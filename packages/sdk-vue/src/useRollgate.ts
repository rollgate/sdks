import { inject, type ComputedRef, computed } from "vue";
import type { CircuitState, MetricsSnapshot } from "@rollgate/sdk-core";
import type { UserContext } from "./plugin";
import type { RollgateContext } from "./context";

export interface UseRollgateReturn {
  /**
   * All current flag values
   */
  flags: ComputedRef<Record<string, boolean>>;

  /**
   * Whether the client is ready
   */
  isReady: ComputedRef<boolean>;

  /**
   * Whether flags are being loaded
   */
  isLoading: ComputedRef<boolean>;

  /**
   * Whether flags are stale (from cache)
   */
  isStale: ComputedRef<boolean>;

  /**
   * Current error, if any
   */
  error: ComputedRef<Error | null>;

  /**
   * Current circuit breaker state
   */
  circuitState: ComputedRef<CircuitState>;

  /**
   * Check if a flag is enabled
   */
  isEnabled: (flagKey: string, defaultValue?: boolean) => boolean;

  /**
   * Set user context and refresh flags
   */
  identify: (user: UserContext) => Promise<void>;

  /**
   * Clear user context and refresh flags
   */
  reset: () => Promise<void>;

  /**
   * Force refresh flags
   */
  refresh: () => Promise<void>;

  /**
   * Get metrics snapshot
   */
  getMetrics: () => MetricsSnapshot;
}

export function useRollgate(): UseRollgateReturn {
  const context = inject<RollgateContext>("rollgate");

  if (!context) {
    throw new Error(
      "[Rollgate] No Rollgate context found. Did you install the RollgatePlugin?",
    );
  }

  return {
    flags: computed(() => context.flags.value),
    isReady: computed(() => context.isReady.value),
    isLoading: computed(() => context.isLoading.value),
    isStale: computed(() => context.isStale.value),
    error: computed(() => context.error.value),
    circuitState: computed(() => context.circuitState.value),

    isEnabled: (flagKey: string, defaultValue = false): boolean => {
      return context.isEnabled(flagKey, defaultValue);
    },

    identify: async (user: UserContext): Promise<void> => {
      await context.identify(user);
    },

    reset: async (): Promise<void> => {
      await context.reset();
    },

    refresh: async (): Promise<void> => {
      await context.refresh();
    },

    getMetrics: (): MetricsSnapshot => {
      return context.getMetrics();
    },
  };
}
