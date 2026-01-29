import { InjectionToken } from "@angular/core";
import type {
  RetryConfig,
  CircuitBreakerConfig,
  CacheConfig,
} from "@rollgate/sdk-core";

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

export interface RollgateModuleConfig extends RollgateConfig {
  /** Initial user context for targeting */
  user?: UserContext;
}

export const ROLLGATE_CONFIG = new InjectionToken<RollgateModuleConfig>(
  "ROLLGATE_CONFIG",
);
