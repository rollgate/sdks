package rollgate

import (
	"testing"
	"time"
)

func TestFlagCache_GetSet(t *testing.T) {
	t.Run("should return empty result for empty cache", func(t *testing.T) {
		cache := NewFlagCache(DefaultCacheConfig())
		result := cache.Get()

		if result.Found {
			t.Error("expected Found to be false")
		}
	})

	t.Run("should store and retrieve flags", func(t *testing.T) {
		cache := NewFlagCache(DefaultCacheConfig())
		flags := map[string]bool{"test-flag": true, "another-flag": false}

		cache.Set(flags)
		result := cache.Get()

		if !result.Found {
			t.Error("expected Found to be true")
		}
		if result.Stale {
			t.Error("expected Stale to be false")
		}
		if result.Flags["test-flag"] != true {
			t.Error("expected test-flag to be true")
		}
		if result.Flags["another-flag"] != false {
			t.Error("expected another-flag to be false")
		}
	})
}

func TestFlagCache_TTL(t *testing.T) {
	t.Run("should return stale data after TTL", func(t *testing.T) {
		config := CacheConfig{
			TTL:      10 * time.Millisecond,
			StaleTTL: 1 * time.Hour,
			Enabled:  true,
		}
		cache := NewFlagCache(config)
		cache.Set(map[string]bool{"test": true})

		// Wait for TTL to expire
		time.Sleep(15 * time.Millisecond)

		result := cache.Get()
		if !result.Found {
			t.Error("expected Found to be true")
		}
		if !result.Stale {
			t.Error("expected Stale to be true")
		}
	})

	t.Run("should return empty after staleTTL", func(t *testing.T) {
		config := CacheConfig{
			TTL:      5 * time.Millisecond,
			StaleTTL: 10 * time.Millisecond,
			Enabled:  true,
		}
		cache := NewFlagCache(config)
		cache.Set(map[string]bool{"test": true})

		// Wait for staleTTL to expire
		time.Sleep(15 * time.Millisecond)

		result := cache.Get()
		if result.Found {
			t.Error("expected Found to be false")
		}
	})
}

func TestFlagCache_HasFreshHasAny(t *testing.T) {
	t.Run("HasFresh should return true for fresh data", func(t *testing.T) {
		cache := NewFlagCache(DefaultCacheConfig())
		cache.Set(map[string]bool{"test": true})

		if !cache.HasFresh() {
			t.Error("expected HasFresh to be true")
		}
	})

	t.Run("HasAny should return true for stale data", func(t *testing.T) {
		config := CacheConfig{
			TTL:      5 * time.Millisecond,
			StaleTTL: 1 * time.Hour,
			Enabled:  true,
		}
		cache := NewFlagCache(config)
		cache.Set(map[string]bool{"test": true})

		time.Sleep(10 * time.Millisecond)

		if cache.HasFresh() {
			t.Error("expected HasFresh to be false")
		}
		if !cache.HasAny() {
			t.Error("expected HasAny to be true")
		}
	})

	t.Run("both should return false for empty cache", func(t *testing.T) {
		cache := NewFlagCache(DefaultCacheConfig())

		if cache.HasFresh() {
			t.Error("expected HasFresh to be false")
		}
		if cache.HasAny() {
			t.Error("expected HasAny to be false")
		}
	})
}

func TestFlagCache_Clear(t *testing.T) {
	cache := NewFlagCache(DefaultCacheConfig())
	cache.Set(map[string]bool{"test": true})
	cache.Clear()

	result := cache.Get()
	if result.Found {
		t.Error("expected Found to be false after Clear")
	}
}

func TestFlagCache_Stats(t *testing.T) {
	t.Run("should track hits", func(t *testing.T) {
		cache := NewFlagCache(DefaultCacheConfig())
		cache.Set(map[string]bool{"test": true})

		cache.Get()
		cache.Get()

		stats := cache.GetStats()
		if stats.Hits != 2 {
			t.Errorf("expected 2 hits, got %d", stats.Hits)
		}
	})

	t.Run("should track misses", func(t *testing.T) {
		cache := NewFlagCache(DefaultCacheConfig())

		cache.Get()
		cache.Get()

		stats := cache.GetStats()
		if stats.Misses != 2 {
			t.Errorf("expected 2 misses, got %d", stats.Misses)
		}
	})

	t.Run("should track stale hits", func(t *testing.T) {
		config := CacheConfig{
			TTL:      5 * time.Millisecond,
			StaleTTL: 1 * time.Hour,
			Enabled:  true,
		}
		cache := NewFlagCache(config)
		cache.Set(map[string]bool{"test": true})

		time.Sleep(10 * time.Millisecond)

		cache.Get()
		cache.Get()

		stats := cache.GetStats()
		if stats.StaleHits != 2 {
			t.Errorf("expected 2 stale hits, got %d", stats.StaleHits)
		}
	})
}
