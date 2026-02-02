import { EventEmitter } from "events";

// Import EventSource for Node.js SSE support
// In browser, EventSource is globally available
// In Node.js, we use the 'eventsource' package
let NodeEventSource: typeof EventSource | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const eventsourceModule = require("eventsource");
  NodeEventSource = eventsourceModule.EventSource || eventsourceModule;
} catch {
  // eventsource package not installed - will fall back to polling
}

import {
  // Retry
  fetchWithRetry,
  DEFAULT_RETRY_CONFIG,
  // Circuit Breaker
  CircuitBreaker,
  CircuitState,
  CircuitOpenError,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  // Cache
  FlagCache,
  DEFAULT_CACHE_CONFIG,
  // Dedup
  RequestDeduplicator,
  // Errors
  RollgateError,
  AuthenticationError,
  ValidationError,
  NetworkError,
  RateLimitError,
  InternalError,
  ErrorCategory,
  ErrorCode,
  classifyError,
  // Metrics
  createMetrics,
  getMetrics,
  // Tracing
  TraceHeaders,
  createTraceContext,
  getTraceHeaders,
  parseTraceHeaders,
  createRequestTrace,
  completeRequestTrace,
  generateRequestId,
} from "@rollgate/sdk-core";
import type {
  RetryConfig,
  CircuitBreakerConfig,
  CacheConfig,
  SDKMetrics,
  MetricsSnapshot,
  RequestMetrics,
  FlagEvaluationMetrics,
  FlagStats,
  TimeWindowMetrics,
  WindowedStats,
  TraceContext,
  RequestTrace,
} from "@rollgate/sdk-core";
import {
  evaluateFlag,
  evaluateAllFlags,
  evaluateFlagValue,
  evaluateFlagWithReason,
  FlagRule,
  FlagRuleV2,
  RulesPayload,
  RulesPayloadV2,
  UserContext as EvalUserContext,
} from "./evaluate";
import type { EvaluationReason, EvaluationDetail } from "@rollgate/sdk-core";
import { unknownReason, errorReason } from "@rollgate/sdk-core";
import {
  TelemetryCollector,
  TelemetryConfig,
  DEFAULT_TELEMETRY_CONFIG,
} from "./telemetry";

export interface RollgateConfig {
  apiKey: string;
  baseUrl?: string; // Default: https://api.rollgate.io
  sseUrl?: string; // SSE URL for streaming (default: same as baseUrl). Use to bypass CDN proxy.
  refreshInterval?: number; // Polling interval in ms (default: 30000 = 30s), 0 to disable
  enableStreaming?: boolean; // Use SSE for real-time updates (default: false)
  streaming?: boolean; // Alias for enableStreaming
  timeout?: number; // Request timeout in milliseconds (default: 5000)
  retry?: Partial<RetryConfig>; // Retry configuration
  circuitBreaker?: Partial<CircuitBreakerConfig>; // Circuit breaker configuration
  cache?: Partial<CacheConfig>; // Cache configuration
  telemetry?: Partial<TelemetryConfig>; // Telemetry configuration for client-side evaluation
}

