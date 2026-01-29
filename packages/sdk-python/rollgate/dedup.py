"""
Request deduplication to prevent duplicate inflight requests.
"""

import asyncio
import time
from dataclasses import dataclass, field
from typing import Dict, Optional, Any, Callable, Awaitable, TypeVar, Generic

T = TypeVar("T")


@dataclass
class DedupConfig:
    """Configuration for request deduplication."""

    enabled: bool = True
    """Enable request deduplication."""

    ttl_ms: int = 5000
    """Time-to-live for inflight request tracking (default: 5s)."""


DEFAULT_DEDUP_CONFIG = DedupConfig()


@dataclass
class InflightRequest(Generic[T]):
    """Represents an inflight request."""

    future: asyncio.Future
    timestamp: float
    key: str


class RequestDeduplicator:
    """
    Deduplicates concurrent identical requests.

    When multiple callers request the same resource simultaneously,
    only one actual request is made and the result is shared.

    Example:
        ```python
        dedup = RequestDeduplicator()

        # These concurrent calls will result in only one actual fetch
        async with asyncio.TaskGroup() as tg:
            tg.create_task(dedup.dedupe("flags", fetch_flags))
            tg.create_task(dedup.dedupe("flags", fetch_flags))
            tg.create_task(dedup.dedupe("flags", fetch_flags))
        ```
    """

    def __init__(self, config: DedupConfig = DEFAULT_DEDUP_CONFIG):
        """
        Initialize the deduplicator.

        Args:
            config: Deduplication configuration
        """
        self._config = config
        self._inflight: Dict[str, InflightRequest] = {}
        self._lock = asyncio.Lock()

        # Statistics
        self._total_requests = 0
        self._deduplicated_requests = 0

    async def dedupe(
        self,
        key: str,
        request_fn: Callable[[], Awaitable[T]],
    ) -> T:
        """
        Execute a request with deduplication.

        If an identical request (by key) is already inflight,
        wait for its result instead of making a new request.

        Args:
            key: Unique key for this request type
            request_fn: Async function to execute if no inflight request exists

        Returns:
            Result of the request
        """
        if not self._config.enabled:
            return await request_fn()

        async with self._lock:
            self._total_requests += 1

            # Clean up expired inflight requests
            self._cleanup_expired()

            # Check for existing inflight request
            if key in self._inflight:
                inflight = self._inflight[key]
                self._deduplicated_requests += 1
                # Wait for existing request to complete
                return await inflight.future

            # Create new inflight request
            loop = asyncio.get_running_loop()
            future: asyncio.Future = loop.create_future()
            self._inflight[key] = InflightRequest(
                future=future,
                timestamp=time.time(),
                key=key,
            )

        # Execute request outside lock
        try:
            result = await request_fn()
            # Set result for all waiters
            if not future.done():
                future.set_result(result)
            return result
        except Exception as e:
            # Propagate error to all waiters
            if not future.done():
                future.set_exception(e)
            raise
        finally:
            # Remove from inflight
            async with self._lock:
                if key in self._inflight and self._inflight[key].future is future:
                    del self._inflight[key]

    def _cleanup_expired(self) -> None:
        """Remove expired inflight requests."""
        now = time.time()
        ttl_seconds = self._config.ttl_ms / 1000
        expired_keys = [
            key
            for key, req in self._inflight.items()
            if now - req.timestamp > ttl_seconds
        ]
        for key in expired_keys:
            del self._inflight[key]

    @property
    def inflight_count(self) -> int:
        """Get number of currently inflight requests."""
        return len(self._inflight)

    def get_stats(self) -> Dict[str, Any]:
        """
        Get deduplication statistics.

        Returns:
            Dictionary with total_requests, deduplicated_requests, dedup_rate
        """
        total = self._total_requests
        deduped = self._deduplicated_requests
        return {
            "total_requests": total,
            "deduplicated_requests": deduped,
            "dedup_rate": deduped / total if total > 0 else 0,
            "inflight_count": len(self._inflight),
        }

    def reset_stats(self) -> None:
        """Reset statistics counters."""
        self._total_requests = 0
        self._deduplicated_requests = 0

    async def clear(self) -> None:
        """Clear all inflight requests."""
        async with self._lock:
            self._inflight.clear()
