// Main exports
export {
  createRollgate,
  type RollgateStores,
  type RollgateConfig,
  type UserContext,
  type CreateRollgateOptions,
} from './rollgate';
export { getFlag, getFlags, getRollgate } from './context';

// Re-export types from sdk-core
export {
  CircuitState,
  RollgateError,
  AuthenticationError,
  ValidationError,
  NetworkError,
  RateLimitError,
  InternalError,
  ErrorCategory,
} from '@rollgate/sdk-core';
export type {
  RetryConfig,
  CircuitBreakerConfig,
  CacheConfig,
  MetricsSnapshot,
} from '@rollgate/sdk-core';
