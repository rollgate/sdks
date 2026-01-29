import { ref, readonly, type App, type Ref } from "vue";
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
  ErrorCategory,
  classifyError,
  // Metrics
  createMetrics,
  // Tracing
  createTraceContext,
  getTraceHeaders,
} from "@rollgate/sdk-core";
import type {
  RetryConfig,
  CircuitBreakerConfig,
  CacheConfig,
  MetricsSnapshot,
} from "@rollgate/sdk-core";

export interface RollgateConfig {
  /** Your Rollgate API key (server or client key) */
  apiKey: string;
  /** Base URL for Rollgate API (default: https://api.rollgate.io) */
  baseUrl?: string;
  /** SSE URL for streaming connections (default: same as baseUrl) */
  sseUrl?: string;
  /** Polling interval in ms (default: 30000 = 30s). Set to 0 to disable polling. */
  refreshInterval?: number;
  /** Enable SSE streaming for real-time updates (default: false). */
  enableStreaming?: boolean;
  /** Alias for enableStreaming */
  streaming?: boolean;
  /** Request timeout in milliseconds (default: 5000) */
  timeout?: number;
  /** Retry configuration for failed requests */
  retry?: Partial<RetryConfig>;
  /** Circuit breaker configuration for fault tolerance */
  circuitBreaker?: Partial<CircuitBreakerConfig>;
  /** Cache configuration for offline support */
  cache?: Partial<CacheConfig>;
}

export interface UserContext {
  id: string;
  email?: string;
  attributes?: Record<string, string | number | boolean>;
}

interface FlagsResponse {
  flags: Record<string, boolean>;
}

export interface RollgatePluginOptions extends RollgateConfig {
  /** Initial user context for targeting */
  user?: UserContext;
}

export interface RollgateContext {
  flags: Ref<Record<string, boolean>>;
  isReady: Ref<boolean>;
  isLoading: Ref<boolean>;
  isStale: Ref<boolean>;
  error: Ref<Error | null>;
  circuitState: Ref<CircuitState>;
  currentUser: Ref<UserContext | undefined>;

  isEnabled: (flagKey: string, defaultValue?: boolean) => boolean;
  identify: (user: UserContext) => Promise<void>;
  reset: () => Promise<void>;
  refresh: () => Promise<void>;
  getMetrics: () => MetricsSnapshot;
  close: () => void;
}