// Re-export from sdk-core
export type {
  RetryConfig,
  CircuitBreakerConfig,
  CacheConfig,
  CacheStats,
} from "@rollgate/sdk-core";
export { CircuitState, CircuitOpenError } from "@rollgate/sdk-core";
export {
  RollgateError,
  AuthenticationError,
  ValidationError,
  NetworkError,
  RateLimitError,
  InternalError,
  ErrorCategory,
  ErrorCode,
  classifyError,
  isRetryable,
  isAuthError,
  isNetworkError,
  isRateLimitError,
  isValidationError,
  isNotFoundError,
  isInternalError,
} from "@rollgate/sdk-core";
export type {
  SDKMetrics,
  MetricsSnapshot,
  RequestMetrics,
  FlagEvaluationMetrics,
  FlagStats,
  TimeWindowMetrics,
  WindowedStats,
} from "@rollgate/sdk-core";
export { getMetrics, createMetrics } from "@rollgate/sdk-core";
export type { TraceContext, RequestTrace } from "@rollgate/sdk-core";
export {
  TraceHeaders,
  createTraceContext,
  getTraceHeaders,
  parseTraceHeaders,
  generateTraceId,
  generateSpanId,
  generateRequestId,
} from "@rollgate/sdk-core";
export {
  evaluateFlag,
  evaluateAllFlags,
  evaluateFlagValue,
  evaluateFlagWithReason,
  FlagRule,
  FlagRuleV2,
  RulesPayload,
  RulesPayloadV2,
  TargetingRule,
  Condition,
  Variation,
  FlagType,
  EvaluationResult,
} from "./evaluate";
export type { EvaluationReason, EvaluationDetail } from "@rollgate/sdk-core";
export {
  offReason,
  targetMatchReason,
  ruleMatchReason,
  fallthroughReason,
  errorReason,
  unknownReason,
} from "@rollgate/sdk-core";
export type {
  EvaluationReasonKind,
  EvaluationErrorKind,
} from "@rollgate/sdk-core";
export {
  TelemetryCollector,
  TelemetryConfig,
  TelemetryPayload,
  EvaluationStats,
  DEFAULT_TELEMETRY_CONFIG,
} from "./telemetry";

export interface UserContext {
  id: string;
  email?: string;
  attributes?: Record<string, string | number | boolean>;
}

interface FlagsResponse {
  flags: Record<string, boolean>;
  reasons?: Record<string, EvaluationReason>;
}

export class RollgateClient extends EventEmitter {
  private config: Required<
    Omit<
      RollgateConfig,
      "retry" | "circuitBreaker" | "cache" | "sseUrl" | "telemetry"
    >
  > & {
    sseUrl: string;
    retry: RetryConfig;
    circuitBreaker: CircuitBreakerConfig;
    cache: CacheConfig;
    telemetry: TelemetryConfig;
  };
  private flags: Map<string, boolean> = new Map();
  private flagValues: Map<string, unknown> = new Map(); // V2: typed values
  private flagReasons: Map<string, EvaluationReason> | null = null; // Reasons from server
  private rules: Record<string, FlagRule> | null = null; // Rules for client-side evaluation
  private rulesV2: Record<string, FlagRuleV2> | null = null; // V2 rules with variations
  private rulesVersion: string | null = null;
  private initialized: boolean = false;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private eventSource: EventSource | null = null;
  private userContext: UserContext | null = null;
  private circuitBreaker: CircuitBreaker;
  private cache: FlagCache;
  private dedup: RequestDeduplicator;
  private lastETag: string | null = null;
  private metrics: SDKMetrics;
  private telemetry: TelemetryCollector;

