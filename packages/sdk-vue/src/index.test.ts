/**
 * Tests for @rollgate/sdk-vue
 *
 * These tests focus ONLY on Vue-specific functionality:
 * - Plugin installation
 * - Composables (useFlag, useFlags, useRollgate)
 * - Context (provide/inject)
 *
 * HTTP, caching, circuit breaker logic is tested in @rollgate/sdk-browser.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref, nextTick } from "vue";
import {
  RollgatePlugin,
  useFlag,
  useFlags,
  useRollgate,
  provideRollgate,
  injectRollgate,
  ROLLGATE_KEY,
  type RollgateContext,
} from "./index";

// Mock sdk-browser
vi.mock("@rollgate/sdk-browser", () => {
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

  return {
    createClient: vi.fn(() => mockClient),
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
  };
});

// Mock Vue's provide/inject
let providedContext: RollgateContext | null = null;

vi.mock("vue", async () => {
  const actual = await vi.importActual<typeof import("vue")>("vue");
  return {
    ...actual,
    provide: vi.fn((key, value) => {
      providedContext = value;
    }),
    inject: vi.fn((key) => providedContext),
    setContext: vi.fn((key, value) => {
      providedContext = value;
    }),
    getContext: vi.fn((key) => providedContext),
  };
});

describe("RollgatePlugin", () => {
  beforeEach(() => {
    providedContext = null;
  });

  it("installs and provides context", () => {
    const mockApp = {
      provide: vi.fn(),
      config: { globalProperties: {} },
    };

    RollgatePlugin.install(mockApp as any, {
      config: { apiKey: "test-key" },
    });

    expect(mockApp.provide).toHaveBeenCalledWith(
      ROLLGATE_KEY,
      expect.objectContaining({
        isEnabled: expect.any(Function),
        identify: expect.any(Function),
        reset: expect.any(Function),
        refresh: expect.any(Function),
      }),
    );
  });
});

describe("provideRollgate", () => {
  beforeEach(() => {
    providedContext = null;
  });

  it("creates and provides context", () => {
    const context = provideRollgate({ apiKey: "test-key" });

    expect(context).toHaveProperty("isEnabled");
    expect(context).toHaveProperty("flags");
    expect(context).toHaveProperty("isLoading");
    expect(context).toHaveProperty("identify");
  });

  it("accepts initial user", () => {
    const context = provideRollgate(
      { apiKey: "test-key" },
      { id: "user-1", email: "test@example.com" },
    );

    expect(context).toBeDefined();
  });
});

describe("injectRollgate", () => {
  beforeEach(() => {
    providedContext = null;
  });

  it("returns context when provided", () => {
    // Setup context first
    provideRollgate({ apiKey: "test-key" });

    const context = injectRollgate();
    expect(context).toBeDefined();
    expect(context.isEnabled).toBeInstanceOf(Function);
  });

  it("throws when context not provided", () => {
    providedContext = null;

    expect(() => injectRollgate()).toThrow("Rollgate not provided");
  });
});

describe("useFlag", () => {
  beforeEach(() => {
    providedContext = null;
    provideRollgate({ apiKey: "test-key" });
  });

  it("returns computed ref for enabled flag", () => {
    const flag = useFlag("enabled-flag", false);
    expect(flag.value).toBe(true);
  });

  it("returns computed ref for disabled flag", () => {
    const flag = useFlag("disabled-flag", true);
    expect(flag.value).toBe(false);
  });

  it("returns default value for unknown flag", () => {
    const flag = useFlag("unknown-flag", true);
    expect(flag.value).toBe(true);
  });
});

describe("useFlags", () => {
  beforeEach(() => {
    providedContext = null;
    provideRollgate({ apiKey: "test-key" });
  });

  it("returns computed ref with multiple flags", () => {
    const flags = useFlags(["enabled-flag", "disabled-flag"]);
    expect(flags.value).toEqual({
      "enabled-flag": true,
      "disabled-flag": false,
    });
  });
});

describe("useRollgate", () => {
  beforeEach(() => {
    providedContext = null;
    provideRollgate({ apiKey: "test-key" });
  });

  it("returns full context", () => {
    const context = useRollgate();

    expect(context).toHaveProperty("isEnabled");
    expect(context).toHaveProperty("flags");
    expect(context).toHaveProperty("isLoading");
    expect(context).toHaveProperty("isError");
    expect(context).toHaveProperty("identify");
    expect(context).toHaveProperty("reset");
    expect(context).toHaveProperty("refresh");
    expect(context).toHaveProperty("getMetrics");
  });

  it("provides working identify function", async () => {
    const context = useRollgate();
    await expect(context.identify({ id: "user-2" })).resolves.toBeUndefined();
  });

  it("provides working refresh function", async () => {
    const context = useRollgate();
    await expect(context.refresh()).resolves.toBeUndefined();
  });

  it("provides working getMetrics function", () => {
    const context = useRollgate();
    const metrics = context.getMetrics();
    expect(metrics.totalRequests).toBe(5);
  });
});
