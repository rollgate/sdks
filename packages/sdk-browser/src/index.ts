/**
 * Rollgate Browser SDK
 *
 * Feature flags client for web browsers. API designed to match LaunchDarkly
 * for easy migration and testing.
 *
 * Usage:
 *   import { createClient } from '@rollgate/sdk-browser';
 *
 *   const client = createClient('api-key', { id: 'user-1' });
 *   await client.waitForInitialization();
 *   const enabled = client.isEnabled('my-flag', false);
 */

import {
  fetchWithRetry,
  DEFAULT_RETRY_CONFIG,
  CircuitBreaker,
  CircuitState,
  CircuitOpenError,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  FlagCache,
  DEFAULT_CACHE_CONFIG,
  RequestDeduplicator,
  RollgateError,
  ErrorCategory,
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

// Re-export types from core
export type {
  RetryConfig,
  CircuitBreakerConfig,
  CacheConfig,
  MetricsSnapshot,
  EvaluationReason,
  EvaluationDetail,
};
export { CircuitState, CircuitOpenError, RollgateError, ErrorCategory };

/**
 * User context for targeting
 */
export interface UserContext {
  id: string;
  email?: string;
  attributes?: Record<string, string | number | boolean>;
}

/**
 * SDK configuration options
 */
export interface RollgateOptions {
  /** Base URL for Rollgate API (default: https://api.rollgate.io) */
  baseUrl?: string;
  /** SSE URL for streaming connections (default: same as baseUrl) */
  sseUrl?: string;
  /** Polling interval in ms (default: 30000). Set to 0 to disable polling. */
  refreshInterval?: number;
  /** Enable SSE streaming for real-time updates (default: false) */
  streaming?: boolean;
  /** Request timeout in milliseconds (default: 5000) */
  timeout?: number;
  /** Retry configuration */
  retry?: Partial<RetryConfig>;
  /** Circuit breaker configuration */
  circuitBreaker?: Partial<CircuitBreakerConfig>;
  /** Cache configuration */
  cache?: Partial<CacheConfig>;
  /** Time to wait for initialization in ms (default: 5000) */
  startWaitTimeMs?: number;
  /** If true, initialization won't throw on failure (default: false) */
  initCanFail?: boolean;
}

interface FlagsResponse {
  flags: Record<string, boolean>;
  reasons?: Record<string, EvaluationReason>;
}

type EventCallback = (...args: unknown[]) => void;

/**
 * Rollgate Browser Client
 *
 * Main SDK client for browser environments.
 */
export class RollgateBrowserClient {
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
  private flagReasons: Map<string, EvaluationReason> = new Map();
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;
  private initResolver: (() => void) | null = null;
  private initRejecter: ((error: Error) => void) | null = null;

  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private eventSource: EventSource | null = null;
  private circuitBreaker: CircuitBreaker;
  private cache: FlagCache;
  private dedup: RequestDeduplicator;
  private lastETag: string | null = null;
  private metrics: SDKMetrics;

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
      sseUrl: options.sseUrl || baseUrl,
      refreshInterval: options.refreshInterval ?? 30000,
      streaming: options.streaming ?? false,
      timeout: options.timeout ?? 5000,
      startWaitTimeMs: options.startWaitTimeMs ?? 5000,
      initCanFail: options.initCanFail ?? false,
      retry: { ...DEFAULT_RETRY_CONFIG, ...options.retry },
      circuitBreaker: {
        ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
        ...options.circuitBreaker,
      },
      cache: { ...DEFAULT_CACHE_CONFIG, ...options.cache },
    };

    this.circuitBreaker = new CircuitBreaker(this.options.circuitBreaker);
    this.cache = new FlagCache(this.options.cache);
    this.dedup = new RequestDeduplicator();
    this.metrics = createMetrics();

    // Setup circuit breaker event forwarding
    this.circuitBreaker.on("state-change", (data) => {
      this.emit("circuit-state-change", data);
    });

    // Create init promise
    this.initPromise = new Promise<void>((resolve, reject) => {
      this.initResolver = resolve;
      this.initRejecter = reject;
    });

    // Auto-start initialization
    this.start();
  }

  /**
   * Start the client (called automatically from constructor)
   */
  private async start(): Promise<void> {
    try {
      // Load cached flags first
      await this.cache.load();
      const cached = this.cache.get();
      if (cached) {
        this.flags = new Map(Object.entries(cached.flags));
      }

      // Fetch fresh flags
      await this.fetchFlags();

      // Start update mechanism
      if (this.options.streaming) {
        this.startStreaming();
      } else if (this.options.refreshInterval > 0) {
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
      }
    }
  }

  /**
   * Wait for client initialization to complete
   */
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

  /**
   * Check if the client is ready
   */
  isReady(): boolean {
    return this.initialized;
  }

  /**
   * Check if a boolean flag is enabled
   */
  isEnabled(flagKey: string, defaultValue: boolean = false): boolean {
    return this.isEnabledDetail(flagKey, defaultValue).value;
  }

  /**
   * Check if a boolean flag is enabled with evaluation reason
   */
  isEnabledDetail(
    flagKey: string,
    defaultValue: boolean = false,
  ): EvaluationDetail<boolean> {
    const startTime = performance.now();

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
    const evaluationTime = performance.now() - startTime;
    this.metrics.recordEvaluation(flagKey, result, evaluationTime);

    // Use stored reason from server, or FALLTHROUGH as default
    const storedReason = this.flagReasons.get(flagKey);
    return {
      value: result,
      reason: storedReason ?? fallthroughReason(result),
    };
  }

  /**
   * Alias for isEnabled (LaunchDarkly compatibility)
   */
  boolVariation(flagKey: string, defaultValue: boolean = false): boolean {
    return this.isEnabled(flagKey, defaultValue);
  }

  /**
   * Alias for isEnabledDetail (LaunchDarkly compatibility)
   */
  boolVariationDetail(
    flagKey: string,
    defaultValue: boolean = false,
  ): EvaluationDetail<boolean> {
    return this.isEnabledDetail(flagKey, defaultValue);
  }

  /**
   * Get all flags as an object
   */
  allFlags(): Record<string, boolean> {
    return Object.fromEntries(this.flags);
  }

  /**
   * Update user context
   */
  async identify(user: UserContext): Promise<void> {
    this.userContext = user;
    await this.fetchFlags();
    this.emit("user-changed", user);
  }

  /**
   * Clear user context
   */
  async reset(): Promise<void> {
    this.userContext = null;
    await this.fetchFlags();
    this.emit("user-reset");
  }

  /**
   * Force refresh flags
   */
  async refresh(): Promise<void> {
    await this.fetchFlags();
  }

  /**
   * Flush any pending events (no-op for now, for API compatibility)
   */
  flush(): void {
    // No-op - browser SDK doesn't batch events yet
  }

  /**
   * Get circuit breaker state
   */
  getCircuitState(): CircuitState {
    return this.circuitBreaker.getState();
  }

  /**
   * Get metrics snapshot
   */
  getMetrics(): MetricsSnapshot {
    return this.metrics.snapshot();
  }

  /**
   * Close the client and clean up resources
   */
  close(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    // Clean up all internal components to prevent memory leaks
    this.cache.close();
    this.circuitBreaker.removeAllListeners();
    this.metrics.removeAllListeners();
    this.dedup.clear();
    this.eventListeners.clear();
  }

  /**
   * Subscribe to events
   */
  on(event: string, callback: EventCallback): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);
  }

  /**
   * Unsubscribe from events
   */
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

  private startStreaming(): void {
    const url = new URL(`${this.options.sseUrl}/api/v1/sdk/stream`);
    url.searchParams.set("token", this.apiKey);
    if (this.userContext?.id) {
      url.searchParams.set("user_id", this.userContext.id);
    }

    this.eventSource = new EventSource(url.toString());

    this.eventSource.addEventListener("init", (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as FlagsResponse;
        const oldFlags = new Map(this.flags);
        this.flags = new Map(Object.entries(data.flags || {}));

        // Emit changes
        for (const [key, value] of this.flags) {
          if (oldFlags.get(key) !== value) {
            this.emit("flag-changed", key, value);
          }
        }
        this.emit("flags-updated", this.allFlags());
      } catch (e) {
        console.error("[Rollgate] Failed to parse init event:", e);
      }
    });

    this.eventSource.addEventListener("flag-changed", () => {
      this.fetchFlags();
    });

    this.eventSource.onerror = () => {
      console.warn("[Rollgate] SSE connection error, will reconnect...");
      this.emit("connection-error");
    };
  }

  private async fetchFlags(): Promise<void> {
    return this.dedup.dedupe("fetch-flags", async () => {
      const url = new URL(`${this.options.baseUrl}/api/v1/sdk/flags`);
      const startTime = Date.now();

      if (this.userContext?.id) {
        url.searchParams.set("user_id", this.userContext.id);
      }
      // Request evaluation reasons from server
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

        this.cache.set("flags", (data as FlagsResponse).flags || {});

        const oldFlags = new Map(this.flags);
        this.flags = new Map(
          Object.entries((data as FlagsResponse).flags || {}),
        );

        // Store reasons from server response
        if ((data as FlagsResponse).reasons) {
          this.flagReasons = new Map(
            Object.entries((data as FlagsResponse).reasons || {}),
          );
        }

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
    const cached = this.cache.get();
    if (cached) {
      this.flags = new Map(Object.entries(cached.flags));
      this.emit("flags-updated", this.allFlags());
    }
  }
}

/**
 * Create a new Rollgate client (LaunchDarkly-style factory function)
 *
 * @param apiKey - Your Rollgate API key
 * @param initialContext - Initial user context (can be null)
 * @param options - SDK configuration options
 * @returns A new RollgateBrowserClient instance
 *
 * @example
 * ```typescript
 * const client = createClient('your-api-key', { id: 'user-123' });
 * await client.waitForInitialization();
 * const enabled = client.isEnabled('my-feature', false);
 * ```
 */
export function createClient(
  apiKey: string,
  initialContext: UserContext | null = null,
  options: RollgateOptions = {},
): RollgateBrowserClient {
  return new RollgateBrowserClient(apiKey, initialContext, options);
}

// Default export
export default createClient;
