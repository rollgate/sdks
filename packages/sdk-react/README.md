# @rollgate/sdk-react

Official React SDK for [Rollgate](https://rollgate.io) - Feature flags made simple.

## Installation

```bash
npm install @rollgate/sdk-react
```

## Quick Start

```tsx
import { RollgateProvider, useFlag } from "@rollgate/sdk-react";

function App() {
  return (
    <RollgateProvider config={{ apiKey: "sb_client_your_api_key" }}>
      <MyComponent />
    </RollgateProvider>
  );
}

function MyComponent() {
  const showNewFeature = useFlag("new-feature");
  return showNewFeature ? <NewFeature /> : <OldFeature />;
}
```

## Provider Configuration

```tsx
<RollgateProvider
  config={{
    apiKey: "sb_client_your_api_key", // Required
    baseUrl: "https://api.rollgate.io", // Optional
    refreshInterval: 60000, // Polling interval in ms (default: 60000)
    enableStreaming: false, // Enable SSE for real-time (default: false)
  }}
  user={{
    // Optional: Initial user context
    id: "user-123",
    email: "user@example.com",
    attributes: { plan: "premium" },
  }}
>
  {children}
</RollgateProvider>
```

## Polling vs Streaming

| Mode              | Default | Use Case                             |
| ----------------- | ------- | ------------------------------------ |
| **Polling**       | Yes     | Most apps, flags change infrequently |
| **SSE Streaming** | No      | Real-time updates, kill switches     |

```tsx
// Polling mode (default) - polls every 60s
<RollgateProvider config={{ apiKey: 'xxx' }}>

// Streaming mode - real-time SSE updates
<RollgateProvider config={{ apiKey: 'xxx', enableStreaming: true }}>
```

## Production Setup

For production apps with many users, we recommend the **proxy pattern** using `@rollgate/sdk-node` on your backend:

```
Browser ──> Your Backend (sdk-node) ──> Rollgate
```

This approach:

- Keeps API keys secure (never exposed in browser)
- Scales to millions of users (1 connection per server, not per user)
- Provides resilience (cached flags work if Rollgate is down)

See full guide: [Production Setup](../../docs/PRODUCTION-SETUP.md)

## Hooks

### useFlag

Check a single flag:

```tsx
const showFeature = useFlag("feature-key");
const showBeta = useFlag("beta-feature", false); // With default
```

### useFlags

Check multiple flags:

```tsx
const flags = useFlags(["dark-mode", "new-sidebar"]);
// { 'dark-mode': true, 'new-sidebar': false }
```

### useRollgate

Access the full context:

```tsx
const { isEnabled, isLoading, isError, identify, reset, refresh, flags } =
  useRollgate();
```

## Feature Component

Declarative feature flag rendering:

```tsx
import { Feature } from '@rollgate/sdk-react';

<Feature flag="new-reviews">
  <ReviewsSection />
</Feature>

<Feature flag="ai-recommendations" fallback={<Classic />}>
  <AIRecommendations />
</Feature>
```

## User Identification

```tsx
const { identify, reset } = useRollgate();

// After login
await identify({ id: user.id, email: user.email });

// After logout
await reset();
```

## Documentation

Full documentation: [docs/SDK-DOCUMENTATION.md](../../docs/SDK-DOCUMENTATION.md)

## License

MIT
