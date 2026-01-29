/**
 * Resilience Integration Tests for React SDK
 *
 * These tests verify the end-to-end behavior of resilience patterns
 * working together: retry, circuit breaker, cache, deduplication.
 */

import {
  CircuitBreaker,
  CircuitState,
  CircuitOpenError,
  FlagCache,
  RequestDeduplicator,
  fetchWithRetry,
  createTraceContext,
  getTraceHeaders,
  TraceHeaders,
} from "@rollgate/sdk-core";

describe("Resilience Integration Tests", () => {
  describe("Retry + Circuit Breaker Integration", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should retry and succeed without opening circuit", async () => {
      const cb = new CircuitBreaker({ failureThreshold: 5 });
      let callCount = 0;

      const makeRequest = async () => {
        return cb.execute(async () => {
          const result = await fetchWithRetry(
            async () => {
              callCount++;
              if (callCount <= 2) {
                throw new Error("503 Service Unavailable");
              }
              return "success";
            },
            { maxRetries: 3, baseDelayMs: 10, jitterFactor: 0 },
          );
          if (!result.success) throw result.error;
          return result.data;
        });
      };

      const promise = makeRequest();
      await jest.advanceTimersByTimeAsync(500);
      const result = await promise;

      expect(result).toBe("success");
      expect(callCount).toBe(3);
      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });

    it("should open circuit after multiple retry exhaustions", async () => {
      jest.useRealTimers(); // Use real timers for this test

      const cb = new CircuitBreaker({
        failureThreshold: 2,
        monitoringWindow: 60000,
      });

      const failingRequest = async () => {
        return cb.execute(async () => {
          const result = await fetchWithRetry(
            async () => {
              throw new Error("503 Service Unavailable");
            },
            { maxRetries: 1, baseDelayMs: 1, jitterFactor: 0 }, // Minimal delay
          );
          if (!result.success) throw result.error;
          return result.data;
        });
      };

      // First failure
      try {
        await failingRequest();
      } catch {
        /* expected */
      }

      // Second failure - should open circuit
      try {
        await failingRequest();
      } catch {
        /* expected */
      }

      expect(cb.getState()).toBe(CircuitState.OPEN);
    });

    it("should use circuit breaker recovery", async () => {
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        recoveryTimeout: 1000,
        successThreshold: 1,
      });

      // Fail to open circuit
      try {
        await cb.execute(async () => {
          throw new Error("failure");
        });
      } catch {
        /* expected */
      }

      expect(cb.getState()).toBe(CircuitState.OPEN);

      // Wait for recovery
      jest.advanceTimersByTime(1100);

      // Success should close circuit
      const result = await cb.execute(async () => "recovered");
      expect(result).toBe("recovered");
      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });
  });

  describe("Cache Fallback Integration", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should serve fresh cache within TTL", () => {
      const cache = new FlagCache({ ttl: 60000, staleTtl: 300000 });
      cache.set({ feature_a: true, feature_b: false });

      const result = cache.get();
      expect(result?.flags).toEqual({ feature_a: true, feature_b: false });
      expect(result?.stale).toBe(false);
    });

    it("should mark cache as stale after TTL", () => {
      const cache = new FlagCache({ ttl: 1000, staleTtl: 10000 });
      cache.set({ feature: true });

      jest.advanceTimersByTime(2000); // Past TTL

      const result = cache.get();
      expect(result?.flags).toEqual({ feature: true });
      expect(result?.stale).toBe(true);
    });

    it("should expire cache after staleTTL", () => {
      const cache = new FlagCache({ ttl: 1000, staleTtl: 5000 });
      cache.set({ feature: true });

      jest.advanceTimersByTime(6000); // Past staleTTL

      const result = cache.get();
      expect(result).toBeUndefined();
    });

    it("should track hit/miss stats", () => {
      const cache = new FlagCache({ ttl: 60000, staleTtl: 300000 });

      // Miss
      cache.get();
      expect(cache.getStats().misses).toBe(1);
      expect(cache.getStats().hits).toBe(0);

      // Set and hit
      cache.set({ feature: true });
      cache.get();
      expect(cache.getStats().hits).toBe(1);
      expect(cache.getHitRate()).toBe(0.5); // 1 hit, 1 miss
    });

    it("should track stale hits", () => {
      const cache = new FlagCache({ ttl: 100, staleTtl: 10000 });
      cache.set({ feature: true });

      // Fresh hit
      cache.get();
      expect(cache.getStats().staleHits).toBe(0);

      // Stale hit
      jest.advanceTimersByTime(200);
      cache.get();
      expect(cache.getStats().staleHits).toBe(1);
    });
  });

  describe("Request Deduplication Integration", () => {
    it("should deduplicate concurrent calls with same key", async () => {
      const dedup = new RequestDeduplicator();
      let callCount = 0;

      const fn = async () => {
        callCount++;
        await new Promise((r) => setTimeout(r, 10));
        return "result";
      };

      jest.useFakeTimers();

      const promises = [
        dedup.dedupe("key", fn),
        dedup.dedupe("key", fn),
        dedup.dedupe("key", fn),
      ];

      jest.advanceTimersByTime(50);
      const results = await Promise.all(promises);

      jest.useRealTimers();

      expect(callCount).toBe(1);
      expect(results).toEqual(["result", "result", "result"]);
    });

    it("should not deduplicate calls with different keys", async () => {
      const dedup = new RequestDeduplicator();
      let callCount = 0;

      const fn = async () => {
        callCount++;
        return "result";
      };

      const results = await Promise.all([
        dedup.dedupe("key1", fn),
        dedup.dedupe("key2", fn),
        dedup.dedupe("key3", fn),
      ]);

      expect(callCount).toBe(3);
      expect(results).toEqual(["result", "result", "result"]);
    });

    it("should allow new request after previous completes", async () => {
      const dedup = new RequestDeduplicator();
      let callCount = 0;

      const fn = async () => {
        callCount++;
        return `result-${callCount}`;
      };

      const result1 = await dedup.dedupe("key", fn);
      const result2 = await dedup.dedupe("key", fn);
      const result3 = await dedup.dedupe("key", fn);

      expect(callCount).toBe(3);
      expect(result1).toBe("result-1");
      expect(result2).toBe("result-2");
      expect(result3).toBe("result-3");
    });

    it("should propagate errors to all waiters", async () => {
      const dedup = new RequestDeduplicator();
      const error = new Error("test error");

      jest.useFakeTimers();

      const fn = async () => {
        await new Promise((r) => setTimeout(r, 10));
        throw error;
      };

      const promises = [dedup.dedupe("key", fn), dedup.dedupe("key", fn)];

      jest.advanceTimersByTime(50);

      await expect(promises[0]).rejects.toThrow("test error");
      await expect(promises[1]).rejects.toThrow("test error");

      jest.useRealTimers();
    });
  });

  describe("Tracing Integration", () => {
    it("should generate trace context with valid IDs", () => {
      const ctx = createTraceContext();

      expect(ctx.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(ctx.spanId).toMatch(/^[0-9a-f]{16}$/);
      expect(ctx.requestId).toMatch(/^sb-\d{14}-[0-9a-f]{8}$/);
      expect(ctx.sampled).toBe(true);
    });

    it("should generate proper trace headers", () => {
      const ctx = createTraceContext();
      const headers = getTraceHeaders(ctx);

      expect(headers[TraceHeaders.TRACE_ID]).toBe(ctx.traceId);
      expect(headers[TraceHeaders.SPAN_ID]).toBe(ctx.spanId);
      expect(headers[TraceHeaders.REQUEST_ID]).toBe(ctx.requestId);
      expect(headers[TraceHeaders.TRACEPARENT]).toBe(
        `00-${ctx.traceId}-${ctx.spanId}-01`,
      );
    });

    it("should inherit trace ID from parent context", () => {
      const parent = createTraceContext();
      const child = createTraceContext({
        traceId: parent.traceId,
        spanId: parent.spanId,
      });

      expect(child.traceId).toBe(parent.traceId);
      expect(child.parentId).toBe(parent.spanId);
      expect(child.spanId).not.toBe(parent.spanId); // New span ID
    });
  });

  describe("Retry Backoff Integration", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should succeed on first attempt without delay", async () => {
      let callCount = 0;
      const fn = async () => {
        callCount++;
        return "success";
      };

      const result = await fetchWithRetry(fn);

      expect(result.success).toBe(true);
      expect(result.data).toBe("success");
      expect(result.attempts).toBe(1);
      expect(callCount).toBe(1);
    });

    it("should retry on retryable error and succeed", async () => {
      let callCount = 0;
      const fn = async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error("503 Service Unavailable");
        }
        return "success";
      };

      const promise = fetchWithRetry(fn, {
        maxRetries: 3,
        baseDelayMs: 10,
        jitterFactor: 0,
      });

      await jest.advanceTimersByTimeAsync(200);
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.data).toBe("success");
      expect(result.attempts).toBe(3);
    });

    it("should not retry on non-retryable error", async () => {
      let callCount = 0;
      const fn = async () => {
        callCount++;
        throw new Error("401 Unauthorized");
      };

      const result = await fetchWithRetry(fn);

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe("401 Unauthorized");
      expect(result.attempts).toBe(1);
      expect(callCount).toBe(1);
    });

    it("should exhaust retries and fail", async () => {
      let callCount = 0;
      const fn = async () => {
        callCount++;
        throw new Error("503 Service Unavailable");
      };

      const promise = fetchWithRetry(fn, {
        maxRetries: 2,
        baseDelayMs: 10,
        jitterFactor: 0,
      });

      await jest.advanceTimersByTimeAsync(500);
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(3); // 1 initial + 2 retries
      expect(callCount).toBe(3);
    });
  });

  describe("Circuit Breaker States", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should track state transitions via events", async () => {
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        recoveryTimeout: 1000,
        successThreshold: 1,
      });

      const stateChanges: Array<{ from?: string; to?: string }> = [];
      cb.on("state-change", (change) => {
        if (change?.from && change?.to)
          stateChanges.push({ from: change.from, to: change.to });
      });

      // Open circuit
      try {
        await cb.execute(async () => {
          throw new Error("failure");
        });
      } catch {
        /* expected */
      }

      expect(stateChanges).toContainEqual({ from: "closed", to: "open" });

      // Wait for recovery
      jest.advanceTimersByTime(1100);

      // Close circuit
      await cb.execute(async () => "success");

      expect(stateChanges).toContainEqual({ from: "open", to: "half_open" });
      expect(stateChanges).toContainEqual({ from: "half_open", to: "closed" });
    });

    it("should reopen on failure in half-open state", async () => {
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        recoveryTimeout: 100,
        successThreshold: 2,
      });

      // Open
      try {
        await cb.execute(async () => {
          throw new Error("failure");
        });
      } catch {
        /* expected */
      }

      expect(cb.getState()).toBe(CircuitState.OPEN);

      // Wait for half-open
      jest.advanceTimersByTime(150);

      // Fail in half-open - should reopen
      try {
        await cb.execute(async () => {
          throw new Error("failure");
        });
      } catch {
        /* expected */
      }

      expect(cb.getState()).toBe(CircuitState.OPEN);
    });

    it("should provide accurate stats", async () => {
      const cb = new CircuitBreaker({ failureThreshold: 5 });

      // Success
      await cb.execute(async () => "success");

      // Failures
      for (let i = 0; i < 3; i++) {
        try {
          await cb.execute(async () => {
            throw new Error("failure");
          });
        } catch {
          /* expected */
        }
      }

      const stats = cb.getStats();
      expect(stats.failures).toBe(3);
      expect(stats.state).toBe(CircuitState.CLOSED);
    });
  });

  describe("Error Classification", () => {
    it("should identify retryable errors", async () => {
      const retryableErrors = [
        new Error("503 Service Unavailable"),
        new Error("502 Bad Gateway"),
        new Error("504 Gateway Timeout"),
        new Error("429 Too Many Requests"),
        new Error("ECONNREFUSED"),
        new Error("ETIMEDOUT"),
        new Error("network error"),
      ];

      for (const error of retryableErrors) {
        const fn = jest
          .fn()
          .mockRejectedValueOnce(error)
          .mockResolvedValue("ok");

        jest.useFakeTimers();
        const promise = fetchWithRetry(fn, {
          maxRetries: 1,
          baseDelayMs: 10,
          jitterFactor: 0,
        });
        await jest.advanceTimersByTimeAsync(100);
        const result = await promise;
        jest.useRealTimers();

        expect(result.success).toBe(true);
        expect(result.attempts).toBe(2);
      }
    });

    it("should not retry non-retryable errors", async () => {
      const nonRetryableErrors = [
        new Error("400 Bad Request"),
        new Error("401 Unauthorized"),
        new Error("403 Forbidden"),
        new Error("404 Not Found"),
        new Error("unknown error"),
      ];

      for (const error of nonRetryableErrors) {
        const fn = jest.fn().mockRejectedValue(error);

        const result = await fetchWithRetry(fn, { maxRetries: 3 });

        expect(result.success).toBe(false);
        expect(result.attempts).toBe(1);
        expect(fn).toHaveBeenCalledTimes(1);

        fn.mockClear();
      }
    });
  });
});
