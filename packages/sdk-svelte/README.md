# @rollgate/sdk-svelte

[![CI](https://github.com/rollgate/sdks/actions/workflows/ci.yml/badge.svg)](https://github.com/rollgate/sdks/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@rollgate/sdk-svelte.svg)](https://www.npmjs.com/package/@rollgate/sdk-svelte)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Official Svelte SDK for [Rollgate](https://rollgate.io) - Feature flags made simple.

## Requirements

- Svelte 4+ or 5+
- Works with SvelteKit

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
  import { createRollgate, setRollgateContext } from '@rollgate/sdk-svelte';
  import { onDestroy } from 'svelte';

  const rollgate = createRollgate({
    apiKey: 'your-api-key',
  }, {
    id: 'user-123',
    email: 'user@example.com',
  });

  setRollgateContext(rollgate);

  // Cleanup on destroy
  onDestroy(() => rollgate.close());
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
  const { isLoading, isError, identify } = getRollgate();
</script>

{#if $isLoading}
  <p>Loading flags...</p>
{:else if $isError}
  <p>Error loading flags</p>
{:else if $newFeature}
  <div>New feature is enabled!</div>
{:else}
  <div>Old experience</div>
{/if}
```

## Usage

### `createRollgate(config, user?)`

Creates Rollgate stores. Call in root layout and provide via context.

```svelte
<script>
  import { createRollgate, setRollgateContext } from '@rollgate/sdk-svelte';
  import { onDestroy } from 'svelte';

  const rollgate = createRollgate({
    apiKey: 'your-api-key',
    baseUrl: 'https://api.rollgate.io',
    refreshInterval: 30000,
  }, { id: 'user-123' });

  setRollgateContext(rollgate);
  onDestroy(() => rollgate.close());
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

### `getFlags(flagKeys)`

Get a reactive store for multiple flags.

```svelte
<script>
  import { getFlags } from '@rollgate/sdk-svelte';

  const flags = getFlags(['feature-a', 'feature-b']);
</script>

{#if $flags['feature-a']}
  <FeatureA />
{/if}
```

### `getRollgate()`

Get full access to Rollgate functionality.

```svelte
<script>
  import { getRollgate } from '@rollgate/sdk-svelte';

  const {
    flags,           // All flags store (Readable)
    isReady,         // Ready state store (Readable)
    isLoading,       // Loading state store (Readable)
    isError,         // Error state store (Readable)
    isStale,         // Stale state store (Readable)
    circuitState,    // Circuit breaker state store (Readable)
    isEnabled,       // Non-reactive flag check
    isEnabledDetail, // Flag with evaluation reason
    identify,        // Set user context
    reset,           // Clear user context
    refresh,         // Force refresh flags
    getMetrics,      // Get SDK metrics
    track,           // Track conversion event
    flush,           // Flush pending events
    close,           // Close the client
    flag,            // Get reactive store for single flag
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

## Configuration

```typescript
createRollgate({
  // Required
  apiKey: "your-api-key",

  // Optional
  baseUrl: "https://api.rollgate.io",
  refreshInterval: 30000, // Polling interval (ms)
  enableStreaming: false, // Use SSE for real-time updates
  timeout: 5000, // Request timeout (ms)

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

## Event Tracking

Track conversion events for A/B testing:

```svelte
<script>
  import { getRollgate } from '@rollgate/sdk-svelte';
  import { onDestroy } from 'svelte';

  const { track, flush } = getRollgate();

  function handlePurchase() {
    track({
      flagKey: 'checkout-redesign',
      eventName: 'purchase',
      userId: 'user-123',
      value: 29.99,
    });
  }

  // Flush pending events on destroy (auto-flushes every 30s)
  onDestroy(() => {
    flush();
  });
</script>

<button on:click={handlePurchase}>Buy Now</button>
```

### TrackEventOptions

| Field         | Type                      | Required | Description                                 |
| ------------- | ------------------------- | -------- | ------------------------------------------- |
| `flagKey`     | `string`                  | Yes      | The flag key this event is associated with  |
| `eventName`   | `string`                  | Yes      | Event name (e.g., `'purchase'`, `'signup'`) |
| `userId`      | `string`                  | Yes      | User ID                                     |
| `variationId` | `string`                  | No       | Variation ID the user was exposed to        |
| `value`       | `number`                  | No       | Numeric value (e.g., revenue amount)        |
| `metadata`    | `Record<string, unknown>` | No       | Optional metadata                           |

## SvelteKit

### Server-Side Rendering

For SSR, initialize on the client only:

```svelte
<!-- +layout.svelte -->
<script>
  import { browser } from '$app/environment';
  import { createRollgate, setRollgateContext } from '@rollgate/sdk-svelte';
  import { onDestroy } from 'svelte';

  let rollgate;

  if (browser) {
    rollgate = createRollgate({
      apiKey: import.meta.env.VITE_ROLLGATE_API_KEY,
    });
    setRollgateContext(rollgate);
  }

  onDestroy(() => {
    if (rollgate) rollgate.close();
  });
</script>

<slot />
```

## API Reference

### Context Helpers

| Function             | Description                                     |
| -------------------- | ----------------------------------------------- |
| `createRollgate`     | Create Rollgate stores from config              |
| `setRollgateContext` | Provide stores to child components via context  |
| `getRollgateContext` | Inject stores from parent context               |
| `getFlag`            | Reactive store for a single flag (via context)  |
| `getFlags`           | Reactive store for multiple flags (via context) |
| `getRollgate`        | Full context access (via context)               |

### RollgateStores (from `createRollgate` / `getRollgate`)

| Property / Method   | Type       | Description                            |
| ------------------- | ---------- | -------------------------------------- |
| `flags`             | `Readable` | Reactive store of all flags            |
| `isLoading`         | `Readable` | Reactive loading state                 |
| `isError`           | `Readable` | Reactive error state                   |
| `isStale`           | `Readable` | Reactive stale state                   |
| `isReady`           | `Readable` | Reactive ready state                   |
| `circuitState`      | `Readable` | Reactive circuit breaker state         |
| `isEnabled()`       | Function   | Check if a flag is enabled             |
| `isEnabledDetail()` | Function   | Flag value with evaluation reason      |
| `identify(user)`    | Function   | Change user context                    |
| `reset()`           | Function   | Clear user context                     |
| `refresh()`         | Function   | Force refresh flags                    |
| `getMetrics()`      | Function   | Get SDK metrics snapshot               |
| `track(options)`    | Function   | Track a conversion event (A/B testing) |
| `flush()`           | Function   | Flush pending events to the server     |
| `close()`           | Function   | Close the client and cleanup           |
| `flag(key, def?)`   | Function   | Get reactive store for a single flag   |

## Documentation

- [Getting Started](../../docs/GETTING-STARTED.md)
- [Architecture](../../docs/ARCHITECTURE.md)
- [Production Setup](../../docs/PRODUCTION-SETUP.md)

Full documentation: [docs.rollgate.io](https://rollgate.io/docs)

## About Rollgate

[Rollgate](https://rollgate.io) is a feature management platform that helps teams release features safely with gradual rollouts, user targeting, and instant kill switches.

## License

MIT
