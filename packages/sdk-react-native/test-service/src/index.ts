/**
 * Test Service for @rollgate/sdk-react-native
 *
 * This HTTP server wraps a React Native-like client and exposes a standard interface
 * for the test harness to interact with.
 *
 * Since React Native's AsyncStorage is not available in Node.js, this test service
 * uses in-memory storage to simulate the same behavior.
 *
 * Protocol:
 * - GET /  -> Health check
 * - POST / -> Execute command
 * - DELETE / -> Cleanup/shutdown
 */

import { createServer, IncomingMessage, ServerResponse } from "http";
import {
  fetchWithRetry,
  DEFAULT_RETRY_CONFIG,
  CircuitBreaker,
  CircuitState,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  RequestDeduplicator,
  RollgateError,
  classifyError,
  createMetrics,
  createTraceContext,
  getTraceHeaders,
  fallthroughReason,
  errorReason,
  unknownReason,
} from "@rollgate/sdk-core";
import type {
  RetryConfig,
  CircuitBreakerConfig,
  CacheConfig,
  SDKMetrics,
  MetricsSnapshot,
  EvaluationReason,
  EvaluationDetail,
} from "@rollgate/sdk-core";

const PORT = parseInt(process.env.PORT || "8006", 10);

// In-memory storage to simulate AsyncStorage
const memoryStorage = new Map<string, string>();

const CACHE_KEY = "@rollgate/flags";

interface UserContext {
  id: string;
  email?: string;
  attributes?: Record<string, string | number | boolean>;
}

interface RollgateOptions {
  baseUrl?: string;
  refreshInterval?: number;
  timeout?: number;
  retry?: Partial<RetryConfig>;
  circuitBreaker?: Partial<CircuitBreakerConfig>;
  cache?: Partial<CacheConfig>;
  startWaitTimeMs?: number;
  initCanFail?: boolean;
}

interface FlagsResponse {
  flags: Record<string, boolean>;
  flagValues?: Record<string, unknown>;
  reasons?: Record<string, EvaluationReason>;
}

interface CachedData {
  flags: Record<string, boolean>;
  flagValues?: Record<string, unknown>;
  timestamp: number;
}

type EventCallback = (...args: unknown[]) => void;

const DEFAULT_CACHE_CONFIG: CacheConfig = {
  ttl: 5 * 60 * 1000,
  staleTtl: 60 * 60 * 1000,
};

/**
 * React Native-like client for testing (uses in-memory storage instead of AsyncStorage)
 */
class TestReactNativeClient {
  private apiKey: string;
  private userContext: UserContext | null;
  private options: Required<
    Omit<RollgateOptions, "retry" | "circuitBreaker" | "cache">
  > & {
    retry: RetryConfig;
    circuitBreaker: CircuitBreakerConfig;
    cache: CacheConfig;
  };

  private flags: Map<string, boolean> = new Map();
  private flagValues: Map<string, unknown> = new Map();
  private flagReasons: Map<string, EvaluationReason> = new Map();
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;
  private initResolver: (() => void) | null = null;
  private initRejecter: ((error: Error) => void) | null = null;

  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private circuitBreaker: CircuitBreaker;
  private dedup: RequestDeduplicator;
  private lastETag: string | null = null;
  private metrics: SDKMetrics;
  private cacheTimestamp: number = 0;

  private eventListeners: Map<string, Set<EventCallback>> = new Map();

  constructor(
    apiKey: string,
    initialContext: UserContext | null,
    options: RollgateOptions = {},
  ) {
    this.apiKey = apiKey;
    this.userContext = initialContext;

    const baseUrl = options.baseUrl || "https://api.rollgate.io";

    this.options = {
      baseUrl,
      refreshInterval: options.refreshInterval ?? 30000,
      timeout: options.timeout ?? 10000,
      startWaitTimeMs: options.startWaitTimeMs ?? 10000,
      initCanFail: options.initCanFail ?? true,
      retry: { ...DEFAULT_RETRY_CONFIG, ...options.retry },
      circuitBreaker: {
        ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
        ...options.circuitBreaker,
      },
      cache: { ...DEFAULT_CACHE_CONFIG, ...options.cache },
    };

    this.circuitBreaker = new CircuitBreaker(this.options.circuitBreaker);
    this.dedup = new RequestDeduplicator();
    this.metrics = createMetrics();

    this.circuitBreaker.on("state-change", (data) => {
      this.emit("circuit-state-change", data);
    });

    this.initPromise = new Promise<void>((resolve, reject) => {
      this.initResolver = resolve;
      this.initRejecter = reject;
    });
  }

