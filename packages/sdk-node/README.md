# @rollgate/sdk-node

[![CI](https://github.com/rollgate/sdks/actions/workflows/ci.yml/badge.svg)](https://github.com/rollgate/sdks/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@rollgate/sdk-node.svg)](https://www.npmjs.com/package/@rollgate/sdk-node)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Official Node.js SDK for [Rollgate](https://rollgate.io) - Feature flags made simple.

## Requirements

- Node.js 18+

## Installation

```bash
npm install @rollgate/sdk-node
```

## Quick Start

```typescript
import { RollgateClient } from "@rollgate/sdk-node";

const client = new RollgateClient({
  apiKey: "sb_server_your_api_key",
});

await client.init();

if (client.isEnabled("new-checkout-flow")) {
  // New feature code
}
```

## Configuration

```typescript
const client = new RollgateClient({
  apiKey: "sb_server_your_api_key", // Required
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

| Method                           | Description                       |
| -------------------------------- | --------------------------------- |
| `init(user?)`                    | Initialize client and fetch flags |
| `isEnabled(key, default?)`       | Check if a flag is enabled        |
| `isEnabledDetail(key, default?)` | Check flag with evaluation reason |
| `getAllFlags()`                  | Get all flags as object           |
| `identify(user)`                 | Update user context               |
| `reset()`                        | Clear user context                |
| `refresh()`                      | Force refresh flags               |
| `close()`                        | Clean up resources                |

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

## Documentation

- [Getting Started](../../docs/GETTING-STARTED.md)
- [Architecture](../../docs/ARCHITECTURE.md)
- [Production Setup](../../docs/PRODUCTION-SETUP.md)

Full documentation: [docs.rollgate.io](https://rollgate.io/docs)

## About Rollgate

[Rollgate](https://rollgate.io) is a feature management platform that helps teams release features safely with gradual rollouts, user targeting, and instant kill switches.

## License

MIT
