# @rollgate/sdk-vue

[![CI](https://github.com/rollgate/sdks/actions/workflows/ci.yml/badge.svg)](https://github.com/rollgate/sdks/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@rollgate/sdk-vue.svg)](https://www.npmjs.com/package/@rollgate/sdk-vue)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Official Vue 3 SDK for [Rollgate](https://rollgate.io) - Feature flags made simple.

## Requirements

- Vue 3.0+
- Works with Nuxt 3, Vite

## Installation

```bash
npm install @rollgate/sdk-vue
# or
yarn add @rollgate/sdk-vue
# or
pnpm add @rollgate/sdk-vue
```

## Quick Start

### 1. Install the Plugin

```typescript
// main.ts
import { createApp } from "vue";
import { RollgatePlugin } from "@rollgate/sdk-vue";
import App from "./App.vue";

const app = createApp(App);

app.use(RollgatePlugin, {
  config: {
    apiKey: "your-api-key",
  },
  // Optional: initial user for targeting
  user: {
    id: "user-123",
    email: "user@example.com",
    attributes: { plan: "pro" },
  },
});

app.mount("#app");
```

### 2. Use in Components

```vue
<script setup lang="ts">
import { useFlag, useRollgate } from "@rollgate/sdk-vue";

// Simple flag check (reactive)
const isNewFeatureEnabled = useFlag("new-feature");

// Full access to Rollgate
const { isLoading, isError, identify, refresh } = useRollgate();
</script>

<template>
  <div v-if="isLoading">Loading flags...</div>
  <div v-else-if="isError">Error loading flags</div>
  <div v-else>
    <div v-if="isNewFeatureEnabled">New feature is enabled!</div>
    <div v-else>Old experience</div>
  </div>
</template>
```

## Composables

### `useFlag(flagKey, defaultValue?)`

Returns a reactive computed ref for a single flag.

```vue
<script setup>
import { useFlag } from "@rollgate/sdk-vue";

const showBanner = useFlag("show-banner", false);
const enableDarkMode = useFlag("dark-mode");
</script>

<template>
  <Banner v-if="showBanner" />
  <div :class="{ dark: enableDarkMode }">Content</div>
</template>
```

### `useFlagDetail(flagKey, defaultValue?)`

Returns a reactive computed ref with flag value and evaluation reason.

```vue
<script setup>
import { useFlagDetail } from "@rollgate/sdk-vue";

const detail = useFlagDetail("new-feature", false);
// detail.value => { value: boolean, reason: { kind: '...' } }
</script>
```

### `useFlags(flagKeys)`

Returns a reactive computed ref for multiple flags.

```vue
<script setup>
import { useFlags } from "@rollgate/sdk-vue";

const flags = useFlags(["feature-a", "feature-b"]);
// flags.value => { 'feature-a': true, 'feature-b': false }
</script>
```

### `useRollgate()`

Full access to Rollgate client functionality.

```vue
<script setup>
import { useRollgate } from "@rollgate/sdk-vue";

const {
  flags, // All flags (reactive ref)
  isLoading, // Loading state (reactive ref)
  isError, // Error state (reactive ref)
  isStale, // Stale state (reactive ref)
  circuitState, // Circuit breaker state (reactive ref)
  isEnabled, // Check flag (non-reactive)
  identify, // Set user context
  reset, // Clear user context
  refresh, // Force refresh flags
  getMetrics, // Get SDK metrics
  track, // Track conversion event
  flush, // Flush pending events
} = useRollgate();

// Set user after login
async function onLogin(user) {
  await identify({
    id: user.id,
    email: user.email,
    attributes: { plan: user.plan },
  });
}

// Clear user on logout
async function onLogout() {
  await reset();
}
</script>
```

## Configuration

```typescript
app.use(RollgatePlugin, {
  config: {
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
  },

  // Initial user context
  user: {
    id: "user-123",
    email: "user@example.com",
    attributes: { plan: "pro" },
  },
});
```

## User Identification

```vue
<script setup>
import { useRollgate } from "@rollgate/sdk-vue";

const { identify, reset } = useRollgate();

// After login
await identify({ id: "user-123", email: "user@example.com" });

// After logout
await reset();
</script>
```

## Event Tracking

Track conversion events for A/B testing:

```vue
<script setup>
import { useRollgate } from "@rollgate/sdk-vue";
import { onUnmounted } from "vue";

const { track, flush } = useRollgate();

function handlePurchase() {
  track({
    flagKey: "checkout-redesign",
    eventName: "purchase",
    userId: "user-123",
    value: 29.99,
  });
}

// Flush pending events on unmount (auto-flushes every 30s)
onUnmounted(() => {
  flush();
});
</script>

<template>
  <button @click="handlePurchase">Buy Now</button>
</template>
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

## TypeScript Support

Full TypeScript support with type inference:

```typescript
import type {
  RollgateConfig,
  UserContext,
  CircuitState,
  TrackEventOptions,
} from "@rollgate/sdk-vue";
```

## SSR / Nuxt

For SSR applications, initialize on the client side only:

```typescript
// plugins/rollgate.client.ts (Nuxt 3)
import { RollgatePlugin } from "@rollgate/sdk-vue";

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.use(RollgatePlugin, {
    config: {
      apiKey: useRuntimeConfig().public.rollgateApiKey,
    },
  });
});
```

## API Reference

### Composables

| Composable      | Description                                |
| --------------- | ------------------------------------------ |
| `useFlag`       | Reactive computed ref for a single flag    |
| `useFlagDetail` | Flag value with evaluation reason          |
| `useFlags`      | Reactive computed ref for multiple flags   |
| `useRollgate`   | Full context (flags, identify, track, etc) |

### useRollgate() Properties and Methods

| Property / Method | Description                            |
| ----------------- | -------------------------------------- |
| `isEnabled()`     | Check if a flag is enabled             |
| `isLoading`       | Reactive loading state                 |
| `isError`         | Reactive error state                   |
| `isStale`         | Reactive stale state                   |
| `circuitState`    | Reactive circuit breaker state         |
| `flags`           | Reactive flags object                  |
| `identify(user)`  | Change user context                    |
| `reset()`         | Clear user context                     |
| `refresh()`       | Force refresh flags                    |
| `getMetrics()`    | Get SDK metrics snapshot               |
| `track(options)`  | Track a conversion event (A/B testing) |
| `flush()`         | Flush pending events to the server     |
| `client`          | Access the underlying browser client   |

## Documentation

- [Getting Started](../../docs/GETTING-STARTED.md)
- [Architecture](../../docs/ARCHITECTURE.md)
- [Production Setup](../../docs/PRODUCTION-SETUP.md)

Full documentation: [docs.rollgate.io](https://rollgate.io/docs)

## About Rollgate

[Rollgate](https://rollgate.io) is a feature management platform that helps teams release features safely with gradual rollouts, user targeting, and instant kill switches.

## License

MIT
