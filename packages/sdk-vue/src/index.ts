export { RollgatePlugin } from "./plugin";
export type {
  RollgatePluginOptions,
  RollgateConfig,
  UserContext,
} from "./plugin";
export { useRollgate } from "./useRollgate";
export type { UseRollgateReturn } from "./useRollgate";
export { useFlag } from "./useFlag";
export { useFlags } from "./useFlags";
export { provideRollgate, injectRollgate, ROLLGATE_KEY } from "./context";
export type { RollgateContext } from "./context";

// Re-export types from sdk-core
export { CircuitState } from "@rollgate/sdk-core";
export type {
  RetryConfig,
  CircuitBreakerConfig,
  CacheConfig,
  MetricsSnapshot,
  FlagEvaluationMetrics,
  FlagStats,
  TimeWindowMetrics,
  WindowedStats,
} from "@rollgate/sdk-core";
