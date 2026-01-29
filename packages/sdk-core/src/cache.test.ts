import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FlagCache, DEFAULT_CACHE_CONFIG } from "./cache";

describe("FlagCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    if (typeof localStorage !== "undefined") {
      localStorage.clear();
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("DEFAULT_CACHE_CONFIG", () => {
    it("should have sensible defaults", () => {
      expect(DEFAULT_CACHE_CONFIG.ttl).toBe(300000);
      expect(DEFAULT_CACHE_CONFIG.staleTtl).toBe(3600000);
    });
  });

  describe("get/set", () => {
    it("should return undefined for empty cache", () => {
      const cache = new FlagCache();
      expect(cache.get()).toBeUndefined();
    });

    it("should store and retrieve flags", () => {
      const cache = new FlagCache();
      const flags = { "test-flag": true, "another-flag": false };

      cache.set(flags);
      const result = cache.get();

      expect(result).toBeDefined();
      expect(result?.flags).toEqual(flags);
      expect(result?.stale).toBe(false);
    });

    it("should return fresh data within TTL", () => {
      const cache = new FlagCache({ ttl: 5000 });
      const flags = { test: true };

      cache.set(flags);
      vi.advanceTimersByTime(3000);

      const result = cache.get();
      expect(result?.stale).toBe(false);
    });

    it("should return stale data after TTL but within staleTtl", () => {
      const cache = new FlagCache({ ttl: 5000, staleTtl: 60000 });
      const flags = { test: true };

      cache.set(flags);
      vi.advanceTimersByTime(10000);

      const result = cache.get();
      expect(result).toBeDefined();
      expect(result?.stale).toBe(true);
    });

    it("should return undefined after staleTtl", () => {
      const cache = new FlagCache({ ttl: 5000, staleTtl: 60000 });
      const flags = { test: true };

      cache.set(flags);
      vi.advanceTimersByTime(70000);

      const result = cache.get();
      expect(result).toBeUndefined();
    });
  });

  describe("hasFresh/hasAny", () => {
    it("hasFresh should return true only for fresh data", () => {
      const cache = new FlagCache({ ttl: 5000 });
      cache.set({ test: true });

      expect(cache.hasFresh()).toBe(true);

      vi.advanceTimersByTime(6000);
      expect(cache.hasFresh()).toBe(false);
    });

    it("hasAny should return true for stale data", () => {
      const cache = new FlagCache({ ttl: 5000, staleTtl: 60000 });
      cache.set({ test: true });

      vi.advanceTimersByTime(10000);

      expect(cache.hasFresh()).toBe(false);
      expect(cache.hasAny()).toBe(true);
    });

    it("hasAny should return false after staleTtl", () => {
      const cache = new FlagCache({ ttl: 5000, staleTtl: 60000 });
      cache.set({ test: true });

      vi.advanceTimersByTime(70000);

      expect(cache.hasAny()).toBe(false);
    });
  });

  describe("clear", () => {
    it("should remove all cached data", () => {
      const cache = new FlagCache();
      cache.set({ test: true });

      cache.clear();

      expect(cache.get()).toBeUndefined();
    });
  });

  describe("stats", () => {
    it("should track cache hits", () => {
      const cache = new FlagCache();
      cache.set({ test: true });

      cache.get();
      cache.get();

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
    });

    it("should track cache misses", () => {
      const cache = new FlagCache();

      cache.get();
      cache.get();

      const stats = cache.getStats();
      expect(stats.misses).toBe(2);
    });

    it("should track stale hits", () => {
      const cache = new FlagCache({ ttl: 1000, staleTtl: 60000 });
      cache.set({ test: true });

      vi.advanceTimersByTime(2000);

      cache.get();
      cache.get();

      const stats = cache.getStats();
      expect(stats.staleHits).toBe(2);
    });
  });
});