  async start(): Promise<void> {
    try {
      await this.loadFromCache();
      await this.fetchFlags();

      if (this.options.refreshInterval > 0) {
        this.startPolling();
      }

      this.initialized = true;
      this.initResolver?.();
      this.emit("ready");
    } catch (error) {
      if (this.options.initCanFail) {
        this.initialized = true;
        this.initResolver?.();
        this.emit("ready");
      } else {
        this.initRejecter?.(
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    }
  }

  private async loadFromCache(): Promise<void> {
    try {
      const cached = memoryStorage.get(CACHE_KEY);
      if (cached) {
        const data: CachedData = JSON.parse(cached);
        const now = Date.now();
        const age = now - data.timestamp;

        if (age < this.options.cache.staleTtl) {
          this.flags = new Map(Object.entries(data.flags));
          if (data.flagValues) {
            this.flagValues = new Map(Object.entries(data.flagValues));
          }
          this.cacheTimestamp = data.timestamp;
        }
      }
    } catch {
      // Ignore cache errors
    }
  }

  private async saveToCache(): Promise<void> {
    try {
      const data: CachedData = {
        flags: Object.fromEntries(this.flags),
        flagValues: Object.fromEntries(this.flagValues),
        timestamp: Date.now(),
      };
      memoryStorage.set(CACHE_KEY, JSON.stringify(data));
      this.cacheTimestamp = data.timestamp;
    } catch {
      // Ignore cache errors
    }
  }

  async waitForInitialization(timeoutMs?: number): Promise<void> {
    const timeout = timeoutMs ?? this.options.startWaitTimeMs;

    if (this.initialized) {
      return;
    }

    return Promise.race([
      this.initPromise!,
      new Promise<void>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Initialization timed out after ${timeout}ms`));
        }, timeout);
      }),
    ]);
  }

  isReady(): boolean {
    return this.initialized;
  }

  isEnabled(flagKey: string, defaultValue: boolean = false): boolean {
    return this.isEnabledDetail(flagKey, defaultValue).value;
  }

  isEnabledDetail(
    flagKey: string,
    defaultValue: boolean = false,
  ): EvaluationDetail<boolean> {
    const startTime = Date.now();

    // Check if client is ready
    if (!this.initialized) {
      return {
        value: defaultValue,
        reason: errorReason("CLIENT_NOT_READY"),
      };
    }

    // Check if flag exists
    if (!this.flags.has(flagKey)) {
      return {
        value: defaultValue,
        reason: unknownReason(),
      };
    }

    const result = this.flags.get(flagKey)!;
    const evaluationTime = Date.now() - startTime;
    this.metrics.recordEvaluation(flagKey, result, evaluationTime);

    // Use stored reason from server, or FALLTHROUGH as default
    const storedReason = this.flagReasons.get(flagKey);
    return {
      value: result,
      reason: storedReason ?? fallthroughReason(result),
    };
  }

  getValue<T>(flagKey: string, defaultValue: T): T {
    const value = this.flagValues.get(flagKey);

    if (value === undefined) {
      return defaultValue;
    }

    return value as T;
  }

  getString(flagKey: string, defaultValue: string = ""): string {
    return this.getValue<string>(flagKey, defaultValue);
  }

  getNumber(flagKey: string, defaultValue: number = 0): number {
    return this.getValue<number>(flagKey, defaultValue);
  }

  getJSON<T>(flagKey: string, defaultValue: T): T {
    return this.getValue<T>(flagKey, defaultValue);
  }

  allFlags(): Record<string, boolean> {
    return Object.fromEntries(this.flags);
  }

  allFlagValues(): Record<string, unknown> {
    return Object.fromEntries(this.flagValues);
  }

  async identify(user: UserContext): Promise<void> {
    this.userContext = user;
    await this.fetchFlags();
    this.emit("user-changed", user);
  }

  async reset(): Promise<void> {
    this.userContext = null;
    await this.fetchFlags();
    this.emit("user-reset");
  }

  async refresh(): Promise<void> {
    await this.fetchFlags();
  }

  getCircuitState(): CircuitState {
    return this.circuitBreaker.getState();
  }

  getMetrics(): MetricsSnapshot {
    return this.metrics.snapshot();
  }

  getCacheStats(): { hits: number; misses: number } {
    const snapshot = this.metrics.snapshot();
    return {
      hits: snapshot.cacheHits,
      misses: snapshot.cacheMisses,
    };
  }

  close(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.eventListeners.clear();
  }

  on(event: string, callback: EventCallback): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);
  }

  off(event: string, callback: EventCallback): void {
    this.eventListeners.get(event)?.delete(callback);
  }

  private emit(event: string, ...args: unknown[]): void {
    this.eventListeners.get(event)?.forEach((cb) => cb(...args));
  }

  private startPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
    this.pollInterval = setInterval(
      () => this.fetchFlags(),
      this.options.refreshInterval,
    );
  }

  private async fetchFlags(): Promise<void> {
    return this.dedup.dedupe("fetch-flags", async () => {
      const url = new URL(`${this.options.baseUrl}/api/v1/sdk/flags`);
      const startTime = Date.now();

      if (this.userContext?.id) {
        url.searchParams.set("user_id", this.userContext.id);
      }
      url.searchParams.set("withReasons", "true");

      if (!this.circuitBreaker.isAllowingRequests()) {
        this.useCachedFallback();
        return;
      }

      let statusCode = 0;

      try {
        const data = await this.circuitBreaker.execute(async () => {
          const result = await fetchWithRetry(async () => {
            const controller = new AbortController();
            const timeoutId = setTimeout(
              () => controller.abort(),
              this.options.timeout,
            );

            try {
              const traceContext = createTraceContext();
              const traceHeaders = getTraceHeaders(traceContext);

              const headers: Record<string, string> = {
                Authorization: `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
                ...traceHeaders,
              };
              if (this.lastETag) {
                headers["If-None-Match"] = this.lastETag;
              }

              const response = await fetch(url.toString(), {
                headers,
                signal: controller.signal,
              });

              statusCode = response.status;

              if (response.status === 304) {
                return null;
              }

              if (!response.ok) {
                const error = await RollgateError.fromHTTPResponse(response);
                throw error;
              }

              const newETag = response.headers.get("ETag");
              if (newETag) {
                this.lastETag = newETag;
              }

              return (await response.json()) as FlagsResponse;
            } finally {
              clearTimeout(timeoutId);
            }
          }, this.options.retry);

          if (!result.success) {
            throw result.error;
          }

          return result.data;
        });

        if (data === null) {
          this.metrics.recordRequest({
            endpoint: "/api/v1/sdk/flags",
            statusCode: 304,
            latencyMs: Date.now() - startTime,
            cacheHit: true,
            notModified: true,
          });
          return;
        }

        this.metrics.recordRequest({
          endpoint: "/api/v1/sdk/flags",
          statusCode: statusCode || 200,
          latencyMs: Date.now() - startTime,
          cacheHit: false,
          notModified: false,
        });

        const oldFlags = new Map(this.flags);
        this.flags = new Map(
          Object.entries((data as FlagsResponse).flags || {}),
        );

        // Update typed flag values
        if ((data as FlagsResponse).flagValues) {
          this.flagValues = new Map(
            Object.entries((data as FlagsResponse).flagValues || {}),
          );
        }

        // Store reasons from server response
        if ((data as FlagsResponse).reasons) {
          this.flagReasons = new Map(
            Object.entries((data as FlagsResponse).reasons || {}),
          );
        }

        await this.saveToCache();

        for (const [key, value] of this.flags) {
          if (oldFlags.get(key) !== value) {
            this.emit("flag-changed", key, value);
          }
        }

        this.emit("flags-updated", this.allFlags());
      } catch (error) {
        const classifiedError =
          error instanceof RollgateError ? error : classifyError(error);

        this.metrics.recordRequest({
          endpoint: "/api/v1/sdk/flags",
          statusCode: statusCode || 0,
          latencyMs: Date.now() - startTime,
          cacheHit: false,
          notModified: false,
          error: classifiedError.message,
          errorCategory: classifiedError.category,
        });

        this.emit("error", classifiedError);
        this.useCachedFallback();
        throw error;
      }
    });
  }

  private useCachedFallback(): void {
    if (this.flags.size > 0) {
      this.emit("flags-updated", this.allFlags());
    }
  }
}

