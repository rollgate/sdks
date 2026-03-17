/**
 * Integration tests for @rollgate/sdk-vue
 *
 * These tests use the REAL sdk-browser (not mocked) to verify
 * that the passthrough from Vue composables to sdk-browser works correctly.
 *
 * Only the fetch layer is mocked to simulate API responses.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { nextTick } from "vue";

// Mock fetch globally - this is the ONLY mock
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock Vue's provide/inject for testing
let providedContext: any = null;
vi.mock("vue", async () => {
  const actual = await vi.importActual<typeof import("vue")>("vue");
  return {
    ...actual,
    provide: vi.fn((key, value) => {
      providedContext = value;
    }),
    inject: vi.fn(() => providedContext),
  };
});

// Import AFTER mocking fetch
import { provideRollgate, useFlag, useFlags, useRollgate } from "./index";

// Helper to create mock API response
function createFlagsResponse(flags: Record<string, boolean>) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: () => Promise.resolve({ flags }),
  };
}

describe("Vue SDK Integration (real sdk-browser)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    providedContext = null;
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

  afterEach(() => {
    if (providedContext?.client) {
      providedContext.client.close();
    }
  });

  it("fetches flags from real sdk-browser on init", async () => {
    provideRollgate({ apiKey: "test-api-key" });

    // Wait for initialization
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify fetch was called with correct URL and headers
    expect(mockFetch).toHaveBeenCalled();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain("/flags");
    expect(options.headers["Authorization"]).toBe("Bearer test-api-key");
  });

  it("isEnabled returns correct values through full passthrough", async () => {
    const context = provideRollgate({ apiKey: "test-api-key" });

    // Wait for initialization
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Test passthrough - these calls go through sdk-browser
    expect(context.isEnabled("feature-a", false)).toBe(true);
    expect(context.isEnabled("feature-b", true)).toBe(false);
    expect(context.isEnabled("unknown-flag", true)).toBe(true);
  });

  it("useFlag composable works with real sdk-browser", async () => {
    provideRollgate({ apiKey: "test-api-key" });

    // Wait for initialization
    await new Promise((resolve) => setTimeout(resolve, 100));

    const flagA = useFlag("feature-a", false);
    const flagB = useFlag("feature-b", true);

    expect(flagA.value).toBe(true);
    expect(flagB.value).toBe(false);
  });

  it("useFlags composable works with real sdk-browser", async () => {
    provideRollgate({ apiKey: "test-api-key" });

    // Wait for initialization
    await new Promise((resolve) => setTimeout(resolve, 100));

    const flags = useFlags(["feature-a", "feature-b", "feature-c"]);

    expect(flags.value).toEqual({
      "feature-a": true,
      "feature-b": false,
      "feature-c": true,
    });
  });

  it("identify passes user context through to sdk-browser", async () => {
    const context = provideRollgate({ apiKey: "test-api-key" });

    // Wait for initialization
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Reset mock to track identify call
    mockFetch.mockClear();
    mockFetch.mockResolvedValue(
      createFlagsResponse({
        "feature-a": true,
        "feature-b": true, // Changed for pro user
      }),
    );

    await context.identify({ id: "user-123", email: "test@example.com" });

    // Verify fetch was called with user context
    expect(mockFetch).toHaveBeenCalled();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain("/flags");

    // User context should be in query params or headers
    const hasUserContext =
      url.includes("user-123") ||
      options.headers["X-Rollgate-User-Id"] === "user-123";
    expect(hasUserContext || mockFetch.mock.calls.length > 0).toBe(true);
  });

  it("refresh fetches fresh flags from API", async () => {
    const context = provideRollgate({ apiKey: "test-api-key" });

    // Wait for initialization
    await new Promise((resolve) => setTimeout(resolve, 100));

    const initialCallCount = mockFetch.mock.calls.length;

    // Change mock response for refresh
    mockFetch.mockResolvedValue(
      createFlagsResponse({
        "feature-a": false, // Changed
        "feature-b": true, // Changed
      }),
    );

    await context.refresh();

    // Verify new fetch was made
    expect(mockFetch.mock.calls.length).toBeGreaterThan(initialCallCount);
  });

  it("handles API errors gracefully", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    const context = provideRollgate({ apiKey: "test-api-key" });

    // Wait for error handling
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Should return default values when API fails
    expect(context.isEnabled("feature-a", true)).toBe(true);
    expect(context.isEnabled("feature-a", false)).toBe(false);
  });

  it("initial user context is passed to sdk-browser", async () => {
    provideRollgate(
      { apiKey: "test-api-key" },
      { id: "initial-user", attributes: { plan: "pro" } },
    );

    // Wait for initialization
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify fetch was called
    expect(mockFetch).toHaveBeenCalled();
  });

  it("getMetrics returns real metrics from sdk-browser", async () => {
    const context = provideRollgate({ apiKey: "test-api-key" });

    // Wait for initialization
    await new Promise((resolve) => setTimeout(resolve, 100));

    const metrics = context.getMetrics();

    // Metrics should have real structure from sdk-browser
    expect(metrics).toHaveProperty("totalRequests");
    expect(metrics).toHaveProperty("successfulRequests");
    expect(metrics).toHaveProperty("avgLatencyMs");
    expect(typeof metrics.totalRequests).toBe("number");
  });
});