  constructor(config: RollgateConfig) {
    super();
    const enableStreaming = config.enableStreaming ?? config.streaming ?? false;
    const baseUrl = config.baseUrl || "https://api.rollgate.io";

    // Build telemetry config with endpoint derived from baseUrl
    const telemetryConfig: TelemetryConfig = {
      ...DEFAULT_TELEMETRY_CONFIG,
      endpoint: `${baseUrl}/api/v1/sdk/telemetry`,
      apiKey: config.apiKey,
      ...config.telemetry,
    };

    this.config = {
      apiKey: config.apiKey,
      baseUrl,
      sseUrl: config.sseUrl || baseUrl, // Use dedicated SSE URL if provided
      refreshInterval: config.refreshInterval ?? 30000, // 30 seconds default
      enableStreaming, // SSE opt-in
      streaming: enableStreaming, // Alias for enableStreaming
      timeout: config.timeout ?? 5000,
      retry: { ...DEFAULT_RETRY_CONFIG, ...config.retry },
      circuitBreaker: {
        ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
        ...config.circuitBreaker,
      },
      cache: { ...DEFAULT_CACHE_CONFIG, ...config.cache },
      telemetry: telemetryConfig,
    };

    // Initialize circuit breaker
    this.circuitBreaker = new CircuitBreaker(this.config.circuitBreaker);

    // Initialize cache
    this.cache = new FlagCache(this.config.cache);

    // Initialize deduplicator
    this.dedup = new RequestDeduplicator();

    // Initialize metrics
    this.metrics = createMetrics();

    // Initialize telemetry collector
    this.telemetry = new TelemetryCollector(this.config.telemetry);

    // Forward circuit breaker events and track in metrics
    this.circuitBreaker.on("circuit-open", (data) => {
      this.metrics.recordCircuitStateChange("open");
      this.emit("circuit-open", data);
    });
    this.circuitBreaker.on("circuit-closed", () => {
      this.metrics.recordCircuitStateChange("closed");
      this.emit("circuit-closed");
    });
    this.circuitBreaker.on("circuit-half-open", () => {
      this.metrics.recordCircuitStateChange("half-open");
      this.emit("circuit-half-open");
    });
    this.circuitBreaker.on("state-change", (data) =>
      this.emit("circuit-state-change", data),
    );

    // Forward cache events
    this.cache.on("cache-hit", (data) => this.emit("cache-hit", data));
    this.cache.on("cache-miss", (data) => this.emit("cache-miss", data));
    this.cache.on("cache-stale", (data) => this.emit("cache-stale", data));

    // Forward telemetry events
    this.telemetry.on("flush", (data) => this.emit("telemetry-flush", data));
    this.telemetry.on("error", (err) => this.emit("telemetry-error", err));
  }

  /**
   * Get current circuit breaker state
   */
  getCircuitState(): CircuitState {
    return this.circuitBreaker.getState();
  }

  /**
   * Get circuit breaker stats
   */
  getCircuitStats() {
    return this.circuitBreaker.getStats();
  }

  /**
   * Force reset the circuit breaker
   */
  resetCircuit(): void {
    this.circuitBreaker.forceReset();
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return this.cache.getStats();
  }

  /**
   * Get cache hit rate
   */
  getCacheHitRate(): number {
    return this.cache.getHitRate();
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get metrics snapshot
   */
  getMetrics(): MetricsSnapshot {
    return this.metrics.snapshot();
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics.reset();
  }

  /**
   * Export metrics in Prometheus format
   */
  getPrometheusMetrics(prefix?: string): string {
    return this.metrics.toPrometheus(prefix);
  }

  /**
   * Subscribe to metrics events
   */
  onMetrics(
    event: "request" | "evaluation" | "circuit-change",
    callback: (metrics: MetricsSnapshot) => void,
  ): void {
    this.metrics.on(event, callback);
  }

  /**
   * Unsubscribe from metrics events
   */
  offMetrics(
    event: "request" | "evaluation" | "circuit-change",
    callback: (metrics: MetricsSnapshot) => void,
  ): void {
    this.metrics.off(event, callback);
  }

  /**
   * Initialize the client and fetch initial flags
   */
  async init(user?: UserContext): Promise<void> {
    this.userContext = user || null;

    // Try to load cached flags first
    await this.cache.load();
    const cached = this.cache.get();
    if (cached) {
      this.flags = new Map(Object.entries(cached.flags));
      if (cached.stale) {
        this.emit("flags-stale", this.getAllFlags());
      }
    }

    // Fetch fresh flags (will use cached as fallback if fetch fails)
    await this.fetchFlags();
    this.initialized = true;

    if (this.config.enableStreaming) {
      this.startStreaming();
    } else if (this.config.refreshInterval > 0) {
      this.startPolling();
    }

    // Start telemetry collector (for client-side evaluation analytics)
    this.telemetry.start();

    this.emit("ready");
  }

  /**
   * Start polling for flag updates
   */
  private startPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
    this.pollInterval = setInterval(
      () => this.fetchFlags(),
      this.config.refreshInterval,
    );
  }

