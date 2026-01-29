/**
 * Simple EventEmitter for browser compatibility
 */
type EventCallback = (...args: unknown[]) => void;

class SimpleEventEmitter {
  private listeners: Map<string, Set<EventCallback>> = new Map();

  on(event: string, callback: EventCallback): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: string, callback: EventCallback): void {
    this.listeners.get(event)?.delete(callback);
  }

  emit(event: string, ...args: unknown[]): void {
    this.listeners.get(event)?.forEach((cb) => cb(...args));
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}

/**
 * Cache configuration
 */
export interface CacheConfig {
  /** Time-to-live for fresh cache entries (default: 300000ms = 5min) */
  ttl: number;
  /** Time-to-live for stale cache entries (default: 3600000ms = 1h) */
  staleTtl: number;
  /** localStorage key for persistence (optional) */
  storageKey?: string;
}

export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  ttl: 300000, // 5 minutes
  staleTtl: 3600000, // 1 hour
};

/**
 * Cache entry with metadata
 */
interface CacheEntry {
  flags: Record<string, boolean>;
  timestamp: number;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  hits: number;
  misses: number;
  staleHits: number;
}

/**
 * Flag cache with stale fallback support
 *
 * Features:
 * - In-memory caching with configurable TTL
 * - Stale-while-revalidate pattern
 * - localStorage persistence for browser
 * - Event emission for cache hit/miss/stale
 */
export class FlagCache extends SimpleEventEmitter {
  private cache: CacheEntry | null = null;
  private config: CacheConfig;
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    staleHits: 0,
  };

  constructor(config: Partial<CacheConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
  }

  /**
   * Get cached flags
   */
  get(): { flags: Record<string, boolean>; stale: boolean } | undefined {
    if (!this.cache) {
      this.stats.misses++;
      this.emit("cache-miss", { key: "flags" });
      return undefined;
    }

    const age = Date.now() - this.cache.timestamp;

    // Fresh cache
    if (age < this.config.ttl) {
      this.stats.hits++;
      this.emit("cache-hit", { key: "flags", age });
      return { flags: this.cache.flags, stale: false };
    }

    // Stale but usable
    if (age < this.config.staleTtl) {
      this.stats.staleHits++;
      this.emit("cache-stale", { key: "flags", age });
      return { flags: this.cache.flags, stale: true };
    }

    // Expired - clear cache
    this.cache = null;
    this.stats.misses++;
    this.emit("cache-miss", { key: "flags" });
    return undefined;
  }

  /**
   * Store flags in cache
   * @param keyOrFlags - Either a key string (ignored, for backwards compatibility) or flags object
   * @param maybeFlags - Flags object if first param is a key
   */
  set(
    keyOrFlags: string | Record<string, boolean>,
    maybeFlags?: Record<string, boolean>,
  ): void {
    // Support both set(flags) and set(key, flags) signatures for backwards compatibility
    const flags = typeof keyOrFlags === "string" ? maybeFlags! : keyOrFlags;
    this.cache = {
      flags,
      timestamp: Date.now(),
    };
    this.persistToStorage();
  }

  /**
   * Check if cache has fresh data
   */
  hasFresh(): boolean {
    if (!this.cache) return false;
    return Date.now() - this.cache.timestamp < this.config.ttl;
  }

  /**
   * Check if cache has any data (fresh or stale)
   */
  hasAny(): boolean {
    if (!this.cache) return false;
    return Date.now() - this.cache.timestamp < this.config.staleTtl;
  }

  /**
   * Clear cached data
   */
  clear(): void {
    this.cache = null;
    if (this.config.storageKey && typeof localStorage !== "undefined") {
      try {
        localStorage.removeItem(this.config.storageKey);
      } catch {
        // Ignore storage errors
      }
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Get hit rate
   */
  getHitRate(): number {
    const total = this.stats.hits + this.stats.staleHits + this.stats.misses;
    if (total === 0) return 0;
    return (this.stats.hits + this.stats.staleHits) / total;
  }

  /**
   * Load cache from localStorage
   */
  load(): boolean {
    if (!this.config.storageKey || typeof localStorage === "undefined") {
      return false;
    }

    try {
      const data = localStorage.getItem(this.config.storageKey);
      if (!data) return false;

      const entry = JSON.parse(data) as CacheEntry;

      // Only restore if within staleTtl
      if (Date.now() - entry.timestamp < this.config.staleTtl) {
        this.cache = entry;
        return true;
      }
    } catch {
      // Ignore parse errors
    }

    return false;
  }

  /**
   * Persist cache to localStorage
   */
  private persistToStorage(): void {
    if (
      !this.config.storageKey ||
      typeof localStorage === "undefined" ||
      !this.cache
    ) {
      return;
    }

    try {
      localStorage.setItem(this.config.storageKey, JSON.stringify(this.cache));
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Close the cache and persist data
   */
  close(): void {
    this.persistToStorage();
    this.removeAllListeners();
  }
}
