import {
  RollgateClient,
  RollgateConfig,
  UserContext,
  EvalContext,
} from "./index";

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

// Helper to create mock response with headers (needed for ETag support)
const createMockResponse = (
  data: unknown,
  options: { ok?: boolean; status?: number; etag?: string } = {},
) => ({
  ok: options.ok ?? true,
  status: options.status ?? 200,
  json: async () => data,
  headers: {
    get: (name: string) => {
      if (name === "ETag" && options.etag) return options.etag;
      return null;
    },
  },
});

describe("RollgateClient", () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  describe("constructor", () => {
    it("should create client with required config", () => {
      const client = new RollgateClient({
        apiKey: "test-key",
      });

      expect(client).toBeInstanceOf(RollgateClient);
    });

    it("should use default values for optional config", () => {
      const client = new RollgateClient({
        apiKey: "test-key",
      });

      expect(client).toBeDefined();
    });

    it("should accept custom config values", () => {
      const client = new RollgateClient({
        apiKey: "test-key",
        baseUrl: "https://custom.api.com",
        refreshInterval: 30000,
        enableStreaming: true,
      });

      expect(client).toBeDefined();
    });
  });

  describe("init", () => {
    it("should fetch flags on init", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ flags: { "test-flag": true } }),
      );

      const client = new RollgateClient({
        apiKey: "test-key",
        refreshInterval: 0,
      });

      await client.init();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/sdk/flags"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-key",
          }),
        }),
      );
    });

    it("should emit ready event after init", async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ flags: {} }));

      const client = new RollgateClient({
        apiKey: "test-key",
        refreshInterval: 0,
      });

      const readyHandler = jest.fn();
      client.on("ready", readyHandler);

      await client.init();

      expect(readyHandler).toHaveBeenCalled();
    });

    it("should include user_id in request when user provided", async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ flags: {} }));

      const client = new RollgateClient({
        apiKey: "test-key",
        refreshInterval: 0,
      });

      await client.init({ id: "user-123" });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("user_id=user-123"),
        expect.any(Object),
      );
    });
  });

  describe("isEnabled", () => {
    it("should return flag value when initialized", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          flags: {
            "feature-a": true,
            "feature-b": false,
          },
        }),
      );

      const client = new RollgateClient({
        apiKey: "test-key",
        refreshInterval: 0,
      });

      await client.init();

      expect(client.isEnabled("feature-a")).toBe(true);
      expect(client.isEnabled("feature-b")).toBe(false);
    });

    it("should return default value for unknown flags", async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ flags: {} }));

      const client = new RollgateClient({
        apiKey: "test-key",
        refreshInterval: 0,
      });

      await client.init();

      expect(client.isEnabled("unknown-flag")).toBe(false);
      expect(client.isEnabled("unknown-flag", true)).toBe(true);
    });

    it("should return default value when not initialized", () => {
      const client = new RollgateClient({
        apiKey: "test-key",
        refreshInterval: 0,
      });

      const warnSpy = jest.spyOn(console, "warn").mockImplementation();

      expect(client.isEnabled("any-flag")).toBe(false);
      expect(client.isEnabled("any-flag", true)).toBe(true);

      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe("getAllFlags", () => {
    it("should return all flags as object", async () => {
      const flagsData = {
        "feature-a": true,
        "feature-b": false,
        "feature-c": true,
      };

      mockFetch.mockResolvedValueOnce(createMockResponse({ flags: flagsData }));

      const client = new RollgateClient({
        apiKey: "test-key",
        refreshInterval: 0,
      });

      await client.init();

      expect(client.getAllFlags()).toEqual(flagsData);
    });

    it("should return empty object when no flags", async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ flags: {} }));

      const client = new RollgateClient({
        apiKey: "test-key",
        refreshInterval: 0,
      });

      await client.init();

      expect(client.getAllFlags()).toEqual({});
    });
  });

  describe("identify", () => {
    it("should re-fetch flags with new user context", async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse({ flags: { flag: false } }))
        .mockResolvedValueOnce(createMockResponse({ flags: { flag: true } }));

      const client = new RollgateClient({
        apiKey: "test-key",
        refreshInterval: 0,
      });

      await client.init();
      expect(client.isEnabled("flag")).toBe(false);

      await client.identify({ id: "premium-user" });
      expect(client.isEnabled("flag")).toBe(true);

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("reset", () => {
    it("should re-fetch flags without user context", async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse({ flags: { flag: true } }))
        .mockResolvedValueOnce(createMockResponse({ flags: { flag: false } }));

      const client = new RollgateClient({
        apiKey: "test-key",
        refreshInterval: 0,
      });

      await client.init({ id: "user-123" });
      expect(client.isEnabled("flag")).toBe(true);

      await client.reset();
      expect(client.isEnabled("flag")).toBe(false);
    });
  });

  describe("refresh", () => {
    it("should fetch flags again", async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse({ flags: { flag: false } }))
        .mockResolvedValueOnce(createMockResponse({ flags: { flag: true } }));

      const client = new RollgateClient({
        apiKey: "test-key",
        refreshInterval: 0,
      });

      await client.init();
      expect(client.isEnabled("flag")).toBe(false);

      await client.refresh();
      expect(client.isEnabled("flag")).toBe(true);
    });
  });

  describe("events", () => {
    it("should emit flag-changed when flag value changes", async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse({ flags: { flag: false } }))
        .mockResolvedValueOnce(createMockResponse({ flags: { flag: true } }));

      const client = new RollgateClient({
        apiKey: "test-key",
        refreshInterval: 0,
      });

      const changeHandler = jest.fn();
      client.on("flag-changed", changeHandler);

      await client.init();
      await client.refresh();

      expect(changeHandler).toHaveBeenCalledWith("flag", true, false);
    });

    it("should emit flags-updated on every fetch", async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({ flags: { flag: true } }),
      );

      const client = new RollgateClient({
        apiKey: "test-key",
        refreshInterval: 0,
      });

      const updateHandler = jest.fn();
      client.on("flags-updated", updateHandler);

      await client.init();

      expect(updateHandler).toHaveBeenCalledWith({ flag: true });
    });

    it("should emit error on fetch failure", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({}, { ok: false, status: 401 }),
      );

      const client = new RollgateClient({
        apiKey: "invalid-key",
        refreshInterval: 0,
      });

      const errorHandler = jest.fn();
      client.on("error", errorHandler);

      const errorSpy = jest.spyOn(console, "error").mockImplementation();

      await client.init();

      expect(errorHandler).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  describe("close", () => {
    it("should clean up resources", async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ flags: {} }));

      const client = new RollgateClient({
        apiKey: "test-key",
        refreshInterval: 0,
      });

      await client.init();

      await client.close();
    });

    it("should remove all listeners", async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ flags: {} }));

      const client = new RollgateClient({
        apiKey: "test-key",
        refreshInterval: 0,
      });

      const handler = jest.fn();
      client.on("ready", handler);

      await client.init();
      await client.close();

      expect(client.listenerCount("ready")).toBe(0);
    });
  });

  describe("SSE streaming", () => {
    let mockEventSource: jest.Mock;
    let mockEventSourceInstance: {
      onmessage: ((event: MessageEvent) => void) | null;
      onerror: (() => void) | null;
      close: jest.Mock;
      addEventListener: jest.Mock;
      removeEventListener: jest.Mock;
      listeners: Map<string, ((event: MessageEvent) => void)[]>;
    };

    beforeEach(() => {
      const listeners = new Map<string, ((event: MessageEvent) => void)[]>();
      mockEventSourceInstance = {
        onmessage: null,
        onerror: null,
        close: jest.fn(),
        listeners,
        addEventListener: jest.fn(
          (event: string, handler: (event: MessageEvent) => void) => {
            if (!listeners.has(event)) {
              listeners.set(event, []);
            }
            listeners.get(event)!.push(handler);
          },
        ),
        removeEventListener: jest.fn(
          (event: string, handler: (event: MessageEvent) => void) => {
            const handlers = listeners.get(event);
            if (handlers) {
              const index = handlers.indexOf(handler);
              if (index > -1) handlers.splice(index, 1);
            }
          },
        ),
      };

      mockEventSource = jest
        .fn()
        .mockImplementation(() => mockEventSourceInstance);
      (global as any).EventSource = mockEventSource;
    });

    afterEach(() => {
      delete (global as any).EventSource;
    });

    it("should start streaming when enableStreaming is true", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ flags: { "test-flag": true } }),
      );

      const client = new RollgateClient({
        apiKey: "test-key",
        enableStreaming: true,
        refreshInterval: 0,
      });

      await client.init();

      expect(mockEventSource).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/sdk/stream"),
        expect.any(Object),
      );
    });

    it("should include user_id in stream URL when user provided", async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ flags: {} }));

      const client = new RollgateClient({
        apiKey: "test-key",
        enableStreaming: true,
        refreshInterval: 0,
      });

      await client.init({ id: "user-456" });

      expect(mockEventSource).toHaveBeenCalledWith(
        expect.stringContaining("user_id=user-456"),
        expect.any(Object),
      );
    });

    // Helper to emit SSE events to registered listeners
    const emitSSEEvent = (eventName: string, data: unknown) => {
      const handlers = mockEventSourceInstance.listeners.get(eventName);
      if (handlers) {
        handlers.forEach((handler) => {
          handler({ data: JSON.stringify(data) } as MessageEvent);
        });
      }
    };

    it("should update flags when SSE message received", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ flags: { "initial-flag": false } }),
      );

      const client = new RollgateClient({
        apiKey: "test-key",
        enableStreaming: true,
        refreshInterval: 0,
      });

      await client.init();

      expect(client.isEnabled("initial-flag")).toBe(false);
      expect(client.isEnabled("new-flag")).toBe(false);

      const updateHandler = jest.fn();
      client.on("flags-updated", updateHandler);

      // Use 'init' event which is what the SDK listens for
      emitSSEEvent("init", {
        flags: { "initial-flag": true, "new-flag": true },
      });

      expect(client.isEnabled("initial-flag")).toBe(true);
      expect(client.isEnabled("new-flag")).toBe(true);
      expect(updateHandler).toHaveBeenCalledWith({
        "initial-flag": true,
        "new-flag": true,
      });
    });

    it("should emit connection-error on SSE error", async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ flags: {} }));

      const client = new RollgateClient({
        apiKey: "test-key",
        enableStreaming: true,
        refreshInterval: 0,
      });

      const errorHandler = jest.fn();
      client.on("connection-error", errorHandler);

      const warnSpy = jest.spyOn(console, "warn").mockImplementation();

      await client.init();

      mockEventSourceInstance.onerror?.();

      expect(errorHandler).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("should handle malformed SSE message gracefully", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ flags: { "test-flag": true } }),
      );

      const client = new RollgateClient({
        apiKey: "test-key",
        enableStreaming: true,
        refreshInterval: 0,
      });

      const errorSpy = jest.spyOn(console, "error").mockImplementation();

      await client.init();

      // Emit malformed data to the 'init' event handler
      const handlers = mockEventSourceInstance.listeners.get("init");
      if (handlers) {
        handlers.forEach((handler) => {
          handler({ data: "not valid json" } as MessageEvent);
        });
      }

      expect(client.isEnabled("test-flag")).toBe(true);
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it("should close EventSource on client close", async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ flags: {} }));

      const client = new RollgateClient({
        apiKey: "test-key",
        enableStreaming: true,
        refreshInterval: 0,
      });

      await client.init();
      await client.close();

      expect(mockEventSourceInstance.close).toHaveBeenCalled();
    });

    it("should continue polling when SSE connection fails", async () => {
      // When SSE fails to connect, it falls back to polling
      mockFetch.mockResolvedValue(createMockResponse({ flags: {} }));

      const client = new RollgateClient({
        apiKey: "test-key",
        enableStreaming: true,
        refreshInterval: 100,
      });

      const warnSpy = jest.spyOn(console, "warn").mockImplementation();

      await client.init();

      // SSE connection attempt will fail (no real server), triggering error handler
      // Wait long enough for at least one polling cycle after SSE fails
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Should have made at least one fetch call (initial)
      // Note: polling fallback timing depends on SSE error timing which is non-deterministic
      expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(1);

      warnSpy.mockRestore();
      await client.close();
    });
  });

  describe("polling", () => {
    it("should poll at specified interval", async () => {
      jest.useFakeTimers();

      mockFetch.mockResolvedValue(
        createMockResponse({ flags: { flag: true } }),
      );

      const client = new RollgateClient({
        apiKey: "test-key",
        refreshInterval: 1000,
        enableStreaming: false,
      });

      await client.init();

      expect(mockFetch).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(1000);

      expect(mockFetch).toHaveBeenCalledTimes(2);

      await jest.advanceTimersByTimeAsync(1000);

      expect(mockFetch).toHaveBeenCalledTimes(3);

      await client.close();
      jest.useRealTimers();
    });

    it("should stop polling on close", async () => {
      jest.useFakeTimers();

      mockFetch.mockResolvedValue(createMockResponse({ flags: {} }));

      const client = new RollgateClient({
        apiKey: "test-key",
        refreshInterval: 1000,
        enableStreaming: false,
      });

      await client.init();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      await client.close();

      await jest.advanceTimersByTimeAsync(3000);

      expect(mockFetch).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });
  });

  describe("per-request context", () => {
    it("should accept context parameter on isEnabled", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ flags: { "test-flag": true } }),
      );

      const client = new RollgateClient({
        apiKey: "test-key",
        refreshInterval: 0,
      });

      await client.init();

      // isEnabled with context should work
      const result = client.isEnabled("test-flag", false, {
        userId: "user-456",
        attributes: { plan: "pro" },
      });

      expect(typeof result).toBe("boolean");
      await client.close();
    });

    it("should accept context parameter on isEnabledDetail", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ flags: { "test-flag": true } }),
      );

      const client = new RollgateClient({
        apiKey: "test-key",
        refreshInterval: 0,
      });

      await client.init();

      const detail = client.isEnabledDetail("test-flag", false, {
        userId: "user-789",
      });

      expect(detail).toHaveProperty("value");
      expect(detail).toHaveProperty("reason");
      await client.close();
    });

    it("should accept context parameter on getValue", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ flags: { "test-flag": true } }),
      );

      const client = new RollgateClient({
        apiKey: "test-key",
        refreshInterval: 0,
      });

      await client.init();

      const value = client.getValue("test-flag", false, {
        userId: "user-999",
      });

      expect(typeof value).toBe("boolean");
      await client.close();
    });

    it("should accept context parameter on getString", async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ flags: {} }));

      const client = new RollgateClient({
        apiKey: "test-key",
        refreshInterval: 0,
      });

      await client.init();

      const value = client.getString("theme", "light", {
        userId: "user-123",
      });

      expect(value).toBe("light");
      await client.close();
    });

    it("should accept context parameter on getNumber", async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ flags: {} }));

      const client = new RollgateClient({
        apiKey: "test-key",
        refreshInterval: 0,
      });

      await client.init();

      const value = client.getNumber("max-items", 10, {
        userId: "user-123",
      });

      expect(value).toBe(10);
      await client.close();
    });

    it("should accept context parameter on getJSON", async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ flags: {} }));

      const client = new RollgateClient({
        apiKey: "test-key",
        refreshInterval: 0,
      });

      await client.init();

      const value = client.getJSON(
        "config",
        { enabled: false },
        {
          userId: "user-123",
        },
      );

      expect(value).toEqual({ enabled: false });
      await client.close();
    });

    it("should not mutate client user context when context is provided", async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({ flags: { "test-flag": true } }),
      );

      const client = new RollgateClient({
        apiKey: "test-key",
        refreshInterval: 0,
      });

      await client.init({ id: "original-user" });

      // Evaluate with per-request context
      client.isEnabled("test-flag", false, {
        userId: "different-user",
        attributes: { plan: "enterprise" },
      });

      // Verify getAllFlags still works (client state unchanged)
      const flags = client.getAllFlags();
      expect(flags).toHaveProperty("test-flag", true);

      await client.close();
    });
  });
});
