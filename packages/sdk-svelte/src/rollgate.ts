import { writable, derived, type Readable, type Writable } from 'svelte/store';
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
  MetricsSnapshot,
} from '@rollgate/sdk-core';

export interface UserContext {
  id: string;
  email?: string;
  attributes?: Record<string, string | number | boolean>;
}

export interface RollgateConfig {
  /** Your Rollgate API key */
  apiKey: string;
  /** Base URL for Rollgate API (default: https://api.rollgate.io) */
  baseUrl?: string;
  /** SSE URL for streaming connections (default: same as baseUrl) */
  sseUrl?: string;
  /** Polling interval in ms (default: 30000 = 30s) */
  refreshInterval?: number;
  /** Enable SSE streaming for real-time updates (default: false) */
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

interface FlagsResponse {
  flags: Record<string, boolean>;
}

export interface RollgateStores {
  /** Store with all flag values */
  flags: Readable<Record<string, boolean>>;
  /** Store indicating if client is ready */
  isReady: Readable<boolean>;
  /** Store indicating if flags are loading */
  isLoading: Readable<boolean>;
  /** Store indicating if flags are stale */
  isStale: Readable<boolean>;
  /** Store with current error, if any */
  error: Readable<Error | null>;
  /** Store with circuit breaker state */
  circuitState: Readable<CircuitState>;

  /** Check if a flag is enabled (non-reactive) */
  isEnabled: (flagKey: string, defaultValue?: boolean) => boolean;
  /** Get a derived store for a specific flag */
  getFlag: (flagKey: string, defaultValue?: boolean) => Readable<boolean>;
  /** Set user context and refresh flags */
  identify: (user: UserContext) => Promise<void>;
  /** Clear user context and refresh flags */
  reset: () => Promise<void>;
  /** Force refresh flags */
  refresh: () => Promise<void>;
  /** Get metrics snapshot */
  getMetrics: () => MetricsSnapshot;
  /** Cleanup resources */
  destroy: () => void;
}

export interface CreateRollgateOptions extends RollgateConfig {
  /** Initial user context for targeting */
  user?: UserContext;
}

/**
 * Create Rollgate stores for Svelte.
 *
 * @example
 * ```svelte
 * <script>
 *   import { createRollgate } from '@rollgate/sdk-svelte';
 *   import { setContext } from 'svelte';
 *
 *   const rollgate = createRollgate({
 *     apiKey: 'your-api-key',
 *   });
 *
 *   setContext('rollgate', rollgate);
 *
 *   const { flags, isReady, getFlag } = rollgate;
 *   const newFeature = getFlag('new-feature');
 * </script>
 *
 * {#if $isReady}
 *   {#if $newFeature}
 *     <NewFeature />
 *   {/if}
 * {:else}
 *   Loading...
 * {/if}
 * ```
 */
export function createRollgate(options: CreateRollgateOptions): RollgateStores {
  // Configuration
  const apiKey = options.apiKey;
  const baseUrl = options.baseUrl || 'https://api.rollgate.io';
  const sseUrl = options.sseUrl || baseUrl;
  const refreshInterval = options.refreshInterval ?? 30000;
  const enableStreaming = options.enableStreaming ?? options.streaming ?? false;
  const timeout = options.timeout ?? 5000;
  const retryConfig: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...options.retry };
  const circuitBreakerConfig: CircuitBreakerConfig = {
    ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
    ...options.circuitBreaker,
  };
  const cacheConfig: CacheConfig = { ...DEFAULT_CACHE_CONFIG, ...options.cache };

  // Create instances
  const metrics = createMetrics();
  const circuitBreaker = new CircuitBreaker(circuitBreakerConfig);
  const cache = new FlagCache(cacheConfig);
  const dedup = new RequestDeduplicator();

  // Create writable stores
  const flagsStore: Writable<Record<string, boolean>> = writable({});
  const isReadyStore: Writable<boolean> = writable(false);
  const isLoadingStore: Writable<boolean> = writable(true);
  const isStaleStore: Writable<boolean> = writable(false);
  const errorStore: Writable<Error | null> = writable(null);
  const circuitStateStore: Writable<CircuitState> = writable(CircuitState.CLOSED);

  let currentUser: UserContext | undefined = options.user;
  let eventSource: EventSource | null = null;
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let lastETag: string | null = null;

  // Track circuit state changes
  circuitBreaker.on('state-change', (data) => {
    if (!data?.to) return;
    circuitStateStore.set(data.to);
    let metricsState: 'closed' | 'open' | 'half-open' = 'closed';
    if (data.to === CircuitState.OPEN) metricsState = 'open';
    else if (data.to === CircuitState.HALF_OPEN) metricsState = 'half-open';
    metrics.recordCircuitStateChange(metricsState);
  });

  // Load cached flags
  cache.load();
  const cached = cache.get();
  if (cached) {
    flagsStore.set(cached.flags);
    isStaleStore.set(cached.stale);
  }

