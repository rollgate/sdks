# Rollgate Java SDK

[![CI](https://github.com/rollgate/sdks/actions/workflows/ci.yml/badge.svg)](https://github.com/rollgate/sdks/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Official Java SDK for [Rollgate](https://rollgate.io) - Feature flags made simple.

## Requirements

- Java 11+
- Maven or Gradle

## Installation

### Maven

```xml
<dependency>
    <groupId>io.rollgate</groupId>
    <artifactId>rollgate-sdk</artifactId>
    <version>1.1.0</version>
</dependency>
```

### Gradle

```groovy
implementation 'io.rollgate:rollgate-sdk:1.1.0'
```

## Quick Start

```java
import io.rollgate.RollgateClient;
import io.rollgate.Config;

public class Example {
    public static void main(String[] args) throws Exception {
        // Create client with default config
        Config config = new Config("your-api-key");

        try (RollgateClient client = new RollgateClient(config)) {
            // Initialize (fetches flags)
            client.initialize();

            // Check if a flag is enabled
            if (client.isEnabled("new-feature", false)) {
                System.out.println("New feature is enabled!");
            }
        }
    }
}
```

## Configuration

```java
Config config = new Config("your-api-key")
    .setBaseUrl("https://api.rollgate.io")
    .setTimeout(Duration.ofSeconds(5))
    .setRefreshInterval(Duration.ofSeconds(30));

// Retry configuration
Config.RetryConfig retryConfig = new Config.RetryConfig()
    .setMaxRetries(3)
    .setBaseDelay(Duration.ofMillis(100))
    .setMaxDelay(Duration.ofSeconds(10))
    .setJitterFactor(0.1);
config.setRetry(retryConfig);

// Circuit breaker configuration
Config.CircuitBreakerConfig cbConfig = new Config.CircuitBreakerConfig()
    .setFailureThreshold(5)
    .setRecoveryTimeout(Duration.ofSeconds(30))
    .setMonitoringWindow(Duration.ofSeconds(60))
    .setSuccessThreshold(3);
config.setCircuitBreaker(cbConfig);

// Cache configuration
Config.CacheConfig cacheConfig = new Config.CacheConfig()
    .setTtl(Duration.ofMinutes(5))
    .setStaleTtl(Duration.ofHours(1))
    .setEnabled(true);
config.setCache(cacheConfig);
```

## User Targeting

```java
import io.rollgate.UserContext;

// Identify a user for targeting
UserContext user = UserContext.builder("user-123")
    .email("user@example.com")
    .attribute("plan", "premium")
    .attribute("country", "IT")
    .build();

client.identify(user);

// Check flag for identified user
boolean enabled = client.isEnabled("premium-feature", false);

// Reset user context
client.reset();
```

## Event Tracking

Track conversion events for A/B testing experiments:

```java
import io.rollgate.EventCollector.TrackEventOptions;

// Track a conversion event
client.track(new TrackEventOptions("checkout-redesign", "purchase", "user-123"));

// Track with variation and value
client.track(new TrackEventOptions("checkout-redesign", "purchase", "user-123")
    .variationId("variant-b")
    .value(29.99)
    .metadata(Map.of("currency", "EUR", "item_count", 3)));

// Manually flush pending events
client.flushEvents();
```

Events are buffered in memory and flushed automatically every 30 seconds or when the buffer reaches 100 events. A final flush is attempted when the client is closed.

### TrackEventOptions

| Field         | Type                  | Required | Description                      |
| ------------- | --------------------- | -------- | -------------------------------- |
| `flagKey`     | `String`              | Yes      | The flag key for the experiment  |
| `eventName`   | `String`              | Yes      | Name of the conversion event     |
| `userId`      | `String`              | Yes      | The user who triggered the event |
| `variationId` | `String`              | No       | The variation the user saw       |
| `value`       | `Double`              | No       | Numeric value (e.g. revenue)     |
| `metadata`    | `Map<String, Object>` | No       | Additional event metadata        |

The builder-style API uses fluent methods: `.variationId(id)`, `.value(v)`, `.metadata(map)`.

## API Reference

### RollgateClient Methods

| Method                          | Description                       |
| ------------------------------- | --------------------------------- |
| `initialize()`                  | Initialize and fetch flags        |
| `isEnabled(key, default)`       | Check if flag is enabled          |
| `isEnabledDetail(key, default)` | Check flag with evaluation reason |
| `getAllFlags()`                 | Get all flag values               |
| `identify(user)`                | Set user context                  |
| `reset()`                       | Clear user context                |
| `refresh()`                     | Force refresh flags               |
| `track(options)`                | Track a conversion event          |
| `flushEvents()`                 | Flush pending conversion events   |
| `isReady()`                     | Check if client is initialized    |
| `getCircuitState()`             | Get circuit breaker state         |
| `getCacheStats()`               | Get cache statistics              |
| `close()`                       | Stop polling and cleanup          |

### Evaluation Reasons

Get detailed information about why a flag evaluated to a particular value:

```java
EvaluationDetail<Boolean> detail = client.isEnabledDetail("my-flag", false);
System.out.println(detail.getValue());         // Boolean
System.out.println(detail.getReason().getKind()); // "OFF", "TARGET_MATCH", etc.
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

| State       | Description                         |
| ----------- | ----------------------------------- |
| `CLOSED`    | Normal operation, requests allowed  |
| `OPEN`      | Too many failures, requests blocked |
| `HALF_OPEN` | Testing recovery, limited requests  |

## Resilience Features

- **Circuit Breaker**: Protects against cascading failures
- **Retry with Backoff**: Exponential backoff with jitter
- **Request Deduplication**: Prevents duplicate concurrent requests
- **In-Memory Cache**: TTL-based caching with stale-while-revalidate
- **ETag Support**: Efficient 304 Not Modified responses
- **Thread Safety**: All operations are thread-safe

## Thread Safety

The SDK is fully thread-safe. You can safely use the client from multiple threads.

## Documentation

- [Getting Started](../../docs/GETTING-STARTED.md)
- [Architecture](../../docs/ARCHITECTURE.md)
- [Production Setup](../../docs/PRODUCTION-SETUP.md)

Full documentation: [docs.rollgate.io](https://rollgate.io/docs)

## About Rollgate

[Rollgate](https://rollgate.io) is a feature management platform that helps teams release features safely with gradual rollouts, user targeting, and instant kill switches.

## License

MIT
