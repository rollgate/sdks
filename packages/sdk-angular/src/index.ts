// Main exports
export { RollgateModule } from "./lib/rollgate.module";
export { RollgateService, UserContext } from "./lib/rollgate.service";
export {
  ROLLGATE_CONFIG,
  RollgateConfig,
  RollgateModuleConfig,
} from "./lib/rollgate.config";
export { FlagDirective } from "./lib/flag.directive";

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
} from "@rollgate/sdk-core";
export type {
  RetryConfig,
  CircuitBreakerConfig,
  CacheConfig,
  MetricsSnapshot,
} from "@rollgate/sdk-core";