  // Fetch flags function
  const fetchFlags = async () => {
    return dedup.dedupe('fetch-flags', async () => {
      const url = new URL(`${baseUrl}/api/v1/sdk/flags`);
      const endpoint = '/api/v1/sdk/flags';
      const startTime = Date.now();
      let statusCode = 0;

      if (currentUser?.id) {
        url.searchParams.set('user_id', currentUser.id);
      }

      if (!circuitBreaker.isAllowingRequests()) {
        console.warn('[Rollgate] Circuit breaker is open, using cached flags');
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
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                ...traceHeaders,
              };
              if (lastETag) {
                headers['If-None-Match'] = lastETag;
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

              const newETag = response.headers.get('ETag');
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
          isLoadingStore.set(false);
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

        flagsStore.set(flagsData);
        isStaleStore.set(false);
        errorStore.set(null);
        isReadyStore.set(true);
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
          console.warn('[Rollgate] Circuit breaker is open:', err.message);
        } else if (classifiedError.category === ErrorCategory.AUTH) {
          console.error('[Rollgate] Authentication error:', classifiedError.message);
        } else if (classifiedError.category === ErrorCategory.RATE_LIMIT) {
          console.warn('[Rollgate] Rate limited:', classifiedError.message);
        } else {
          console.error('[Rollgate] Error fetching flags:', classifiedError.message);
        }

        useCachedFallback();
        errorStore.set(classifiedError);
      } finally {
        isLoadingStore.set(false);
      }
    });

    function useCachedFallback() {
      const cached = cache.get();
      if (cached) {
        flagsStore.set(cached.flags);
        isStaleStore.set(cached.stale);
      }
    }
  };

  // Setup SSE streaming
  const setupSSE = () => {
    if (!enableStreaming) return;

    const url = new URL(`${sseUrl}/api/v1/sdk/stream`);
    url.searchParams.set('token', apiKey);
    if (currentUser?.id) {
      url.searchParams.set('user_id', currentUser.id);
    }

    eventSource = new EventSource(url.toString());

    eventSource.addEventListener('init', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as FlagsResponse;
        flagsStore.set(data.flags || {});
        isLoadingStore.set(false);
        errorStore.set(null);
        isReadyStore.set(true);
      } catch (e) {
        console.error('[Rollgate] Failed to parse init event:', e);
      }
    });

    eventSource.addEventListener('flag-changed', () => {
      fetchFlags();
    });

    eventSource.addEventListener('flag-update', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as { key: string; enabled: boolean };
        flagsStore.update((flags) => ({ ...flags, [data.key]: data.enabled }));
      } catch (e) {
        console.error('[Rollgate] Failed to parse flag-update event:', e);
      }
    });

    eventSource.onerror = () => {
      console.warn('[Rollgate] SSE connection error');
      errorStore.set(new Error('SSE connection error'));
    };
  };

  // Setup polling
  const setupPolling = () => {
    if (enableStreaming) return;

    if (refreshInterval > 0) {
      pollInterval = setInterval(fetchFlags, refreshInterval);
    }
  };

  // Cleanup function
  const closeConnections = () => {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  };

  // Initialize
  if (enableStreaming) {
    setupSSE();
  } else {
    fetchFlags();
    setupPolling();
  }

  // Get current flags value (for non-reactive access)
  let currentFlags: Record<string, boolean> = {};
  flagsStore.subscribe((flags) => {
    currentFlags = flags;
  });

  return {
    flags: { subscribe: flagsStore.subscribe },
    isReady: { subscribe: isReadyStore.subscribe },
    isLoading: { subscribe: isLoadingStore.subscribe },
    isStale: { subscribe: isStaleStore.subscribe },
    error: { subscribe: errorStore.subscribe },
    circuitState: { subscribe: circuitStateStore.subscribe },

    isEnabled: (flagKey: string, defaultValue = false): boolean => {
      const startTime = performance.now();
      const result = currentFlags[flagKey] ?? defaultValue;
      const evaluationTime = performance.now() - startTime;
      metrics.recordEvaluation(flagKey, result, evaluationTime);
      return result;
    },

    getFlag: (flagKey: string, defaultValue = false): Readable<boolean> => {
      return derived(flagsStore, ($flags) => $flags[flagKey] ?? defaultValue);
    },

    identify: async (user: UserContext): Promise<void> => {
      currentUser = user;

      if (enableStreaming && eventSource) {
        closeConnections();
        setupSSE();
      } else {
        await fetchFlags();
      }
    },

    reset: async (): Promise<void> => {
      currentUser = undefined;

      if (enableStreaming && eventSource) {
        closeConnections();
        setupSSE();
      } else {
        await fetchFlags();
      }
    },

    refresh: async (): Promise<void> => {
      await fetchFlags();
    },

    getMetrics: (): MetricsSnapshot => {
      return metrics.snapshot();
    },

    destroy: (): void => {
      closeConnections();
    },
  };
}

export { CircuitState } from '@rollgate/sdk-core';
