package io.rollgate;

import java.time.Duration;
import java.time.Instant;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.locks.ReentrantReadWriteLock;

/**
 * In-memory cache for feature flags.
 */
public class FlagCache {

    private final Config.CacheConfig config;
    private final ReentrantReadWriteLock lock = new ReentrantReadWriteLock();

    private Map<String, Boolean> flags;
    private Instant timestamp;

    // Stats
    private long hits = 0;
    private long misses = 0;
    private long staleHits = 0;

    public FlagCache() {
        this(new Config.CacheConfig());
    }

    public FlagCache(Config.CacheConfig config) {
        this.config = config;
    }

    public void set(Map<String, Boolean> flags) {
        lock.writeLock().lock();
        try {
            this.flags = new HashMap<>(flags);
            this.timestamp = Instant.now();
        } finally {
            lock.writeLock().unlock();
        }
    }

    public Optional<CacheResult> get() {
        lock.writeLock().lock();
        try {
            if (flags == null || timestamp == null) {
                misses++;
                return Optional.empty();
            }

            Duration age = Duration.between(timestamp, Instant.now());

            // Check if completely expired
            if (age.compareTo(config.getStaleTtl()) > 0) {
                misses++;
                flags = null;
                timestamp = null;
                return Optional.empty();
            }

            // Check if stale
            boolean stale = age.compareTo(config.getTtl()) > 0;
            if (stale) {
                staleHits++;
            } else {
                hits++;
            }

            return Optional.of(new CacheResult(new HashMap<>(flags), stale));
        } finally {
            lock.writeLock().unlock();
        }
    }

    public void clear() {
        lock.writeLock().lock();
        try {
            flags = null;
            timestamp = null;
        } finally {
            lock.writeLock().unlock();
        }
    }

    public boolean hasFresh() {
        lock.readLock().lock();
        try {
            if (flags == null || timestamp == null) {
                return false;
            }
            Duration age = Duration.between(timestamp, Instant.now());
            return age.compareTo(config.getTtl()) <= 0;
        } finally {
            lock.readLock().unlock();
        }
    }

    public boolean hasAny() {
        lock.readLock().lock();
        try {
            if (flags == null || timestamp == null) {
                return false;
            }
            Duration age = Duration.between(timestamp, Instant.now());
            return age.compareTo(config.getStaleTtl()) <= 0;
        } finally {
            lock.readLock().unlock();
        }
    }

    public CacheStats getStats() {
        lock.readLock().lock();
        try {
            return new CacheStats(hits, misses, staleHits);
        } finally {
            lock.readLock().unlock();
        }
    }

    public double getHitRate() {
        lock.readLock().lock();
        try {
            long total = hits + misses + staleHits;
            if (total == 0) {
                return 0.0;
            }
            return (double) (hits + staleHits) / total;
        } finally {
            lock.readLock().unlock();
        }
    }

    /**
     * Result from cache lookup.
     */
    public static class CacheResult {
        private final Map<String, Boolean> flags;
        private final boolean stale;

        public CacheResult(Map<String, Boolean> flags, boolean stale) {
            this.flags = Collections.unmodifiableMap(flags);
            this.stale = stale;
        }

        public Map<String, Boolean> getFlags() {
            return flags;
        }

        public boolean isStale() {
            return stale;
        }
    }

    /**
     * Cache statistics.
     */
    public static class CacheStats {
        private final long hits;
        private final long misses;
        private final long staleHits;

        public CacheStats(long hits, long misses, long staleHits) {
            this.hits = hits;
            this.misses = misses;
            this.staleHits = staleHits;
        }

        public long getHits() {
            return hits;
        }

        public long getMisses() {
            return misses;
        }

        public long getStaleHits() {
            return staleHits;
        }
    }
}
