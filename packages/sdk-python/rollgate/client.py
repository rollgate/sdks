"""
Rollgate client for feature flag evaluation.
"""

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Optional, Dict, Callable, Any, List

import httpx
from httpx_sse import aconnect_sse

from rollgate.cache import FlagCache, CacheConfig, DEFAULT_CACHE_CONFIG
from rollgate.circuit_breaker import (
    CircuitBreaker,
    CircuitBreakerConfig,
    CircuitOpenError,
    CircuitState,
    DEFAULT_CIRCUIT_BREAKER_CONFIG,
)
from rollgate.retry import (
    RetryConfig,
    DEFAULT_RETRY_CONFIG,
    fetch_with_retry,
)
from rollgate.errors import (
    RollgateError,
    AuthenticationError,
    NetworkError,
    RateLimitError,
    classify_error,
)

logger = logging.getLogger("rollgate")


@dataclass
class UserContext:
    """User context for targeting."""

    id: str
    email: Optional[str] = None
    attributes: Optional[Dict[str, Any]] = None


@dataclass
class RollgateConfig:
    """Configuration for Rollgate client."""

    api_key: str
    """API key for authentication."""

    base_url: str = "https://api.rollgate.io"
    """Base URL for the API."""

    refresh_interval_ms: int = 30000
    """Polling interval in milliseconds (default: 30s). Set to 0 to disable."""

    enable_streaming: bool = False
    """Use SSE for real-time updates (default: False)."""

    timeout_ms: int = 5000
    """Request timeout in milliseconds."""

    retry: RetryConfig = field(default_factory=lambda: DEFAULT_RETRY_CONFIG)
    """Retry configuration."""

    circuit_breaker: CircuitBreakerConfig = field(
        default_factory=lambda: DEFAULT_CIRCUIT_BREAKER_CONFIG
    )
    """Circuit breaker configuration."""

    cache: CacheConfig = field(default_factory=lambda: DEFAULT_CACHE_CONFIG)
    """Cache configuration."""


