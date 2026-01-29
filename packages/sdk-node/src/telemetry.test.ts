import { TelemetryCollector, DEFAULT_TELEMETRY_CONFIG } from "./telemetry";

// Helper to create mock Response
const createMockResponse = (
  data: unknown,
  options: { ok?: boolean; status?: number; statusText?: string } = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any => ({
  ok: options.ok ?? true,
  status: options.status ?? 200,
  statusText: options.statusText ?? "OK",
  json: async () => data,
  headers: new Map(),
  redirected: false,
  type: "basic" as ResponseType,
  url: "",
  clone: () => createMockResponse(data, options),
  body: null,
  bodyUsed: false,
  arrayBuffer: async () => new ArrayBuffer(0),
  blob: async () => new Blob(),
  formData: async () => new FormData(),
  text: async () => JSON.stringify(data),
  bytes: async () => new Uint8Array(0),
});

describe("telemetry module", () => {
  describe("DEFAULT_TELEMETRY_CONFIG", () => {
    it("should have sensible defaults", () => {
      expect(DEFAULT_TELEMETRY_CONFIG.endpoint).toBe("");
      expect(DEFAULT_TELEMETRY_CONFIG.apiKey).toBe("");
      expect(DEFAULT_TELEMETRY_CONFIG.flushIntervalMs).toBe(60000);
      expect(DEFAULT_TELEMETRY_CONFIG.maxBufferSize).toBe(1000);
      expect(DEFAULT_TELEMETRY_CONFIG.enabled).toBe(true);
    });
  });

  describe("TelemetryCollector", () => {
    let collector: TelemetryCollector;
    let globalMockFetch: jest.SpyInstance | null = null;

    afterEach(async () => {
      // Ensure fetch is mocked for cleanup to avoid real network calls
      if (!globalMockFetch) {
        globalMockFetch = jest
          .spyOn(global, "fetch")
          .mockResolvedValue(createMockResponse({ received: 0 }));
      }
      if (collector) {
        await collector.stop();
      }
      if (globalMockFetch) {
        globalMockFetch.mockRestore();
        globalMockFetch = null;
      }
    });

    describe("constructor", () => {
      it("should use default config when no options provided", () => {
        collector = new TelemetryCollector();
        const stats = collector.getBufferStats();
        expect(stats.flagCount).toBe(0);
        expect(stats.evaluationCount).toBe(0);
      });

      it("should merge provided config with defaults", () => {
        collector = new TelemetryCollector({
          flushIntervalMs: 30000,
        });
        expect(collector.getBufferStats()).toBeDefined();
      });
    });

    describe("recordEvaluation", () => {
      it("should record evaluations in buffer", () => {
        collector = new TelemetryCollector();

        collector.recordEvaluation("flag-1", true);
        collector.recordEvaluation("flag-1", true);
        collector.recordEvaluation("flag-1", false);
        collector.recordEvaluation("flag-2", true);

        const stats = collector.getBufferStats();
        expect(stats.flagCount).toBe(2);
        expect(stats.evaluationCount).toBe(4);
      });

      it("should not record when disabled", () => {
        collector = new TelemetryCollector({ enabled: false });

        collector.recordEvaluation("flag-1", true);
        collector.recordEvaluation("flag-1", false);

        const stats = collector.getBufferStats();
        expect(stats.flagCount).toBe(0);
        expect(stats.evaluationCount).toBe(0);
      });
    });

    describe("start", () => {
      it("should not start without endpoint", () => {
        collector = new TelemetryCollector({
          apiKey: "test-key",
          enabled: true,
        });

        collector.start();
        expect(collector.getBufferStats()).toBeDefined();
      });

      it("should not start without apiKey", () => {
        collector = new TelemetryCollector({
          endpoint: "https://api.test.com/telemetry",
          enabled: true,
        });

        collector.start();
        expect(collector.getBufferStats()).toBeDefined();
      });

      it("should not start when disabled", () => {
        collector = new TelemetryCollector({
          endpoint: "https://api.test.com/telemetry",
          apiKey: "test-key",
          enabled: false,
        });

        collector.start();
        expect(collector.getBufferStats()).toBeDefined();
      });
    });

    describe("flush", () => {
      let mockFetch: jest.SpyInstance;

      beforeEach(() => {
        mockFetch = jest
          .spyOn(global, "fetch")
          .mockResolvedValue(createMockResponse({ received: 0 }));
        globalMockFetch = mockFetch;
      });

      afterEach(() => {
        // Don't restore here - let global afterEach handle cleanup
      });

      it("should not flush when buffer is empty", async () => {
        collector = new TelemetryCollector({
          endpoint: "https://api.test.com/telemetry",
          apiKey: "test-key",
        });

        await collector.flush();
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it("should not flush without endpoint", async () => {
        collector = new TelemetryCollector({
          apiKey: "test-key",
        });

        collector.recordEvaluation("flag-1", true);
        await collector.flush();

        expect(mockFetch).not.toHaveBeenCalled();
        expect(collector.getBufferStats().evaluationCount).toBe(1);
      });

      it("should flush evaluations to endpoint", async () => {
        mockFetch.mockResolvedValue(createMockResponse({ received: 1 }));

        collector = new TelemetryCollector({
          endpoint: "https://api.test.com/telemetry",
          apiKey: "test-key",
        });

        collector.recordEvaluation("flag-1", true);
        collector.recordEvaluation("flag-1", true);
        collector.recordEvaluation("flag-1", false);

        await collector.flush();

        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(mockFetch).toHaveBeenCalledWith(
          "https://api.test.com/telemetry",
          expect.objectContaining({
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer test-key",
            },
          }),
        );

        const call = mockFetch.mock.calls[0];
        const body = JSON.parse(call[1].body);
        expect(body.evaluations["flag-1"]).toEqual({
          total: 3,
          true: 2,
          false: 1,
        });
        expect(body.period_ms).toBeGreaterThanOrEqual(0);

        expect(collector.getBufferStats().evaluationCount).toBe(0);
      });

      it("should emit flush event on success", async () => {
        mockFetch.mockResolvedValue(createMockResponse({ received: 2 }));

        collector = new TelemetryCollector({
          endpoint: "https://api.test.com/telemetry",
          apiKey: "test-key",
        });

        const flushHandler = jest.fn();
        collector.on("flush", flushHandler);

        collector.recordEvaluation("flag-1", true);
        collector.recordEvaluation("flag-2", false);

        await collector.flush();

        expect(flushHandler).toHaveBeenCalledTimes(1);
        expect(flushHandler).toHaveBeenCalledWith(
          expect.objectContaining({
            flagsReported: 2,
            received: 2,
          }),
        );
      });

      it("should restore data on flush failure", async () => {
        mockFetch
          .mockResolvedValueOnce(
            createMockResponse(null, {
              ok: false,
              status: 500,
              statusText: "Internal Server Error",
            }),
          )
          .mockResolvedValue(createMockResponse({ received: 1 })); // For cleanup

        collector = new TelemetryCollector({
          endpoint: "https://api.test.com/telemetry",
          apiKey: "test-key",
        });

        collector.recordEvaluation("flag-1", true);
        collector.recordEvaluation("flag-1", false);

        await expect(collector.flush()).rejects.toThrow(
          "Telemetry request failed",
        );

        expect(collector.getBufferStats().evaluationCount).toBe(2);
      });

      it("should merge restored data with new evaluations", async () => {
        mockFetch
          .mockResolvedValueOnce(
            createMockResponse(null, {
              ok: false,
              status: 500,
              statusText: "Internal Server Error",
            }),
          )
          .mockResolvedValue(createMockResponse({ received: 1 })); // For second flush and cleanup

        collector = new TelemetryCollector({
          endpoint: "https://api.test.com/telemetry",
          apiKey: "test-key",
        });

        collector.recordEvaluation("flag-1", true);
        collector.recordEvaluation("flag-1", true);

        // First flush fails - data should be restored
        await expect(collector.flush()).rejects.toThrow();
        expect(collector.getBufferStats().evaluationCount).toBe(2);

        // Add more data - should merge with restored data
        collector.recordEvaluation("flag-1", false);
        expect(collector.getBufferStats().evaluationCount).toBe(3);

        // Second flush should include all data
        await collector.flush();

        const call = mockFetch.mock.calls[1];
        const body = JSON.parse(call[1].body);
        expect(body.evaluations["flag-1"]).toEqual({
          total: 3,
          true: 2,
          false: 1,
        });
      });

      it("should not allow concurrent flushes", async () => {
        let resolveFlush: () => void;
        const flushPromise = new Promise<void>((resolve) => {
          resolveFlush = resolve;
        });

        mockFetch.mockImplementation(async () => {
          await flushPromise;
          return createMockResponse({ received: 1 });
        });

        collector = new TelemetryCollector({
          endpoint: "https://api.test.com/telemetry",
          apiKey: "test-key",
        });

        collector.recordEvaluation("flag-1", true);

        const flush1 = collector.flush();

        collector.recordEvaluation("flag-2", false);

        const flush2 = collector.flush();

        resolveFlush!();
        await flush1;
        await flush2;

        expect(mockFetch).toHaveBeenCalledTimes(1);

        expect(collector.getBufferStats().flagCount).toBe(1);
      });
    });

    describe("stop", () => {
      let mockFetch: jest.SpyInstance;

      beforeEach(() => {
        mockFetch = jest
          .spyOn(global, "fetch")
          .mockResolvedValue(createMockResponse({ received: 1 }));
        globalMockFetch = mockFetch;
      });

      afterEach(() => {
        // Don't restore here - let global afterEach handle cleanup
      });

      it("should flush remaining data on stop", async () => {
        collector = new TelemetryCollector({
          endpoint: "https://api.test.com/telemetry",
          apiKey: "test-key",
        });

        collector.recordEvaluation("flag-1", true);

        await collector.stop();

        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(collector.getBufferStats().evaluationCount).toBe(0);
      });
    });

    describe("auto-flush on buffer size", () => {
      let mockFetch: jest.SpyInstance;

      beforeEach(() => {
        mockFetch = jest
          .spyOn(global, "fetch")
          .mockResolvedValue(createMockResponse({ received: 1 }));
        globalMockFetch = mockFetch;
      });

      afterEach(() => {
        // Don't restore here - let global afterEach handle cleanup
      });

      it("should auto-flush when buffer reaches maxBufferSize", async () => {
        collector = new TelemetryCollector({
          endpoint: "https://api.test.com/telemetry",
          apiKey: "test-key",
          maxBufferSize: 3,
        });

        collector.recordEvaluation("flag-1", true);
        collector.recordEvaluation("flag-1", true);

        expect(mockFetch).not.toHaveBeenCalled();

        collector.recordEvaluation("flag-1", false);

        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(mockFetch).toHaveBeenCalledTimes(1);
      });
    });

    describe("updateConfig", () => {
      it("should update enabled state", () => {
        collector = new TelemetryCollector({
          enabled: true,
        });

        collector.recordEvaluation("flag-1", true);
        expect(collector.getBufferStats().evaluationCount).toBe(1);

        collector.updateConfig({ enabled: false });

        collector.recordEvaluation("flag-2", true);
        expect(collector.getBufferStats().evaluationCount).toBe(1);

        collector.updateConfig({ enabled: true });

        collector.recordEvaluation("flag-3", true);
        expect(collector.getBufferStats().evaluationCount).toBe(2);
      });
    });
  });
});
