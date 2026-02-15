# Rollgate SDKs

[![CI](https://github.com/rollgate/sdks/actions/workflows/ci.yml/badge.svg)](https://github.com/rollgate/sdks/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@rollgate/sdk-node.svg)](https://www.npmjs.com/package/@rollgate/sdk-node)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Official SDKs for [Rollgate](https://rollgate.io) - Feature flags made simple.

## Rollgate Overview

[Rollgate](https://rollgate.io) is a feature management platform that helps teams release features safely and iterate faster. [Get started](https://rollgate.io/docs) using Rollgate today!

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
| **Flutter** | [rollgate](./packages/sdk-flutter)              | `dart pub add rollgate`                           | [README](./packages/sdk-flutter/README.md) |
| **.NET**    | [Rollgate.SDK](./packages/sdk-dotnet)           | `dotnet add package Rollgate.SDK`                 | [README](./packages/sdk-dotnet/README.md)  |

## Supported Versions

| SDK     | Minimum Version              |
| ------- | ---------------------------- |
| Node.js | Node.js 18+                  |
| React   | React 16.8+ (requires Hooks) |
| Vue     | Vue 3.0+                     |
| Angular | Angular 14+                  |
| Svelte  | Svelte 4+                    |
| Go      | Go 1.21+                     |
| Java    | Java 11+                     |
| Python  | Python 3.9+                  |
| Flutter | Dart 3.0+ / Flutter 3.0+     |
| .NET    | .NET 8.0+                    |

## Browser Compatibility

The client-side SDKs (React, Vue, Angular, Svelte) work in all modern browsers:

- Chrome (latest 2 versions)
- Firefox (latest 2 versions)
- Safari (latest 2 versions)
- Edge (latest 2 versions)

For SSE streaming support, the browser must support `EventSource`. All modern browsers include this natively.

## Getting Started

Refer to the [Getting Started Guide](./docs/GETTING-STARTED.md) for detailed installation and setup instructions.

### Quick Start - Node.js

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

### Quick Start - React

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

### Event Tracking

All SDKs support tracking conversion events for A/B testing:

```typescript
// Track a conversion event
client.track({
  flagKey: "checkout-redesign",
  eventName: "purchase",
  userId: "user-123",
  value: 29.99,
});

// Flush pending events
await client.flushEvents();
```

For other SDKs (Vue, Go, Java, Python, Flutter, .NET), see the [Getting Started Guide](./docs/GETTING-STARTED.md).

## Features

All SDKs include:

- **Local evaluation** - Evaluate flags locally for minimal latency
- **Real-time updates** - SSE streaming for instant flag changes
- **Caching** - Built-in caching with stale-while-revalidate
- **Circuit breaker** - Automatic fallback on API failures
- **Retry with backoff** - Exponential backoff with jitter
- **Event tracking** - Track conversion events for A/B testing
- **TypeScript support** - Full type definitions (TypeScript SDKs)

## Learn More

| Document                                       | Description                   |
| ---------------------------------------------- | ----------------------------- |
| [Getting Started](./docs/GETTING-STARTED.md)   | Installation and first steps  |
| [Architecture](./docs/ARCHITECTURE.md)         | SDK architecture and patterns |
| [Production Setup](./docs/PRODUCTION-SETUP.md) | Best practices for production |

Full documentation available at [docs.rollgate.io](https://rollgate.io/docs)

## API Keys

Rollgate uses prefixed API keys to distinguish between server and client usage:

| Type   | Prefix      | Use Case                               |
| ------ | ----------- | -------------------------------------- |
| Server | `sb_server` | Backend (Node, Go, Java, Python)       |
| Client | `sb_client` | Frontend (React, Vue, Angular, Svelte) |

**Important**: Never expose server keys in client-side code. Use client keys for browser applications.

## Testing

We run integration tests for all SDKs using GitHub Actions. Tests cover flag evaluation, caching, retry logic, circuit breaker behavior, and SSE streaming. See the [CI workflow](./.github/workflows/ci.yml) for details.

## Contributing

We encourage pull requests and other contributions from the community. Check out our [contributing guidelines](CONTRIBUTING.md) for instructions on how to contribute to these SDKs.

## About Rollgate

Rollgate is a feature management platform that allows developers to ship features safely and iterate quickly. With Rollgate, you can:

- **Gradual rollouts** - Release features to a percentage of users and increase gradually
- **User targeting** - Show features to specific users based on attributes (plan, country, etc.)
- **Kill switches** - Instantly disable features in production without redeploying
- **A/B testing** - Run experiments and measure impact on key metrics
- **Scheduled releases** - Plan feature launches in advance

### Explore Rollgate

- [rollgate.io](https://rollgate.io) - Main website
- [docs.rollgate.io](https://rollgate.io/docs) - Documentation
- [app.rollgate.io](https://app.rollgate.io) - Dashboard

## License

MIT License - see [LICENSE](./LICENSE) for details.
