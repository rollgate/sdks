"""
Flag cache with stale-while-revalidate support.
"""

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, Callable, Dict, Any


@dataclass
class CacheConfig:
    """Configuration for cache behavior."""

    ttl_ms: int = 300000
    """Time-to-live for fresh cache entries (default: 5 minutes)."""

    stale_ttl_ms: int = 3600000
    """Time-to-live for stale cache entries (default: 1 hour)."""

    persist_path: Optional[str] = None
    """File path for persistent cache."""


@dataclass
class CacheStats:
    """Cache statistics."""

    hits: int = 0
    misses: int = 0
    stale_hits: int = 0
    size: int = 0


@dataclass
class CacheEntry:
    """Cache entry with metadata."""

    value: Dict[str, bool]
    timestamp: float
    stale: bool = False


@dataclass
class CacheResult:
    """Result of a cache lookup."""

    flags: Dict[str, bool]
    stale: bool


DEFAULT_CACHE_CONFIG = CacheConfig()


class FlagCache:
    """
    Flag cache with stale fallback support.

    Features:
    - In-memory caching with configurable TTL
    - Stale-while-revalidate pattern
    - File persistence
    - Event callbacks for cache state changes
    """

    def __init__(self, config: Optional[CacheConfig] = None):
        self._config = config or DEFAULT_CACHE_CONFIG
        self._cache: Dict[str, CacheEntry] = {}
        self._stats = CacheStats()
        self._callbacks: Dict[str, list[Callable]] = {
            "cache_hit": [],
            "cache_miss": [],
            "cache_set": [],
            "cache_expired": [],
            "cache_stale": [],
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
                pass

    def get(self, key: str = "flags") -> Optional[CacheResult]:
        """
        Get cached flags.

        Args:
            key: Cache key

        Returns:
            CacheResult with flags and stale indicator, or None if not found
        """
        entry = self._cache.get(key)

        if entry is None:
            self._stats.misses += 1
            self._emit("cache_miss", key)
            return None

        age_ms = (time.time() - entry.timestamp) * 1000

        # Fresh cache
        if age_ms < self._config.ttl_ms:
            self._stats.hits += 1
            self._emit("cache_hit", key, False, age_ms)
            return CacheResult(flags=entry.value, stale=False)

        # Stale but usable
        if age_ms < self._config.stale_ttl_ms:
            self._stats.stale_hits += 1
            self._emit("cache_hit", key, True, age_ms)
            self._emit("cache_stale", key, age_ms)
            return CacheResult(flags=entry.value, stale=True)

        # Expired - remove from cache
        del self._cache[key]
        self._stats.size = len(self._cache)
        self._stats.misses += 1
        self._emit("cache_expired", key, age_ms)
        return None

    def set(self, key: str, flags: Dict[str, bool]) -> None:
        """
        Store flags in cache.

        Args:
            key: Cache key
            flags: Flags dictionary
        """
        entry = CacheEntry(
            value=flags,
            timestamp=time.time(),
            stale=False,
        )

        self._cache[key] = entry
        self._stats.size = len(self._cache)
        self._emit("cache_set", key, len(flags))

        # Persist if configured
        self._persist()

    def has_fresh(self, key: str = "flags") -> bool:
        """Check if cache has fresh data."""
        entry = self._cache.get(key)
        if entry is None:
            return False
        age_ms = (time.time() - entry.timestamp) * 1000
        return age_ms < self._config.ttl_ms

    def has_any(self, key: str = "flags") -> bool:
        """Check if cache has any data (fresh or stale)."""
        entry = self._cache.get(key)
        if entry is None:
            return False
        age_ms = (time.time() - entry.timestamp) * 1000
        return age_ms < self._config.stale_ttl_ms

    def clear(self) -> None:
        """Clear all cached data."""
        self._cache.clear()
        self._stats.size = 0

    def get_stats(self) -> CacheStats:
        """Get cache statistics."""
        return CacheStats(
            hits=self._stats.hits,
            misses=self._stats.misses,
            stale_hits=self._stats.stale_hits,
            size=self._stats.size,
        )

    def get_hit_rate(self) -> float:
        """Get hit rate (hits / (hits + misses))."""
        total = self._stats.hits + self._stats.stale_hits + self._stats.misses
        if total == 0:
            return 0.0
        return (self._stats.hits + self._stats.stale_hits) / total

    def load(self) -> bool:
        """
        Load cache from persistent storage.

        Returns:
            True if cache was loaded successfully
        """
        if not self._config.persist_path:
            return False

        try:
            path = Path(self._config.persist_path)
            if not path.exists():
                return False

            data = json.loads(path.read_text())
            entries = data.get("entries", [])

            for key, entry_data in entries:
                timestamp = entry_data.get("timestamp", 0)
                age_ms = (time.time() - timestamp) * 1000

                # Only restore if within stale TTL
                if age_ms < self._config.stale_ttl_ms:
                    self._cache[key] = CacheEntry(
                        value=entry_data.get("value", {}),
                        timestamp=timestamp,
                        stale=age_ms >= self._config.ttl_ms,
                    )

            self._stats.size = len(self._cache)
            return True
        except Exception:
            return False

    def _persist(self) -> bool:
        """
        Persist cache to storage.

        Returns:
            True if cache was persisted successfully
        """
        if not self._config.persist_path:
            return False

        try:
            data = {
                "version": 1,
                "entries": [
                    [key, {"value": entry.value, "timestamp": entry.timestamp}]
                    for key, entry in self._cache.items()
                ],
            }
            path = Path(self._config.persist_path)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(data))
            return True
        except Exception:
            return False

    def close(self) -> None:
        """Cleanup resources and final persist."""
        if self._config.persist_path:
            self._persist()