// Test service implementation
let client: TestReactNativeClient | null = null;
let currentBaseUrl: string | null = null;
let currentApiKey: string | null = null;

async function notifyMockIdentify(
  user: UserContext,
  apiKey: string,
): Promise<void> {
  if (!currentBaseUrl) return;

  try {
    await fetch(`${currentBaseUrl}/api/v1/sdk/identify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ user }),
    });
  } catch {
    // Ignore errors
  }
}

interface Config {
  apiKey: string;
  baseUrl: string;
  refreshInterval?: number;
  timeout?: number;
}

interface Command {
  command: string;
  config?: Config;
  user?: UserContext;
  flagKey?: string;
  defaultValue?: boolean;
  defaultStringValue?: string;
  defaultNumberValue?: number;
  defaultJsonValue?: unknown;
  eventName?: string;
  userId?: string;
  variationId?: string;
  eventValue?: number;
  eventMetadata?: Record<string, unknown>;
}

interface Response {
  value?: boolean;
  stringValue?: string;
  numberValue?: number;
  jsonValue?: unknown;
  flags?: Record<string, boolean>;
  isReady?: boolean;
  circuitState?: string;
  cacheStats?: { hits: number; misses: number };
  success?: boolean;
  error?: string;
  message?: string;
  reason?: EvaluationReason;
  variationId?: string;
}

function getRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

function sendJSON(res: ServerResponse, data: Response, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function handleCommand(cmd: Command): Promise<Response> {
  switch (cmd.command) {
    case "init": {
      if (!cmd.config) {
        return { error: "ValidationError", message: "config is required" };
      }

      try {
        // Clear memory storage for fresh start
        memoryStorage.clear();

        currentBaseUrl = cmd.config.baseUrl;
        currentApiKey = cmd.config.apiKey;

        client = new TestReactNativeClient(
          cmd.config.apiKey,
          cmd.user || null,
          {
            baseUrl: cmd.config.baseUrl,
            refreshInterval: cmd.config.refreshInterval ?? 0,
            timeout: cmd.config.timeout ?? 5000,
            initCanFail: false,
          },
        );

        if (cmd.user) {
          await notifyMockIdentify(cmd.user, cmd.config.apiKey);
        }

        await client.start();
        return { success: true };
      } catch (err) {
        const error = err as Error;
        client = null;
        return { error: error.name || "Error", message: error.message };
      }
    }

    case "isEnabled": {
      if (!client) {
        return {
          error: "NotInitializedError",
          message: "Client not initialized",
        };
      }
      if (!cmd.flagKey) {
        return { error: "ValidationError", message: "flagKey is required" };
      }

      const defaultValue = cmd.defaultValue ?? false;
      const value = client.isEnabled(cmd.flagKey, defaultValue);
      return { value };
    }

    case "isEnabledDetail": {
      if (!client) {
        return {
          error: "NotInitializedError",
          message: "Client not initialized",
        };
      }
      if (!cmd.flagKey) {
        return { error: "ValidationError", message: "flagKey is required" };
      }

      const defaultValue = cmd.defaultValue ?? false;
      const detail = client.isEnabledDetail(cmd.flagKey, defaultValue);
      return {
        value: detail.value,
        reason: detail.reason,
        variationId: detail.variationId,
      };
    }

    case "getString": {
      if (!client) {
        return {
          error: "NotInitializedError",
          message: "Client not initialized",
        };
      }
      if (!cmd.flagKey) {
        return { error: "ValidationError", message: "flagKey is required" };
      }

      const defaultValue = cmd.defaultStringValue ?? "";
      const stringValue = client.getString(cmd.flagKey, defaultValue);
      return { stringValue };
    }

    case "getNumber": {
      if (!client) {
        return {
          error: "NotInitializedError",
          message: "Client not initialized",
        };
      }
      if (!cmd.flagKey) {
        return { error: "ValidationError", message: "flagKey is required" };
      }

      const defaultValue = cmd.defaultNumberValue ?? 0;
      const numberValue = client.getNumber(cmd.flagKey, defaultValue);
      return { numberValue };
    }

    case "getJson": {
      if (!client) {
        return {
          error: "NotInitializedError",
          message: "Client not initialized",
        };
      }
      if (!cmd.flagKey) {
        return { error: "ValidationError", message: "flagKey is required" };
      }

      const defaultValue = cmd.defaultJsonValue ?? null;
      const jsonValue = client.getJSON(cmd.flagKey, defaultValue);
      return { jsonValue };
    }

    case "identify": {
      if (!client) {
        return {
          error: "NotInitializedError",
          message: "Client not initialized",
        };
      }
      if (!cmd.user) {
        return { error: "ValidationError", message: "user is required" };
      }

      try {
        if (currentApiKey) {
          await notifyMockIdentify(cmd.user, currentApiKey);
        }
        await client.identify(cmd.user);
        return { success: true };
      } catch (err) {
        const error = err as Error;
        return { error: error.name || "Error", message: error.message };
      }
    }

    case "reset": {
      if (!client) {
        return {
          error: "NotInitializedError",
          message: "Client not initialized",
        };
      }

      try {
        await client.reset();
        return { success: true };
      } catch (err) {
        const error = err as Error;
        return { error: error.name || "Error", message: error.message };
      }
    }

    case "getAllFlags": {
      if (!client) {
        return {
          error: "NotInitializedError",
          message: "Client not initialized",
        };
      }

      const flags = client.allFlags();
      return { flags };
    }

    case "getState": {
      if (!client) {
        return {
          isReady: false,
          circuitState: "UNKNOWN",
        };
      }

      const circuitState = client.getCircuitState();
      const cacheStats = client.getCacheStats();

      return {
        isReady: client.isReady(),
        circuitState: circuitState,
        cacheStats: {
          hits: Number(cacheStats.hits),
          misses: Number(cacheStats.misses),
        },
      };
    }

    case "track": {
      if (!client) {
        return {
          error: "NotInitializedError",
          message: "Client not initialized",
        };
      }
      if (!cmd.flagKey || !cmd.eventName || !cmd.userId) {
        return {
          error: "ValidationError",
          message: "flagKey, eventName, and userId are required",
        };
      }

      // React Native SDK uses custom client without event tracking.
      // Send events directly to the mock server's events endpoint.
      if (currentBaseUrl && currentApiKey) {
        const event: Record<string, unknown> = {
          flagKey: cmd.flagKey,
          eventName: cmd.eventName,
          userId: cmd.userId,
          timestamp: new Date().toISOString(),
        };
        if (cmd.variationId) event.variationId = cmd.variationId;
        if (cmd.eventValue !== undefined) event.value = cmd.eventValue;
        if (cmd.eventMetadata) event.metadata = cmd.eventMetadata;

        // Buffer events in memory for flush
        if (!(globalThis as any).__rnEventBuffer) {
          (globalThis as any).__rnEventBuffer = [];
        }
        (globalThis as any).__rnEventBuffer.push(event);
      }
      return { success: true };
    }

    case "flushEvents": {
      if (!client) {
        return {
          error: "NotInitializedError",
          message: "Client not initialized",
        };
      }

      try {
        const buffer = (globalThis as any).__rnEventBuffer || [];
        if (buffer.length > 0 && currentBaseUrl && currentApiKey) {
          await fetch(`${currentBaseUrl}/api/v1/sdk/events`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${currentApiKey}`,
            },
            body: JSON.stringify({ events: buffer }),
          });
          (globalThis as any).__rnEventBuffer = [];
        }
        return { success: true };
      } catch (err) {
        const error = err as Error;
        return { error: error.name || "Error", message: error.message };
      }
    }

    case "close": {
      if (client) {
        try {
          client.close();
        } catch {
          // Ignore close errors
        }
        client = null;
      }
      memoryStorage.clear();
      (globalThis as any).__rnEventBuffer = [];
      return { success: true };
    }

    default:
      return {
        error: "UnknownCommand",
        message: `Unknown command: ${cmd.command}`,
      };
  }
}

