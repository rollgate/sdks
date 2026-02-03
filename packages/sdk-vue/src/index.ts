/**
 * Rollgate Vue SDK
 *
 * Thin wrapper around @rollgate/sdk-browser providing Vue-specific bindings:
 * - RollgatePlugin (Vue plugin)
 * - useFlag, useFlags composables
 * - provide/inject pattern
 *
 * All HTTP, caching, circuit breaker logic is delegated to sdk-browser.
 */
import {
  inject,
  provide,
  ref,
  computed,
  onMounted,
  onUnmounted,
  type Ref,
  type ComputedRef,
  type App,
  type InjectionKey,
} from "vue";
import {
  createClient,
  RollgateBrowserClient,
  CircuitState,
} from "@rollgate/sdk-browser";
import type {
  UserContext,
  RollgateOptions,
  MetricsSnapshot,
  EvaluationReason,
  EvaluationDetail,
} from "@rollgate/sdk-browser";

// Re-export types from sdk-browser
export type {
  UserContext,
  RollgateOptions,
  MetricsSnapshot,
  EvaluationReason,
  EvaluationDetail,
} from "@rollgate/sdk-browser";
export {
  CircuitState,
  CircuitOpenError,
  RollgateError,
  ErrorCategory,
} from "@rollgate/sdk-browser";

/**
 * Vue SDK configuration
 */
export interface RollgateConfig extends RollgateOptions {
  /** Your Rollgate API key */
  apiKey: string;
}

/**
 * Rollgate context value provided to components
 */
export interface RollgateContext {
  /** Check if a flag is enabled */
  isEnabled: (flagKey: string, defaultValue?: boolean) => boolean;
  /** Reactive loading state */
  isLoading: Ref<boolean>;
  /** Reactive error state */
  isError: Ref<boolean>;
  /** Reactive stale state */
  isStale: Ref<boolean>;
  /** Reactive circuit breaker state */
  circuitState: Ref<CircuitState>;
  /** Reactive flags object */
  flags: Ref<Record<string, boolean>>;
  /** Change user context */
  identify: (user: UserContext) => Promise<void>;
  /** Clear user context */
  reset: () => Promise<void>;
  /** Force refresh flags */
  refresh: () => Promise<void>;
  /** Get metrics snapshot */
  getMetrics: () => MetricsSnapshot;
  /** Underlying browser client */
  client: RollgateBrowserClient | null;
}

/** Injection key for Rollgate context */
export const ROLLGATE_KEY: InjectionKey<RollgateContext> = Symbol("rollgate");

/**
 * Create Rollgate context from config
 */
function createRollgateContext(
  config: RollgateConfig,
  initialUser?: UserContext,
): RollgateContext {
  const flags = ref<Record<string, boolean>>({});
  const isLoading = ref(true);
  const isError = ref(false);
  const isStale = ref(false);
  const circuitState = ref<CircuitState>(CircuitState.CLOSED);

  let client: RollgateBrowserClient | null = null;

  const { apiKey, ...options } = config;
  client = createClient(apiKey, initialUser || null, options);

  // Subscribe to client events
  client.on("ready", () => {
    flags.value = client!.allFlags();
    isLoading.value = false;
    isError.value = false;
    isStale.value = false;
  });

  client.on("flags-updated", (newFlags) => {
    flags.value = newFlags as Record<string, boolean>;
    isStale.value = false;
  });

  client.on("error", () => {
    isError.value = true;
    const currentFlags = client!.allFlags();
    if (Object.keys(currentFlags).length > 0) {
      flags.value = currentFlags;
      isStale.value = true;
    }
  });

  client.on("circuit-state-change", (data) => {
    const stateData = data as { to: CircuitState };
    circuitState.value = stateData.to;
  });

  // Wait for initialization
  client.waitForInitialization().catch(() => {
    isError.value = true;
    isLoading.value = false;
  });

  const isEnabled = (
    flagKey: string,
    defaultValue: boolean = false,
  ): boolean => {
    if (client) {
      return client.isEnabled(flagKey, defaultValue);
    }
    return defaultValue;
  };

  const identify = async (user: UserContext): Promise<void> => {
    if (client) {
      await client.identify(user);
    }
  };

  const reset = async (): Promise<void> => {
    if (client) {
      await client.reset();
    }
  };

  const refresh = async (): Promise<void> => {
    if (client) {
      await client.refresh();
    }
  };

  const getMetrics = (): MetricsSnapshot => {
    if (client) {
      return client.getMetrics();
    }
    // Return empty metrics
    return {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      successRate: 0,
      errorRate: 0,
      avgLatencyMs: 0,
      minLatencyMs: 0,
      maxLatencyMs: 0,
      p50LatencyMs: 0,
      p95LatencyMs: 0,
      p99LatencyMs: 0,
      cacheHits: 0,
      cacheMisses: 0,
      cacheHitRate: 0,
      notModifiedResponses: 0,
      errorsByCategory: {},
      circuitOpens: 0,
      circuitCloses: 0,
      circuitState: "closed",
      flagEvaluations: {
        totalEvaluations: 0,
        evaluationsPerFlag: {},
        avgEvaluationTimeMs: 0,
      },
      windows: {
        "1m": { requests: 0, errors: 0, avgLatencyMs: 0, errorRate: 0 },
        "5m": { requests: 0, errors: 0, avgLatencyMs: 0, errorRate: 0 },
        "15m": { requests: 0, errors: 0, avgLatencyMs: 0, errorRate: 0 },
        "1h": { requests: 0, errors: 0, avgLatencyMs: 0, errorRate: 0 },
      },
      uptimeMs: 0,
      lastRequestAt: null,
    };
  };

  return {
    isEnabled,
    isLoading,
    isError,
    isStale,
    circuitState,
    flags,
    identify,
    reset,
    refresh,
    getMetrics,
    client,
  };
}

