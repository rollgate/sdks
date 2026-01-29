package rollgate

import (
	"sync"
	"time"
)

// CacheEntry represents a cached item with metadata.
type CacheEntry struct {
	Flags     map[string]bool
	Timestamp time.Time
}

// CacheResult represents the result of a cache lookup.
type CacheResult struct {
	Flags map[string]bool
	Stale bool
	Found bool
}

// CacheStats holds cache statistics.
type CacheStats struct {
	Hits      int64
	Misses    int64
	StaleHits int64
}

// FlagCache provides in-memory caching for feature flags.
type FlagCache struct {
	mu     sync.RWMutex
	config CacheConfig
	entry  *CacheEntry
	stats  CacheStats
}

// NewFlagCache creates a new FlagCache with the given config.
func NewFlagCache(config CacheConfig) *FlagCache {
	return &FlagCache{
		config: config,
	}
}

// Get retrieves cached flags if available and not expired.
func (c *FlagCache) Get() CacheResult {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.entry == nil {
		c.stats.Misses++
		return CacheResult{Found: false}
	}

	age := time.Since(c.entry.Timestamp)

	// Check if completely expired (past staleTTL)
	if age > c.config.StaleTTL {
		c.stats.Misses++
		c.entry = nil
		return CacheResult{Found: false}
	}

	// Check if stale but usable (past TTL but within staleTTL)
	if age > c.config.TTL {
		c.stats.StaleHits++
		return CacheResult{
			Flags: c.copyFlags(c.entry.Flags),
			Stale: true,
			Found: true,
		}
	}

	// Fresh cache hit
	c.stats.Hits++
	return CacheResult{
		Flags: c.copyFlags(c.entry.Flags),
		Stale: false,
		Found: true,
	}
}

// Set stores flags in the cache.
func (c *FlagCache) Set(flags map[string]bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.entry = &CacheEntry{
		Flags:     c.copyFlags(flags),
		Timestamp: time.Now(),
	}
}

// Clear removes all cached data.
func (c *FlagCache) Clear() {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.entry = nil
}

// HasFresh returns true if cache has fresh (non-stale) data.
func (c *FlagCache) HasFresh() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()

	if c.entry == nil {
		return false
	}

	return time.Since(c.entry.Timestamp) <= c.config.TTL
}

// HasAny returns true if cache has any data (including stale).
func (c *FlagCache) HasAny() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()

	if c.entry == nil {
		return false
	}

	return time.Since(c.entry.Timestamp) <= c.config.StaleTTL
}

// GetStats returns cache statistics.
func (c *FlagCache) GetStats() CacheStats {
	c.mu.RLock()
	defer c.mu.RUnlock()

	return CacheStats{
		Hits:      c.stats.Hits,
		Misses:    c.stats.Misses,
		StaleHits: c.stats.StaleHits,
	}
}

// GetHitRate returns the cache hit rate (0-1).
func (c *FlagCache) GetHitRate() float64 {
	c.mu.RLock()
	defer c.mu.RUnlock()

	total := c.stats.Hits + c.stats.Misses + c.stats.StaleHits
	if total == 0 {
		return 0
	}

	return float64(c.stats.Hits+c.stats.StaleHits) / float64(total)
}

// copyFlags creates a copy of the flags map to prevent external mutation.
func (c *FlagCache) copyFlags(flags map[string]bool) map[string]bool {
	if flags == nil {
		return nil
	}

	copy := make(map[string]bool, len(flags))
	for k, v := range flags {
		copy[k] = v
	}
	return copy
}
