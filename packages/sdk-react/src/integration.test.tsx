/**
 * Integration tests for @rollgate/sdk-react
 *
 * These tests use the REAL sdk-browser (not mocked) to verify
 * that the passthrough from React hooks to sdk-browser works correctly.
 *
 * Only the fetch layer is mocked to simulate API responses.
 */
import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";

// Mock fetch globally - this is the ONLY mock
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

// Import AFTER mocking fetch
import {
  RollgateProvider,
  useFlag,
  useFlags,
  useRollgate,
  Feature,
} from "./index";

// Helper to create mock API response
function createFlagsResponse(flags: Record<string, boolean>) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: () => Promise.resolve({ flags }),
  };
}

// Test component that uses hooks
function TestComponent({
  onMount,
}: {
  onMount?: (ctx: ReturnType<typeof useRollgate>) => void;
}) {
  const ctx = useRollgate();
  const featureA = useFlag("feature-a", false);
  const featureB = useFlag("feature-b", true);
  const allFlags = useFlags(["feature-a", "feature-b", "feature-c"]);

  React.useEffect(() => {
    if (onMount && !ctx.isLoading) {
      onMount(ctx);
    }
  }, [ctx.isLoading, onMount, ctx]);

  return (
    <div>
      <div data-testid="loading">{ctx.isLoading ? "loading" : "ready"}</div>
      <div data-testid="feature-a">{featureA ? "enabled" : "disabled"}</div>
      <div data-testid="feature-b">{featureB ? "enabled" : "disabled"}</div>
      <div data-testid="all-flags">{JSON.stringify(allFlags)}</div>
      <Feature flag="feature-a">
        <div data-testid="feature-content">Feature A Content</div>
      </Feature>
    </div>
  );
}

describe("React SDK Integration (real sdk-browser)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    if (typeof localStorage !== "undefined") {
      localStorage.clear();
    }

    // Default mock response
    mockFetch.mockResolvedValue(
      createFlagsResponse({
        "feature-a": true,
        "feature-b": false,
        "feature-c": true,
      }),
    );
  });

  it("fetches flags from real sdk-browser on mount", async () => {
    render(
      <RollgateProvider config={{ apiKey: "test-api-key" }}>
        <TestComponent />
      </RollgateProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("ready");
    });

    // Verify fetch was called with correct URL and headers
    expect(mockFetch).toHaveBeenCalled();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain("/flags");
    expect(options.headers["Authorization"]).toBe("Bearer test-api-key");
  });

  it("useFlag returns correct values through full passthrough", async () => {
    render(
      <RollgateProvider config={{ apiKey: "test-api-key" }}>
        <TestComponent />
      </RollgateProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("ready");
    });

    // feature-a is true in mock response
    expect(screen.getByTestId("feature-a")).toHaveTextContent("enabled");
    // feature-b is false in mock response
    expect(screen.getByTestId("feature-b")).toHaveTextContent("disabled");
  });

  it("useFlags returns correct values through full passthrough", async () => {
    render(
      <RollgateProvider config={{ apiKey: "test-api-key" }}>
        <TestComponent />
      </RollgateProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("ready");
    });

    const allFlags = JSON.parse(screen.getByTestId("all-flags").textContent!);
    expect(allFlags).toEqual({
      "feature-a": true,
      "feature-b": false,
      "feature-c": true,
    });
  });

  it("Feature component renders based on real flag value", async () => {
    render(
      <RollgateProvider config={{ apiKey: "test-api-key" }}>
        <TestComponent />
      </RollgateProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("ready");
    });

    // feature-a is true, so content should be visible
    expect(screen.getByTestId("feature-content")).toBeInTheDocument();
  });

  it("Feature component hides content when flag is false", async () => {
    mockFetch.mockResolvedValue(
      createFlagsResponse({
        "feature-a": false,
        "feature-b": false,
        "feature-c": false,
      }),
    );

    render(
      <RollgateProvider config={{ apiKey: "test-api-key" }}>
        <TestComponent />
      </RollgateProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("ready");
    });

    // feature-a is false, so content should NOT be visible
    expect(screen.queryByTestId("feature-content")).not.toBeInTheDocument();
  });

  it("identify passes user context through to sdk-browser", async () => {
    let capturedCtx: ReturnType<typeof useRollgate> | null = null;

    render(
      <RollgateProvider config={{ apiKey: "test-api-key" }}>
        <TestComponent
          onMount={(ctx) => {
            capturedCtx = ctx;
          }}
        />
      </RollgateProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("ready");
    });

    // Reset mock to track identify call
    mockFetch.mockClear();
    mockFetch.mockResolvedValue(
      createFlagsResponse({
        "feature-a": true,
        "feature-b": true,
      }),
    );

    await act(async () => {
      await capturedCtx!.identify({
        id: "user-123",
        email: "test@example.com",
      });
    });

    // Verify fetch was called after identify
    expect(mockFetch).toHaveBeenCalled();
  });

  it("refresh fetches fresh flags from API", async () => {
    let capturedCtx: ReturnType<typeof useRollgate> | null = null;

    render(
      <RollgateProvider config={{ apiKey: "test-api-key" }}>
        <TestComponent
          onMount={(ctx) => {
            capturedCtx = ctx;
          }}
        />
      </RollgateProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("ready");
    });

    const initialCallCount = mockFetch.mock.calls.length;

    mockFetch.mockResolvedValue(
      createFlagsResponse({
        "feature-a": false,
        "feature-b": true,
      }),
    );

    await act(async () => {
      await capturedCtx!.refresh();
    });

    expect(mockFetch.mock.calls.length).toBeGreaterThan(initialCallCount);
  });

  it("handles API errors gracefully", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    render(
      <RollgateProvider config={{ apiKey: "test-api-key" }}>
        <TestComponent />
      </RollgateProvider>,
    );

    // Wait for error handling
    await waitFor(
      () => {
        expect(screen.getByTestId("loading")).toHaveTextContent("ready");
      },
      { timeout: 2000 },
    );

    // Should use default values when API fails
    expect(screen.getByTestId("feature-a")).toHaveTextContent("disabled"); // default false
    expect(screen.getByTestId("feature-b")).toHaveTextContent("enabled"); // default true
  });

  it("initial user context is passed to sdk-browser", async () => {
    render(
      <RollgateProvider
        config={{ apiKey: "test-api-key" }}
        user={{ id: "initial-user", attributes: { plan: "pro" } }}
      >
        <TestComponent />
      </RollgateProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("ready");
    });

    expect(mockFetch).toHaveBeenCalled();
  });

  it("getMetrics returns real metrics from sdk-browser", async () => {
    let capturedCtx: ReturnType<typeof useRollgate> | null = null;

    render(
      <RollgateProvider config={{ apiKey: "test-api-key" }}>
        <TestComponent
          onMount={(ctx) => {
            capturedCtx = ctx;
          }}
        />
      </RollgateProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("ready");
    });

    const metrics = capturedCtx!.getMetrics();

    expect(metrics).toHaveProperty("totalRequests");
    expect(metrics).toHaveProperty("successfulRequests");
    expect(metrics).toHaveProperty("avgLatencyMs");
    expect(typeof metrics.totalRequests).toBe("number");
  });
});
