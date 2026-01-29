# Rollgate Svelte SDK

Official Svelte SDK for [Rollgate](https://rollgate.io) feature flags.

## Installation

```bash
npm install @rollgate/sdk-svelte
# or
yarn add @rollgate/sdk-svelte
# or
pnpm add @rollgate/sdk-svelte
```

## Quick Start

### 1. Create Rollgate in Root Layout

```svelte
<!-- +layout.svelte -->
<script>
  import { createRollgate } from '@rollgate/sdk-svelte';
  import { setContext } from 'svelte';

  const rollgate = createRollgate({
    apiKey: 'your-api-key',
    user: {
      id: 'user-123',
      email: 'user@example.com',
    },
  });

  setContext('rollgate', rollgate);

  // Cleanup on destroy
  import { onDestroy } from 'svelte';
  onDestroy(() => rollgate.destroy());
</script>

<slot />
```

### 2. Use in Components

```svelte
<!-- Feature.svelte -->
<script>
  import { getFlag, getRollgate } from '@rollgate/sdk-svelte';

  // Get a reactive flag store
  const newFeature = getFlag('new-feature');

  // Or get full access
  const { isReady, isLoading, error, identify } = getRollgate();
</script>

{#if $isLoading}
  <p>Loading flags...</p>
{:else if $error}
  <p>Error: {$error.message}</p>
{:else if $newFeature}
  <div class="new-feature">
    ✨ New feature is enabled!
  </div>
{:else}
  <div>Old experience</div>
{/if}
```

## Usage

### `createRollgate(options)`

Creates Rollgate stores. Call in root layout and provide via context.

```svelte
<script>
  import { createRollgate } from '@rollgate/sdk-svelte';
  import { setContext, onDestroy } from 'svelte';

  const rollgate = createRollgate({
    apiKey: 'your-api-key',
    baseUrl: 'https://api.rollgate.io',
    refreshInterval: 30000,
    user: { id: 'user-123' },
  });

  setContext('rollgate', rollgate);
  onDestroy(() => rollgate.destroy());
</script>
```

### `getFlag(flagKey, defaultValue?)`

Get a reactive store for a single flag.

```svelte
<script>
  import { getFlag } from '@rollgate/sdk-svelte';

  const showBanner = getFlag('show-banner');
  const darkMode = getFlag('dark-mode', false);
</script>

{#if $showBanner}
  <Banner />
{/if}

<div class:dark={$darkMode}>
  Content
</div>
```

### `getFlags()`

Get all flags as a reactive store.

```svelte
<script>
  import { getFlags } from '@rollgate/sdk-svelte';

  const flags = getFlags();
</script>

<ul>
  {#each Object.entries($flags) as [key, value]}
    <li>{key}: {value ? 'enabled' : 'disabled'}</li>
  {/each}
</ul>
```

### `getRollgate()`

Get full access to Rollgate functionality.

```svelte
<script>
  import { getRollgate } from '@rollgate/sdk-svelte';

  const {
    flags,           // All flags store
    isReady,         // Ready state store
    isLoading,       // Loading state store
    error,           // Error store
    circuitState,    // Circuit breaker state store
    client,          // Underlying RollgateClient
    isEnabled,       // Non-reactive flag check
    getFlag,         // Get single flag store
    identify,        // Set user context
    reset,           // Clear user context
    refresh,         // Force refresh flags
    destroy,         // Cleanup
  } = getRollgate();

  async function onLogin(user) {
    await identify({
      id: user.id,
      email: user.email,
      attributes: { plan: user.plan },
    });
  }

  async function onLogout() {
    await reset();
  }
</script>
```

## SvelteKit

### Server-Side Rendering

For SSR, initialize on the client only:

```svelte
<!-- +layout.svelte -->
<script>
  import { browser } from '$app/environment';
  import { createRollgate } from '@rollgate/sdk-svelte';
  import { setContext, onDestroy } from 'svelte';

  let rollgate;

  if (browser) {
    rollgate = createRollgate({
      apiKey: import.meta.env.VITE_ROLLGATE_API_KEY,
    });
    setContext('rollgate', rollgate);
  }

  onDestroy(() => {
    if (rollgate) rollgate.destroy();
  });
</script>

<slot />
```

### With Stores in +page.svelte

```svelte
<script>
  import { browser } from '$app/environment';
  import { getFlag } from '@rollgate/sdk-svelte';

  // Only access on client
  $: newFeature = browser ? getFlag('new-feature') : null;
</script>

{#if browser && $newFeature}
  <NewFeature />
{/if}
```

## Configuration

```typescript
createRollgate({
  // Required
  apiKey: 'your-api-key',

  // Optional
  baseUrl: 'https://api.rollgate.io',
  refreshInterval: 30000, // Polling interval (ms)
  enableStreaming: false, // Use SSE for real-time updates
  timeout: 5000, // Request timeout (ms)

  // Initial user context
  user: {
    id: 'user-123',
    email: 'user@example.com',
    attributes: { plan: 'pro' },
  },

  // Retry configuration
  retry: {
    maxRetries: 3,
    baseDelayMs: 100,
    maxDelayMs: 10000,
    jitterFactor: 0.1,
  },

  // Circuit breaker configuration
  circuitBreaker: {
    failureThreshold: 5,
    recoveryTimeout: 30000,
    monitoringWindow: 60000,
    successThreshold: 3,
  },

  // Cache configuration
  cache: {
    ttl: 300000, // 5 minutes
    staleTtl: 3600000, // 1 hour
  },
});
```

## Requirements

- Svelte 4+ or 5+
- @rollgate/node

## License

MIT
