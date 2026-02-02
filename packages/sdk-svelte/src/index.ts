/**
 * Rollgate Svelte SDK
 *
 * Thin wrapper around @rollgate/sdk-browser providing Svelte-specific bindings:
 * - createRollgate() factory returning Svelte stores
 * - Context API helpers (setRollgateContext, getRollgateContext)
 * - getFlag, getFlags store helpers
 *
 * All HTTP, caching, circuit breaker logic is delegated to sdk-browser.
 */
import {
  writable,
  derived,
  get,
  type Writable,
  type Readable,
} from "svelte/store";
import { getContext, setContext } from "svelte";
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
 * Svelte SDK configuration
 */
export interface RollgateConfig extends RollgateOptions {
  /** Your Rollgate API key */
  apiKey: string;
}

/**
 * Rollgate stores returned by createRollgate()
 */
export interface RollgateStores {
  /** Reactive store of all flags */
  flags: Readable<Record<string, boolean>>;
  /** Reactive loading state */
  isLoading: Readable<boolean>;
  /** Reactive error state */
  isError: Readable<boolean>;
  /** Reactive stale state */
  isStale: Readable<boolean>;
  /** Reactive circuit breaker state */
  circuitState: Readable<CircuitState>;
  /** Reactive ready state */
  isReady: Readable<boolean>;
  /** Check if a flag is enabled (non-reactive) */
  isEnabled: (flagKey: string, defaultValue?: boolean) => boolean;
  /** Check if a flag is enabled with evaluation reason */
  isEnabledDetail: (flagKey: string, defaultValue?: boolean) => EvaluationDetail<boolean>;
  /** Change user context */
  identify: (user: UserContext) => Promise<void>;
  /** Clear user context */
  reset: () => Promise<void>;
  /** Force refresh flags */
  refresh: () => Promise<void>;
  /** Get metrics snapshot */
  getMetrics: () => MetricsSnapshot;
  /** Close the client */
  close: () => void;
  /** Get a reactive store for a single flag */
  flag: (flagKey: string, defaultValue?: boolean) => Readable<boolean>;
}

/** Context key for Rollgate stores */
const ROLLGATE_CONTEXT_KEY = Symbol("rollgate");

/**
 * Create Rollgate stores
 *
 * @example
 * ```svelte
 * <script>
 *   import { createRollgate, setRollgateContext } from '@rollgate/sdk-svelte';
 *
 *   const rollgate = createRollgate({
 *     apiKey: 'your-api-key'
 *   }, { id: 'user-1' });
 *
 *   setRollgateContext(rollgate);
 * </script>
 * ```
 */
