import { computed, inject, type ComputedRef } from 'vue';
import type { RollgateContext } from './context';

/**
 * Reactive hook to get all flag values.
 *
 * @returns Computed ref with all flags that updates when any flag changes
 *
 * @example
 * ```vue
 * <script setup>
 * import { useFlags } from '@rollgate/sdk-vue';
 *
 * const flags = useFlags();
 * </script>
 *
 * <template>
 *   <div v-for="(enabled, key) in flags" :key="key">
 *     {{ key }}: {{ enabled ? 'ON' : 'OFF' }}
 *   </div>
 * </template>
 * ```
 */
export function useFlags(): ComputedRef<Record<string, boolean>> {
  const context = inject<RollgateContext>('rollgate');

  if (!context) {
    throw new Error('[Rollgate] No Rollgate context found. Did you install the RollgatePlugin?');
  }

  return computed(() => {
    return { ...context.flags.value };
  });
}