  /**
   * Start SSE streaming for real-time updates
   */
  private startStreaming(): void {
    // Use native EventSource (browser) or eventsource package (Node.js)
    const ES =
      typeof EventSource !== "undefined" ? EventSource : NodeEventSource;
    if (!ES) {
      console.warn(
        "[Rollgate] SSE not available in this environment, falling back to polling",
      );
      this.startPolling();
      return;
    }

    const url = new URL(`${this.config.sseUrl}/api/v1/sdk/stream`);
    // EventSource doesn't support custom headers, pass API key as query param
    url.searchParams.set("token", this.config.apiKey);
    if (this.userContext?.id) {
      url.searchParams.set("user_id", this.userContext.id);
    }

    this.eventSource = new ES(url.toString(), {
      // @ts-ignore - withCredentials for browser compatibility
      withCredentials: false,
    });

    // Handle rules-full event (client-side evaluation mode)
    this.eventSource.addEventListener("rules-full", ((event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as RulesPayload;
        this.rules = data.flags;
        this.rulesVersion = data.version;

        // Re-evaluate all flags with current user context
        const evaluated = evaluateAllFlags(this.rules, this.userContext);
        const oldFlags = new Map(this.flags);
        this.flags = new Map(Object.entries(evaluated));

        // Emit change events for any flags that changed
        for (const [key, value] of this.flags) {
          const oldValue = oldFlags.get(key);
          if (oldValue !== value) {
            this.emit("flag-changed", key, value, oldValue);
          }
        }

        this.emit("rules-updated", data.version);
        this.emit("flags-updated", this.getAllFlags());
      } catch (e) {
        console.error("[Rollgate] Failed to parse rules-full event:", e);
      }
    }) as (event: Event) => void);

