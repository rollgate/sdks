/**
 * Integration tests for @rollgate/sdk-svelte
 *
 * These tests use the REAL sdk-browser (not mocked) to verify
 * that the passthrough from Svelte stores to sdk-browser works correctly.
 *
 * Only the fetch layer is mocked to simulate API responses.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { get } from "svelte/store";

// Mock fetch globally - this is the ONLY mock
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock Svelte context (minimal mock, actual stores are real)
let contextStore: Map<symbol, any> = new Map();
vi.mock("svelte", async () => {
  const actual = await vi.importActual<typeof import("svelte")>("svelte");
  return {
    ...actual,
    setContext: vi.fn((key: symbol, value: any) => {
      contextStore.set(key, value);
    }),
    getContext: vi.fn((key: symbol) => contextStore.get(key)),
  };
});

// Import AFTER mocking fetch
import {
  createRollgate,
  setRollgateContext,
  getRollgateContext,
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

describe("Svelte SDK Integration (real sdk-browser)", () => {
  let stores: ReturnType<typeof createRollgate>;

  beforeEach(() => {
    vi.clearAllMocks();
    contextStore.clear();
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
    if (stores) {
      stores.close();
    }
  });

  it("fetches flags from real sdk-browser on init", async () => {
    stores = createRollgate({ apiKey: "test-api-key" });

    // Wait for initialization
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify fetch was called with correct URL and headers
    expect(mockFetch).toHaveBeenCalled();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain("/flags");
    expect(options.headers["Authorization"]).toBe("Bearer test-api-key");
  });

  it("isEnabled returns correct values through full passthrough", async () => {
    stores = createRollgate({ apiKey: "test-api-key" });

    // Wait for initialization
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(stores.isEnabled("feature-a", false)).toBe(true);
    expect(stores.isEnabled("feature-b", true)).toBe(false);
    expect(stores.isEnabled("unknown-flag", true)).toBe(true);
  });

  it("flags store contains correct values", async () => {
    stores = createRollgate({ apiKey: "test-api-key" });

    // Wait for initialization
    await new Promise((resolve) => setTimeout(resolve, 100));

    const flags = get(stores.flags);
    expect(flags).toEqual({
      "feature-a": true,
      "feature-b": false,
      "feature-c": true,
    });
  });

  it("flag() helper returns reactive store with correct value", async () => {
    stores = createRollgate({ apiKey: "test-api-key" });

    // Wait for initialization
    await new Promise((resolve) => setTimeout(resolve, 100));

    const featureA = stores.flag("feature-a", false);
    const featureB = stores.flag("feature-b", true);

    expect(get(featureA)).toBe(true);
    expect(get(featureB)).toBe(false);
  });

  it("isLoading store transitions from true to false", async () => {
    stores = createRollgate({ apiKey: "test-api-key" });

    // Initially loading
    expect(get(stores.isLoading)).toBe(true);

    // Wait for initialization
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should be done loading
    expect(get(stores.isLoading)).toBe(false);
  });

  it("isReady store transitions to true after init", async () => {
    stores = createRollgate({ apiKey: "test-api-key" });

    // Initially not ready
    expect(get(stores.isReady)).toBe(false);

    // Wait for initialization
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should be ready
    expect(get(stores.isReady)).toBe(true);
  });

  it("identify passes user context through to sdk-browser", async () => {
    stores = createRollgate({ apiKey: "test-api-key" });

    // Wait for initialization
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Reset mock to track identify call
    mockFetch.mockClear();
    mockFetch.mockResolvedValue(
      createFlagsResponse({
        "feature-a": true,
        "feature-b": true,
      }),
    );

    await stores.identify({ id: "user-123", email: "test@example.com" });

    // Verify fetch was called after identify
    expect(mockFetch).toHaveBeenCalled();
  });

  it("refresh fetches fresh flags from API", async () => {
    stores = createRollgate({ apiKey: "test-api-key" });

    // Wait for initialization
    await new Promise((resolve) => setTimeout(resolve, 100));

    const initialCallCount = mockFetch.mock.calls.length;

    mockFetch.mockResolvedValue(
      createFlagsResponse({
        "feature-a": false,
        "feature-b": true,
      }),
    );

    await stores.refresh();

    expect(mockFetch.mock.calls.length).toBeGreaterThan(initialCallCount);
  });

  it("reset clears user context", async () => {
    stores = createRollgate({ apiKey: "test-api-key" });

    // Wait for initialization
    await new Promise((resolve) => setTimeout(resolve, 100));

    await stores.identify({ id: "user-123" });

    mockFetch.mockClear();
    mockFetch.mockResolvedValue(
      createFlagsResponse({
        "feature-a": true,
        "feature-b": false,
      }),
    );

    await stores.reset();

    // Verify fetch was called after reset
    expect(mockFetch).toHaveBeenCalled();
  });

  it("handles API errors gracefully", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    stores = createRollgate({ apiKey: "test-api-key" });

    // Wait for error handling
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Should return default values when API fails
    expect(stores.isEnabled("feature-a", true)).toBe(true);
    expect(stores.isEnabled("feature-a", false)).toBe(false);
  });

  it("getMetrics returns real metrics from sdk-browser", async () => {
    stores = createRollgate({ apiKey: "test-api-key" });

    // Wait for initialization
    await new Promise((resolve) => setTimeout(resolve, 100));

    const metrics = stores.getMetrics();

    expect(metrics).toHaveProperty("totalRequests");
    expect(metrics).toHaveProperty("successfulRequests");
    expect(metrics).toHaveProperty("avgLatencyMs");
    expect(typeof metrics.totalRequests).toBe("number");
  });

  it("context functions work correctly", async () => {
    stores = createRollgate({ apiKey: "test-api-key" });
    setRollgateContext(stores);

    // Wait for initialization
    await new Promise((resolve) => setTimeout(resolve, 100));

    const retrieved = getRollgateContext();

    expect(retrieved).toBe(stores);
    expect(retrieved.isEnabled("feature-a", false)).toBe(true);
  });

  it("close cleans up client", async () => {
    stores = createRollgate({ apiKey: "test-api-key" });

    // Wait for initialization
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should not throw
    expect(() => stores.close()).not.toThrow();
  });

  it("initial user context is passed to sdk-browser", async () => {
    stores = createRollgate(
      { apiKey: "test-api-key" },
      { id: "initial-user", attributes: { plan: "pro" } },
    );

    // Wait for initialization
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockFetch).toHaveBeenCalled();
  });
});
