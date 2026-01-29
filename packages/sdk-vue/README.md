# Rollgate Vue SDK

Official Vue 3 SDK for [Rollgate](https://rollgate.io) feature flags.

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
  apiKey: "your-api-key",
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
const { isReady, isLoading, error, identify, refresh } = useRollgate();
</script>

<template>
  <div v-if="isLoading">Loading flags...</div>
  <div v-else-if="error">Error: {{ error.message }}</div>
  <div v-else>
    <div v-if="isNewFeatureEnabled">✨ New feature is enabled!</div>
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

### `useFlags()`

Returns all flags as a reactive computed ref.

```vue
<script setup>
import { useFlags } from "@rollgate/sdk-vue";

const flags = useFlags();
</script>

<template>
  <pre>{{ flags }}</pre>
</template>
```

### `useRollgate()`

Full access to Rollgate client functionality.

```vue
<script setup>
import { useRollgate } from "@rollgate/sdk-vue";

const {
  flags, // All flags (reactive)
  isReady, // Client ready state
  isLoading, // Loading state
  error, // Current error
  circuitState, // Circuit breaker state
  isEnabled, // Check flag (non-reactive)
  identify, // Set user context
  reset, // Clear user context
  refresh, // Force refresh flags
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
  // Required
  apiKey: "your-api-key",

  // Optional
  baseUrl: "https://api.rollgate.io",
  refreshInterval: 30000, // Polling interval (ms)
  enableStreaming: false, // Use SSE for real-time updates
  timeout: 5000, // Request timeout (ms)

  // Initial user context
  user: {
    id: "user-123",
    email: "user@example.com",
    attributes: { plan: "pro" },
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

## TypeScript Support

Full TypeScript support with type inference:

```typescript
import type {
  RollgateConfig,
  UserContext,
  CircuitState,
} from "@rollgate/sdk-vue";

const config: RollgateConfig = {
  apiKey: "your-api-key",
};

const user: UserContext = {
  id: "user-123",
  email: "user@example.com",
  attributes: { plan: "pro", country: "IT" },
};
```

## SSR / Nuxt

For SSR applications, initialize on the client side only:

```typescript
// plugins/rollgate.client.ts (Nuxt 3)
import { RollgatePlugin } from "@rollgate/sdk-vue";

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.use(RollgatePlugin, {
    apiKey: useRuntimeConfig().public.rollgateApiKey,
  });
});
```

## License

MIT
