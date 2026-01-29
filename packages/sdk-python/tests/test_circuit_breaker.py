"""Tests for circuit breaker."""

import pytest
import asyncio
from rollgate.circuit_breaker import (
    CircuitBreaker,
    CircuitBreakerConfig,
    CircuitState,
    CircuitOpenError,
)


@pytest.fixture
def circuit_breaker():
    """Create a circuit breaker with fast timeouts for testing."""
    config = CircuitBreakerConfig(
        failure_threshold=3,
        recovery_timeout_ms=100,
        monitoring_window_ms=1000,
        success_threshold=2,
    )
    return CircuitBreaker(config)


class TestCircuitBreaker:
    """Tests for CircuitBreaker class."""

    async def test_initial_state_is_closed(self, circuit_breaker):
        """Circuit should start in closed state."""
        assert circuit_breaker.state == CircuitState.CLOSED

    async def test_successful_request_keeps_circuit_closed(self, circuit_breaker):
        """Successful requests should keep circuit closed."""

        async def success():
            return "ok"

        result = await circuit_breaker.execute(success)
        assert result == "ok"
        assert circuit_breaker.state == CircuitState.CLOSED

    async def test_failures_open_circuit(self, circuit_breaker):
        """Enough failures should open the circuit."""

        async def failure():
            raise Exception("fail")

        # Cause failures up to threshold
        for _ in range(3):
            with pytest.raises(Exception):
                await circuit_breaker.execute(failure)

        assert circuit_breaker.state == CircuitState.OPEN

    async def test_open_circuit_rejects_requests(self, circuit_breaker):
        """Open circuit should reject requests immediately."""

        async def failure():
            raise Exception("fail")

        # Open the circuit
        for _ in range(3):
            with pytest.raises(Exception):
                await circuit_breaker.execute(failure)

        # Next request should fail with CircuitOpenError
        async def success():
            return "ok"

        with pytest.raises(CircuitOpenError):
            await circuit_breaker.execute(success)

    async def test_circuit_transitions_to_half_open(self, circuit_breaker):
        """Circuit should transition to half-open after recovery timeout."""

        async def failure():
            raise Exception("fail")

        # Open the circuit
        for _ in range(3):
            with pytest.raises(Exception):
                await circuit_breaker.execute(failure)

        assert circuit_breaker.state == CircuitState.OPEN

        # Wait for recovery timeout
        await asyncio.sleep(0.15)

        # Next request should be allowed (half-open state)
        async def success():
            return "ok"

        result = await circuit_breaker.execute(success)
        assert result == "ok"
        assert circuit_breaker.state == CircuitState.HALF_OPEN

    async def test_half_open_closes_on_success(self, circuit_breaker):
        """Circuit should close after enough successes in half-open."""

        async def failure():
            raise Exception("fail")

        # Open the circuit
        for _ in range(3):
            with pytest.raises(Exception):
                await circuit_breaker.execute(failure)

        await asyncio.sleep(0.15)

        async def success():
            return "ok"

        # Success threshold is 2
        await circuit_breaker.execute(success)
        assert circuit_breaker.state == CircuitState.HALF_OPEN

        await circuit_breaker.execute(success)
        assert circuit_breaker.state == CircuitState.CLOSED

    async def test_half_open_reopens_on_failure(self, circuit_breaker):
        """Circuit should reopen on failure in half-open state."""

        async def failure():
            raise Exception("fail")

        # Open the circuit
        for _ in range(3):
            with pytest.raises(Exception):
                await circuit_breaker.execute(failure)

        await asyncio.sleep(0.15)

        async def success():
            return "ok"

        # Allow one success
        await circuit_breaker.execute(success)
        assert circuit_breaker.state == CircuitState.HALF_OPEN

        # Then fail
        with pytest.raises(Exception):
            await circuit_breaker.execute(failure)

        assert circuit_breaker.state == CircuitState.OPEN

    async def test_force_reset(self, circuit_breaker):
        """Force reset should close the circuit."""

        async def failure():
            raise Exception("fail")

        # Open the circuit
        for _ in range(3):
            with pytest.raises(Exception):
                await circuit_breaker.execute(failure)

        assert circuit_breaker.state == CircuitState.OPEN

        circuit_breaker.force_reset()
        assert circuit_breaker.state == CircuitState.CLOSED

    async def test_force_open(self, circuit_breaker):
        """Force open should open the circuit."""
        assert circuit_breaker.state == CircuitState.CLOSED

        circuit_breaker.force_open()
        assert circuit_breaker.state == CircuitState.OPEN

    async def test_get_stats(self, circuit_breaker):
        """Should return correct statistics."""

        async def failure():
            raise Exception("fail")

        with pytest.raises(Exception):
            await circuit_breaker.execute(failure)

        stats = circuit_breaker.get_stats()
        assert stats.state == CircuitState.CLOSED
        assert stats.failures == 1
        assert stats.last_failure_time is not None

    async def test_is_allowing_requests(self, circuit_breaker):
        """Should correctly report if requests are allowed."""
        assert circuit_breaker.is_allowing_requests() is True

        async def failure():
            raise Exception("fail")

        # Open circuit
        for _ in range(3):
            with pytest.raises(Exception):
                await circuit_breaker.execute(failure)

        assert circuit_breaker.is_allowing_requests() is False

        # After recovery timeout
        await asyncio.sleep(0.15)
        assert circuit_breaker.is_allowing_requests() is True
