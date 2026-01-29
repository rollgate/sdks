package io.rollgate;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;

class FlagCacheTest {

    @Test
    void shouldReturnEmptyWhenNoData() {
        FlagCache cache = new FlagCache();

        Optional<FlagCache.CacheResult> result = cache.get();

        assertFalse(result.isPresent());
    }

    @Test
    void shouldStoreAndRetrieveFlags() {
        FlagCache cache = new FlagCache();
        Map<String, Boolean> flags = new HashMap<>();
        flags.put("feature-a", true);
        flags.put("feature-b", false);

        cache.set(flags);
        Optional<FlagCache.CacheResult> result = cache.get();

        assertTrue(result.isPresent());
        assertEquals(true, result.get().getFlags().get("feature-a"));
        assertEquals(false, result.get().getFlags().get("feature-b"));
        assertFalse(result.get().isStale());
    }

    @Test
    void shouldMarkAsStaleAfterTtl() throws Exception {
        Config.CacheConfig config = new Config.CacheConfig()
            .setTtl(Duration.ofMillis(50))
            .setStaleTtl(Duration.ofSeconds(10));
        FlagCache cache = new FlagCache(config);

        Map<String, Boolean> flags = new HashMap<>();
        flags.put("feature", true);
        cache.set(flags);

        Thread.sleep(60);

        Optional<FlagCache.CacheResult> result = cache.get();
        assertTrue(result.isPresent());
        assertTrue(result.get().isStale());
    }

    @Test
    void shouldExpireAfterStaleTtl() throws Exception {
        Config.CacheConfig config = new Config.CacheConfig()
            .setTtl(Duration.ofMillis(10))
            .setStaleTtl(Duration.ofMillis(50));
        FlagCache cache = new FlagCache(config);

        Map<String, Boolean> flags = new HashMap<>();
        flags.put("feature", true);
        cache.set(flags);

        Thread.sleep(60);

        Optional<FlagCache.CacheResult> result = cache.get();
        assertFalse(result.isPresent());
    }

    @Test
    void shouldClearCache() {
        FlagCache cache = new FlagCache();
        Map<String, Boolean> flags = new HashMap<>();
        flags.put("feature", true);
        cache.set(flags);

        cache.clear();

        Optional<FlagCache.CacheResult> result = cache.get();
        assertFalse(result.isPresent());
    }

    @Test
    void shouldTrackHits() {
        FlagCache cache = new FlagCache();
        Map<String, Boolean> flags = new HashMap<>();
        flags.put("feature", true);
        cache.set(flags);

        cache.get();
        cache.get();
        cache.get();

        FlagCache.CacheStats stats = cache.getStats();
        assertEquals(3, stats.getHits());
        assertEquals(0, stats.getMisses());
    }

    @Test
    void shouldTrackMisses() {
        FlagCache cache = new FlagCache();

        cache.get();
        cache.get();

        FlagCache.CacheStats stats = cache.getStats();
        assertEquals(0, stats.getHits());
        assertEquals(2, stats.getMisses());
    }

    @Test
    void shouldTrackStaleHits() throws Exception {
        Config.CacheConfig config = new Config.CacheConfig()
            .setTtl(Duration.ofMillis(10))
            .setStaleTtl(Duration.ofSeconds(10));
        FlagCache cache = new FlagCache(config);

        Map<String, Boolean> flags = new HashMap<>();
        flags.put("feature", true);
        cache.set(flags);

        Thread.sleep(20);

        cache.get();
        cache.get();

        FlagCache.CacheStats stats = cache.getStats();
        assertEquals(0, stats.getHits());
        assertEquals(2, stats.getStaleHits());
    }

    @Test
    void hasFreshShouldReturnTrueWhenFresh() {
        FlagCache cache = new FlagCache();
        Map<String, Boolean> flags = new HashMap<>();
        flags.put("feature", true);
        cache.set(flags);

        assertTrue(cache.hasFresh());
    }

    @Test
    void hasFreshShouldReturnFalseWhenStale() throws Exception {
        Config.CacheConfig config = new Config.CacheConfig()
            .setTtl(Duration.ofMillis(10))
            .setStaleTtl(Duration.ofSeconds(10));
        FlagCache cache = new FlagCache(config);

        Map<String, Boolean> flags = new HashMap<>();
        flags.put("feature", true);
        cache.set(flags);

        Thread.sleep(20);

        assertFalse(cache.hasFresh());
    }

    @Test
    void hasAnyShouldReturnTrueWhenStale() throws Exception {
        Config.CacheConfig config = new Config.CacheConfig()
            .setTtl(Duration.ofMillis(10))
            .setStaleTtl(Duration.ofSeconds(10));
        FlagCache cache = new FlagCache(config);

        Map<String, Boolean> flags = new HashMap<>();
        flags.put("feature", true);
        cache.set(flags);

        Thread.sleep(20);

        assertTrue(cache.hasAny());
    }

    @Test
    void hasAnyShouldReturnFalseWhenExpired() throws Exception {
        Config.CacheConfig config = new Config.CacheConfig()
            .setTtl(Duration.ofMillis(10))
            .setStaleTtl(Duration.ofMillis(30));
        FlagCache cache = new FlagCache(config);

        Map<String, Boolean> flags = new HashMap<>();
        flags.put("feature", true);
        cache.set(flags);

        Thread.sleep(50);

        assertFalse(cache.hasAny());
    }

    @Test
    void getHitRateShouldBeZeroWhenEmpty() {
        FlagCache cache = new FlagCache();
        assertEquals(0.0, cache.getHitRate());
    }

    @Test
    void getHitRateShouldCalculateCorrectly() {
        FlagCache cache = new FlagCache();
        Map<String, Boolean> flags = new HashMap<>();
        flags.put("feature", true);
        cache.set(flags);

        cache.get(); // hit
        cache.get(); // hit
        cache.clear();
        cache.get(); // miss
        cache.get(); // miss

        FlagCache.CacheStats stats = cache.getStats();
        assertEquals(2, stats.getHits());
        assertEquals(2, stats.getMisses());
        assertEquals(0.5, cache.getHitRate(), 0.001);
    }

    @Test
    void shouldReturnUnmodifiableFlags() {
        FlagCache cache = new FlagCache();
        Map<String, Boolean> flags = new HashMap<>();
        flags.put("feature", true);
        cache.set(flags);

        Optional<FlagCache.CacheResult> result = cache.get();
        assertTrue(result.isPresent());

        assertThrows(UnsupportedOperationException.class, () -> {
            result.get().getFlags().put("new-feature", false);
        });
    }
}