export const RollgatePlugin = {
  install(app: App, options: RollgatePluginOptions) {
    const flags: Ref<Record<string, boolean>> = ref({});
    const isReady = ref(false);
    const isLoading = ref(true);
    const isStale = ref(false);
    const error: Ref<Error | null> = ref(null);
    const circuitStateRef: Ref<CircuitState> = ref(CircuitState.CLOSED);
    const currentUser: Ref<UserContext | undefined> = ref(options.user);

    // Configuration
    const baseUrl = options.baseUrl || "https://api.rollgate.io";
    const sseUrl = options.sseUrl || baseUrl;
    const refreshInterval = options.refreshInterval ?? 30000;
    const enableStreaming =
      options.enableStreaming ?? options.streaming ?? false;
    const timeout = options.timeout ?? 5000;
    const retryConfig: RetryConfig = {
      ...DEFAULT_RETRY_CONFIG,
      ...options.retry,
    };
    const circuitBreakerConfig: CircuitBreakerConfig = {
      ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
      ...options.circuitBreaker,
    };
    const cacheConfig: CacheConfig = {
      ...DEFAULT_CACHE_CONFIG,
      ...options.cache,
    };

    // Create instances
    const metrics = createMetrics();
    const circuitBreaker = new CircuitBreaker(circuitBreakerConfig);
    const cache = new FlagCache(cacheConfig);
    const dedup = new RequestDeduplicator();

    let eventSource: EventSource | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let lastETag: string | null = null;

    // Track circuit state changes
    circuitBreaker.on("state-change", (data) => {
      if (!data?.to) return;
      circuitStateRef.value = data.to;
      let metricsState: "closed" | "open" | "half-open" = "closed";
      if (data.to === CircuitState.OPEN) metricsState = "open";
      else if (data.to === CircuitState.HALF_OPEN) metricsState = "half-open";
      metrics.recordCircuitStateChange(metricsState);
    });

    // Load cached flags
    cache.load();
    const cached = cache.get();
    if (cached) {
      flags.value = cached.flags;
      isStale.value = cached.stale;
    }

    // Fetch flags function
    const fetchFlags = async () => {
      return dedup.dedupe("fetch-flags", async () => {
        const url = new URL(`${baseUrl}/api/v1/sdk/flags`);
        const endpoint = "/api/v1/sdk/flags";
        const startTime = Date.now();
        let statusCode = 0;

        if (currentUser.value?.id) {
          url.searchParams.set("user_id", currentUser.value.id);
        }

        if (!circuitBreaker.isAllowingRequests()) {
          console.warn(
            "[Rollgate] Circuit breaker is open, using cached flags",
          );
          useCachedFallback();
          return;
        }

        try {
          const data = await circuitBreaker.execute(async () => {
            const result = await fetchWithRetry(async () => {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), timeout);

              try {
                const traceContext = createTraceContext();
                const traceHeaders = getTraceHeaders(traceContext);

                const headers: Record<string, string> = {
                  Authorization: `Bearer ${options.apiKey}`,
                  "Content-Type": "application/json",
                  ...traceHeaders,
                };
                if (lastETag) {
                  headers["If-None-Match"] = lastETag;
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
                  const err = await RollgateError.fromHTTPResponse(response);
                  throw err;
                }

                const newETag = response.headers.get("ETag");
                if (newETag) {
                  lastETag = newETag;
                }

                return (await response.json()) as FlagsResponse;
              } finally {
                clearTimeout(timeoutId);
              }
            }, retryConfig);

            if (!result.success) {
              throw result.error;
            }

            return result.data;
          });

          if (data === null) {
            metrics.recordRequest({
              endpoint,
              statusCode: 304,
              latencyMs: Date.now() - startTime,
              cacheHit: true,
              notModified: true,
            });
            isLoading.value = false;
            return;
          }

          metrics.recordRequest({
            endpoint,
            statusCode: statusCode || 200,
            latencyMs: Date.now() - startTime,
            cacheHit: false,
            notModified: false,
          });

          const flagsData = (data as FlagsResponse).flags || {};
          cache.set(flagsData);

          flags.value = flagsData;
          isStale.value = false;
          error.value = null;
          isReady.value = true;
        } catch (err) {
          const classifiedError: RollgateError =
            err instanceof RollgateError ? err : classifyError(err);

          metrics.recordRequest({
            endpoint,
            statusCode: statusCode || 0,
            latencyMs: Date.now() - startTime,
            cacheHit: false,
            notModified: false,
            error: classifiedError.message,
            errorCategory: classifiedError.category,
          });

          if (err instanceof CircuitOpenError) {
            console.warn("[Rollgate] Circuit breaker is open:", err.message);
          } else if (classifiedError.category === ErrorCategory.AUTH) {
            console.error(
              "[Rollgate] Authentication error:",
              classifiedError.message,
            );
          } else if (classifiedError.category === ErrorCategory.RATE_LIMIT) {
            console.warn("[Rollgate] Rate limited:", classifiedError.message);
          } else {
            console.error(
              "[Rollgate] Error fetching flags:",
              classifiedError.message,
            );
          }

          useCachedFallback();
          error.value = classifiedError;
        } finally {
          isLoading.value = false;
        }
      });

      function useCachedFallback() {
        const cached = cache.get();
        if (cached) {
          flags.value = cached.flags;
          isStale.value = cached.stale;
        }
      }
    };

    // Setup SSE streaming
    const setupSSE = () => {
      if (!enableStreaming) return;

      const url = new URL(`${sseUrl}/api/v1/sdk/stream`);
      url.searchParams.set("token", options.apiKey);
      if (currentUser.value?.id) {
        url.searchParams.set("user_id", currentUser.value.id);
      }

      eventSource = new EventSource(url.toString());

      eventSource.addEventListener("init", (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data) as FlagsResponse;
          flags.value = data.flags || {};
          isLoading.value = false;
          error.value = null;
          isReady.value = true;
        } catch (e) {
          console.error("[Rollgate] Failed to parse init event:", e);
        }
      });

      eventSource.addEventListener("flag-changed", () => {
        fetchFlags();
      });

      eventSource.addEventListener("flag-update", (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data) as {
            key: string;
            enabled: boolean;
          };
          flags.value = { ...flags.value, [data.key]: data.enabled };
        } catch (e) {
          console.error("[Rollgate] Failed to parse flag-update event:", e);
        }
      });

      eventSource.onerror = () => {
        console.warn("[Rollgate] SSE connection error");
        error.value = new Error("SSE connection error");
      };
    };

    // Setup polling
    const setupPolling = () => {
      if (enableStreaming) return;

      fetchFlags();

      if (refreshInterval > 0) {
        pollInterval = setInterval(fetchFlags, refreshInterval);
      }
    };

    // Initialize
    if (enableStreaming) {
      setupSSE();
    } else {
      setupPolling();
    }

    // Cleanup function
    const close = () => {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    };

    // Context methods
    const isEnabled = (
      flagKey: string,
      defaultValue: boolean = false,
    ): boolean => {
      const startTime = performance.now();
      const result = flags.value[flagKey] ?? defaultValue;
      const evaluationTime = performance.now() - startTime;
      metrics.recordEvaluation(flagKey, result, evaluationTime);
      return result;
    };

    const identify = async (user: UserContext): Promise<void> => {
      currentUser.value = user;

      // Reconnect SSE with new user context
      if (enableStreaming && eventSource) {
        close();
        setupSSE();
      } else {
        await fetchFlags();
      }
    };

    const reset = async (): Promise<void> => {
      currentUser.value = undefined;

      if (enableStreaming && eventSource) {
        close();
        setupSSE();
      } else {
        await fetchFlags();
      }
    };

    const refresh = async (): Promise<void> => {
      await fetchFlags();
    };

    const getMetricsSnapshot = (): MetricsSnapshot => {
      return metrics.snapshot();
    };

    const context: RollgateContext = {
      flags,
      isReady: readonly(isReady) as Ref<boolean>,
      isLoading: readonly(isLoading) as Ref<boolean>,
      isStale: readonly(isStale) as Ref<boolean>,
      error: readonly(error) as Ref<Error | null>,
      circuitState: readonly(circuitStateRef) as Ref<CircuitState>,
      currentUser: readonly(currentUser) as Ref<UserContext | undefined>,
      isEnabled,
      identify,
      reset,
      refresh,
      getMetrics: getMetricsSnapshot,
      close,
    };

    // Provide context to all components
    app.provide("rollgate", context);

    // Also make it available via app.config.globalProperties
    app.config.globalProperties.$rollgate = context;

    // Cleanup on unmount
    const originalUnmount = app.unmount;
    app.unmount = function (this: App) {
      close();
      return originalUnmount.call(this);
    };
  },
};
