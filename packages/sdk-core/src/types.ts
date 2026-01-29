/**
 * Shared types for Rollgate SDKs
 */

/**
 * User context for targeting rules evaluation
 */
export interface UserContext {
  /** Unique user identifier */
  id: string;
  /** User email (optional) */
  email?: string;
  /** User name (optional) */
  name?: string;
  /** Custom attributes for targeting rules */
  attributes?: Record<string, string | number | boolean>;
}

/**
 * Flag configuration from API
 */
export interface FlagConfig {
  key: string;
  enabled: boolean;
  value?: unknown;
}

/**
 * Response from flags API endpoint
 */
export interface FlagsResponse {
  flags: Record<string, boolean>;
  etag?: string;
}

/**
 * SDK configuration options
 */
export interface SDKConfig {
  /** API key for authentication */
  apiKey: string;
  /** Base URL for the API (default: https://api.rollgate.io) */
  baseUrl?: string;
  /** SSE URL for real-time updates (optional) */
  sseUrl?: string;
  /** Request timeout in milliseconds (default: 10000) */
  timeout?: number;
  /** Polling interval in milliseconds (default: 30000) */
  pollingInterval?: number;
  /** Enable real-time updates via SSE (default: false) */
  enableSSE?: boolean;
  /** Enable request deduplication (default: true) */
  enableDedup?: boolean;
  /** Enable circuit breaker (default: true) */
  enableCircuitBreaker?: boolean;
  /** Enable caching (default: true) */
  enableCache?: boolean;
  /** Enable metrics collection (default: true) */
  enableMetrics?: boolean;
  /** Enable distributed tracing (default: false) */
  enableTracing?: boolean;
}

/**
 * Default SDK configuration
 */
export const DEFAULT_SDK_CONFIG: Required<
  Omit<SDKConfig, "apiKey" | "sseUrl">
> = {
  baseUrl: "https://api.rollgate.io",
  timeout: 10000,
  pollingInterval: 30000,
  enableSSE: false,
  enableDedup: true,
  enableCircuitBreaker: true,
  enableCache: true,
  enableMetrics: true,
  enableTracing: false,
};

/**
 * SDK event types
 */
export type SDKEvent =
  | "ready"
  | "error"
  | "flags-changed"
  | "flag-updated"
  | "connection-established"
  | "connection-lost"
  | "circuit-open"
  | "circuit-closed";

/**
 * SDK event handler
 */
export type SDKEventHandler<T = unknown> = (data: T) => void;

/**
 * Flag change event data
 */
export interface FlagChangeEvent {
  key: string;
  previousValue: boolean;
  newValue: boolean;
  timestamp: number;
}

/**
 * Flags changed event data
 */
export interface FlagsChangedEvent {
  flags: Record<string, boolean>;
  changes: FlagChangeEvent[];
  timestamp: number;
}

/**
 * Error event data
 */
export interface ErrorEvent {
  error: Error;
  context?: string;
  timestamp: number;
}
