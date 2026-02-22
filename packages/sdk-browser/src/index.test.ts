/**
 * Tests for @rollgate/sdk-browser new API surface
 *
 * Tests config object constructor, RollgateClient alias, init() method,
 * and createClient overloads.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RollgateBrowserClient, RollgateClient, createClient } from "./index";

// Mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch as unknown as typeof fetch;

const createMockResponse = (data: unknown) => ({
  ok: true,
  status: 200,
  json: async () => data,
  headers: {
    get: () => null,
  },
});

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue(
    createMockResponse({ flags: { "test-flag": true } }),
  );
});

describe("RollgateClient alias", () => {
  it("should be the same class as RollgateBrowserClient", () => {
    expect(RollgateClient).toBe(RollgateBrowserClient);
  });
});

describe("Config object constructor", () => {
  it("should accept a config object", () => {
    const client = new RollgateBrowserClient({
      apiKey: "rg_test_key",
      baseUrl: "http://localhost:8080",
    });
    expect(client).toBeInstanceOf(RollgateBrowserClient);
    client.close();
  });

  it("should accept config object with user", () => {
    const client = new RollgateBrowserClient({
      apiKey: "rg_test_key",
      user: { id: "user-1", email: "test@test.com" },
    });
    expect(client).toBeInstanceOf(RollgateBrowserClient);
    client.close();
  });

  it("should accept config object with all options", () => {
    const client = new RollgateBrowserClient({
      apiKey: "rg_test_key",
      baseUrl: "http://localhost:8080",
      user: { id: "user-1" },
      refreshInterval: 60000,
      timeout: 10000,
    });
    expect(client).toBeInstanceOf(RollgateBrowserClient);
    client.close();
  });
});

describe("Legacy positional constructor (backward compat)", () => {
  it("should still work with positional args", () => {
    const client = new RollgateBrowserClient("rg_test_key", null);
    expect(client).toBeInstanceOf(RollgateBrowserClient);
    client.close();
  });

  it("should still work with positional args and user context", () => {
    const client = new RollgateBrowserClient(
      "rg_test_key",
      { id: "user-1" },
      { baseUrl: "http://localhost:8080" },
    );
    expect(client).toBeInstanceOf(RollgateBrowserClient);
    client.close();
  });
});

describe("init() method", () => {
  it("should exist on the client", () => {
    const client = new RollgateBrowserClient({ apiKey: "rg_test_key" });
    expect(typeof client.init).toBe("function");
    client.close();
  });

  it("should resolve when initialization completes", async () => {
    const client = new RollgateBrowserClient({
      apiKey: "rg_test_key",
      baseUrl: "http://localhost:8080",
    });
    await client.init();
    expect(client.isReady()).toBe(true);
    client.close();
  });
});

describe("createClient overloads", () => {
  it("should accept config object", () => {
    const client = createClient({ apiKey: "rg_test_key" });
    expect(client).toBeInstanceOf(RollgateBrowserClient);
    client.close();
  });

  it("should accept positional args (backward compat)", () => {
    const client = createClient("rg_test_key", { id: "user-1" });
    expect(client).toBeInstanceOf(RollgateBrowserClient);
    client.close();
  });

  it("should accept positional args with options", () => {
    const client = createClient("rg_test_key", null, {
      baseUrl: "http://localhost:8080",
    });
    expect(client).toBeInstanceOf(RollgateBrowserClient);
    client.close();
  });
});
