# @rollgate/sdk-core

[![CI](https://github.com/rollgate/sdks/actions/workflows/ci.yml/badge.svg)](https://github.com/rollgate/sdks/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Internal core utilities for Rollgate TypeScript SDKs.

> **Note**: This is an internal package. Do not use directly. Use `@rollgate/sdk-node` for server-side or `@rollgate/sdk-browser` for client-side applications.

## Purpose

This package provides shared utilities used by all Rollgate TypeScript SDKs:

- **Types & Interfaces**: Common type definitions for flags, users, and configuration
- **HTTP Client**: Base HTTP client with retry logic and circuit breaker
- **Event Emitter**: Type-safe event system for SDK events
- **Cache Utilities**: Flag caching with ETag support
- **Error Types**: Standardized error handling across SDKs
- **Evaluation Logic**: Flag evaluation with operators and targeting rules
- **Event Tracking**: Conversion event collection for A/B testing

## Architecture

```
sdk-core (this package)
    │
    ├── sdk-node (server-side)
    │
    └── sdk-browser (client-side)
            │
            ├── sdk-react
            ├── sdk-vue
            ├── sdk-angular
            └── sdk-svelte
```

## Exports

| Module     | Description                                  |
| ---------- | -------------------------------------------- |
| `types`    | TypeScript interfaces and types              |
| `errors`   | RollgateError and error categories           |
| `http`     | HTTP client with retry/circuit               |
| `cache`    | In-memory and persistent caching             |
| `evaluate` | Flag evaluation engine                       |
| `events`   | Analytics events and EventCollector          |
| `retry`    | Retry logic with exponential backoff         |
| `metrics`  | SDK metrics collection and Prometheus export |
| `tracing`  | Distributed tracing with W3C Trace Context   |
| `reasons`  | Evaluation reasons for flag decisions        |

## Event Tracking (A/B Testing)

The `EventCollector` class buffers conversion events and sends them to the server in batches. It is used internally by `sdk-node` and `sdk-browser` to power the `track()` method.

### EventCollector

```typescript
import { EventCollector } from "@rollgate/sdk-core";
import type {
  EventCollectorConfig,
  TrackEventOptions,
} from "@rollgate/sdk-core";

const collector = new EventCollector({
  endpoint: "https://api.rollgate.io/api/v1/sdk/events",
  apiKey: "your-api-key",
  flushIntervalMs: 30000, // Flush every 30 seconds (default)
  maxBufferSize: 100, // Force flush at 100 buffered events (default)
  enabled: true, // Enable/disable tracking (default: true)
});

// Start periodic flushing
collector.start();

// Track a conversion event
collector.track({
  flagKey: "checkout-redesign",
  eventName: "purchase",
  userId: "user-123",
  variationId: "variant-b", // optional
  value: 29.99, // optional numeric value (e.g., revenue)
  metadata: { currency: "EUR" }, // optional metadata
});

// Manual flush
await collector.flush();

// Check buffer stats
const stats = collector.getBufferStats();
// => { eventCount: 0 }

// Listen to events
collector.on("flush", (data) => {
  console.log(
    `Sent ${data.eventsSent} events, server received ${data.received}`,
  );
});
collector.on("error", (err) => {
  console.error("Event tracking error:", err);
});

// Stop and flush remaining events
await collector.stop();
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

### EventCollectorConfig

| Property          | Type      | Default | Description                                |
| ----------------- | --------- | ------- | ------------------------------------------ |
| `endpoint`        | `string`  | `""`    | API endpoint for event tracking            |
| `apiKey`          | `string`  | `""`    | API key for authentication                 |
| `flushIntervalMs` | `number`  | `30000` | Flush interval in milliseconds             |
| `maxBufferSize`   | `number`  | `100`   | Max buffered events before forcing a flush |
| `enabled`         | `boolean` | `true`  | Enable/disable event tracking              |

### Behavior

- Events are buffered in memory and sent in batches via `POST` to the configured endpoint.
- Automatic flush occurs every `flushIntervalMs` (default: 30 seconds).
- When the buffer reaches `maxBufferSize` (default: 100), a flush is triggered immediately.
- On flush failure, events are placed back into the buffer so they are not lost.
- The flush timer uses `unref()` in Node.js so it does not prevent process exit.
- Events with missing required fields (`flagKey`, `eventName`, `userId`) are silently dropped.

## For SDK Developers

If you're building a new Rollgate SDK wrapper:

```typescript
import {
  RollgateConfig,
  User,
  Flags,
  RollgateError,
  ErrorCategory,
  EventCollector,
  DEFAULT_EVENT_COLLECTOR_CONFIG,
} from "@rollgate/sdk-core";
import type {
  EventCollectorConfig,
  TrackEventOptions,
} from "@rollgate/sdk-core";
```

To add event tracking to a new SDK:

1. Create an `EventCollector` instance in your client constructor, deriving the endpoint from `baseUrl`.
2. Call `collector.start()` during initialization.
3. Expose `track(options)`, `flush()`, and `getEventStats()` on your public client API.
4. Call `collector.stop()` in your `close()`/`destroy()` method to flush remaining events.

## License

MIT
