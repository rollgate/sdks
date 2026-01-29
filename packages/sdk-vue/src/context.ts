import type { InjectionKey, Ref } from "vue";
import type { CircuitState, MetricsSnapshot } from "@rollgate/sdk-core";
import type { UserContext } from "./plugin";

export interface RollgateContext {
  flags: Ref<Record<string, boolean>>;
  isReady: Ref<boolean>;
  isLoading: Ref<boolean>;
  isStale: Ref<boolean>;
  error: Ref<Error | null>;
  circuitState: Ref<CircuitState>;
  currentUser: Ref<UserContext | undefined>;

  isEnabled: (flagKey: string, defaultValue?: boolean) => boolean;
  identify: (user: UserContext) => Promise<void>;
  reset: () => Promise<void>;
  refresh: () => Promise<void>;
  getMetrics: () => MetricsSnapshot;
  close: () => void;
}

export const ROLLGATE_KEY: InjectionKey<RollgateContext> = Symbol("rollgate");

export function provideRollgate(context: RollgateContext): void {
  // This is handled by the plugin
}

export function injectRollgate(): RollgateContext | undefined {
  // This is a placeholder - use inject('rollgate') in composables
  return undefined;
}
