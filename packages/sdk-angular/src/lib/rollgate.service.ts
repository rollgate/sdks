import { Injectable, Inject, OnDestroy, Optional } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { ROLLGATE_CONFIG, type RollgateModuleConfig } from './rollgate.config';
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
  SDKMetrics,
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

interface FlagsResponse {
  flags: Record<string, boolean>;
}

@Injectable({
  providedIn: 'root',
})
export class RollgateService implements OnDestroy {
  private initialized = false;

  private readonly _flags$ = new BehaviorSubject<Record<string, boolean>>({});
  private readonly _isReady$ = new BehaviorSubject<boolean>(false);
  private readonly _isLoading$ = new BehaviorSubject<boolean>(true);
  private readonly _isStale$ = new BehaviorSubject<boolean>(false);
  private readonly _error$ = new BehaviorSubject<Error | null>(null);
  private readonly _circuitState$ = new BehaviorSubject<CircuitState>(CircuitState.CLOSED);

  // Internal state
  private currentUser: UserContext | undefined;
  private eventSource: EventSource | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private lastETag: string | null = null;

  // Instances
  private metrics: SDKMetrics | null = null;
  private circuitBreaker: CircuitBreaker | null = null;
  private cache: FlagCache | null = null;
  private dedup: RequestDeduplicator | null = null;

  // Config
  private apiKey = '';
  private baseUrl = 'https://api.rollgate.io';
  private sseUrl = '';
  private refreshInterval = 30000;
  private enableStreaming = false;
  private timeout = 5000;
  private retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG;

  /**
   * Observable of all flag values
   */
  readonly flags$: Observable<Record<string, boolean>> = this._flags$.asObservable();

  /**
   * Observable of ready state
   */
  readonly isReady$: Observable<boolean> = this._isReady$.asObservable();

  /**
   * Observable of loading state
   */
  readonly isLoading$: Observable<boolean> = this._isLoading$.asObservable();

  /**
   * Observable of stale state
   */
  readonly isStale$: Observable<boolean> = this._isStale$.asObservable();

  /**
   * Observable of error state
   */
  readonly error$: Observable<Error | null> = this._error$.asObservable();

  /**
   * Observable of circuit breaker state
   */
  readonly circuitState$: Observable<CircuitState> = this._circuitState$.asObservable();

  constructor(@Optional() @Inject(ROLLGATE_CONFIG) private config?: RollgateModuleConfig) {
    if (this.config) {
      this.init(this.config);
    }
  }

  /**
   * Initialize the Rollgate client
   */
  async init(config: RollgateModuleConfig): Promise<void> {
    if (this.initialized) {
      console.warn('[Rollgate] Already initialized');
      return;
    }

    // Store config
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.rollgate.io';
    this.sseUrl = config.sseUrl || this.baseUrl;
    this.refreshInterval = config.refreshInterval ?? 30000;
    this.enableStreaming = config.enableStreaming ?? config.streaming ?? false;
    this.timeout = config.timeout ?? 5000;
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config.retry };
    this.currentUser = config.user;

    const circuitBreakerConfig: CircuitBreakerConfig = {
      ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
      ...config.circuitBreaker,
    };
    const cacheConfig: CacheConfig = { ...DEFAULT_CACHE_CONFIG, ...config.cache };

    // Create instances
    this.metrics = createMetrics();
    this.circuitBreaker = new CircuitBreaker(circuitBreakerConfig);
    this.cache = new FlagCache(cacheConfig);
    this.dedup = new RequestDeduplicator();

    // Track circuit state changes
    this.circuitBreaker.on('state-change', (data) => {
      if (!data?.to) return;
      this._circuitState$.next(data.to);
      if (this.metrics) {
        let metricsState: 'closed' | 'open' | 'half-open' = 'closed';
        if (data.to === CircuitState.OPEN) metricsState = 'open';
        else if (data.to === CircuitState.HALF_OPEN) metricsState = 'half-open';
        this.metrics.recordCircuitStateChange(metricsState);
      }
    });

    // Load cached flags
    this.cache.load();
    const cached = this.cache.get();
    if (cached) {
      this._flags$.next(cached.flags);
      this._isStale$.next(cached.stale);
    }

    // Initialize
    if (this.enableStreaming) {
      this.setupSSE();
    } else {
      await this.fetchFlags();
      this.setupPolling();
    }