export function createRollgate(
  config: RollgateConfig,
  user?: UserContext,
): RollgateStores {
  const { apiKey, ...options } = config;

  const client = createClient(apiKey, user || null, options);

  // Create writable stores
  const flags: Writable<Record<string, boolean>> = writable({});
  const isLoading: Writable<boolean> = writable(true);
  const isError: Writable<boolean> = writable(false);
  const isStale: Writable<boolean> = writable(false);
  const circuitState: Writable<CircuitState> = writable(CircuitState.CLOSED);
  const isReady: Writable<boolean> = writable(false);

  // Subscribe to client events
  client.on("ready", () => {
    flags.set(client.allFlags());
    isLoading.set(false);
    isError.set(false);
    isStale.set(false);
    isReady.set(true);
  });

  client.on("flags-updated", (newFlags) => {
    flags.set(newFlags as Record<string, boolean>);
    isStale.set(false);
  });

  client.on("error", () => {
    isError.set(true);
    const currentFlags = client.allFlags();
    if (Object.keys(currentFlags).length > 0) {
      flags.set(currentFlags);
      isStale.set(true);
    }
  });

  client.on("circuit-state-change", (data) => {
    const stateData = data as { to: CircuitState };
    circuitState.set(stateData.to);
  });

  // Wait for initialization
  client.waitForInitialization().catch(() => {
    isError.set(true);
    isLoading.set(false);
  });

  const isEnabled = (
    flagKey: string,
    defaultValue: boolean = false,
  ): boolean => {
    return client.isEnabled(flagKey, defaultValue);
  };

  const isEnabledDetail = (
    flagKey: string,
    defaultValue: boolean = false,
  ): EvaluationDetail<boolean> => {
    return client.isEnabledDetail(flagKey, defaultValue);
  };

  const identify = async (newUser: UserContext): Promise<void> => {
    await client.identify(newUser);
  };

  const reset = async (): Promise<void> => {
    await client.reset();
  };

  const refresh = async (): Promise<void> => {
    await client.refresh();
  };

  const getMetrics = (): MetricsSnapshot => {
    return client.getMetrics();
  };

  const close = (): void => {
    client.close();
  };

  // Create a derived store for a single flag
  const flag = (
    flagKey: string,
    defaultValue: boolean = false,
  ): Readable<boolean> => {
    return derived(flags, ($flags) => $flags[flagKey] ?? defaultValue);
  };

  return {
    flags: { subscribe: flags.subscribe },
    isLoading: { subscribe: isLoading.subscribe },
    isError: { subscribe: isError.subscribe },
    isStale: { subscribe: isStale.subscribe },
    circuitState: { subscribe: circuitState.subscribe },
    isReady: { subscribe: isReady.subscribe },
    isEnabled,
    isEnabledDetail,
    identify,
    reset,
    refresh,
    getMetrics,
    close,
    flag,
  };
}

/**
 * Set Rollgate context for child components
 *
 * @example
 * ```svelte
 * <script>
 *   import { createRollgate, setRollgateContext } from '@rollgate/sdk-svelte';
 *   const rollgate = createRollgate({ apiKey: 'key' });
 *   setRollgateContext(rollgate);
 * </script>
 * ```
 */
export function setRollgateContext(stores: RollgateStores): void {
  setContext(ROLLGATE_CONTEXT_KEY, stores);
}

/**
 * Get Rollgate context from parent component
 *
 * @example
 * ```svelte
 * <script>
 *   import { getRollgateContext } from '@rollgate/sdk-svelte';
 *   const { flags, isEnabled } = getRollgateContext();
 * </script>
 * ```
 */
export function getRollgateContext(): RollgateStores {
  const stores = getContext<RollgateStores>(ROLLGATE_CONTEXT_KEY);
  if (!stores) {
    throw new Error(
      "Rollgate context not found. Call setRollgateContext first.",
    );
  }
  return stores;
}

/**
 * Get a reactive store for a single flag (uses context)
 *
 * @example
 * ```svelte
 * <script>
 *   import { getFlag } from '@rollgate/sdk-svelte';
 *   const showFeature = getFlag('new-feature', false);
 * </script>
 *
 * {#if $showFeature}
 *   <NewFeature />
 * {/if}
 * ```
 */
export function getFlag(
  flagKey: string,
  defaultValue: boolean = false,
): Readable<boolean> {
  const { flag } = getRollgateContext();
  return flag(flagKey, defaultValue);
}

/**
 * Get a reactive store for multiple flags (uses context)
 *
 * @example
 * ```svelte
 * <script>
 *   import { getFlags } from '@rollgate/sdk-svelte';
 *   const flags = getFlags(['feature-a', 'feature-b']);
 * </script>
 *
 * {#if $flags['feature-a']}...{/if}
 * ```
 */
export function getFlags(
  flagKeys: string[],
): Readable<Record<string, boolean>> {
  const { flags } = getRollgateContext();
  return derived(flags, ($flags) => {
    const result: Record<string, boolean> = {};
    for (const key of flagKeys) {
      result[key] = $flags[key] ?? false;
    }
    return result;
  });
}

/**
 * Get the full Rollgate context (uses context)
 *
 * @example
 * ```svelte
 * <script>
 *   import { getRollgate } from '@rollgate/sdk-svelte';
 *   const { identify, refresh, isLoading } = getRollgate();
 * </script>
 * ```
 */
export function getRollgate(): RollgateStores {
  return getRollgateContext();
}