/**
 * Plugin options
 */
export interface RollgatePluginOptions {
  config: RollgateConfig;
  user?: UserContext;
}

/**
 * Vue plugin for Rollgate
 *
 * @example
 * ```ts
 * import { createApp } from 'vue';
 * import { RollgatePlugin } from '@rollgate/sdk-vue';
 *
 * const app = createApp(App);
 * app.use(RollgatePlugin, {
 *   config: { apiKey: 'your-api-key' },
 *   user: { id: 'user-1' }
 * });
 * ```
 */
export const RollgatePlugin = {
  install(app: App, options: RollgatePluginOptions) {
    const context = createRollgateContext(options.config, options.user);
    app.provide(ROLLGATE_KEY, context);

    // Cleanup on app unmount
    app.config.globalProperties.$rollgateCleanup = () => {
      if (context.client) {
        context.client.close();
      }
    };
  },
};

/**
 * Provide Rollgate context (for Composition API setup without plugin)
 */
export function provideRollgate(
  config: RollgateConfig,
  user?: UserContext,
): RollgateContext {
  const context = createRollgateContext(config, user);
  provide(ROLLGATE_KEY, context);
  return context;
}

/**
 * Inject Rollgate context
 */
export function injectRollgate(): RollgateContext {
  const context = inject(ROLLGATE_KEY);
  if (!context) {
    throw new Error(
      "Rollgate not provided. Use RollgatePlugin or provideRollgate first.",
    );
  }
  return context;
}

/**
 * Composable to check if a flag is enabled
 *
 * @example
 * ```vue
 * <script setup>
 * import { useFlag } from '@rollgate/sdk-vue';
 * const showNewFeature = useFlag('new-feature', false);
 * </script>
 * ```
 */
export function useFlag(
  flagKey: string,
  defaultValue: boolean = false,
): ComputedRef<boolean> {
  const context = injectRollgate();
  return computed(() => context.isEnabled(flagKey, defaultValue));
}

/**
 * Composable to check if a flag is enabled with evaluation reason
 *
 * @example
 * ```vue
 * <script setup>
 * import { useFlagDetail } from '@rollgate/sdk-vue';
 * const { value, reason } = useFlagDetail('new-feature', false);
 * </script>
 * ```
 */
export function useFlagDetail(
  flagKey: string,
  defaultValue: boolean = false,
): ComputedRef<EvaluationDetail<boolean>> {
  const context = injectRollgate();
  return computed(() => {
    if (context.client) {
      return context.client.isEnabledDetail(flagKey, defaultValue);
    }
    return {
      value: defaultValue,
      reason: {
        kind: "ERROR" as const,
        errorKind: "CLIENT_NOT_READY" as const,
      },
    };
  });
}

/**
 * Composable to get multiple flags
 *
 * @example
 * ```vue
 * <script setup>
 * import { useFlags } from '@rollgate/sdk-vue';
 * const flags = useFlags(['feature-a', 'feature-b']);
 * </script>
 * ```
 */
export function useFlags(
  flagKeys: string[],
): ComputedRef<Record<string, boolean>> {
  const context = injectRollgate();
  return computed(() => {
    const result: Record<string, boolean> = {};
    for (const key of flagKeys) {
      result[key] = context.isEnabled(key, false);
    }
    return result;
  });
}

/**
 * Composable to access the full Rollgate context
 *
 * @example
 * ```vue
 * <script setup>
 * import { useRollgate } from '@rollgate/sdk-vue';
 * const { identify, refresh, isLoading } = useRollgate();
 * </script>
 * ```
 */
export function useRollgate(): RollgateContext {
  return injectRollgate();
}
