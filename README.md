# Rollgate SDKs

Official SDKs for [Rollgate](https://rollgate.io) - Feature flags made simple.

## Available SDKs

| SDK         | Package                                         | Install                                           |
| ----------- | ----------------------------------------------- | ------------------------------------------------- |
| **Node.js** | [@rollgate/sdk-node](./packages/sdk-node)       | `npm install @rollgate/sdk-node`                  |
| **React**   | [@rollgate/sdk-react](./packages/sdk-react)     | `npm install @rollgate/sdk-react`                 |
| **Vue**     | [@rollgate/sdk-vue](./packages/sdk-vue)         | `npm install @rollgate/sdk-vue`                   |
| **Angular** | [@rollgate/sdk-angular](./packages/sdk-angular) | `npm install @rollgate/sdk-angular`               |
| **Svelte**  | [@rollgate/sdk-svelte](./packages/sdk-svelte)   | `npm install @rollgate/sdk-svelte`                |
| **Go**      | [sdk-go](./packages/sdk-go)                     | `go get github.com/rollgate/sdks/packages/sdk-go` |
| **Java**    | [sdk-java](./packages/sdk-java)                 | Maven/Gradle                                      |
| **Python**  | [rollgate](./packages/sdk-python)               | `pip install rollgate`                            |

## Quick Start

### Node.js

```typescript
import { RollgateClient } from "@rollgate/sdk-node";

const client = new RollgateClient({
  apiKey: "your-api-key",
  environment: "production",
});

await client.initialize();

const isEnabled = client.isEnabled("my-feature", { userId: "user-123" });
```

### React

```tsx
import { RollgateProvider, useFlag } from "@rollgate/sdk-react";

function App() {
  return (
    <RollgateProvider apiKey="your-api-key" environment="production">
      <MyComponent />
    </RollgateProvider>
  );
}

function MyComponent() {
  const isEnabled = useFlag("my-feature");
  return isEnabled ? <NewFeature /> : <OldFeature />;
}
```

## Features

All SDKs include:

- **Local evaluation** - Evaluate flags locally for minimal latency
- **Real-time updates** - SSE streaming for instant flag changes
- **Caching** - Built-in caching with stale-while-revalidate
- **Circuit breaker** - Automatic fallback on API failures
- **Retry with backoff** - Exponential backoff with jitter
- **TypeScript support** - Full type definitions

## Documentation

Full documentation available at [docs.rollgate.io](https://rollgate.io/docs)

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](./LICENSE) for details.