    // Handle init event (initial flags - legacy server-side evaluation)
    this.eventSource.addEventListener("init", ((event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as FlagsResponse;
        // Only use init if we don't have rules (fallback mode)
        if (!this.rules) {
          this.flags = new Map(Object.entries(data.flags || {}));
          this.emit("flags-updated", this.getAllFlags());
        }
      } catch (e) {
        console.error("[Rollgate] Failed to parse init event:", e);
      }
    }) as (event: Event) => void);

    // Handle flag-changed event (server notifies that a flag changed)
    this.eventSource.addEventListener("flag-changed", () => {
      // If we have rules, we'll get a rules-full event shortly
      // If not, refetch all flags to get values evaluated for current user context
      if (!this.rules) {
        this.fetchFlags();
      }
    });

    // Handle legacy flag-update event (deprecated, kept for backwards compatibility)
    this.eventSource.addEventListener("flag-update", ((event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as {
          key: string;
          enabled: boolean;
        };
        // Only use direct flag updates if we don't have rules
        if (!this.rules) {
          this.flags.set(data.key, data.enabled);
          this.emit("flag-changed", data.key, data.enabled);
          this.emit("flags-updated", this.getAllFlags());
        }
      } catch (e) {
        console.error("[Rollgate] Failed to parse flag-update event:", e);
      }
    }) as (event: Event) => void);

    this.eventSource.onerror = () => {
      console.warn("[Rollgate] SSE connection error, will reconnect...");
      this.emit("connection-error");
    };
  }

  /**
   * Fetch all flags from the API with dedup, cache, circuit breaker, retry and timeout
   */
  private async fetchFlags(): Promise<void> {
    // Use request deduplication to avoid concurrent identical requests
    return this.dedup.dedupe("fetch-flags", async () => {
      const url = new URL(`${this.config.baseUrl}/api/v1/sdk/flags`);
      const endpoint = "/api/v1/sdk/flags";
      const startTime = Date.now();

      if (this.userContext?.id) {
        url.searchParams.set("user_id", this.userContext.id);
      }
      // Request evaluation reasons from server
      url.searchParams.set("withReasons", "true");

      // Check if circuit breaker allows the request
      if (!this.circuitBreaker.isAllowingRequests()) {
        console.warn("[Rollgate] Circuit breaker is open, using cached flags");
        this.emit("circuit-rejected");
        this.useCachedFallback();
        return;
      }

      let data: FlagsResponse;
      let attempts = 1;
      let statusCode = 0;
      let notModified = false;

      try {
        // Execute through circuit breaker - the circuit breaker wraps the retry logic
        const result = await this.circuitBreaker.execute(async () => {
          const retryResult = await fetchWithRetry(async () => {
            // Setup timeout with AbortController
            const controller = new AbortController();
            const timeoutId = setTimeout(
              () => controller.abort(),
              this.config.timeout,
            );

            try {
              // Create trace context for this request
              const traceContext = createTraceContext();
              const traceHeaders = getTraceHeaders(traceContext);

              // Build headers with optional ETag for conditional request
              const headers: Record<string, string> = {
                Authorization: `Bearer ${this.config.apiKey}`,
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

              // Extract server trace ID from response for correlation
              const serverTraceId = response.headers.get(TraceHeaders.TRACE_ID);
              if (serverTraceId) {
                this.emit("trace", {
                  requestId: traceContext.requestId,
                  clientTraceId: traceContext.traceId,
                  serverTraceId,
                  endpoint,
                });
              }

              // Track status code for metrics
              statusCode = response.status;

              // Handle 304 Not Modified - flags haven't changed
              if (response.status === 304) {
                notModified = true;
                this.emit("flags-not-modified");
                return null; // Signal that flags are unchanged
              }

              if (!response.ok) {
                // Try to parse structured error from server
                const error = await RollgateError.fromHTTPResponse(response);
                throw error;
              }

              // Store the new ETag for next request
              const newETag = response.headers.get("ETag");
              if (newETag) {
                this.lastETag = newETag;
              }

              return (await response.json()) as FlagsResponse;
            } finally {
              clearTimeout(timeoutId);
            }
          }, this.config.retry);

          // If retry failed, throw the error so circuit breaker can track it
          if (!retryResult.success) {
            throw retryResult.error;
          }

          attempts = retryResult.attempts;
          return retryResult.data; // Can be null for 304
        });

        // If null or undefined, it means 304 Not Modified - record metrics and skip update
        if (result === null || result === undefined) {
          this.metrics.recordRequest({
            endpoint,
            statusCode: 304,
            latencyMs: Date.now() - startTime,
            cacheHit: true,
            notModified: true,
          });
          return;
        }

        data = result as FlagsResponse;
      } catch (error) {
        // Classify the error - always results in RollgateError
        const classifiedError: RollgateError =
          error instanceof RollgateError ? error : classifyError(error);

        // Record failed request metrics
        this.metrics.recordRequest({
          endpoint,
          statusCode: statusCode || 0,
          latencyMs: Date.now() - startTime,
          cacheHit: false,
          notModified: false,
          error: classifiedError.message,
          errorCategory: classifiedError.category,
        });

        if (error instanceof CircuitOpenError) {
          console.warn("[Rollgate] Circuit breaker is open:", error.message);
          this.emit("circuit-rejected");
        } else if (classifiedError.category === ErrorCategory.AUTH) {
          console.error(
            "[Rollgate] Authentication error:",
            classifiedError.message,
          );
          this.emit("auth-error", classifiedError);
        } else if (classifiedError.category === ErrorCategory.RATE_LIMIT) {
          console.warn("[Rollgate] Rate limited:", classifiedError.message);
          this.emit("rate-limited", classifiedError);
        } else {
          console.error(
            "[Rollgate] Error fetching flags:",
            classifiedError.message,
          );
        }

        this.emit("error", classifiedError);
        this.emit("retry-exhausted", { attempts, error: classifiedError });

        // Try to use cached flags as fallback
        this.useCachedFallback();
        return;
      }

      // Record successful request metrics
      this.metrics.recordRequest({
        endpoint,
        statusCode: statusCode || 200,
        latencyMs: Date.now() - startTime,
        cacheHit: false,
        notModified: false,
      });

      // Emit retry info if we had to retry
      if (attempts > 1) {
        this.emit("retry-success", { attempts });
      }

      // Update cache with fresh data
      this.cache.set("flags", data.flags || {});

      const oldFlags = new Map(this.flags);
      this.flags = new Map(Object.entries(data.flags || {}));

      // Store reasons from server response
      if (data.reasons) {
        this.flagReasons = new Map(Object.entries(data.reasons));
      }

      // Emit change events for any flags that changed
      for (const [key, value] of this.flags) {
        const oldValue = oldFlags.get(key);
        if (oldValue !== value) {
          this.emit("flag-changed", key, value, oldValue);
        }
      }

      this.emit("flags-updated", this.getAllFlags());
    });
  }

  /**
   * Use cached flags as fallback when fetch fails
   */
  private useCachedFallback(): void {
    const cached = this.cache.get();
    if (cached) {
      const oldFlags = new Map(this.flags);
      this.flags = new Map(Object.entries(cached.flags));

      if (cached.stale) {
        this.emit("flags-stale", this.getAllFlags());
      }

      // Emit change events for any flags that changed
      for (const [key, value] of this.flags) {
        const oldValue = oldFlags.get(key);
        if (oldValue !== value) {
          this.emit("flag-changed", key, value, oldValue);
        }
      }

      this.emit("flags-updated", this.getAllFlags());
    }
  }

  /**
   * Check if a flag is enabled.
   * When rules are available (client-side evaluation mode), evaluates locally.
   * Otherwise, returns the server-evaluated value from flags map.
   */
  isEnabled(flagKey: string, defaultValue: boolean = false): boolean {
    const startTime = performance.now();

    if (!this.initialized) {
      console.warn(
        "[Rollgate] Client not initialized. Call init() first. Returning default value.",
      );
      // Record evaluation with default value
      const evaluationTime = performance.now() - startTime;
      this.metrics.recordEvaluation(flagKey, defaultValue, evaluationTime);
      return defaultValue;
    }

    let result: boolean;
    let isClientSide = false;

    // If we have rules, use client-side evaluation
    if (this.rules && this.rules[flagKey]) {
      result = evaluateFlag(this.rules[flagKey], this.userContext);
      isClientSide = true;
    } else {
      // Fallback to server-evaluated flags or default
      result = this.flags.get(flagKey) ?? defaultValue;
    }

    const evaluationTime = performance.now() - startTime;
    this.metrics.recordEvaluation(flagKey, result, evaluationTime);

    // Record telemetry for client-side evaluations
    if (isClientSide) {
      this.telemetry.recordEvaluation(flagKey, result);
    }

    return result;
  }

  /**
   * Get a flag's value with type support.
   * For non-boolean flags (string, number, json), returns the typed value.
   * Falls back to defaultValue if flag not found or disabled.
   *
   * Note: This method requires V2 rules to work properly. In V1 mode, it will
   * fall back to isEnabled() for boolean flags or return defaultValue.
   */
  getValue<T>(flagKey: string, defaultValue: T): T {
    if (!this.initialized) {
      console.warn(
        "[Rollgate] Client not initialized. Call init() first. Returning default value.",
      );
      return defaultValue;
    }

    // V2 rules support typed values
    if (this.rulesV2 && this.rulesV2[flagKey]) {
      const result = evaluateFlagValue<T>(
        this.rulesV2[flagKey],
        this.userContext,
      );
      if (!result.enabled) {
        return defaultValue;
      }
      return result.value;
    }

    // Fallback: try boolean flags for backward compatibility
    if (this.rules && this.rules[flagKey]) {
      const enabled = evaluateFlag(this.rules[flagKey], this.userContext);
      // If T is boolean, return enabled state; otherwise return default
      if (typeof defaultValue === "boolean") {
        return enabled as unknown as T;
      }
    }

    // Check v2 values map if available
    if (this.flagValues.has(flagKey)) {
      const val = this.flagValues.get(flagKey);
      if (val !== undefined) {
        return val as T;
      }
    }

    // Final fallback to boolean flags map
    const boolVal = this.flags.get(flagKey);
    if (boolVal !== undefined && typeof defaultValue === "boolean") {
      return boolVal as unknown as T;
    }

    return defaultValue;
  }

  /**
   * Get a string flag value.
   * Convenience method for getValue<string>.
   */
  getString(flagKey: string, defaultValue: string = ""): string {
    return this.getValue<string>(flagKey, defaultValue);
  }

  /**
   * Get a number flag value.
   * Convenience method for getValue<number>.
   */
  getNumber(flagKey: string, defaultValue: number = 0): number {
    return this.getValue<number>(flagKey, defaultValue);
  }

  /**
   * Get a JSON flag value.
   * Convenience method for getValue with type parameter.
   */
  getJSON<T>(flagKey: string, defaultValue: T): T {
    return this.getValue<T>(flagKey, defaultValue);
  }

  /**
   * Check if a flag is enabled with detailed evaluation reason.
   * Returns both the value and the reason why it evaluated that way.
   */
  isEnabledDetail(
    flagKey: string,
    defaultValue: boolean = false,
  ): EvaluationDetail<boolean> {
    const startTime = performance.now();

    if (!this.initialized) {
      const evaluationTime = performance.now() - startTime;
      this.metrics.recordEvaluation(flagKey, defaultValue, evaluationTime);
      return {
        value: defaultValue,
        reason: errorReason("CLIENT_NOT_READY"),
      };
    }

    // If we have rules, use client-side evaluation with reason
    if (this.rules && this.rules[flagKey]) {
      const detail = evaluateFlagWithReason(
        this.rules[flagKey],
        this.userContext,
      );
      const evaluationTime = performance.now() - startTime;
      this.metrics.recordEvaluation(flagKey, detail.value, evaluationTime);
      this.telemetry.recordEvaluation(flagKey, detail.value);
      return detail;
    }

    // Fallback to server-evaluated flags
    const value = this.flags.get(flagKey);
    const evaluationTime = performance.now() - startTime;

    if (value === undefined) {
      this.metrics.recordEvaluation(flagKey, defaultValue, evaluationTime);
      return {
        value: defaultValue,
        reason: unknownReason(),
      };
    }

    this.metrics.recordEvaluation(flagKey, value, evaluationTime);
    // Server-evaluated flags don't have client-side reasons
    // The reason would need to come from the server
    return {
      value,
      reason: this.flagReasons?.get(flagKey) ?? { kind: "UNKNOWN" },
    };
  }

  /**
   * Get a flag's value with type support and detailed evaluation reason.
   * Returns both the value and the reason why it evaluated that way.
   */
  getValueDetail<T>(flagKey: string, defaultValue: T): EvaluationDetail<T> {
    if (!this.initialized) {
      return {
        value: defaultValue,
        reason: errorReason("CLIENT_NOT_READY"),
      };
    }

    // V2 rules support typed values with reasons
    if (this.rulesV2 && this.rulesV2[flagKey]) {
      const result = evaluateFlagValue<T>(
        this.rulesV2[flagKey],
        this.userContext,
      );
      if (!result.enabled) {
        return {
          value: defaultValue,
          reason: result.reason ?? { kind: "UNKNOWN" },
          variationId: result.variationId,
        };
      }
      return {
        value: result.value,
        reason: result.reason ?? { kind: "UNKNOWN" },
        variationId: result.variationId,
      };
    }

    // Fallback: try boolean rules
    if (this.rules && this.rules[flagKey]) {
      const detail = evaluateFlagWithReason(
        this.rules[flagKey],
        this.userContext,
      );
      if (typeof defaultValue === "boolean") {
        return detail as unknown as EvaluationDetail<T>;
      }
      return {
        value: defaultValue,
        reason: detail.reason,
      };
    }

    // Check v2 values map
    if (this.flagValues.has(flagKey)) {
      const val = this.flagValues.get(flagKey);
      if (val !== undefined) {
        return {
          value: val as T,
          reason: this.flagReasons?.get(flagKey) ?? { kind: "UNKNOWN" },
        };
      }
    }

    return {
      value: defaultValue,
      reason: unknownReason(),
    };
  }

  /**
   * Get all flags as an object
   */
  getAllFlags(): Record<string, boolean> {
    return Object.fromEntries(this.flags);
  }

  /**
   * Get current rules version (for debugging/monitoring).
   * Returns null if in server-side evaluation mode.
   */
  getRulesVersion(): string | null {
    return this.rulesVersion;
  }

  /**
   * Check if client-side evaluation is active.
   * Returns true if we have rules and are evaluating locally.
   */
  isClientSideEvaluation(): boolean {
    return this.rules !== null;
  }

  /**
   * Update user context and re-evaluate flags.
   * In client-side mode, re-evaluates locally without server call.
   */
  async identify(user: UserContext): Promise<void> {
    this.userContext = user;

    // If we have rules, re-evaluate locally (no server call needed)
    if (this.rules) {
      const evaluated = evaluateAllFlags(this.rules, this.userContext);
      const oldFlags = new Map(this.flags);
      this.flags = new Map(Object.entries(evaluated));

      // Emit change events for any flags that changed
      for (const [key, value] of this.flags) {
        const oldValue = oldFlags.get(key);
        if (oldValue !== value) {
          this.emit("flag-changed", key, value, oldValue);
        }
      }

      this.emit("flags-updated", this.getAllFlags());
    } else {
      // Server-side evaluation mode - fetch new flags
      await this.fetchFlags();
    }
  }

  /**
   * Clear user context and re-evaluate flags.
   * In client-side mode, re-evaluates locally without server call.
   */
  async reset(): Promise<void> {
    this.userContext = null;

    // If we have rules, re-evaluate locally (no server call needed)
    if (this.rules) {
      const evaluated = evaluateAllFlags(this.rules, null);
      const oldFlags = new Map(this.flags);
      this.flags = new Map(Object.entries(evaluated));

      // Emit change events for any flags that changed
      for (const [key, value] of this.flags) {
        const oldValue = oldFlags.get(key);
        if (oldValue !== value) {
          this.emit("flag-changed", key, value, oldValue);
        }
      }

      this.emit("flags-updated", this.getAllFlags());
    } else {
      // Server-side evaluation mode - fetch new flags
      await this.fetchFlags();
    }
  }

  /**
   * Force refresh flags
   */
  async refresh(): Promise<void> {
    await this.fetchFlags();
  }

  /**
   * Close the client and clean up resources
   */
  async close(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    // Stop telemetry (flushes remaining data)
    await this.telemetry.stop();

    // Close cache (persists if configured)
    this.cache.close();

    // Clean up all internal components to prevent memory leaks
    this.circuitBreaker.removeAllListeners();
    this.metrics.removeAllListeners();
    this.dedup.clear();

    this.removeAllListeners();
  }

  /**
   * Get telemetry buffer stats (for debugging/monitoring)
   */
  getTelemetryStats(): { flagCount: number; evaluationCount: number } {
    return this.telemetry.getBufferStats();
  }

  /**
   * Force flush telemetry data
   */
  async flushTelemetry(): Promise<void> {
    await this.telemetry.flush();
  }
}

// Default export for convenience
export default RollgateClient;
