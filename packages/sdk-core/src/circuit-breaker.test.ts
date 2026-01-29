import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  CircuitBreaker,
  CircuitState,
  CircuitOpenError,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
} from "./circuit-breaker";

describe("CircuitBreaker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("DEFAULT_CIRCUIT_BREAKER_CONFIG", () => {
    it("should have sensible defaults", () => {
      expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.failureThreshold).toBe(5);
      expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.recoveryTimeout).toBe(30000);
      expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.monitoringWindow).toBe(60000);
      expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.successThreshold).toBe(3);
    });
  });

  describe("initial state", () => {
    it("should start in CLOSED state", () => {
      const cb = new CircuitBreaker();
      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });

    it("should allow requests initially", () => {
      const cb = new CircuitBreaker();
      expect(cb.isAllowingRequests()).toBe(true);
    });

    it("should have zero failures initially", () => {
      const cb = new CircuitBreaker();
      expect(cb.getStats().failures).toBe(0);
    });
  });

  describe("execute", () => {
    it("should pass through successful requests", async () => {
      const cb = new CircuitBreaker();
      const fn = vi.fn().mockResolvedValue("success");

      const result = await cb.execute(fn);

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(1);
      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });

    it("should pass through and rethrow errors", async () => {
      const cb = new CircuitBreaker();
      const error = new Error("test error");
      const fn = vi.fn().mockRejectedValue(error);

      await expect(cb.execute(fn)).rejects.toThrow("test error");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should track failures", async () => {
      const cb = new CircuitBreaker();
      const fn = vi.fn().mockRejectedValue(new Error("failure"));

      await cb.execute(fn).catch(() => {});

      expect(cb.getStats().failures).toBe(1);
    });
  });

  describe("circuit opening", () => {
    it("should open after reaching failure threshold", async () => {
      const cb = new CircuitBreaker({ failureThreshold: 3 });
      const fn = vi.fn().mockRejectedValue(new Error("failure"));

      for (let i = 0; i < 3; i++) {
        await cb.execute(fn).catch(() => {});
      }

      expect(cb.getState()).toBe(CircuitState.OPEN);
    });

    it("should emit circuit-open event", async () => {
      const cb = new CircuitBreaker({ failureThreshold: 2 });
      const fn = vi.fn().mockRejectedValue(new Error("failure"));
      const openHandler = vi.fn();
      cb.on("circuit-open", openHandler);

      await cb.execute(fn).catch(() => {});
      await cb.execute(fn).catch(() => {});

      expect(openHandler).toHaveBeenCalledTimes(1);
      expect(openHandler).toHaveBeenCalledWith(
        expect.objectContaining({ failures: 2 }),
      );
    });

    it("should throw CircuitOpenError when open", async () => {
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        recoveryTimeout: 30000,
      });
      const fn = vi.fn().mockRejectedValue(new Error("failure"));

      await cb.execute(fn).catch(() => {});

      expect(cb.getState()).toBe(CircuitState.OPEN);

      const successFn = vi.fn().mockResolvedValue("success");
      await expect(cb.execute(successFn)).rejects.toThrow(CircuitOpenError);
      expect(successFn).not.toHaveBeenCalled();
    });
  });

  describe("monitoring window", () => {
    it("should only count failures within the window", async () => {
      const cb = new CircuitBreaker({
        failureThreshold: 3,
        monitoringWindow: 5000,
      });
      const fn = vi.fn().mockRejectedValue(new Error("failure"));

      await cb.execute(fn).catch(() => {});
      expect(cb.getStats().failures).toBe(1);

      vi.advanceTimersByTime(6000);

      await cb.execute(fn).catch(() => {});
      expect(cb.getStats().failures).toBe(1);

      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });
  });

  describe("recovery (half-open)", () => {
    it("should transition to HALF_OPEN after recovery timeout", async () => {
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        recoveryTimeout: 5000,
      });
      const fn = vi.fn().mockRejectedValue(new Error("failure"));

      await cb.execute(fn).catch(() => {});
      expect(cb.getState()).toBe(CircuitState.OPEN);

      vi.advanceTimersByTime(5001);

      expect(cb.isAllowingRequests()).toBe(true);
    });

    it("should allow test request in HALF_OPEN state", async () => {
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        recoveryTimeout: 1000,
        successThreshold: 1,
      });

      await cb.execute(vi.fn().mockRejectedValue(new Error())).catch(() => {});
      expect(cb.getState()).toBe(CircuitState.OPEN);

      vi.advanceTimersByTime(1001);

      const successFn = vi.fn().mockResolvedValue("success");
      const result = await cb.execute(successFn);

      expect(result).toBe("success");
      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });

    it("should close circuit after success threshold in HALF_OPEN", async () => {
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        recoveryTimeout: 1000,
        successThreshold: 2,
      });

      await cb.execute(vi.fn().mockRejectedValue(new Error())).catch(() => {});
      vi.advanceTimersByTime(1001);

      const successFn = vi.fn().mockResolvedValue("success");

      await cb.execute(successFn);
      expect(cb.getState()).toBe(CircuitState.HALF_OPEN);

      await cb.execute(successFn);
      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });

    it("should reopen circuit on failure in HALF_OPEN", async () => {
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        recoveryTimeout: 1000,
        successThreshold: 3,
      });

      await cb.execute(vi.fn().mockRejectedValue(new Error())).catch(() => {});
      vi.advanceTimersByTime(1001);

      await cb.execute(vi.fn().mockRejectedValue(new Error())).catch(() => {});

      expect(cb.getState()).toBe(CircuitState.OPEN);
    });
  });

  describe("forceReset", () => {
    it("should reset circuit to closed", async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1 });

      await cb.execute(vi.fn().mockRejectedValue(new Error())).catch(() => {});
      expect(cb.getState()).toBe(CircuitState.OPEN);

      cb.forceReset();
      expect(cb.getState()).toBe(CircuitState.CLOSED);
      expect(cb.getStats().failures).toBe(0);
    });
  });

  describe("forceOpen", () => {
    it("should force circuit to open", () => {
      const cb = new CircuitBreaker();

      cb.forceOpen();
      expect(cb.getState()).toBe(CircuitState.OPEN);
    });
  });
});
