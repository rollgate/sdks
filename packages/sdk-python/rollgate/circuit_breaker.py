"""
Circuit Breaker implementation.

Prevents cascading failures by failing fast when a service is down.
"""

import time
from dataclasses import dataclass
from enum import Enum
from typing import Callable, TypeVar, Optional, Awaitable, List

T = TypeVar("T")


class CircuitState(str, Enum):
    """Circuit breaker states."""

    CLOSED = "closed"
    """Normal operation, requests pass through."""

    OPEN = "open"
    """Circuit is open, requests fail fast."""

    HALF_OPEN = "half_open"
    """Testing if service has recovered."""


@dataclass
class CircuitBreakerConfig:
    """Configuration for circuit breaker behavior."""

    failure_threshold: int = 5
    """Number of failures before opening circuit."""

    recovery_timeout_ms: int = 30000
    """Time to wait before attempting recovery."""

    monitoring_window_ms: int = 60000
    """Window for counting failures."""

    success_threshold: int = 3
    """Number of successful requests in half-open to close circuit."""


@dataclass
class CircuitBreakerStats:
    """Statistics about circuit breaker state."""

    state: CircuitState
    failures: int
    last_failure_time: Optional[float]
    half_open_successes: int


class CircuitOpenError(Exception):
    """Raised when circuit breaker is open."""

    def __init__(self, message: str = "Circuit breaker is open", retry_after_ms: int = 0):
        super().__init__(message)
        self.retry_after_ms = retry_after_ms


DEFAULT_CIRCUIT_BREAKER_CONFIG = CircuitBreakerConfig()


class CircuitBreaker:
    """
    Circuit Breaker implementation.

    States:
    - CLOSED: Normal operation, all requests pass through
    - OPEN: Service is down, all requests fail immediately
    - HALF_OPEN: Testing recovery, limited requests allowed
    """

    def __init__(self, config: Optional[CircuitBreakerConfig] = None):
        self._config = config or DEFAULT_CIRCUIT_BREAKER_CONFIG
        self._state = CircuitState.CLOSED
        self._failures: List[float] = []
        self._last_failure_time: float = 0
        self._half_open_successes: int = 0
        self._callbacks: dict[str, list[Callable]] = {
            "state_change": [],
            "circuit_open": [],
            "circuit_closed": [],
            "circuit_half_open": [],
        }

    def on(self, event: str, callback: Callable) -> None:
        """Register an event callback."""
        if event in self._callbacks:
            self._callbacks[event].append(callback)

    def off(self, event: str, callback: Callable) -> None:
        """Remove an event callback."""
        if event in self._callbacks and callback in self._callbacks[event]:
            self._callbacks[event].remove(callback)

    def _emit(self, event: str, *args) -> None:
        """Emit an event to all registered callbacks."""
        for callback in self._callbacks.get(event, []):
            try:
                callback(*args)
            except Exception:
                pass  # Don't let callback errors affect circuit breaker

    async def execute(self, fn: Callable[[], Awaitable[T]]) -> T:
        """
        Execute a function through the circuit breaker.

        Args:
            fn: Async function to execute

        Returns:
            Result of the function

        Raises:
            CircuitOpenError: If circuit is open
            Exception: Any exception from the function
        """
        # Check if circuit should transition from OPEN to HALF_OPEN
        if self._state == CircuitState.OPEN:
            if self._should_attempt_reset():
                self._transition_to(CircuitState.HALF_OPEN)
            else:
                retry_after = self._get_time_until_retry()
                raise CircuitOpenError(
                    f"Circuit breaker is open. Will retry after {retry_after}ms",
                    retry_after_ms=retry_after,
                )

        try:
            result = await fn()
            self._on_success()
            return result
        except Exception as error:
            self._on_failure()
            raise

    def _on_success(self) -> None:
        """Handle successful request."""
        if self._state == CircuitState.HALF_OPEN:
            self._half_open_successes += 1

            if self._half_open_successes >= self._config.success_threshold:
                self._reset()

        # Clean up old failures outside monitoring window
        self._cleanup_old_failures()

    def _on_failure(self) -> None:
        """Handle failed request."""
        now = time.time() * 1000  # Convert to ms
        self._failures.append(now)
        self._last_failure_time = now

        # If in HALF_OPEN, immediately open the circuit
        if self._state == CircuitState.HALF_OPEN:
            self._transition_to(CircuitState.OPEN)
            self._half_open_successes = 0
            return

        # Clean up old failures and check threshold
        self._cleanup_old_failures()

        if len(self._failures) >= self._config.failure_threshold:
            self._transition_to(CircuitState.OPEN)

    def _cleanup_old_failures(self) -> None:
        """Remove failures outside the monitoring window."""
        cutoff = time.time() * 1000 - self._config.monitoring_window_ms
        self._failures = [t for t in self._failures if t > cutoff]

    def _should_attempt_reset(self) -> bool:
        """Check if enough time has passed to attempt reset."""
        elapsed = time.time() * 1000 - self._last_failure_time
        return elapsed >= self._config.recovery_timeout_ms

    def _get_time_until_retry(self) -> int:
        """Get time until next retry attempt is allowed."""
        elapsed = time.time() * 1000 - self._last_failure_time
        return max(0, int(self._config.recovery_timeout_ms - elapsed))

    def _transition_to(self, new_state: CircuitState) -> None:
        """Transition to a new state."""
        old_state = self._state
        self._state = new_state

        self._emit("state_change", old_state, new_state)

        if new_state == CircuitState.OPEN:
            self._emit("circuit_open", len(self._failures), self._last_failure_time)
        elif new_state == CircuitState.CLOSED:
            self._emit("circuit_closed")
        elif new_state == CircuitState.HALF_OPEN:
            self._emit("circuit_half_open")

    def _reset(self) -> None:
        """Reset the circuit breaker to closed state."""
        self._failures = []
        self._half_open_successes = 0
        self._transition_to(CircuitState.CLOSED)

    def force_reset(self) -> None:
        """Force reset the circuit breaker (for testing/manual recovery)."""
        self._reset()

    def force_open(self) -> None:
        """Force open the circuit breaker (for testing/manual circuit trip)."""
        self._last_failure_time = time.time() * 1000
        self._transition_to(CircuitState.OPEN)

    @property
    def state(self) -> CircuitState:
        """Get current circuit state."""
        return self._state

    def get_stats(self) -> CircuitBreakerStats:
        """Get circuit breaker statistics."""
        return CircuitBreakerStats(
            state=self._state,
            failures=len(self._failures),
            last_failure_time=self._last_failure_time if self._last_failure_time else None,
            half_open_successes=self._half_open_successes,
        )

    def is_allowing_requests(self) -> bool:
        """Check if circuit is allowing requests."""
        if self._state == CircuitState.CLOSED:
            return True
        if self._state == CircuitState.HALF_OPEN:
            return True
        if self._state == CircuitState.OPEN and self._should_attempt_reset():
            return True
        return False
