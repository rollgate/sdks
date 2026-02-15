/**
 * Rollgate SDK Core
 *
 * Shared utilities for all Rollgate SDKs:
 * - Cache with stale-while-revalidate
 * - Circuit breaker for resilience
 * - Retry with exponential backoff
 * - Request deduplication
 * - Error classification
 * - Metrics collection
 * - Distributed tracing
 */

// Cache
export { FlagCache, DEFAULT_CACHE_CONFIG } from "./cache";
export type { CacheConfig, CacheStats } from "./cache";

// Circuit Breaker
export {
  CircuitBreaker,
  CircuitState,
  CircuitOpenError,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
} from "./circuit-breaker";
export type { CircuitBreakerConfig } from "./circuit-breaker";

// Retry
export {
  fetchWithRetry,
  calculateBackoff,
  isRetryableError,
  DEFAULT_RETRY_CONFIG,
} from "./retry";
export type { RetryConfig, RetryResult } from "./retry";

// Dedup
export { RequestDeduplicator } from "./dedup";

// Errors
export {
  RollgateError,
  AuthenticationError,
  ValidationError,
  NotFoundError,
  RateLimitError,
  NetworkError,
  InternalError,
  ErrorCategory,
  ErrorCode,
  isRetryable,
  isAuthError,
  isValidationError,
  isNotFoundError,
  isRateLimitError,
  isNetworkError,
  isInternalError,
  classifyError,
} from "./errors";
export type { APIErrorResponse } from "./errors";

// Metrics
export { SDKMetrics, getMetrics, createMetrics } from "./metrics";
export type {
  MetricsSnapshot,
  FlagEvaluationMetrics,
  FlagStats,
  TimeWindowMetrics,
  WindowedStats,
  RequestMetrics,
  FlagEvaluationRecord,
} from "./metrics";

// Tracing
export {
  createTraceContext,
  createChildSpan,
  getTraceHeaders,
  parseTraceHeaders,
  parseTraceparent,
  formatTraceContext,
  createRequestTrace,
  completeRequestTrace,
  generateTraceId,
  generateSpanId,
  generateRequestId,
  TraceHeaders,
} from "./tracing";
export type { TraceContext, RequestTrace } from "./tracing";

// Types
export { DEFAULT_SDK_CONFIG } from "./types";
export type {
  UserContext,
  FlagConfig,
  FlagsResponse,
  SDKConfig,
  SDKEvent,
  SDKEventHandler,
  FlagChangeEvent,
  FlagsChangedEvent,
  ErrorEvent,
} from "./types";

// Evaluation Reasons
export {
  offReason,
  targetMatchReason,
  ruleMatchReason,
  fallthroughReason,
  errorReason,
  unknownReason,
} from "./reasons";
export type {
  EvaluationReasonKind,
  EvaluationReason,
  EvaluationErrorKind,
  EvaluationDetail,
} from "./reasons";

// Analytics Events
export {
  createFeatureEvent,
  createIdentifyEvent,
  createCustomEvent,
  EventCollector,
  DEFAULT_EVENT_COLLECTOR_CONFIG,
} from "./events";
export type {
  AnalyticsEventKind,
  BaseAnalyticsEvent,
  FeatureEvent,
  IdentifyEvent,
  CustomEvent,
  AnalyticsEvent,
  AnalyticsPayload,
  EvaluationStats,
  EventBuffer,
  EventCollectorConfig,
  TrackEventOptions,
} from "./events";
