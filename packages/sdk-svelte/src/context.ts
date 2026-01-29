import { getContext } from 'svelte';
import { derived, type Readable } from 'svelte/store';
import type { RollgateStores } from './rollgate';

const ROLLGATE_KEY = 'rollgate';

/**
 * Get the Rollgate stores from context.
 *
 * @example
 * ```svelte
 * <script>
 *   import { getRollgate } from '@rollgate/sdk-svelte';
 *
 *   const { flags, isReady, identify } = getRollgate();
 * </script>
 * ```
 */
export function getRollgate(): RollgateStores {
  const rollgate = getContext<RollgateStores>(ROLLGATE_KEY);
  if (!rollgate) {
    throw new Error(
      '[Rollgate] No Rollgate context found. Did you call createRollgate() and setContext()?'
    );
  }
  return rollgate;
}

/**
 * Get a reactive store for a specific flag.
 *
 * @example
 * ```svelte
 * <script>
 *   import { getFlag } from '@rollgate/sdk-svelte';
 *
 *   const newFeature = getFlag('new-feature');
 *   const premium = getFlag('premium', true);
 * </script>
 *
 * {#if $newFeature}
 *   <NewFeature />
 * {/if}
 * ```
 */
export function getFlag(flagKey: string, defaultValue = false): Readable<boolean> {
  const rollgate = getRollgate();
  return rollgate.getFlag(flagKey, defaultValue);
}

/**
 * Get all flags as a reactive store.
 *
 * @example
 * ```svelte
 * <script>
 *   import { getFlags } from '@rollgate/sdk-svelte';
 *
 *   const flags = getFlags();
 * </script>
 *
 * {#each Object.entries($flags) as [key, value]}
 *   <p>{key}: {value}</p>
 * {/each}
 * ```
 */
export function getFlags(): Readable<Record<string, boolean>> {
  const rollgate = getRollgate();
  return rollgate.flags;
}
