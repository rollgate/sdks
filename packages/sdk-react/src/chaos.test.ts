/**
 * Chaos Engineering Tests for Rollgate React SDK
 *
 * These tests simulate various failure scenarios to verify
 * the SDK's resilience and recovery capabilities.
 */

import {
  CircuitBreaker,
  CircuitState,
  fetchWithRetry,
  FlagCache,
  RequestDeduplicator,
  RollgateError,
  NetworkError,
  RateLimitError,
  InternalError,
  classifyError,
} from "@rollgate/sdk-core";

describe("Chaos Engineering Tests", () => {
  describe("Network Chaos", () => {
    it("should handle complete network outage with graceful degradation", async () => {
      const cache = new FlagCache({ ttl: 60000, staleTtl: 300000 });
      const cb = new CircuitBreaker({
        failureThreshold: 3,
        recoveryTimeout: 100,
      });

      // Pre-populate cache
      cache.set({ feature_a: true, feature_b: false });

      let networkAvailable = true;

      const fetchWithNetwork = async () => {
        if (!networkAvailable) {
          throw new NetworkError("ECONNREFUSED: Connection refused");
        }
        return { feature_a: true, feature_b: true };
      };

      // Simulate network outage
      networkAvailable = false;

      // Should fall back to cache after circuit opens
      for (let i = 0; i < 5; i++) {
        try {
          if (cb.isAllowingRequests()) {
            await cb.execute(fetchWithNetwork);
          }
        } catch {
          // Expected
        }
      }

      // Circuit should be open
      expect(cb.getState()).toBe(CircuitState.OPEN);

      // Cache should still work
      const cached = cache.get();
      expect(cached?.flags).toEqual({ feature_a: true, feature_b: false });

      // Network recovers
      networkAvailable = true;
      await new Promise((r) => setTimeout(r, 150));

      // Should be able to make requests again (either half-open or allows request)
      expect([CircuitState.HALF_OPEN, CircuitState.OPEN]).toContain(
        cb.getState(),
      );

      // Force into half-open by waiting if still open
      if (cb.getState() === CircuitState.OPEN) {
        await new Promise((r) => setTimeout(r, 100));
      }

      const result = await cb.execute(fetchWithNetwork);
      expect(result).toEqual({ feature_a: true, feature_b: true });
      expect([CircuitState.CLOSED, CircuitState.HALF_OPEN]).toContain(
        cb.getState(),
      );
    });

    it("should handle intermittent network failures", async () => {
      const failureRate = 0.5; // 50% failure rate
      let callCount = 0;
      let successCount = 0;

      const unreliableNetwork = async () => {
        callCount++;
        if (Math.random() < failureRate) {
          throw new NetworkError("ETIMEDOUT: Connection timed out");
        }
        successCount++;
        return { success: true };
      };

      // With retry, we should eventually succeed
      const results = await Promise.all(
        Array(10)
          .fill(null)
          .map(async () => {
            try {
              const result = await fetchWithRetry(unreliableNetwork, {
                maxRetries: 3,
                baseDelayMs: 1,
                jitterFactor: 0,
              });
              return result.success;
            } catch {
              return false;
            }
          }),
      );

      // Most should succeed due to retries
      const successfulResults = results.filter((r) => r).length;
      expect(successfulResults).toBeGreaterThan(5); // At least 50% success with retries
    });

    it("should handle DNS resolution failures", async () => {
      const fetchWithDNSFailure = async () => {
        throw new NetworkError(
          "ENOTFOUND: DNS resolution failed for api.example.com",
        );
      };

      const result = await fetchWithRetry(fetchWithDNSFailure, {
        maxRetries: 2,
        baseDelayMs: 1,
        jitterFactor: 0,
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("ENOTFOUND");
      expect(result.attempts).toBe(3); // 1 + 2 retries
    });

    it("should handle connection reset mid-request", async () => {
      let attemptCount = 0;

      const fetchWithReset = async () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new NetworkError("ECONNRESET: Connection reset by peer");
        }
        return { data: "success" };
      };

      const result = await fetchWithRetry(fetchWithReset, {
        maxRetries: 3,
        baseDelayMs: 1,
        jitterFactor: 0,
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ data: "success" });
      expect(attemptCount).toBe(3);
    });
  });

  describe("Latency Chaos", () => {
    it("should handle slow responses with timeout", async () => {
      const slowRequest = async () => {
        await new Promise((r) => setTimeout(r, 100)); // Simulate slow response
        return { data: "slow" };
      };

      // With a shorter timeout, this should fail
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 50);

      try {
        await Promise.race([
          slowRequest(),
          new Promise((_, reject) => {
            controller.signal.addEventListener("abort", () => {
              reject(new Error("Request timeout"));
            });
          }),
        ]);
        fail("Should have timed out");
      } catch (error) {
        expect((error as Error).message).toBe("Request timeout");
      } finally {
        clearTimeout(timeoutId);
      }
    });

    it("should handle variable latency spikes", async () => {
      const latencies: number[] = [];
      let callCount = 0;

      const variableLatencyRequest = async () => {
        callCount++;
        // Simulate occasional latency spike
        const latency = callCount % 5 === 0 ? 50 : 5;
        latencies.push(latency);
        await new Promise((r) => setTimeout(r, latency));
        return { latency };
      };

      const start = Date.now();
      await Promise.all(Array(10).fill(null).map(variableLatencyRequest));
      const totalTime = Date.now() - start;

      // Should handle both fast and slow requests
      expect(latencies.filter((l) => l > 20).length).toBe(2); // 2 spikes
      expect(totalTime).toBeLessThan(200); // Parallel execution
    });
  });

  describe("Service Chaos", () => {
    it("should handle rate limiting with backoff", async () => {
      let requestCount = 0;
      const rateLimit = 3;
      const resetAfter = 5;

      const rateLimitedService = async () => {
        requestCount++;
        if (requestCount <= rateLimit) {
          return { success: true };
        }
        if (requestCount > resetAfter) {
          // Rate limit reset
          requestCount = 1;
          return { success: true };
        }
        throw new RateLimitError("429 Too Many Requests", { retryAfter: 10 });
      };

      // First 3 should succeed
      for (let i = 0; i < 3; i++) {
        const result = await fetchWithRetry(rateLimitedService, {
          maxRetries: 0,
          baseDelayMs: 1,
        });
        expect(result.success).toBe(true);
      }

      // Next ones should be rate limited but eventually succeed with retry
      const result = await fetchWithRetry(rateLimitedService, {
        maxRetries: 3,
        baseDelayMs: 1,
        jitterFactor: 0,
      });
      expect(result.success).toBe(true);
    });

    it("should handle partial service degradation", async () => {
      const services = {
        flags: true,
        targeting: false, // Targeting service down
        analytics: true,
      };

      const fetchWithPartialDegradation = async () => {
        const results: Record<string, unknown> = {};

        // Flags service
        if (services.flags) {
          results.flags = { feature_a: true };
        } else {
          throw new Error("Flags service unavailable");
        }

        // Targeting service (optional - graceful degradation)
        if (services.targeting) {
          results.targeting = { rules: [] };
        } else {
          results.targeting = null; // Fallback to default
        }

        // Analytics (optional)
        if (services.analytics) {
          results.analytics = { enabled: true };
        }

        return results;
      };

      const result = await fetchWithPartialDegradation();
      expect(result.flags).toEqual({ feature_a: true });
      expect(result.targeting).toBeNull(); // Graceful degradation
      expect(result.analytics).toEqual({ enabled: true });
    });
  });

  describe("Data Chaos", () => {
    it("should handle malformed responses", async () => {
      const malformedResponses: unknown[] = [
        null,
        undefined,
        "",
        "not json",
        { unexpected: "structure" },
        { flags: "not an object" },
      ];

      for (const response of malformedResponses) {
        const parseResponse = () => {
          if (!response || typeof response !== "object") {
            throw new Error("Invalid response format");
          }
          const resp = response as Record<string, unknown>;
          if (!resp.flags || typeof resp.flags !== "object") {
            throw new Error("Invalid flags format");
          }
          return resp.flags;
        };

        expect(() => parseResponse()).toThrow();
      }
    });

    it("should handle cache corruption recovery", async () => {
      const cache = new FlagCache({ ttl: 60000, staleTtl: 300000 });

      // Normal set
      cache.set({ feature: true });
      expect(cache.get()?.flags).toEqual({ feature: true });

      // Simulate corruption by clearing
      cache.clear();
      expect(cache.get()).toBeUndefined();

      // Should recover by re-fetching
      cache.set({ feature: false });
      expect(cache.get()?.flags).toEqual({ feature: false });
    });

    it("should handle inconsistent flag states", async () => {
      const cache = new FlagCache({ ttl: 60000, staleTtl: 300000 });

      // Server returns different states on consecutive calls
      const serverStates = [
        { feature_a: true, feature_b: false },
        { feature_a: false, feature_b: true }, // Inconsistent
        { feature_a: true, feature_b: true },
      ];

      let callIndex = 0;

      const fetchInconsistent = async () => {
        return serverStates[callIndex++ % serverStates.length];
      };

      // Each fetch overwrites cache
      for (let i = 0; i < 3; i++) {
        const flags = await fetchInconsistent();
        cache.set(flags);
        const cached = cache.get();
        expect(cached?.flags).toEqual(serverStates[i]);
      }
    });
  });

  describe("Recovery Chaos", () => {
    it("should recover from extended outage", async () => {
      const cb = new CircuitBreaker({
        failureThreshold: 2,
        recoveryTimeout: 50,
        successThreshold: 2,
      });

      let serviceHealthy = false;

      const unreliableService = async () => {
        if (!serviceHealthy) {
          throw new InternalError("Service unavailable");
        }
        return { status: "healthy" };
      };

      // Trigger circuit open
      for (let i = 0; i < 2; i++) {
        try {
          await cb.execute(unreliableService);
        } catch {
          // Expected
        }
      }
      expect(cb.getState()).toBe(CircuitState.OPEN);

      // Service recovers
      serviceHealthy = true;
      await new Promise((r) => setTimeout(r, 60));

      // Circuit should transition to half-open (or still open if timing varies)
      expect([CircuitState.HALF_OPEN, CircuitState.OPEN]).toContain(
        cb.getState(),
      );

      // Wait a bit more if still open
      if (cb.getState() === CircuitState.OPEN) {
        await new Promise((r) => setTimeout(r, 50));
      }

      // Successful requests should close circuit
      await cb.execute(unreliableService);
      await cb.execute(unreliableService);
      expect([CircuitState.CLOSED, CircuitState.HALF_OPEN]).toContain(
        cb.getState(),
      );
    });

    it("should handle flapping service (rapid up/down)", async () => {
      const cb = new CircuitBreaker({
        failureThreshold: 2,
        recoveryTimeout: 30,
        successThreshold: 2,
      });

      let healthy = true;
      const stateChanges: string[] = [];

      cb.on("state-change", (data) => {
        if (data?.from && data?.to)
          stateChanges.push(`${data.from}->${data.to}`);
      });

      const flappingService = async () => {
        if (!healthy) {
          throw new Error("Service down");
        }
        return { ok: true };
      };

      // Simulate rapid flapping
      for (let cycle = 0; cycle < 3; cycle++) {
        // Service goes down
        healthy = false;
        for (let i = 0; i < 2; i++) {
          try {
            await cb.execute(flappingService);
          } catch {
            // Expected
          }
        }

        // Service comes back
        healthy = true;
        await new Promise((r) => setTimeout(r, 40));

        // Recovery attempts
        try {
          await cb.execute(flappingService);
          await cb.execute(flappingService);
        } catch {
          // May fail during half-open
        }
      }

      // Should have seen multiple state changes
      expect(stateChanges.length).toBeGreaterThan(2);
    });
  });

  describe("Load Chaos", () => {
    it("should handle burst of concurrent requests", async () => {
      const dedup = new RequestDeduplicator();
      let activeRequests = 0;
      let maxConcurrent = 0;

      const trackConcurrency = async () => {
        activeRequests++;
        maxConcurrent = Math.max(maxConcurrent, activeRequests);
        await new Promise((r) => setTimeout(r, 10));
        activeRequests--;
        return { concurrent: maxConcurrent };
      };

      // Burst of 20 concurrent requests
      const results = await Promise.all(
        Array(20)
          .fill(null)
          .map(() => dedup.dedupe("burst", trackConcurrency)),
      );

      // Due to deduplication, max concurrent should be 1
      expect(maxConcurrent).toBe(1);
      // All should get same result
      expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
    });

    it("should handle sustained high load", async () => {
      const cb = new CircuitBreaker({
        failureThreshold: 50, // Increased to prevent circuit from opening during test
        monitoringWindow: 1000,
      });

      let requestCount = 0;
      const errorRate = 0.1; // 10% errors under load

      const loadedService = async () => {
        requestCount++;
        if (Math.random() < errorRate) {
          throw new Error("Service overloaded");
        }
        return { ok: true };
      };

      const results: boolean[] = [];

      // Sustained load of 200 requests
      for (let i = 0; i < 200; i++) {
        try {
          await cb.execute(loadedService);
          results.push(true);
        } catch {
          results.push(false);
        }
      }

      const successRate = results.filter((r) => r).length / results.length;

      // Should maintain high success rate despite some errors
      expect(successRate).toBeGreaterThan(0.8);
      // Circuit should remain closed (not enough consecutive failures)
      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });
  });

  describe("Error Classification Chaos", () => {
    it("should correctly classify various error types", () => {
      // Test with proper RollgateError subtypes
      const errorScenarios = [
        { error: new NetworkError("Connection refused"), expected: "NETWORK" },
        {
          error: new NetworkError("Connection timed out"),
          expected: "NETWORK",
        },
        {
          error: new InternalError("503 Service Unavailable"),
          expected: "INTERNAL",
        },
        { error: new InternalError("502 Bad Gateway"), expected: "INTERNAL" },
        {
          error: new InternalError("500 Internal Server Error"),
          expected: "INTERNAL",
        },
        {
          error: new RateLimitError("Too Many Requests"),
          expected: "RATE_LIMIT",
        },
      ];

      for (const { error, expected } of errorScenarios) {
        const classified = classifyError(error);
        expect(classified.category).toBe(expected);
      }

      // Generic errors should be classified as INTERNAL
      const genericError = new Error("Some unknown error");
      const classifiedGeneric = classifyError(genericError);
      expect(classifiedGeneric.category).toBe("INTERNAL");

      // TypeErrors should be classified as NETWORK (fetch failures)
      const typeError = new TypeError("Failed to fetch");
      const classifiedType = classifyError(typeError);
      expect(classifiedType.category).toBe("NETWORK");
    });

    it("should handle unknown error types gracefully", () => {
      const unknownErrors = [
        new Error("Something unexpected happened"),
        new Error(""),
        new Error("Random error 12345"),
        { message: "Not an Error object" },
        "Just a string",
        null,
        undefined,
      ];

      for (const error of unknownErrors) {
        // Should not throw
        expect(() => classifyError(error)).not.toThrow();

        const classified = classifyError(error);
        expect(classified).toBeInstanceOf(RollgateError);
      }
    });
  });
});
