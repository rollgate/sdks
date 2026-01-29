# Rollgate Java SDK

Official Java SDK for [Rollgate](https://rollgate.io) feature flags.

## Requirements

- Java 11+
- Maven or Gradle

## Installation

### Maven

```xml
<dependency>
    <groupId>io.rollgate</groupId>
    <artifactId>rollgate-sdk</artifactId>
    <version>0.1.0</version>
</dependency>
```

### Gradle

```groovy
implementation 'io.rollgate:rollgate-sdk:0.1.0'
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

## API Reference

### RollgateClient Methods

| Method                    | Description                    |
| ------------------------- | ------------------------------ |
| `initialize()`            | Initialize and fetch flags     |
| `isEnabled(key, default)` | Check if flag is enabled       |
| `getAllFlags()`           | Get all flag values            |
| `identify(user)`          | Set user context               |
| `reset()`                 | Clear user context             |
| `refresh()`               | Force refresh flags            |
| `isReady()`               | Check if client is initialized |
| `getCircuitState()`       | Get circuit breaker state      |
| `getCacheStats()`         | Get cache statistics           |
| `close()`                 | Stop polling and cleanup       |

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

## License

MIT