const server = createServer(async (req, res) => {
  if (req.method === "GET") {
    sendJSON(res, { success: true });
    return;
  }

  if (req.method === "POST") {
    try {
      const body = await getRequestBody(req);
      const cmd: Command = JSON.parse(body);
      const result = await handleCommand(cmd);
      sendJSON(res, result);
    } catch (err) {
      const error = err as Error;
      sendJSON(res, { error: "ParseError", message: error.message }, 400);
    }
    return;
  }

  if (req.method === "DELETE") {
    if (client) {
      try {
        client.close();
      } catch {
        // Ignore close errors
      }
      client = null;
    }
    memoryStorage.clear();
    sendJSON(res, { success: true });
    return;
  }

  res.writeHead(405);
  res.end();
});

server.listen(PORT, () => {
  console.log(`[sdk-react-native test-service] Listening on port ${PORT}`);
});

// Handle unhandled rejections to prevent crashes
process.on("unhandledRejection", (reason, promise) => {
  process.stderr.write(
    `[TestService] Unhandled rejection: ${reason instanceof Error ? reason.message : reason}\n`,
  );
  // Don't crash - just log it
});

process.on("uncaughtException", (error) => {
  process.stderr.write(`[TestService] Uncaught exception: ${error.message}\n`);
  // Don't crash - just log it
});

process.on("SIGINT", () => {
  console.log("\n[sdk-react-native test-service] Shutting down...");
  if (client) {
    client.close();
  }
  server.close(() => {
    console.log("[sdk-react-native test-service] Server closed");
    process.exit(0);
  });
});

process.on("SIGTERM", () => {
  console.log("[sdk-react-native test-service] Received SIGTERM");
  if (client) {
    client.close();
  }
  server.close(() => {
    process.exit(0);
  });
});
