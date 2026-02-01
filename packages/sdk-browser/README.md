# @rollgate/sdk-browser

[![CI](https://github.com/rollgate/sdks/actions/workflows/ci.yml/badge.svg)](https://github.com/rollgate/sdks/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@rollgate/sdk-browser.svg)](https://www.npmjs.com/package/@rollgate/sdk-browser)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Official Browser SDK for [Rollgate](https://rollgate.io) - Feature flags made simple.

> **Note**: For React, Vue, Angular, or Svelte apps, consider using the framework-specific SDKs (`@rollgate/sdk-react`, `@rollgate/sdk-vue`, etc.) which provide better integration with your framework's reactivity system.

## Requirements

- Modern browser with Fetch API support
- ES2015+ environment

## Installation

```bash
npm install @rollgate/sdk-browser
```

## Quick Start

```typescript
import { createClient } from "@rollgate/sdk-browser";

const client = createClient({
  apiKey: "sb_client_your_api_key",
});

await client.init();

if (client.isEnabled("new-checkout-flow")) {
  // New feature code
}
```

## Configuration

```typescript
const client = createClient({
  apiKey: "sb_client_your_api_key", // Required
  baseUrl: "https://api.rollgate.io", // Optional
  refreshInterval: 60000, // Polling interval in ms (0 to disable)
  enableStreaming: false, // Enable SSE for real-time updates
});
```

## User Targeting

```typescript
// Initialize with user context
await client.init({
  id: "user-123",
  email: "user@example.com",
  attributes: { plan: "premium" },
});

// Or identify later
await client.identify({
  id: "user-456",
  attributes: { country: "US" },
});
```

## API

| Method                     | Description                       |
| -------------------------- | --------------------------------- |
| `init(user?)`              | Initialize client and fetch flags |
| `isEnabled(key, default?)` | Check if a flag is enabled        |
| `getString(key, default?)` | Get string flag value             |
| `getNumber(key, default?)` | Get number flag value             |
| `getJSON(key, default?)`   | Get JSON flag value               |
| `getAllFlags()`            | Get all flags as object           |
| `identify(user)`           | Update user context               |
| `reset()`                  | Clear user context                |
| `refresh()`                | Force refresh flags               |
| `close()`                  | Clean up resources                |

## Events

```typescript
client.on("ready", () => {
  /* Client initialized */
});
client.on("flag-changed", (key, newValue, oldValue) => {
  /* Flag changed */
});
client.on("flags-updated", (flags) => {
  /* Flags refreshed */
});
client.on("error", (error) => {
  /* Error occurred */
});
```

## Framework Wrappers

This SDK is the core browser implementation. Framework-specific SDKs wrap this package:

| Framework | Package              | Features                    |
| --------- | -------------------- | --------------------------- |
| React     | `@rollgate/sdk-react`   | Hooks, Provider, Context    |
| Vue       | `@rollgate/sdk-vue`     | Composables, Plugin         |
| Angular   | `@rollgate/sdk-angular` | Service, Module, Directives |
| Svelte    | `@rollgate/sdk-svelte`  | Stores, Context             |

## Documentation

- [Getting Started](../../docs/GETTING-STARTED.md)
- [Architecture](../../docs/SDK-ARCHITECTURE.md)
- [Production Setup](../../docs/PRODUCTION-SETUP.md)

Full documentation: [docs.rollgate.io](https://rollgate.io/docs)

## About Rollgate

[Rollgate](https://rollgate.io) is a feature management platform that helps teams release features safely with gradual rollouts, user targeting, and instant kill switches.

## License

MIT
