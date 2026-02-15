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

const client = createClient("sb_client_your_api_key", { id: "user-123" });

await client.waitForInitialization();

if (client.isEnabled("new-checkout-flow")) {
  // New feature code
}
```

## Configuration

```typescript
const client = createClient(
  "sb_client_your_api_key",
  { id: "user-123" },
  {
    baseUrl: "https://api.rollgate.io", // Optional
    refreshInterval: 60000, // Polling interval in ms (0 to disable)
    streaming: false, // Enable SSE for real-time updates
    events: {
      flushIntervalMs: 30000, // Event flush interval (default: 30s)
      maxBufferSize: 100, // Max buffered events before flush (default: 100)
    },
  },
);
```

## User Targeting

```typescript
// Create client with initial user context
const client = createClient("sb_client_your_api_key", {
  id: "user-123",
  email: "user@example.com",
  attributes: { plan: "premium" },
});

await client.waitForInitialization();

// Or identify later
await client.identify({
  id: "user-456",
  attributes: { country: "US" },
});
```

## API

| Method                               | Description                              |
| ------------------------------------ | ---------------------------------------- |
| `waitForInitialization(timeout?)`    | Wait for client to be ready              |
| `isReady()`                          | Check if client is initialized           |
| `isEnabled(key, default?)`           | Check if a flag is enabled               |
| `isEnabledDetail(key, default?)`     | Check flag with evaluation reason        |
| `boolVariation(key, default?)`       | Alias for `isEnabled` (LD compatibility) |
| `boolVariationDetail(key, default?)` | Alias for `isEnabledDetail`              |
| `allFlags()`                         | Get all flags as object                  |
| `identify(user)`                     | Update user context                      |
| `reset()`                            | Clear user context                       |
| `refresh()`                          | Force refresh flags                      |
| `track(options)`                     | Track a conversion event for A/B testing |
| `flush()`                            | Force flush buffered conversion events   |
| `getEventStats()`                    | Get event buffer stats                   |
| `getCircuitState()`                  | Get circuit breaker state                |
| `getMetrics()`                       | Get metrics snapshot                     |
| `close()`                            | Clean up resources                       |

## Evaluation Reasons

Get detailed information about why a flag evaluated to a particular value:

```typescript
const detail = client.isEnabledDetail("my-flag", false);
console.log(detail.value); // boolean
console.log(detail.reason.kind); // "OFF" | "TARGET_MATCH" | "RULE_MATCH" | "FALLTHROUGH" | "ERROR" | "UNKNOWN"
```

Reason kinds:

| Kind           | Description                        |
| -------------- | ---------------------------------- |
| `OFF`          | Flag is disabled                   |
| `TARGET_MATCH` | User is in the flag's target list  |
| `RULE_MATCH`   | User matched a targeting rule      |
| `FALLTHROUGH`  | Default rollout (no rules matched) |
| `ERROR`        | Error during evaluation            |
| `UNKNOWN`      | Flag not found                     |

## Events

```typescript
client.on("ready", () => {
  /* Client initialized */
});
client.on("flag-changed", (key, newValue) => {
  /* Flag changed */
});
client.on("flags-updated", (flags) => {
  /* Flags refreshed */
});
client.on("error", (error) => {
  /* Error occurred */
});
client.on("user-changed", (user) => {
  /* User context updated */
});
client.on("user-reset", () => {
  /* User context cleared */
});
```

## Event Tracking

Track conversion events for A/B testing experiments:

```typescript
// Track a conversion event
client.track({
  flagKey: "checkout-redesign",
  eventName: "purchase",
  userId: "user-123",
  variationId: "variant-b",
  value: 29.99,
  metadata: { currency: "EUR" },
});

// Force flush pending events (events auto-flush every 30s)
await client.flush();

// Get event buffer stats
const stats = client.getEventStats();
console.log(stats.eventCount); // number of buffered events
```

### TrackEventOptions

| Property      | Type                      | Required | Description                                |
| ------------- | ------------------------- | -------- | ------------------------------------------ |
| `flagKey`     | `string`                  | Yes      | The flag key this event is associated with |
| `eventName`   | `string`                  | Yes      | Event name (e.g., `purchase`, `signup`)    |
| `userId`      | `string`                  | Yes      | User ID                                    |
| `variationId` | `string`                  | No       | Variation ID the user was exposed to       |
| `value`       | `number`                  | No       | Numeric value (e.g., revenue amount)       |
| `metadata`    | `Record<string, unknown>` | No       | Additional event metadata                  |

Events are buffered in memory and sent in batches. The buffer auto-flushes every 30 seconds (configurable via `events.flushIntervalMs`) or when the buffer reaches 100 events (configurable via `events.maxBufferSize`). On `close()`, remaining events are flushed automatically (best-effort).

## Framework Wrappers

This SDK is the core browser implementation. Framework-specific SDKs wrap this package:

| Framework | Package                 | Features                    |
| --------- | ----------------------- | --------------------------- |
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
