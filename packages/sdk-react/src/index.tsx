import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
  ReactNode,
} from 'react';
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
} from '@rollgate/sdk-core';
import type {
  RetryConfig,
  CircuitBreakerConfig,
  CacheConfig,
  SDKMetrics,
  MetricsSnapshot,
  FlagEvaluationMetrics,
  FlagStats,
  TimeWindowMetrics,
  WindowedStats,
} from '@rollgate/sdk-core';

export interface RollgateConfig {
  /** Your Rollgate API key (server or client key) */
  apiKey: string;
  /** Base URL for Rollgate API (default: https://api.rollgate.io) */
  baseUrl?: string;
  /** SSE URL for streaming connections (default: same as baseUrl). Use when SSE needs a separate endpoint (e.g., to bypass Cloudflare proxy). */
  sseUrl?: string;
  /** Polling interval in ms (default: 30000 = 30s). Set to 0 to disable polling. */
  refreshInterval?: number;
  /**
   * Enable SSE streaming for real-time updates (default: false).
   *
   * ⚠️ For production with many users, we recommend using the proxy pattern
   * with @rollgate/sdk-node on your backend instead of direct browser connections.
   * See: https://docs.rollgate.io/guides/production-setup
   */
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

// Re-export from sdk-core
export type { RetryConfig, CircuitBreakerConfig, CacheConfig } from '@rollgate/sdk-core';
export { CircuitState } from '@rollgate/sdk-core';
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
} from '@rollgate/sdk-core';
export type {
  SDKMetrics,
  MetricsSnapshot,
  FlagEvaluationMetrics,
  FlagStats,
  TimeWindowMetrics,
  WindowedStats,
} from '@rollgate/sdk-core';
export {
  TraceHeaders,
  createTraceContext,
  getTraceHeaders,
  generateTraceId,
  generateSpanId,
  generateRequestId,
} from '@rollgate/sdk-core';
export type { TraceContext } from '@rollgate/sdk-core';

export interface UserContext {
  id: string;
  email?: string;
  attributes?: Record<string, string | number | boolean>;
}

interface FlagsResponse {
  flags: Record<string, boolean>;
}

interface RollgateContextValue {
  isEnabled: (flagKey: string, defaultValue?: boolean) => boolean;
  isLoading: boolean;
  isError: boolean;
  isStale: boolean;
  retryCount: number;
  circuitState: CircuitState;
  flags: Record<string, boolean>;
  identify: (user: UserContext) => Promise<void>;
  reset: () => Promise<void>;
  refresh: () => Promise<void>;
  getMetrics: () => MetricsSnapshot;
  resetMetrics: () => void;
  getPrometheusMetrics: (prefix?: string) => string;
  onMetrics: (
    event: 'request' | 'evaluation' | 'circuit-change',
    callback: (metrics: MetricsSnapshot) => void
  ) => void;
  offMetrics: (
    event: 'request' | 'evaluation' | 'circuit-change',
    callback: (metrics: MetricsSnapshot) => void
  ) => void;
}

const RollgateContext = createContext<RollgateContextValue | null>(null);

interface RollgateProviderProps {
  config: RollgateConfig;
  user?: UserContext;
  children: ReactNode;
}