class RollgateClient:
    """
    Rollgate feature flag client.

    Example:
        ```python
        client = RollgateClient(RollgateConfig(api_key="your-api-key"))
        await client.init()

        if client.is_enabled("my-feature"):
            # Feature is enabled
            pass

        await client.close()
        ```
    """

    def __init__(self, config: RollgateConfig):
        """
        Initialize the Rollgate client.

        Args:
            config: Client configuration
        """
        self._config = config
        self._flags: Dict[str, bool] = {}
        self._initialized = False
        self._user_context: Optional[UserContext] = None
        self._circuit_breaker = CircuitBreaker(config.circuit_breaker)
        self._cache = FlagCache(config.cache)
        self._last_etag: Optional[str] = None
        self._poll_task: Optional[asyncio.Task] = None
        self._sse_task: Optional[asyncio.Task] = None
        self._http_client: Optional[httpx.AsyncClient] = None
        self._closing = False

        # Event callbacks
        self._callbacks: Dict[str, List[Callable]] = {
            "ready": [],
            "flags_updated": [],
            "flags_stale": [],
            "flag_changed": [],
            "error": [],
            "circuit_open": [],
            "circuit_closed": [],
            "circuit_half_open": [],
        }

        # Forward circuit breaker events
        self._circuit_breaker.on("circuit_open", lambda *args: self._emit("circuit_open", *args))
        self._circuit_breaker.on("circuit_closed", lambda: self._emit("circuit_closed"))
        self._circuit_breaker.on("circuit_half_open", lambda: self._emit("circuit_half_open"))

    def on(self, event: str, callback: Callable) -> "RollgateClient":
        """
        Register an event callback.

        Args:
            event: Event name
            callback: Callback function

        Returns:
            Self for chaining
        """
        if event in self._callbacks:
            self._callbacks[event].append(callback)
        return self

    def off(self, event: str, callback: Callable) -> "RollgateClient":
        """
        Remove an event callback.

        Args:
            event: Event name
            callback: Callback function

        Returns:
            Self for chaining
        """
        if event in self._callbacks and callback in self._callbacks[event]:
            self._callbacks[event].remove(callback)
        return self

    def _emit(self, event: str, *args) -> None:
        """Emit an event to all registered callbacks."""
        for callback in self._callbacks.get(event, []):
            try:
                callback(*args)
            except Exception as e:
                logger.warning(f"Error in event callback: {e}")

    async def init(self, user: Optional[UserContext] = None) -> None:
        """
        Initialize the client and fetch initial flags.

        Args:
            user: Optional user context for targeting
        """
        self._user_context = user
        self._http_client = httpx.AsyncClient(timeout=self._config.timeout_ms / 1000)

        # Try to load cached flags first
        self._cache.load()
        cached = self._cache.get()
        if cached:
            self._flags = cached.flags.copy()
            if cached.stale:
                self._emit("flags_stale", self.get_all_flags())

        # Fetch fresh flags
        await self._fetch_flags()
        self._initialized = True

        # Start background refresh
        if self._config.enable_streaming:
            self._sse_task = asyncio.create_task(self._start_streaming())
        elif self._config.refresh_interval_ms > 0:
            self._poll_task = asyncio.create_task(self._start_polling())

        self._emit("ready")

    async def _start_polling(self) -> None:
        """Start background polling for flag updates."""
        while not self._closing:
            await asyncio.sleep(self._config.refresh_interval_ms / 1000)
            if self._closing:
                break
            try:
                await self._fetch_flags()
            except Exception as e:
                logger.warning(f"Polling error: {e}")

    async def _start_streaming(self) -> None:
        """Start SSE streaming for real-time updates."""
        url = f"{self._config.base_url}/api/v1/sdk/stream"
        params = {}
        if self._user_context:
            params["user_id"] = self._user_context.id

        headers = {
            "Authorization": f"Bearer {self._config.api_key}",
        }

        while not self._closing:
            try:
                async with aconnect_sse(
                    self._http_client,
                    "GET",
                    url,
                    params=params,
                    headers=headers,
                ) as event_source:
                    async for event in event_source.aiter_sse():
                        if self._closing:
                            break
                        if event.data:
                            try:
                                import json

                                data = json.loads(event.data)
                                new_flags = data.get("flags", {})
                                self._update_flags(new_flags)
                            except Exception as e:
                                logger.warning(f"Failed to parse SSE message: {e}")
            except Exception as e:
                if not self._closing:
                    logger.warning(f"SSE connection error, reconnecting: {e}")
                    await asyncio.sleep(5)  # Wait before reconnecting

    async def _fetch_flags(self) -> None:
        """Fetch all flags from the API."""
        url = f"{self._config.base_url}/api/v1/sdk/flags"
        params = {}
        if self._user_context:
            params["user_id"] = self._user_context.id

        # Check if circuit breaker allows the request
        if not self._circuit_breaker.is_allowing_requests():
            logger.warning("Circuit breaker is open, using cached flags")
            self._use_cached_fallback()
            return

        try:
            # Execute through circuit breaker with retry
            result = await self._circuit_breaker.execute(
                lambda: self._do_fetch_flags(url, params)
            )

            if result is None:
                # 304 Not Modified
                return

            # Update cache and flags
            self._cache.set("flags", result)
            self._update_flags(result)

        except CircuitOpenError:
            logger.warning("Circuit breaker is open")
            self._use_cached_fallback()
        except Exception as e:
            classified = classify_error(e)
            logger.error(f"Error fetching flags: {classified.message}")
            self._emit("error", classified)
            self._use_cached_fallback()

    async def _do_fetch_flags(self, url: str, params: Dict) -> Optional[Dict[str, bool]]:
        """Execute the actual fetch with retry."""
        result = await fetch_with_retry(
            lambda: self._single_fetch(url, params),
            self._config.retry,
        )

        if not result.success:
            raise result.error or Exception("Fetch failed")

        return result.data

    async def _single_fetch(self, url: str, params: Dict) -> Optional[Dict[str, bool]]:
        """Single fetch attempt."""
        headers = {
            "Authorization": f"Bearer {self._config.api_key}",
            "Content-Type": "application/json",
        }
        if self._last_etag:
            headers["If-None-Match"] = self._last_etag

        response = await self._http_client.get(url, params=params, headers=headers)

        # Handle 304 Not Modified
        if response.status_code == 304:
            return None

        # Handle errors
        if response.status_code == 401 or response.status_code == 403:
            raise AuthenticationError(
                f"Authentication failed: {response.status_code}",
                response.status_code,
            )

        if response.status_code == 429:
            retry_after = response.headers.get("Retry-After")
            raise RateLimitError(
                "Rate limit exceeded",
                retry_after=int(retry_after) if retry_after else None,
            )

        if response.status_code >= 500:
            raise RollgateError(
                f"Server error: {response.status_code}",
                status_code=response.status_code,
                retryable=True,
            )

        if not response.is_success:
            raise RollgateError(
                f"Request failed: {response.status_code}",
                status_code=response.status_code,
            )

        # Store ETag for conditional requests
        etag = response.headers.get("ETag")
        if etag:
            self._last_etag = etag

        data = response.json()
        return data.get("flags", {})

    def _update_flags(self, new_flags: Dict[str, bool]) -> None:
        """Update flags and emit change events."""
        old_flags = self._flags.copy()
        self._flags = new_flags.copy()

        # Emit change events for changed flags
        for key, value in self._flags.items():
            old_value = old_flags.get(key)
            if old_value != value:
                self._emit("flag_changed", key, value, old_value)

        self._emit("flags_updated", self.get_all_flags())

    def _use_cached_fallback(self) -> None:
        """Use cached flags as fallback."""
        cached = self._cache.get()
        if cached:
            self._update_flags(cached.flags)
            if cached.stale:
                self._emit("flags_stale", self.get_all_flags())

    def is_enabled(self, flag_key: str, default_value: bool = False) -> bool:
        """
        Check if a flag is enabled.

        Args:
            flag_key: The flag key to check
            default_value: Default value if flag not found

        Returns:
            True if the flag is enabled
        """
        if not self._initialized:
            logger.warning("Client not initialized. Call init() first.")
            return default_value

        return self._flags.get(flag_key, default_value)

    def get_all_flags(self) -> Dict[str, bool]:
        """
        Get all flags as a dictionary.

        Returns:
            Dictionary of flag keys to boolean values
        """
        return self._flags.copy()

    async def identify(self, user: UserContext) -> None:
        """
        Update user context and re-fetch flags.

        Args:
            user: New user context
        """
        self._user_context = user
        await self._fetch_flags()

    async def reset(self) -> None:
        """Clear user context and re-fetch flags."""
        self._user_context = None
        await self._fetch_flags()

    async def refresh(self) -> None:
        """Force refresh flags."""
        await self._fetch_flags()

    @property
    def circuit_state(self) -> CircuitState:
        """Get current circuit breaker state."""
        return self._circuit_breaker.state

    def get_circuit_stats(self):
        """Get circuit breaker statistics."""
        return self._circuit_breaker.get_stats()

    def reset_circuit(self) -> None:
        """Force reset the circuit breaker."""
        self._circuit_breaker.force_reset()

    def get_cache_stats(self):
        """Get cache statistics."""
        return self._cache.get_stats()

    def get_cache_hit_rate(self) -> float:
        """Get cache hit rate."""
        return self._cache.get_hit_rate()

    def clear_cache(self) -> None:
        """Clear the cache."""
        self._cache.clear()

    async def close(self) -> None:
        """Close the client and cleanup resources."""
        self._closing = True

        # Cancel background tasks
        if self._poll_task:
            self._poll_task.cancel()
            try:
                await self._poll_task
            except asyncio.CancelledError:
                pass

        if self._sse_task:
            self._sse_task.cancel()
            try:
                await self._sse_task
            except asyncio.CancelledError:
                pass

        # Close HTTP client
        if self._http_client:
            await self._http_client.aclose()

        # Close cache
        self._cache.close()

    async def __aenter__(self) -> "RollgateClient":
        """Async context manager entry."""
        await self.init()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """Async context manager exit."""
        await self.close()
