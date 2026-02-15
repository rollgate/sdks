# @rollgate/sdk-react

[![CI](https://github.com/rollgate/sdks/actions/workflows/ci.yml/badge.svg)](https://github.com/rollgate/sdks/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@rollgate/sdk-react.svg)](https://www.npmjs.com/package/@rollgate/sdk-react)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Official React SDK for [Rollgate](https://rollgate.io) - Feature flags made simple.

## Requirements

- React 16.8+ (requires Hooks)
- Works with Next.js, Remix, Vite, CRA

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

See full guide: [Production Setup](../../docs/PRODUCTION-SETUP.md) for details.

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

### useFlagDetail

Get flag value with evaluation reason:

```tsx
const { value, reason } = useFlagDetail("feature-key", false);
console.log(value); // boolean
console.log(reason.kind); // "FALLTHROUGH", "TARGET_MATCH", etc.
```

### useRollgate

Access the full context:

```tsx
const {
  isEnabled,
  isLoading,
  isError,
  isStale,
  circuitState,
  flags,
  identify,
  reset,
  refresh,
  getMetrics,
  track,
  flush,
} = useRollgate();
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

## Event Tracking

Track conversion events for A/B testing:

```tsx
import { useRollgate } from "@rollgate/sdk-react";
import { useEffect } from "react";

function CheckoutButton() {
  const { track, flush } = useRollgate();

  const handlePurchase = () => {
    track({
      flagKey: "checkout-redesign",
      eventName: "purchase",
      userId: "user-123",
      value: 29.99,
    });
  };

  // Flush pending events on unmount (auto-flushes every 30s)
  useEffect(() => {
    return () => {
      flush();
    };
  }, []);

  return <button onClick={handlePurchase}>Buy Now</button>;
}
```

### TrackEventOptions

| Field         | Type                      | Required | Description                                 |
| ------------- | ------------------------- | -------- | ------------------------------------------- |
| `flagKey`     | `string`                  | Yes      | The flag key this event is associated with  |
| `eventName`   | `string`                  | Yes      | Event name (e.g., `'purchase'`, `'signup'`) |
| `userId`      | `string`                  | Yes      | User ID                                     |
| `variationId` | `string`                  | No       | Variation ID the user was exposed to        |
| `value`       | `number`                  | No       | Numeric value (e.g., revenue amount)        |
| `metadata`    | `Record<string, unknown>` | No       | Optional metadata                           |

## API Reference

| Hook / Component   | Description                                |
| ------------------ | ------------------------------------------ |
| `useFlag`          | Check a single flag (reactive)             |
| `useFlags`         | Check multiple flags (reactive)            |
| `useFlagDetail`    | Flag value with evaluation reason          |
| `useRollgate`      | Full context (flags, identify, track, etc) |
| `useMetrics`       | SDK metrics snapshot                       |
| `Feature`          | Declarative conditional rendering          |
| `RollgateProvider` | Context provider                           |

### useRollgate() Methods

| Method / Property | Description                            |
| ----------------- | -------------------------------------- |
| `isEnabled()`     | Check if a flag is enabled             |
| `isLoading`       | True while initial flags are loading   |
| `isError`         | True if there was an error             |
| `isStale`         | True if using cached/stale flags       |
| `circuitState`    | Current circuit breaker state          |
| `flags`           | All flags as key-value object          |
| `identify(user)`  | Change user context                    |
| `reset()`         | Clear user context                     |
| `refresh()`       | Force refresh flags                    |
| `getMetrics()`    | Get SDK metrics snapshot               |
| `track(options)`  | Track a conversion event (A/B testing) |
| `flush()`         | Flush pending events to the server     |
| `client`          | Access the underlying browser client   |

## Documentation

- [Getting Started](../../docs/GETTING-STARTED.md)
- [Architecture](../../docs/ARCHITECTURE.md)
- [Production Setup](../../docs/PRODUCTION-SETUP.md)

Full documentation: [docs.rollgate.io](https://rollgate.io/docs)

## About Rollgate

[Rollgate](https://rollgate.io) is a feature management platform that helps teams release features safely with gradual rollouts, user targeting, and instant kill switches.

## License

MIT
