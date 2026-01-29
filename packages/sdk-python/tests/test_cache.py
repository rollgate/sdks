"""Tests for flag cache."""

import pytest
import time
import tempfile
import os
from pathlib import Path
from rollgate.cache import FlagCache, CacheConfig


@pytest.fixture
def cache():
    """Create a cache with fast TTLs for testing."""
    config = CacheConfig(
        ttl_ms=100,  # 100ms fresh
        stale_ttl_ms=500,  # 500ms stale
    )
    return FlagCache(config)


class TestFlagCache:
    """Tests for FlagCache class."""

    def test_get_returns_none_for_empty_cache(self, cache):
        """Should return None for empty cache."""
        result = cache.get("flags")
        assert result is None

    def test_set_and_get_fresh_data(self, cache):
        """Should store and retrieve fresh data."""
        flags = {"feature-a": True, "feature-b": False}
        cache.set("flags", flags)

        result = cache.get("flags")
        assert result is not None
        assert result.flags == flags
        assert result.stale is False

    def test_data_becomes_stale_after_ttl(self, cache):
        """Data should be marked stale after TTL."""
        flags = {"feature-a": True}
        cache.set("flags", flags)

        # Wait for TTL to expire
        time.sleep(0.15)

        result = cache.get("flags")
        assert result is not None
        assert result.flags == flags
        assert result.stale is True

    def test_data_expires_after_stale_ttl(self, cache):
        """Data should expire after stale TTL."""
        flags = {"feature-a": True}
        cache.set("flags", flags)

        # Wait for stale TTL to expire
        time.sleep(0.6)

        result = cache.get("flags")
        assert result is None

    def test_has_fresh_returns_correct_value(self, cache):
        """has_fresh should return correct value."""
        assert cache.has_fresh("flags") is False

        cache.set("flags", {"a": True})
        assert cache.has_fresh("flags") is True

        time.sleep(0.15)
        assert cache.has_fresh("flags") is False

    def test_has_any_returns_correct_value(self, cache):
        """has_any should return correct value."""
        assert cache.has_any("flags") is False

        cache.set("flags", {"a": True})
        assert cache.has_any("flags") is True

        time.sleep(0.15)  # After TTL but before stale TTL
        assert cache.has_any("flags") is True

        time.sleep(0.5)  # After stale TTL
        assert cache.has_any("flags") is False

    def test_clear_removes_all_data(self, cache):
        """clear should remove all data."""
        cache.set("flags", {"a": True})
        cache.set("other", {"b": False})

        cache.clear()

        assert cache.get("flags") is None
        assert cache.get("other") is None

    def test_stats_tracking(self, cache):
        """Should track cache statistics."""
        # Miss
        cache.get("flags")

        # Set and hit
        cache.set("flags", {"a": True})
        cache.get("flags")

        stats = cache.get_stats()
        assert stats.hits == 1
        assert stats.misses == 1
        assert stats.size == 1

    def test_stale_hits_tracking(self, cache):
        """Should track stale hits."""
        cache.set("flags", {"a": True})
        time.sleep(0.15)  # Make stale

        cache.get("flags")

        stats = cache.get_stats()
        assert stats.stale_hits == 1

    def test_hit_rate_calculation(self, cache):
        """Should calculate hit rate correctly."""
        assert cache.get_hit_rate() == 0.0

        cache.get("flags")  # Miss
        cache.set("flags", {"a": True})
        cache.get("flags")  # Hit

        # 1 hit / 2 total = 0.5
        assert cache.get_hit_rate() == 0.5


class TestCachePersistence:
    """Tests for cache persistence."""

    def test_persist_and_load(self):
        """Should persist and load cache from file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            cache_path = os.path.join(tmpdir, "cache.json")

            # Create and persist cache
            config = CacheConfig(
                ttl_ms=60000,
                stale_ttl_ms=120000,
                persist_path=cache_path,
            )
            cache1 = FlagCache(config)
            cache1.set("flags", {"a": True, "b": False})
            cache1.close()

            # Verify file exists
            assert Path(cache_path).exists()

            # Load in new cache instance
            cache2 = FlagCache(config)
            loaded = cache2.load()

            assert loaded is True
            result = cache2.get("flags")
            assert result is not None
            assert result.flags == {"a": True, "b": False}

    def test_load_nonexistent_file(self):
        """Should return False for nonexistent file."""
        config = CacheConfig(persist_path="/nonexistent/path/cache.json")
        cache = FlagCache(config)

        result = cache.load()
        assert result is False

    def test_expired_data_not_loaded(self):
        """Should not load expired data from file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            cache_path = os.path.join(tmpdir, "cache.json")

            # Create cache with very short TTL
            config = CacheConfig(
                ttl_ms=10,
                stale_ttl_ms=50,
                persist_path=cache_path,
            )
            cache1 = FlagCache(config)
            cache1.set("flags", {"a": True})
            cache1.close()

            # Wait for stale TTL
            time.sleep(0.1)

            # Load - should not restore expired data
            cache2 = FlagCache(config)
            cache2.load()

            result = cache2.get("flags")
            assert result is None


class TestCacheEvents:
    """Tests for cache events."""

    def test_cache_hit_event(self, cache):
        """Should emit cache_hit event."""
        events = []
        cache.on("cache_hit", lambda *args: events.append(("hit", args)))

        cache.set("flags", {"a": True})
        cache.get("flags")

        assert len(events) == 1
        assert events[0][0] == "hit"

    def test_cache_miss_event(self, cache):
        """Should emit cache_miss event."""
        events = []
        cache.on("cache_miss", lambda *args: events.append(("miss", args)))

        cache.get("flags")

        assert len(events) == 1
        assert events[0][0] == "miss"

    def test_cache_set_event(self, cache):
        """Should emit cache_set event."""
        events = []
        cache.on("cache_set", lambda *args: events.append(("set", args)))

        cache.set("flags", {"a": True, "b": False})

        assert len(events) == 1
        assert events[0][0] == "set"
