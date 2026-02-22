/**
 * Tests for @rollgate/sdk-react
 *
 * These tests focus ONLY on React-specific functionality:
 * - Provider/Context setup
 * - Hooks behavior
 * - Feature component
 *
 * HTTP, caching, circuit breaker logic is tested in @rollgate/sdk-browser.
 */
import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  RollgateProvider,
  useFlag,
  useFlags,
  useRollgate,
  useMetrics,
  Feature,
} from "./index";

// Mock sdk-browser
jest.mock("@rollgate/sdk-browser", () => {
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
      // Simulate ready event on next tick
      if (event === "ready") {
        setTimeout(() => callback(), 0);
      }
    }),
    off: jest.fn(),
  };

  return {
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
  };
});

describe("RollgateProvider", () => {
  it("renders children", async () => {
    render(
      <RollgateProvider config={{ apiKey: "test-key" }}>
        <div data-testid="child">Hello</div>
      </RollgateProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("child")).toHaveTextContent("Hello");
    });
  });

  it("provides context to children", async () => {
    function TestComponent() {
      const { flags } = useRollgate();
      return <div data-testid="flags">{JSON.stringify(flags)}</div>;
    }

    render(
      <RollgateProvider config={{ apiKey: "test-key" }}>
        <TestComponent />
      </RollgateProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("flags")).toBeInTheDocument();
    });
  });
});

describe("useFlag", () => {
  it("returns true for enabled flag", async () => {
    function TestComponent() {
      const enabled = useFlag("enabled-flag", false);
      return <div data-testid="result">{enabled ? "yes" : "no"}</div>;
    }

    render(
      <RollgateProvider config={{ apiKey: "test-key" }}>
        <TestComponent />
      </RollgateProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("result")).toHaveTextContent("yes");
    });
  });

  it("returns false for disabled flag", async () => {
    function TestComponent() {
      const enabled = useFlag("disabled-flag", true);
      return <div data-testid="result">{enabled ? "yes" : "no"}</div>;
    }

    render(
      <RollgateProvider config={{ apiKey: "test-key" }}>
        <TestComponent />
      </RollgateProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("result")).toHaveTextContent("no");
    });
  });

  it("returns default value for unknown flag", async () => {
    function TestComponent() {
      const enabled = useFlag("unknown-flag", true);
      return <div data-testid="result">{enabled ? "yes" : "no"}</div>;
    }

    render(
      <RollgateProvider config={{ apiKey: "test-key" }}>
        <TestComponent />
      </RollgateProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("result")).toHaveTextContent("yes");
    });
  });

  it("throws when used outside provider", () => {
    function TestComponent() {
      useFlag("test-flag");
      return null;
    }

    // Suppress console.error for this test
    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    expect(() => render(<TestComponent />)).toThrow(
      "useFlag must be used within a RollgateProvider",
    );

    consoleSpy.mockRestore();
  });
});

describe("useFlags", () => {
  it("returns multiple flags", async () => {
    function TestComponent() {
      const flags = useFlags(["enabled-flag", "disabled-flag"]);
      return (
        <div data-testid="result">
          {flags["enabled-flag"] ? "E" : "e"}
          {flags["disabled-flag"] ? "D" : "d"}
        </div>
      );
    }

    render(
      <RollgateProvider config={{ apiKey: "test-key" }}>
        <TestComponent />
      </RollgateProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("result")).toHaveTextContent("Ed");
    });
  });
});

describe("useRollgate", () => {
  it("provides identify function", async () => {
    function TestComponent() {
      const { identify } = useRollgate();
      return (
        <button
          data-testid="identify"
          onClick={() => identify({ id: "user-1" })}
        >
          Identify
        </button>
      );
    }

    render(
      <RollgateProvider config={{ apiKey: "test-key" }}>
        <TestComponent />
      </RollgateProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("identify")).toBeInTheDocument();
    });
  });

  it("provides refresh function", async () => {
    function TestComponent() {
      const { refresh } = useRollgate();
      return (
        <button data-testid="refresh" onClick={() => refresh()}>
          Refresh
        </button>
      );
    }

    render(
      <RollgateProvider config={{ apiKey: "test-key" }}>
        <TestComponent />
      </RollgateProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("refresh")).toBeInTheDocument();
    });
  });
});

describe("useMetrics", () => {
  it("returns metrics snapshot", async () => {
    function TestComponent() {
      const { metrics } = useMetrics();
      return <div data-testid="requests">{metrics.totalRequests}</div>;
    }

    render(
      <RollgateProvider config={{ apiKey: "test-key" }}>
        <TestComponent />
      </RollgateProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("requests")).toHaveTextContent("5");
    });
  });
});

describe("Feature", () => {
  it("renders children when flag is enabled", async () => {
    render(
      <RollgateProvider config={{ apiKey: "test-key" }}>
        <Feature flag="enabled-flag">
          <div data-testid="feature">Enabled content</div>
        </Feature>
      </RollgateProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("feature")).toHaveTextContent(
        "Enabled content",
      );
    });
  });

  it("renders fallback when flag is disabled", async () => {
    render(
      <RollgateProvider config={{ apiKey: "test-key" }}>
        <Feature
          flag="disabled-flag"
          fallback={<div data-testid="fallback">Fallback</div>}
        >
          <div data-testid="feature">Enabled content</div>
        </Feature>
      </RollgateProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("fallback")).toHaveTextContent("Fallback");
    });
  });

  it("renders nothing when flag is disabled and no fallback", async () => {
    render(
      <RollgateProvider config={{ apiKey: "test-key" }}>
        <Feature flag="disabled-flag">
          <div data-testid="feature">Enabled content</div>
        </Feature>
        <div data-testid="marker">Marker</div>
      </RollgateProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("marker")).toBeInTheDocument();
      expect(screen.queryByTestId("feature")).not.toBeInTheDocument();
    });
  });
});

describe("RollgateProvider flat props", () => {
  it("accepts apiKey as direct prop", async () => {
    function TestComponent() {
      const { flags } = useRollgate();
      return <div data-testid="flags">{JSON.stringify(flags)}</div>;
    }

    render(
      <RollgateProvider apiKey="test-key">
        <TestComponent />
      </RollgateProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("flags")).toBeInTheDocument();
    });
  });

  it("accepts apiKey and baseUrl as direct props", async () => {
    render(
      <RollgateProvider apiKey="test-key" baseUrl="http://localhost:8080">
        <div data-testid="child">Hello</div>
      </RollgateProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("child")).toHaveTextContent("Hello");
    });
  });

  it("accepts all flat props", async () => {
    render(
      <RollgateProvider
        apiKey="test-key"
        baseUrl="http://localhost:8080"
        refreshInterval={60000}
        enableStreaming={false}
        timeout={10000}
      >
        <div data-testid="child">Hello</div>
      </RollgateProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("child")).toHaveTextContent("Hello");
    });
  });

  it("still works with deprecated config prop (backward compat)", async () => {
    render(
      <RollgateProvider config={{ apiKey: "test-key" }}>
        <div data-testid="child">Hello</div>
      </RollgateProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("child")).toHaveTextContent("Hello");
    });
  });

  it("warns when using deprecated config prop", async () => {
    const consoleSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    render(
      <RollgateProvider config={{ apiKey: "test-key" }}>
        <div data-testid="child">Hello</div>
      </RollgateProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("child")).toBeInTheDocument();
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("deprecated"),
    );

    consoleSpy.mockRestore();
  });
});
