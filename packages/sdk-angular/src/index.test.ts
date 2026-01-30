/**
 * Tests for @rollgate/sdk-angular
 *
 * These tests focus ONLY on Angular-specific functionality:
 * - RollgateService (Injectable service)
 * - RollgateModule (NgModule)
 * - FeatureDirective (*rollgateFeature)
 *
 * HTTP, caching, circuit breaker logic is tested in @rollgate/sdk-browser.
 */

// Mock sdk-browser BEFORE importing anything else
const mockClient = {
  waitForInitialization: jest.fn().mockResolvedValue(undefined),
  isEnabled: jest.fn((key: string, defaultValue: boolean) => {
    const flags: Record<string, boolean> = {
      "enabled-flag": true,
      "disabled-flag": false,
    };
    return flags[key] ?? defaultValue;
  }),
  allFlags: jest.fn(() => ({
    "enabled-flag": true,
    "disabled-flag": false,
  })),
  identify: jest.fn().mockResolvedValue(undefined),
  reset: jest.fn().mockResolvedValue(undefined),
  refresh: jest.fn().mockResolvedValue(undefined),
  getMetrics: jest.fn(() => ({
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
  close: jest.fn(),
  on: jest.fn((event: string, callback: Function) => {
    if (event === "ready") {
      setTimeout(() => callback(), 0);
    }
  }),
  off: jest.fn(),
};

jest.mock("@rollgate/sdk-browser", () => ({
  createClient: jest.fn(() => mockClient),
  RollgateBrowserClient: jest.fn(),
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

// Mock Angular decorators and DI
jest.mock("@angular/core", () => ({
  Injectable: () => (target: any) => target,
  NgModule: (config: any) => (target: any) => target,
  Directive: (config: any) => (target: any) => target,
  Input: () => (target: any, propertyKey: string) => {},
  Inject:
    (token: any) => (target: any, propertyKey: string, index: number) => {},
  InjectionToken: class {
    constructor(public description: string) {}
  },
  ModuleWithProviders: class {},
  TemplateRef: class {},
  ViewContainerRef: class {},
  OnInit: class {},
  OnDestroy: class {},
}));

import {
  RollgateService,
  RollgateModule,
  FeatureDirective,
  ROLLGATE_CONFIG,
  CircuitState,
} from "./index";

describe("RollgateService", () => {
  let service: RollgateService;

  beforeEach(() => {
    jest.clearAllMocks();
    // Create service with config injected
    service = new (RollgateService as any)({ apiKey: "test-key" });
  });

  afterEach(() => {
    if (service.ngOnDestroy) {
      service.ngOnDestroy();
    }
  });

  it("initializes with config", () => {
    const { createClient } = require("@rollgate/sdk-browser");
    expect(createClient).toHaveBeenCalledWith("test-key", null, {});
  });

  it("isEnabled returns correct value for enabled flag", () => {
    expect(service.isEnabled("enabled-flag", false)).toBe(true);
  });

  it("isEnabled returns correct value for disabled flag", () => {
    expect(service.isEnabled("disabled-flag", true)).toBe(false);
  });

  it("isEnabled returns default for unknown flag", () => {
    expect(service.isEnabled("unknown-flag", true)).toBe(true);
    expect(service.isEnabled("unknown-flag", false)).toBe(false);
  });

  it("has observable flags$", () => {
    expect(service.flags$).toBeDefined();
    expect(typeof service.flags$.subscribe).toBe("function");
  });

  it("has observable isLoading$", () => {
    expect(service.isLoading$).toBeDefined();
    expect(typeof service.isLoading$.subscribe).toBe("function");
  });

  it("has observable isError$", () => {
    expect(service.isError$).toBeDefined();
    expect(typeof service.isError$.subscribe).toBe("function");
  });

  it("has observable circuitState$", () => {
    expect(service.circuitState$).toBeDefined();
    expect(typeof service.circuitState$.subscribe).toBe("function");
  });

  it("identify calls client.identify", async () => {
    await service.identify({ id: "user-2" });
    expect(mockClient.identify).toHaveBeenCalledWith({ id: "user-2" });
  });

  it("reset calls client.reset", async () => {
    await service.reset();
    expect(mockClient.reset).toHaveBeenCalled();
  });

  it("refresh calls client.refresh", async () => {
    await service.refresh();
    expect(mockClient.refresh).toHaveBeenCalled();
  });

  it("getMetrics returns metrics", () => {
    const metrics = service.getMetrics();
    expect(metrics.totalRequests).toBe(5);
  });

  it("ngOnDestroy closes client", () => {
    service.ngOnDestroy();
    expect(mockClient.close).toHaveBeenCalled();
  });
});

describe("RollgateModule", () => {
  it("forRoot returns ModuleWithProviders", () => {
    const result = RollgateModule.forRoot({ apiKey: "test-key" });

    expect(result).toHaveProperty("ngModule");
    expect(result).toHaveProperty("providers");
    expect(result.ngModule).toBe(RollgateModule);
    expect(result.providers).toContainEqual({
      provide: ROLLGATE_CONFIG,
      useValue: { apiKey: "test-key" },
    });
  });
});

describe("FeatureDirective", () => {
  let directive: FeatureDirective;
  let mockTemplateRef: any;
  let mockViewContainer: any;
  let mockRollgateService: any;

  beforeEach(() => {
    mockTemplateRef = {};
    mockViewContainer = {
      clear: jest.fn(),
      createEmbeddedView: jest.fn(),
    };
    mockRollgateService = {
      isEnabled: jest.fn((key: string) => key === "enabled-flag"),
      flags$: {
        subscribe: jest.fn((callback: Function) => {
          // Immediately call callback to simulate initial value
          callback();
          return { unsubscribe: jest.fn() };
        }),
      },
    };

    directive = new FeatureDirective(
      mockTemplateRef,
      mockViewContainer,
      mockRollgateService,
    );
  });

  it("creates view for enabled flag", () => {
    directive.rollgateFeature = "enabled-flag";
    directive.ngOnInit();

    expect(mockViewContainer.createEmbeddedView).toHaveBeenCalledWith(
      mockTemplateRef,
    );
  });

  it("clears view for disabled flag", () => {
    directive.rollgateFeature = "disabled-flag";
    directive.ngOnInit();

    expect(mockViewContainer.clear).toHaveBeenCalled();
    expect(mockViewContainer.createEmbeddedView).not.toHaveBeenCalled();
  });

  it("shows else template when flag is disabled", () => {
    const elseTemplate = {};
    directive.rollgateFeature = "disabled-flag";
    directive.rollgateFeatureElse = elseTemplate as any;
    directive.ngOnInit();

    expect(mockViewContainer.createEmbeddedView).toHaveBeenCalledWith(
      elseTemplate,
    );
  });

  it("unsubscribes on destroy", () => {
    const mockUnsubscribe = jest.fn();
    mockRollgateService.flags$.subscribe = jest.fn(() => ({
      unsubscribe: mockUnsubscribe,
    }));

    directive.ngOnInit();
    directive.ngOnDestroy();

    expect(mockUnsubscribe).toHaveBeenCalled();
  });
});

describe("ROLLGATE_CONFIG", () => {
  it("is defined as InjectionToken", () => {
    expect(ROLLGATE_CONFIG).toBeDefined();
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
