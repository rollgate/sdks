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

| Feature          | iOS | Android |
| ---------------- | --- | ------- |
| Polling          | Yes | Yes     |
| SSE Streaming    | Yes | Yes     |
| AsyncStorage     | Yes | Yes     |
| Background Fetch | No  | No      |

## Documentation

- [Getting Started](../../docs/GETTING-STARTED.md)
- [Architecture](../../docs/SDK-ARCHITECTURE.md)
- [Production Setup](../../docs/PRODUCTION-SETUP.md)

Full documentation: [docs.rollgate.io](https://rollgate.io/docs)

## About Rollgate

[Rollgate](https://rollgate.io) is a feature management platform that helps teams release features safely with gradual rollouts, user targeting, and instant kill switches.

## License

MIT