    this.initialized = true;
  }

  private async fetchFlags(): Promise<void> {
    if (!this.dedup || !this.circuitBreaker || !this.cache || !this.metrics) return;

    return this.dedup.dedupe('fetch-flags', async () => {
      const url = new URL(`${this.baseUrl}/api/v1/sdk/flags`);
      const endpoint = '/api/v1/sdk/flags';
      const startTime = Date.now();
      let statusCode = 0;

      if (this.currentUser?.id) {
        url.searchParams.set('user_id', this.currentUser.id);
      }

      if (!this.circuitBreaker!.isAllowingRequests()) {
        console.warn('[Rollgate] Circuit breaker is open, using cached flags');
        this.useCachedFallback();
        return;
      }

      try {
        const data = await this.circuitBreaker!.execute(async () => {
          const result = await fetchWithRetry(async () => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeout);

            try {
              const traceContext = createTraceContext();
              const traceHeaders = getTraceHeaders(traceContext);

              const headers: Record<string, string> = {
                Authorization: `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
                ...traceHeaders,
              };
              if (this.lastETag) {
                headers['If-None-Match'] = this.lastETag;
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
                this.lastETag = newETag;
              }

              return (await response.json()) as FlagsResponse;
            } finally {
              clearTimeout(timeoutId);
            }
          }, this.retryConfig);

          if (!result.success) {
            throw result.error;
          }

          return result.data;
        });

        if (data === null) {
          this.metrics!.recordRequest({
            endpoint,
            statusCode: 304,
            latencyMs: Date.now() - startTime,
            cacheHit: true,
            notModified: true,
          });
          this._isLoading$.next(false);
          return;
        }

        this.metrics!.recordRequest({
          endpoint,
          statusCode: statusCode || 200,
          latencyMs: Date.now() - startTime,
          cacheHit: false,
          notModified: false,
        });

        const flagsData = (data as FlagsResponse).flags || {};
        this.cache!.set(flagsData);

        this._flags$.next(flagsData);
        this._isStale$.next(false);
        this._error$.next(null);
        this._isReady$.next(true);
      } catch (err) {
        const classifiedError: RollgateError =
          err instanceof RollgateError ? err : classifyError(err);

        this.metrics!.recordRequest({
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

        this.useCachedFallback();
        this._error$.next(classifiedError);
      } finally {
        this._isLoading$.next(false);
      }
    });
  }

  private useCachedFallback(): void {
    if (!this.cache) return;
    const cached = this.cache.get();
    if (cached) {
      this._flags$.next(cached.flags);
      this._isStale$.next(cached.stale);
    }
  }

  private setupSSE(): void {
    if (!this.enableStreaming) return;

    const url = new URL(`${this.sseUrl}/api/v1/sdk/stream`);
    url.searchParams.set('token', this.apiKey);
    if (this.currentUser?.id) {
      url.searchParams.set('user_id', this.currentUser.id);
    }

    this.eventSource = new EventSource(url.toString());

    this.eventSource.addEventListener('init', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as FlagsResponse;
        this._flags$.next(data.flags || {});
        this._isLoading$.next(false);
        this._error$.next(null);
        this._isReady$.next(true);
      } catch (e) {
        console.error('[Rollgate] Failed to parse init event:', e);
      }
    });

    this.eventSource.addEventListener('flag-changed', () => {
      this.fetchFlags();
    });

    this.eventSource.addEventListener('flag-update', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as { key: string; enabled: boolean };
        const current = this._flags$.value;
        this._flags$.next({ ...current, [data.key]: data.enabled });
      } catch (e) {
        console.error('[Rollgate] Failed to parse flag-update event:', e);
      }
    });

    this.eventSource.onerror = () => {
      console.warn('[Rollgate] SSE connection error');
      this._error$.next(new Error('SSE connection error'));
    };
  }

  private setupPolling(): void {
    if (this.enableStreaming) return;

    if (this.refreshInterval > 0) {
      this.pollInterval = setInterval(() => this.fetchFlags(), this.refreshInterval);
    }
  }

  private closeConnections(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Check if a flag is enabled
   */
  isEnabled(flagKey: string, defaultValue = false): boolean {
    const startTime = performance.now();
    const result = this._flags$.value[flagKey] ?? defaultValue;
    const evaluationTime = performance.now() - startTime;
    this.metrics?.recordEvaluation(flagKey, result, evaluationTime);
    return result;
  }

  /**
   * Get observable for a specific flag
   */
  getFlag$(flagKey: string, defaultValue = false): Observable<boolean> {
    return new Observable<boolean>((subscriber) => {
      const subscription = this._flags$.subscribe((flags) => {
        subscriber.next(flags[flagKey] ?? defaultValue);
      });
      return () => subscription.unsubscribe();
    });
  }

  /**
   * Get all flags
   */
  getAllFlags(): Record<string, boolean> {
    return this._flags$.value;
  }

  /**
   * Set user context and refresh flags
   */
  async identify(user: UserContext): Promise<void> {
    this.currentUser = user;

    if (this.enableStreaming && this.eventSource) {
      this.closeConnections();
      this.setupSSE();
    } else {
      await this.fetchFlags();
    }
  }

  /**
   * Clear user context and refresh flags
   */
  async reset(): Promise<void> {
    this.currentUser = undefined;

    if (this.enableStreaming && this.eventSource) {
      this.closeConnections();
      this.setupSSE();
    } else {
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
   * Get metrics snapshot
   */
  getMetrics(): MetricsSnapshot | null {
    return this.metrics?.snapshot() ?? null;
  }

  /**
   * Get circuit breaker state
   */
  getCircuitState(): CircuitState {
    return this._circuitState$.value;
  }

  ngOnDestroy(): void {
    this.closeConnections();
    this._flags$.complete();
    this._isReady$.complete();
    this._isLoading$.complete();
    this._isStale$.complete();
    this._error$.complete();
    this._circuitState$.complete();
  }
}

// Re-export types
export { CircuitState } from '@rollgate/sdk-core';
