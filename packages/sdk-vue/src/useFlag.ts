import { computed, inject, type ComputedRef } from 'vue';
import type { RollgateContext } from './context';

/**
 * Reactive hook to check if a specific flag is enabled.
 *
 * @param flagKey - The flag key to check
 * @param defaultValue - Default value if flag not found (default: false)
 * @returns Computed ref that updates when flag changes
 *
 * @example
 * ```vue
 * <script setup>
 * import { useFlag } from '@rollgate/sdk-vue';
 *
 * const isNewFeatureEnabled = useFlag('new-feature');
 * const isPremium = useFlag('premium-feature', false);
 * </script>
 *
 * <template>
 *   <div v-if="isNewFeatureEnabled">
 *     New feature is here!
 *   </div>
 * </template>
 * ```
 */
export function useFlag(flagKey: string, defaultValue = false): ComputedRef<boolean> {
  const context = inject<RollgateContext>('rollgate');

  if (!context) {
    throw new Error('[Rollgate] No Rollgate context found. Did you install the RollgatePlugin?');
  }

  return computed(() => {
    return context.flags.value[flagKey] ?? defaultValue;
  });
}