export function RollgateProvider({ config, user, children }: RollgateProviderProps) {
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [isStale, setIsStale] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [circuitState, setCircuitState] = useState<CircuitState>(CircuitState.CLOSED);
  const [currentUser, setCurrentUser] = useState<UserContext | undefined>(user);

  const eventSourceRef = useRef<EventSource | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastETagRef = useRef<string | null>(null);

  const baseUrl = config.baseUrl || 'https://api.rollgate.io';
  const sseUrl = config.sseUrl || baseUrl; // Use dedicated SSE URL if provided
  const refreshInterval = config.refreshInterval ?? 30000; // 30 seconds default
  const enableStreaming = config.enableStreaming ?? config.streaming ?? false; // Default to polling (SSE opt-in)
  const timeout = config.timeout ?? 5000;
  const retryConfig: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config.retry };
  const circuitBreakerConfig: CircuitBreakerConfig = {
    ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
    ...config.circuitBreaker,
  };
  const cacheConfig: CacheConfig = { ...DEFAULT_CACHE_CONFIG, ...config.cache };

  // Create stable instances across renders
  const metricsRef = useRef<SDKMetrics | null>(null);
  const circuitBreaker = useMemo(() => {
    const cb = new CircuitBreaker(circuitBreakerConfig);
    cb.on('state-change', (data) => {
      if (!data?.to) return;
      setCircuitState(data.to);
      // Track in metrics
      if (metricsRef.current) {
        let metricsState: 'closed' | 'open' | 'half-open' = 'closed';
        if (data.to === CircuitState.OPEN) metricsState = 'open';
        else if (data.to === CircuitState.HALF_OPEN) metricsState = 'half-open';
        metricsRef.current.recordCircuitStateChange(metricsState);
      }
    });
    return cb;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cache = useMemo(() => new FlagCache(cacheConfig), []); // eslint-disable-line react-hooks/exhaustive-deps
  const dedup = useMemo(() => new RequestDeduplicator(), []);
  const metrics = useMemo(() => createMetrics(), []);

  // Link metrics ref for circuit breaker callbacks
  useEffect(() => {
    metricsRef.current = metrics;
  }, [metrics]);

  // Load cached flags on mount
  useEffect(() => {
    cache.load();
    const cached = cache.get();
    if (cached) {
      setFlags(cached.flags);
      setIsStale(cached.stale);
    }
  }, [cache]);

  const fetchFlags = useCallback(async () => {
    // Use request deduplication
    return dedup.dedupe('fetch-flags', async () => {
      const url = new URL(`${baseUrl}/api/v1/sdk/flags`);
      const endpoint = '/api/v1/sdk/flags';
      const startTime = Date.now();
      let statusCode = 0;

      if (currentUser?.id) {
        url.searchParams.set('user_id', currentUser.id);
      }

      // Check if circuit breaker allows requests
      if (!circuitBreaker.isAllowingRequests()) {
        console.warn('[Rollgate] Circuit breaker is open, using cached flags');
        useCachedFallback();
        return;
      }

      try {
        // Execute through circuit breaker
        const data = await circuitBreaker.execute(async () => {
          const result = await fetchWithRetry(async () => {
            // Setup timeout with AbortController
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            try {
              // Create trace context for this request
              const traceContext = createTraceContext();
              const traceHeaders = getTraceHeaders(traceContext);

              // Build headers with optional ETag for conditional request
              const headers: Record<string, string> = {
                Authorization: `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json',
                ...traceHeaders,
              };
              if (lastETagRef.current) {
                headers['If-None-Match'] = lastETagRef.current;
              }

              const response = await fetch(url.toString(), {
                headers,
                signal: controller.signal,
              });

              // Track status code for metrics
              statusCode = response.status;

              // Handle 304 Not Modified - flags haven't changed
              if (response.status === 304) {
                return null; // Signal that flags are unchanged
              }

              if (!response.ok) {
                // Try to parse structured error from server
                const error = await RollgateError.fromHTTPResponse(response);
                throw error;
              }

              // Store the new ETag for next request
              const newETag = response.headers.get('ETag');
              if (newETag) {
                lastETagRef.current = newETag;
              }

              return (await response.json()) as FlagsResponse;
            } finally {
              clearTimeout(timeoutId);
            }
          }, retryConfig);

          // If retry failed, throw so circuit breaker can track it
          if (!result.success) {
            setRetryCount(result.attempts);
            throw result.error;
          }

          if (result.attempts > 1) {
            setRetryCount(result.attempts);
          }

          return result.data; // Can be null for 304
        });

        // If null, it means 304 Not Modified - record metrics and skip update
        if (data === null) {
          metrics.recordRequest({
            endpoint,
            statusCode: 304,
            latencyMs: Date.now() - startTime,
            cacheHit: true,
            notModified: true,
          });
          setIsLoading(false);
          return;
        }

        // Record successful request metrics
        metrics.recordRequest({
          endpoint,
          statusCode: statusCode || 200,
          latencyMs: Date.now() - startTime,
          cacheHit: false,
          notModified: false,
        });

        // Update cache with fresh data
        const flagsData = (data as FlagsResponse).flags || {};
        cache.set(flagsData);

        setFlags(flagsData);
        setIsStale(false);
        setIsError(false);
      } catch (error) {
        // Classify the error - always results in RollgateError
        const classifiedError: RollgateError =
          error instanceof RollgateError ? error : classifyError(error);

        // Record failed request metrics
        metrics.recordRequest({
          endpoint,
          statusCode: statusCode || 0,
          latencyMs: Date.now() - startTime,
          cacheHit: false,
          notModified: false,
          error: classifiedError.message,
          errorCategory: classifiedError.category,
        });

        if (error instanceof CircuitOpenError) {
          console.warn('[Rollgate] Circuit breaker is open:', error.message);
        } else if (classifiedError.category === ErrorCategory.AUTH) {
          console.error('[Rollgate] Authentication error:', classifiedError.message);
        } else if (classifiedError.category === ErrorCategory.RATE_LIMIT) {
          console.warn('[Rollgate] Rate limited:', classifiedError.message);
        } else {
          console.error('[Rollgate] Error fetching flags:', classifiedError.message);
        }
        // Use cached fallback on error
        useCachedFallback();
        setIsError(true);
      } finally {
        setIsLoading(false);
      }
    });

    function useCachedFallback() {
      const cached = cache.get();
      if (cached) {
        setFlags(cached.flags);
        setIsStale(cached.stale);
      }
    }
  }, [
    baseUrl,
    config.apiKey,
    currentUser?.id,
    timeout,
    retryConfig,
    circuitBreaker,
    cache,
    dedup,
    metrics,
  ]);

  // Setup SSE streaming
  useEffect(() => {
    if (!enableStreaming) return;

    const url = new URL(`${sseUrl}/api/v1/sdk/stream`);
    // EventSource doesn't support custom headers, pass API key as query param
    url.searchParams.set('token', config.apiKey);
    if (currentUser?.id) {
      url.searchParams.set('user_id', currentUser.id);
    }

    const eventSource = new EventSource(url.toString());
    eventSourceRef.current = eventSource;

    eventSource.addEventListener('init', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as FlagsResponse;
        setFlags(data.flags || {});
        setIsLoading(false);
        setIsError(false);
      } catch (e) {
        console.error('[Rollgate] Failed to parse init event:', e);
      }
    });

    // Handle flag-changed event (server notifies that a flag changed, client refetches)
    eventSource.addEventListener('flag-changed', () => {
      // Refetch all flags to get values evaluated for current user context
      fetchFlags();
    });

    // Handle legacy flag-update event (deprecated, kept for backwards compatibility)
    eventSource.addEventListener('flag-update', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as {
          key: string;
          enabled: boolean;
        };
        setFlags((prev) => ({ ...prev, [data.key]: data.enabled }));
      } catch (e) {
        console.error('[Rollgate] Failed to parse flag-update event:', e);
      }
    });

    eventSource.onerror = () => {
      console.warn('[Rollgate] SSE connection error');
      setIsError(true);
      // EventSource will auto-reconnect
    };

    return () => {
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [sseUrl, config.apiKey, currentUser?.id, enableStreaming]);

  // Fallback to polling if streaming is disabled
  useEffect(() => {
    if (enableStreaming) return;

    fetchFlags();

    if (refreshInterval > 0) {
      intervalRef.current = setInterval(fetchFlags, refreshInterval);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [fetchFlags, refreshInterval, enableStreaming]);

  // Initial fetch when not streaming
  useEffect(() => {
    if (!enableStreaming) {
      fetchFlags();
    }
  }, [enableStreaming, fetchFlags]);

  const isEnabled = useCallback(
    (flagKey: string, defaultValue: boolean = false): boolean => {
      const startTime = performance.now();
      const result = flags[flagKey] ?? defaultValue;
      const evaluationTime = performance.now() - startTime;
      metrics.recordEvaluation(flagKey, result, evaluationTime);
      return result;
    },
    [flags, metrics]
  );

  const identify = useCallback(async (user: UserContext): Promise<void> => {
    setCurrentUser(user);
    // Flags will be re-fetched due to dependency change
  }, []);

  const reset = useCallback(async (): Promise<void> => {
    setCurrentUser(undefined);
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    await fetchFlags();
  }, [fetchFlags]);

  const getMetricsSnapshot = useCallback((): MetricsSnapshot => {
    return metrics.snapshot();
  }, [metrics]);

  const resetMetricsData = useCallback((): void => {
    metrics.reset();
  }, [metrics]);

  const getPrometheusMetricsData = useCallback(
    (prefix?: string): string => {
      return metrics.toPrometheus(prefix);
    },
    [metrics]
  );

  const onMetricsEvent = useCallback(
    (
      event: 'request' | 'evaluation' | 'circuit-change',
      callback: (metricsData: MetricsSnapshot) => void
    ): void => {
      metrics.on(event, callback);
    },
    [metrics]
  );

  const offMetricsEvent = useCallback(
    (
      event: 'request' | 'evaluation' | 'circuit-change',
      callback: (metricsData: MetricsSnapshot) => void
    ): void => {
      metrics.off(event, callback);
    },
    [metrics]
  );

  const value: RollgateContextValue = {
    isEnabled,
    isLoading,
    isError,
    isStale,
    retryCount,
    circuitState,
    flags,
    identify,
    reset,
    refresh,
    getMetrics: getMetricsSnapshot,
    resetMetrics: resetMetricsData,
    getPrometheusMetrics: getPrometheusMetricsData,
    onMetrics: onMetricsEvent,
    offMetrics: offMetricsEvent,
  };

  return <RollgateContext.Provider value={value}>{children}</RollgateContext.Provider>;
}

/**
 * Hook to check if a single flag is enabled
 */
export function useFlag(flagKey: string, defaultValue: boolean = false): boolean {
  const context = useContext(RollgateContext);

  if (!context) {
    throw new Error('useFlag must be used within a RollgateProvider');
  }

  return context.isEnabled(flagKey, defaultValue);
}

/**
 * Hook to get multiple flags at once
 */
export function useFlags(flagKeys: string[]): Record<string, boolean> {
  const context = useContext(RollgateContext);

  if (!context) {
    throw new Error('useFlags must be used within a RollgateProvider');
  }

  const result: Record<string, boolean> = {};
  for (const key of flagKeys) {
    result[key] = context.isEnabled(key, false);
  }
  return result;
}

/**
 * Hook to access the full Rollgate context
 */
export function useRollgate(): RollgateContextValue {
  const context = useContext(RollgateContext);

  if (!context) {
    throw new Error('useRollgate must be used within a RollgateProvider');
  }

  return context;
}

/**
 * Hook to access SDK metrics
 */
export function useMetrics(): { metrics: MetricsSnapshot; reset: () => void } {
  const context = useContext(RollgateContext);

  if (!context) {
    throw new Error('useMetrics must be used within a RollgateProvider');
  }

  return {
    metrics: context.getMetrics(),
    reset: context.resetMetrics,
  };
}

/**
 * Component that renders children only if flag is enabled
 */
interface FeatureProps {
  flag: string;
  children: ReactNode;
  fallback?: ReactNode;
}

export function Feature({ flag, children, fallback = null }: FeatureProps): JSX.Element {
  const enabled = useFlag(flag);
  return <>{enabled ? children : fallback}</>;
}

// Re-export types
export type { RollgateContextValue, RollgateProviderProps };
