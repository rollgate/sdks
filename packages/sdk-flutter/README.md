# Rollgate Flutter/Dart SDK

[![CI](https://github.com/rollgate/sdks/actions/workflows/ci.yml/badge.svg)](https://github.com/rollgate/sdks/actions/workflows/ci.yml)
[![pub package](https://img.shields.io/pub/v/rollgate.svg)](https://pub.dev/packages/rollgate)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Official Dart/Flutter SDK for [Rollgate](https://rollgate.io) - Feature flags made simple.

## Requirements

- Dart SDK >= 3.0.0
- Dependencies: `http ^1.2.0`, `crypto ^3.0.0`

## Installation

Add to your `pubspec.yaml`:

```yaml
dependencies:
  rollgate: ^0.1.0
```

Then run:

```bash
dart pub get
```

## Quick Start

```dart
import 'package:rollgate/rollgate.dart';

void main() async {
  // Create client
  final config = RollgateConfig(apiKey: 'your-api-key');
  final client = RollgateClient(config);

  // Initialize (fetches flags)
  await client.initialize();

  // Check if a flag is enabled
  if (client.isEnabled('new-feature')) {
    print('New feature is enabled!');
  }

  // Cleanup
  client.close();
}
```

## Configuration

```dart
final config = RollgateConfig(
  apiKey: 'your-api-key',
  baseUrl: 'https://api.rollgate.io',             // optional
  timeout: Duration(seconds: 5),                   // optional
  refreshInterval: Duration(seconds: 30),          // optional

  // Retry configuration
  retry: RetryConfig(
    maxRetries: 3,
    baseDelay: Duration(milliseconds: 100),
    maxDelay: Duration(seconds: 10),
    jitterFactor: 0.1,
  ),

  // Circuit breaker configuration
  circuitBreaker: CircuitBreakerConfig(
    failureThreshold: 5,
    recoveryTimeout: Duration(seconds: 30),
    monitoringWindow: Duration(seconds: 60),
    successThreshold: 3,
  ),

  // Cache configuration
  cache: CacheConfig(
    ttl: Duration(minutes: 5),
    staleTtl: Duration(hours: 1),
    enabled: true,
  ),
);
```

## User Targeting

```dart
// Identify a user for targeting
await client.identify(UserContext(
  id: 'user-123',
  email: 'user@example.com',
  attributes: {
    'plan': 'premium',
    'country': 'IT',
  },
));

// Check flag for identified user
final enabled = client.isEnabled('premium-feature');

// Reset user context
await client.reset();
```

## API Reference

### RollgateClient

| Method                            | Description                       |
| --------------------------------- | --------------------------------- |
| `initialize()`                    | Initialize and fetch flags        |
| `isEnabled(key, [default])`       | Check if flag is enabled          |
| `isEnabledDetail(key, [default])` | Check flag with evaluation reason |
| `getAllFlags()`                   | Get all flag values               |
| `getString(key, default)`         | Get string flag value             |
| `getNumber(key, default)`         | Get number flag value             |
| `getJson(key, default)`           | Get JSON flag value               |
| `identify(user)`                  | Set user context                  |
| `reset()`                         | Clear user context                |
| `refresh()`                       | Force refresh flags               |
| `close()`                         | Stop polling and cleanup          |

### Properties

| Property       | Type              | Description                   |
| -------------- | ----------------- | ----------------------------- |
| `isReady`      | `bool`            | Whether client is initialized |
| `circuitState` | `String`          | Circuit breaker state         |
| `metrics`      | `MetricsSnapshot` | SDK metrics                   |
| `cacheStats`   | `CacheStats`      | Cache hit/miss statistics     |

### Evaluation Reasons

Get detailed information about why a flag evaluated to a particular value:

```dart
final detail = client.isEnabledDetail('my-flag', false);
print(detail.value);       // bool
print(detail.reason.kind); // OFF, TARGET_MATCH, RULE_MATCH, FALLTHROUGH, ERROR, UNKNOWN
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

### Circuit Breaker States

| State      | Description                         |
| ---------- | ----------------------------------- |
| `closed`   | Normal operation, requests allowed  |
| `open`     | Too many failures, requests blocked |
| `halfOpen` | Testing recovery, limited requests  |

## Resilience Features

- **Circuit Breaker**: Protects against cascading failures
- **Retry with Backoff**: Exponential backoff with jitter
- **Request Deduplication**: Prevents duplicate concurrent requests
- **In-Memory Cache**: TTL-based caching with stale-while-revalidate
- **ETag Support**: Efficient 304 Not Modified responses
- **Error Classification**: Categorized errors (Network, Auth, RateLimit, Server)

## Metrics

```dart
final metrics = client.metrics;

print('Total requests: ${metrics.totalRequests}');
print('Successful: ${metrics.successfulRequests}');
print('Cache hits: ${metrics.cacheHits}');
print('Circuit state: ${metrics.circuitState}');
print('Total evaluations: ${metrics.totalEvaluations}');
```

## Error Handling

```dart
try {
  await client.initialize();
} on RollgateException catch (e) {
  switch (e.category) {
    case ErrorCategory.auth:
      print('Invalid API key');
    case ErrorCategory.rateLimit:
      print('Rate limited, will retry');
    case ErrorCategory.network:
      print('Network error, using cached flags');
    default:
      print('Error: ${e.message}');
  }
}
```

Error categories:

| Category     | Description                  |
| ------------ | ---------------------------- |
| `network`    | Connection or timeout errors |
| `auth`       | Invalid API key              |
| `rateLimit`  | Rate limited (429)           |
| `server`     | Server error (5xx)           |
| `validation` | Invalid configuration        |

## Platform Differences

| Feature          | iOS | Android | Web | Notes                      |
| ---------------- | --- | ------- | --- | -------------------------- |
| Polling          | Yes | Yes     | Yes | Default update method      |
| SSE Streaming    | No  | No      | No  | Use polling instead        |
| Circuit Breaker  | Yes | Yes     | Yes | Fault tolerance built-in   |
| In-Memory Cache  | Yes | Yes     | Yes | Flags cached between polls |
| Background Fetch | No  | No      | No  | App must be in foreground  |

## Flutter Integration

```dart
import 'package:flutter/material.dart';
import 'package:rollgate/rollgate.dart';

class MyApp extends StatefulWidget {
  @override
  State<MyApp> createState() => _MyAppState();
}

class _MyAppState extends State<MyApp> {
  late RollgateClient _client;

  @override
  void initState() {
    super.initState();
    _client = RollgateClient(RollgateConfig(apiKey: 'your-api-key'));
    _client.initialize();
  }

  @override
  void dispose() {
    _client.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_client.isEnabled('new-ui')) {
      return NewUI();
    }
    return OldUI();
  }
}
```

## Documentation

- [Getting Started](../../docs/GETTING-STARTED.md)
- [Architecture](../../docs/SDK-ARCHITECTURE.md)
- [Production Setup](../../docs/PRODUCTION-SETUP.md)

Full documentation: [docs.rollgate.io](https://rollgate.io/docs)

## About Rollgate

[Rollgate](https://rollgate.io) is a feature management platform that helps teams release features safely with gradual rollouts, user targeting, and instant kill switches.

## License

MIT
