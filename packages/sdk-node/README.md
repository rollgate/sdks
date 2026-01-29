# @rollgate/sdk-node

Official Node.js SDK for [Rollgate](https://rollgate.io) - Feature flags made simple.

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

| Method                     | Description                       |
| -------------------------- | --------------------------------- |
| `init(user?)`              | Initialize client and fetch flags |
| `isEnabled(key, default?)` | Check if a flag is enabled        |
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

## Documentation

- [Getting Started](../../docs/GETTING-STARTED.md)
- [Architecture](../../docs/ARCHITECTURE.md)
- [Production Setup](../../docs/PRODUCTION-SETUP.md)

Full documentation: [docs.rollgate.io](https://rollgate.io/docs)

## License

MIT
