/**
 * Tests for @rollgate/sdk-svelte
 *
 * These tests focus ONLY on Svelte-specific functionality:
 * - createRollgate() factory
 * - Store creation (flags, isLoading, etc.)
 * - Context helpers (setRollgateContext, getRollgateContext)
 * - getFlag, getFlags helpers
 *
 * HTTP, caching, circuit breaker logic is tested in @rollgate/sdk-browser.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted to create mocks that can be referenced in vi.mock factory
const {
  mockClient,
  mockCreateClient,
  mockSetContext,
  mockGetContext,
  contextStore,
} = vi.hoisted(() => {
  const contextStore = new Map<symbol, any>();

  const mockClient = {
    waitForInitialization: vi.fn().mockResolvedValue(undefined),
    isEnabled: vi.fn((key: string, defaultValue: boolean) => {
      const flags: Record<string, boolean> = {
        "enabled-flag": true,
        "disabled-flag": false,
      };
      return flags[key] ?? defaultValue;
    }),
    allFlags: vi.fn(() => ({
      "enabled-flag": true,
      "disabled-flag": false,
    })),
    identify: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
    getMetrics: vi.fn(() => ({
      totalRequests: 5,
      successfulRequests: 4,
      failedRequests: 1,
      successRate: 0.8,
      errorRate: 0.2,
      avgLatencyMs: 50,
      minLatencyMs: 10,
      maxLatencyMs: 100,
      p50LatencyMs: 45,
      p95LatencyMs: 90,
      p99LatencyMs: 98,
      cacheHits: 2,
      cacheMisses: 3,
      cacheHitRate: 0.4,
      notModifiedResponses: 1,
      errorsByCategory: {},
      circuitOpens: 0,
      circuitCloses: 0,
      circuitState: "closed",
      flagEvaluations: {
        totalEvaluations: 10,
        evaluationsPerFlag: {},
        avgEvaluationTimeMs: 0.1,
      },
      windows: {
        "1m": { requests: 5, errors: 1, avgLatencyMs: 50, errorRate: 0.2 },
        "5m": { requests: 5, errors: 1, avgLatencyMs: 50, errorRate: 0.2 },
        "15m": { requests: 5, errors: 1, avgLatencyMs: 50, errorRate: 0.2 },
        "1h": { requests: 5, errors: 1, avgLatencyMs: 50, errorRate: 0.2 },
      },
      uptimeMs: 10000,
      lastRequestAt: Date.now(),
    })),
    close: vi.fn(),
    on: vi.fn((event: string, callback: Function) => {
      if (event === "ready") {
        setTimeout(() => callback(), 0);
      }
    }),
    off: vi.fn(),
  };

  const mockCreateClient = vi.fn(() => mockClient);

  const mockSetContext = vi.fn((key: symbol, value: any) => {
    contextStore.set(key, value);
  });

  const mockGetContext = vi.fn((key: symbol) => contextStore.get(key));

  return {
    mockClient,
    mockCreateClient,
    mockSetContext,
    mockGetContext,
    contextStore,
  };
});

vi.mock("@rollgate/sdk-browser", () => ({
  createClient: mockCreateClient,
  RollgateBrowserClient: vi.fn(),
  CircuitState: {
    CLOSED: "CLOSED",
    OPEN: "OPEN",
    HALF_OPEN: "HALF_OPEN",
  },
  CircuitOpenError: class extends Error {},
  RollgateError: class extends Error {},
  ErrorCategory: {
    AUTH: "AUTH",
    NETWORK: "NETWORK",
    RATE_LIMIT: "RATE_LIMIT",
    VALIDATION: "VALIDATION",
    INTERNAL: "INTERNAL",
    UNKNOWN: "UNKNOWN",
  },
}));

vi.mock("svelte", async () => {
  const actual = await vi.importActual<typeof import("svelte")>("svelte");
  return {
    ...actual,
    setContext: mockSetContext,
    getContext: mockGetContext,
  };
});

import {
  createRollgate,
  setRollgateContext,
  getRollgateContext,
  getFlag,
  getFlags,
  getRollgate,
  CircuitState,
  type RollgateStores,
} from "./index";

describe("createRollgate", () => {
  beforeEach(() => {
    contextStore.clear();
    vi.clearAllMocks();
  });

  it("creates stores object", () => {
    const stores = createRollgate({ apiKey: "test-key" });

    expect(stores).toHaveProperty("flags");
    expect(stores).toHaveProperty("isLoading");
    expect(stores).toHaveProperty("isError");
    expect(stores).toHaveProperty("isStale");
    expect(stores).toHaveProperty("circuitState");
    expect(stores).toHaveProperty("isReady");
  });

  it("creates client with config", () => {
    createRollgate({ apiKey: "test-key" });

    expect(mockCreateClient).toHaveBeenCalledWith("test-key", null, {});
  });

  it("creates client with user", () => {
    createRollgate({ apiKey: "test-key" }, { id: "user-1" });

    expect(mockCreateClient).toHaveBeenCalledWith(
      "test-key",
      { id: "user-1" },
      {},
    );
  });

  it("provides isEnabled function", () => {
    const stores = createRollgate({ apiKey: "test-key" });

    expect(stores.isEnabled("enabled-flag", false)).toBe(true);
    expect(stores.isEnabled("disabled-flag", true)).toBe(false);
    expect(stores.isEnabled("unknown-flag", true)).toBe(true);
  });

  it("provides identify function", async () => {
    const stores = createRollgate({ apiKey: "test-key" });
    await stores.identify({ id: "user-2" });

    expect(mockClient.identify).toHaveBeenCalledWith({ id: "user-2" });
  });

  it("provides reset function", async () => {
    const stores = createRollgate({ apiKey: "test-key" });
    await stores.reset();

    expect(mockClient.reset).toHaveBeenCalled();
  });

  it("provides refresh function", async () => {
    const stores = createRollgate({ apiKey: "test-key" });
    await stores.refresh();

    expect(mockClient.refresh).toHaveBeenCalled();
  });

  it("provides getMetrics function", () => {
    const stores = createRollgate({ apiKey: "test-key" });
    const metrics = stores.getMetrics();

    expect(metrics.totalRequests).toBe(5);
  });

  it("provides close function", () => {
    const stores = createRollgate({ apiKey: "test-key" });
    stores.close();

    expect(mockClient.close).toHaveBeenCalled();
  });

  it("provides flag store helper", () => {
    const stores = createRollgate({ apiKey: "test-key" });
    const flagStore = stores.flag("enabled-flag", false);

    expect(flagStore).toHaveProperty("subscribe");
  });

  it("stores have subscribe method", () => {
    const stores = createRollgate({ apiKey: "test-key" });

    expect(typeof stores.flags.subscribe).toBe("function");
    expect(typeof stores.isLoading.subscribe).toBe("function");
    expect(typeof stores.isError.subscribe).toBe("function");
    expect(typeof stores.isStale.subscribe).toBe("function");
    expect(typeof stores.circuitState.subscribe).toBe("function");
    expect(typeof stores.isReady.subscribe).toBe("function");
  });
});

describe("setRollgateContext", () => {
  beforeEach(() => {
    contextStore.clear();
    vi.clearAllMocks();
  });

  it("sets context with stores", () => {
    const stores = createRollgate({ apiKey: "test-key" });
    setRollgateContext(stores);

    expect(mockSetContext).toHaveBeenCalled();
  });
});

describe("getRollgateContext", () => {
  beforeEach(() => {
    contextStore.clear();
    vi.clearAllMocks();
  });

  it("returns stores from context", () => {
    const stores = createRollgate({ apiKey: "test-key" });
    setRollgateContext(stores);

    const retrieved = getRollgateContext();
    expect(retrieved).toBe(stores);
  });

  it("throws when context not set", () => {
    expect(() => getRollgateContext()).toThrow(
      "Rollgate context not found. Call setRollgateContext first.",
    );
  });
});

describe("getFlag", () => {
  beforeEach(() => {
    contextStore.clear();
    vi.clearAllMocks();
    const stores = createRollgate({ apiKey: "test-key" });
    setRollgateContext(stores);
  });

  it("returns readable store for flag", () => {
    const flagStore = getFlag("enabled-flag", false);
    expect(flagStore).toHaveProperty("subscribe");
  });
});

describe("getFlags", () => {
  beforeEach(() => {
    contextStore.clear();
    vi.clearAllMocks();
    const stores = createRollgate({ apiKey: "test-key" });
    setRollgateContext(stores);
  });

  it("returns readable store for multiple flags", () => {
    const flagsStore = getFlags(["enabled-flag", "disabled-flag"]);
    expect(flagsStore).toHaveProperty("subscribe");
  });
});

describe("getRollgate", () => {
  beforeEach(() => {
    contextStore.clear();
    vi.clearAllMocks();
    const stores = createRollgate({ apiKey: "test-key" });
    setRollgateContext(stores);
  });

  it("returns full stores from context", () => {
    const stores = getRollgate();

    expect(stores).toHaveProperty("flags");
    expect(stores).toHaveProperty("isEnabled");
    expect(stores).toHaveProperty("identify");
    expect(stores).toHaveProperty("refresh");
  });
});

describe("exports", () => {
  it("exports CircuitState", () => {
    expect(CircuitState).toBeDefined();
    expect(CircuitState.CLOSED).toBe("CLOSED");
    expect(CircuitState.OPEN).toBe("OPEN");
    expect(CircuitState.HALF_OPEN).toBe("HALF_OPEN");
  });
});
