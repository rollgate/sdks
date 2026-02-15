# @rollgate/sdk-react-native

[![CI](https://github.com/rollgate/sdks/actions/workflows/ci.yml/badge.svg)](https://github.com/rollgate/sdks/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@rollgate/sdk-react-native.svg)](https://www.npmjs.com/package/@rollgate/sdk-react-native)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Official React Native SDK for [Rollgate](https://rollgate.io) - Feature flags made simple.

## Requirements

- React Native 0.60+
- React 16.8+ (requires Hooks)
- Expo SDK 41+ (if using Expo)

## Installation

```bash
npm install @rollgate/sdk-react-native
```

For bare React Native projects:

```bash
npx pod-install
```

## Quick Start

```tsx
import { RollgateProvider, useFlag } from "@rollgate/sdk-react-native";

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
    refreshInterval: 30000, // Polling interval in ms (default: 30000)
    timeout: 10000, // Request timeout in ms (default: 10000)
    events: {
      // Event collector configuration (optional)
      flushIntervalMs: 30000, // Flush every 30s (default)
      maxBufferSize: 100, // Max events before auto-flush (default)
    },
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
  identify,
  reset,
  refresh,
  track,
  flags,
} = useRollgate();
```

### useMetrics

Access SDK metrics:

```tsx
const { metrics } = useMetrics();
console.log(metrics.totalRequests, metrics.cacheHitRate);
```

## Event Tracking

Track conversion events for A/B testing experiments:

```tsx
import { useRollgate } from "@rollgate/sdk-react-native";

function CheckoutScreen() {
  const { track } = useRollgate();

  const handlePurchase = (amount: number) => {
    // Track the conversion event
    track({
      flagKey: "checkout-redesign",
      eventName: "purchase",
      userId: "user-123",
      value: amount,
      metadata: { currency: "EUR" },
    });
  };

  return <Button onPress={() => handlePurchase(29.99)} title="Buy Now" />;
}
```

You can also track events directly from the client:

```tsx
import { createClient } from "@rollgate/sdk-react-native";

const client = createClient("your-api-key", { id: "user-123" });
await client.waitForInitialization();

// Track a conversion event
client.track({
  flagKey: "checkout-redesign",
  eventName: "purchase",
  userId: "user-123",
  variationId: "variant-b",
  value: 29.99,
  metadata: { currency: "EUR", item_count: 3 },
});

// Manually flush pending events
await client.flush();
```

Events are buffered in memory and flushed automatically every 30 seconds or when the buffer reaches 100 events. A final flush is attempted when the client is closed.

### TrackEventOptions

| Field         | Type                       | Required | Description                      |
| ------------- | -------------------------- | -------- | -------------------------------- |
| `flagKey`     | `string`                   | Yes      | The flag key for the experiment  |
| `eventName`   | `string`                   | Yes      | Name of the conversion event     |
| `userId`      | `string`                   | Yes      | The user who triggered the event |
| `variationId` | `string?`                  | No       | The variation the user saw       |
| `value`       | `number?`                  | No       | Numeric value (e.g. revenue)     |
| `metadata`    | `Record<string, unknown>?` | No       | Additional event metadata        |

## Feature Component

Declarative feature flag rendering:

```tsx
import { Feature } from "@rollgate/sdk-react-native";

function ProductPage() {
  return (
    <View>
      <Text>Product</Text>

      {/* Show children only if flag is enabled */}
      <Feature flag="new-reviews">
        <ReviewsSection />
      </Feature>

      {/* With fallback content */}
      <Feature flag="ai-recommendations" fallback={<ClassicRecommendations />}>
        <AIRecommendations />
      </Feature>
    </View>
  );
}
```

## User Identification

```tsx
const { identify, reset } = useRollgate();

// After login
await identify({ id: user.id, email: user.email });

// After logout
await reset();
```

## Offline Support

The SDK automatically caches flags in AsyncStorage for offline use:

```tsx
<RollgateProvider
  config={{
    apiKey: "sb_client_your_api_key",
    // Flags are cached automatically
  }}
>
```

## Platform Differences

| Feature          | iOS | Android | Notes                     |
| ---------------- | --- | ------- | ------------------------- |
| Polling          | Yes | Yes     | Default update method     |
| AsyncStorage     | Yes | Yes     | Automatic offline cache   |
| Circuit Breaker  | Yes | Yes     | Fault tolerance built-in  |
| Event Tracking   | Yes | Yes     | Buffered with auto-flush  |
| SSE Streaming    | No  | No      | Use polling instead       |
| Background Fetch | No  | No      | App must be in foreground |

## API Reference

### Hooks

| Hook            | Description                           |
| --------------- | ------------------------------------- |
| `useFlag`       | Check a single boolean flag           |
| `useFlagDetail` | Check flag with evaluation reason     |
| `useFlags`      | Check multiple flags at once          |
| `useStringFlag` | Get a string flag value               |
| `useNumberFlag` | Get a number flag value               |
| `useJSONFlag`   | Get a JSON flag value                 |
| `useRollgate`   | Access full context (identify, track) |
| `useMetrics`    | Access SDK metrics                    |

### Context (useRollgate)

| Property       | Type                                   | Description                   |
| -------------- | -------------------------------------- | ----------------------------- |
| `isEnabled`    | `(key, default?) => boolean`           | Check if flag is enabled      |
| `isLoading`    | `boolean`                              | True while initial load       |
| `isError`      | `boolean`                              | True if fetch error occurred  |
| `isStale`      | `boolean`                              | True if using cached flags    |
| `circuitState` | `CircuitState`                         | Current circuit breaker state |
| `flags`        | `Record<string, boolean>`              | All flags as key-value object |
| `identify`     | `(user) => Promise<void>`              | Set user context              |
| `reset`        | `() => Promise<void>`                  | Clear user context            |
| `refresh`      | `() => Promise<void>`                  | Force refresh flags           |
| `track`        | `(options: TrackEventOptions) => void` | Track a conversion event      |
| `getMetrics`   | `() => MetricsSnapshot`                | Get metrics snapshot          |
| `client`       | `RollgateReactNativeClient \| null`    | Underlying client instance    |

### Client Methods

| Method                           | Description                       |
| -------------------------------- | --------------------------------- |
| `waitForInitialization()`        | Wait for client to be ready       |
| `isReady()`                      | Check if client is initialized    |
| `isEnabled(key, default?)`       | Check if flag is enabled          |
| `isEnabledDetail(key, default?)` | Check flag with evaluation reason |
| `allFlags()`                     | Get all boolean flags             |
| `identify(user)`                 | Set user context                  |
| `reset()`                        | Clear user context                |
| `refresh()`                      | Force refresh flags               |
| `track(options)`                 | Track a conversion event          |
| `flush()`                        | Flush pending events              |
| `getCircuitState()`              | Get circuit breaker state         |
| `getMetrics()`                   | Get metrics snapshot              |
| `close()`                        | Cleanup resources                 |

## Documentation

- [Getting Started](../../docs/GETTING-STARTED.md)
- [Architecture](../../docs/SDK-ARCHITECTURE.md)
- [Production Setup](../../docs/PRODUCTION-SETUP.md)

Full documentation: [docs.rollgate.io](https://rollgate.io/docs)

## About Rollgate

[Rollgate](https://rollgate.io) is a feature management platform that helps teams release features safely with gradual rollouts, user targeting, and instant kill switches.

## License

MIT
