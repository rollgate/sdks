/**
 * Rollgate React Native Client
 *
 * Feature flags client for React Native apps. Uses AsyncStorage for persistence
 * and polling for updates (SSE not supported in React Native without polyfill).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  fetchWithRetry,
  DEFAULT_RETRY_CONFIG,
  CircuitBreaker,
  CircuitState,
  CircuitOpenError,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  RequestDeduplicator,
  RollgateError,
  ErrorCategory,
  classifyError,
  createMetrics,
  createTraceContext,
  getTraceHeaders,
} from "@rollgate/sdk-core";
import type {
  RetryConfig,
  CircuitBreakerConfig,
  CacheConfig,
  SDKMetrics,
  MetricsSnapshot,
} from "@rollgate/sdk-core";

// Re-export types from core
export type { RetryConfig, CircuitBreakerConfig, CacheConfig, MetricsSnapshot };
export { CircuitState, CircuitOpenError, RollgateError, ErrorCategory };

const CACHE_KEY = "@rollgate/flags";

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
  /** Polling interval in ms (default: 30000). Set to 0 to disable polling. */
  refreshInterval?: number;
  /** Request timeout in milliseconds (default: 10000 - longer for mobile) */
  timeout?: number;
  /** Retry configuration */
  retry?: Partial<RetryConfig>;
  /** Circuit breaker configuration */
  circuitBreaker?: Partial<CircuitBreakerConfig>;
  /** Cache configuration */
  cache?: Partial<CacheConfig>;
  /** Time to wait for initialization in ms (default: 10000 - longer for mobile) */
  startWaitTimeMs?: number;
  /** If true, initialization won't throw on failure (default: true for mobile) */
  initCanFail?: boolean;
}

interface FlagsResponse {
  flags: Record<string, boolean>;
  flagValues?: Record<string, unknown>;
}

interface CachedData {
  flags: Record<string, boolean>;
  flagValues?: Record<string, unknown>;
  timestamp: number;
}

type EventCallback = (...args: unknown[]) => void;

const DEFAULT_CACHE_CONFIG_RN: CacheConfig = {
  ttl: 5 * 60 * 1000, // 5 minutes
  staleTtl: 60 * 60 * 1000, // 1 hour
};

/**
 * Rollgate React Native Client
 *
 * Main SDK client for React Native environments.
 */
export class RollgateReactNativeClient {
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
      timeout: options.timeout ?? 10000, // Longer timeout for mobile
      startWaitTimeMs: options.startWaitTimeMs ?? 10000,
      initCanFail: options.initCanFail ?? true, // Default true for mobile
      retry: { ...DEFAULT_RETRY_CONFIG, ...options.retry },
      circuitBreaker: {
        ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
        ...options.circuitBreaker,
      },
      cache: { ...DEFAULT_CACHE_CONFIG_RN, ...options.cache },
    };

    this.circuitBreaker = new CircuitBreaker(this.options.circuitBreaker);
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
      await this.loadFromCache();

      // Fetch fresh flags
      await this.fetchFlags();

      // Start polling if configured
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
      }
    }
  }

  /**
   * Load flags from AsyncStorage cache
   */
  private async loadFromCache(): Promise<void> {
    try {
      const cached = await AsyncStorage.getItem(CACHE_KEY);
      if (cached) {
        const data: CachedData = JSON.parse(cached);
        const now = Date.now();
        const age = now - data.timestamp;

        // Check if cache is still valid
        if (age < this.options.cache.staleTtl) {
          this.flags = new Map(Object.entries(data.flags));
          if (data.flagValues) {
            this.flagValues = new Map(Object.entries(data.flagValues));
          }
          this.cacheTimestamp = data.timestamp;
        }
      }
    } catch (error) {
      // Ignore cache errors
      console.warn("[Rollgate] Failed to load cache:", error);
    }
  }

  /**
   * Save flags to AsyncStorage cache
   */
  private async saveToCache(): Promise<void> {
    try {
      const data: CachedData = {
        flags: Object.fromEntries(this.flags),
        flagValues: Object.fromEntries(this.flagValues),
        timestamp: Date.now(),
      };
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(data));
      this.cacheTimestamp = data.timestamp;
    } catch (error) {
      // Ignore cache errors
      console.warn("[Rollgate] Failed to save cache:", error);
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
    const startTime = Date.now();
    const result = this.flags.get(flagKey) ?? defaultValue;
    const evaluationTime = Date.now() - startTime;
    this.metrics.recordEvaluation(flagKey, result, evaluationTime);
    return result;
  }

  /**
   * Alias for isEnabled (LaunchDarkly compatibility)
   */
  boolVariation(flagKey: string, defaultValue: boolean = false): boolean {
    return this.isEnabled(flagKey, defaultValue);
  }

  /**
   * Get a typed flag value
   */
  getValue<T>(flagKey: string, defaultValue: T): T {
    const value = this.flagValues.get(flagKey);

    if (value === undefined) {
      return defaultValue;
    }

    return value as T;
  }

  /**
   * Get a string flag value
   */
  getString(flagKey: string, defaultValue: string = ""): string {
    return this.getValue<string>(flagKey, defaultValue);
  }

  /**
   * Get a number flag value
   */
  getNumber(flagKey: string, defaultValue: number = 0): number {
    return this.getValue<number>(flagKey, defaultValue);
  }

  /**
   * Get a JSON flag value
   */
  getJSON<T>(flagKey: string, defaultValue: T): T {
    return this.getValue<T>(flagKey, defaultValue);
  }

  /**
   * Get all flags as an object
   */
  allFlags(): Record<string, boolean> {
    return Object.fromEntries(this.flags);
  }

  /**
   * Get all typed flag values as an object
   */
  allFlagValues(): Record<string, unknown> {
    return Object.fromEntries(this.flagValues);
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
    // No-op - RN SDK doesn't batch events yet
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

    // Clean up all internal components to prevent memory leaks
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

  private async fetchFlags(): Promise<void> {
    return this.dedup.dedupe("fetch-flags", async () => {
      const url = new URL(`${this.options.baseUrl}/api/v1/sdk/flags`);
      const startTime = Date.now();

      if (this.userContext?.id) {
        url.searchParams.set("user_id", this.userContext.id);
      }

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

        // Save to cache
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
    // Flags are already loaded from cache during initialization
    // Just emit the current flags
    if (this.flags.size > 0) {
      this.emit("flags-updated", this.allFlags());
    }
  }
}

/**
 * Create a new Rollgate React Native client
 *
 * @param apiKey - Your Rollgate API key
 * @param initialContext - Initial user context (can be null)
 * @param options - SDK configuration options
 * @returns A new RollgateReactNativeClient instance
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
): RollgateReactNativeClient {
  return new RollgateReactNativeClient(apiKey, initialContext, options);
}

export default createClient;
