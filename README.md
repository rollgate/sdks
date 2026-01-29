# Rollgate SDKs

Official SDKs for [Rollgate](https://rollgate.io) - Feature flags made simple.

## Available SDKs

| SDK         | Package                                         | Install                                           | Docs                                       |
| ----------- | ----------------------------------------------- | ------------------------------------------------- | ------------------------------------------ |
| **Node.js** | [@rollgate/sdk-node](./packages/sdk-node)       | `npm install @rollgate/sdk-node`                  | [README](./packages/sdk-node/README.md)    |
| **React**   | [@rollgate/sdk-react](./packages/sdk-react)     | `npm install @rollgate/sdk-react`                 | [README](./packages/sdk-react/README.md)   |
| **Vue**     | [@rollgate/sdk-vue](./packages/sdk-vue)         | `npm install @rollgate/sdk-vue`                   | [README](./packages/sdk-vue/README.md)     |
| **Angular** | [@rollgate/sdk-angular](./packages/sdk-angular) | `npm install @rollgate/sdk-angular`               | [README](./packages/sdk-angular/README.md) |
| **Svelte**  | [@rollgate/sdk-svelte](./packages/sdk-svelte)   | `npm install @rollgate/sdk-svelte`                | [README](./packages/sdk-svelte/README.md)  |
| **Go**      | [sdk-go](./packages/sdk-go)                     | `go get github.com/rollgate/sdks/packages/sdk-go` | [README](./packages/sdk-go/README.md)      |
| **Java**    | [sdk-java](./packages/sdk-java)                 | Maven/Gradle                                      | [README](./packages/sdk-java/README.md)    |
| **Python**  | [rollgate](./packages/sdk-python)               | `pip install rollgate`                            | [README](./packages/sdk-python/README.md)  |

## Quick Start

### Node.js

```typescript
import { RollgateClient } from "@rollgate/sdk-node";

const client = new RollgateClient({
  apiKey: "your-api-key",
});

await client.init();

if (client.isEnabled("my-feature")) {
  // New feature code
}
```

### React

```tsx
import { RollgateProvider, useFlag } from "@rollgate/sdk-react";

function App() {
  return (
    <RollgateProvider config={{ apiKey: "your-api-key" }}>
      <MyComponent />
    </RollgateProvider>
  );
}

function MyComponent() {
  const isEnabled = useFlag("my-feature");
  return isEnabled ? <NewFeature /> : <OldFeature />;
}
```

### Vue

```typescript
import { createApp } from "vue";
import { RollgatePlugin } from "@rollgate/sdk-vue";

const app = createApp(App);
app.use(RollgatePlugin, { apiKey: "your-api-key" });
```

```vue
<script setup>
import { useFlag } from "@rollgate/sdk-vue";
const isEnabled = useFlag("my-feature");
</script>
```

### Go

```go
config := rollgate.DefaultConfig("your-api-key")
client, _ := rollgate.NewClient(config)
defer client.Close()

client.Initialize(ctx)

if client.IsEnabled("my-feature", false) {
    // New feature code
}
```

### Python

```python
from rollgate import RollgateClient, RollgateConfig

async with RollgateClient(RollgateConfig(api_key="your-api-key")) as client:
    if client.is_enabled("my-feature"):
        # New feature code
```

### Java

```java
Config config = new Config("your-api-key");
try (RollgateClient client = new RollgateClient(config)) {
    client.initialize();
    if (client.isEnabled("my-feature", false)) {
        // New feature code
    }
}
```

## Features

All SDKs include:

- **Local evaluation** - Evaluate flags locally for minimal latency
- **Real-time updates** - SSE streaming for instant flag changes
- **Caching** - Built-in caching with stale-while-revalidate
- **Circuit breaker** - Automatic fallback on API failures
- **Retry with backoff** - Exponential backoff with jitter
- **TypeScript support** - Full type definitions (TS SDKs)

## Documentation

| Document                                       | Description                   |
| ---------------------------------------------- | ----------------------------- |
| [Getting Started](./docs/GETTING-STARTED.md)   | Installation and first steps  |
| [Architecture](./docs/ARCHITECTURE.md)         | SDK architecture and patterns |
| [Production Setup](./docs/PRODUCTION-SETUP.md) | Best practices for production |

Full documentation available at [docs.rollgate.io](https://rollgate.io/docs)

## User Targeting

All SDKs support user targeting for personalized flag evaluation:

```typescript
await client.identify({
  id: "user-123",
  email: "user@example.com",
  attributes: { plan: "premium", country: "US" },
});
```

## API Keys

| Type   | Prefix      | Use Case                               |
| ------ | ----------- | -------------------------------------- |
| Server | `sb_server` | Backend (Node, Go, Java, Python)       |
| Client | `sb_client` | Frontend (React, Vue, Angular, Svelte) |

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](./LICENSE) for details.
