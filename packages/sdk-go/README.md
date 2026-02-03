# @rollgate/sdk-go

[![CI](https://github.com/rollgate/sdks/actions/workflows/ci.yml/badge.svg)](https://github.com/rollgate/sdks/actions/workflows/ci.yml)
[![Go Reference](https://pkg.go.dev/badge/github.com/rollgate/sdks/packages/sdk-go.svg)](https://pkg.go.dev/github.com/rollgate/sdks/packages/sdk-go)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Official Go SDK for [Rollgate](https://rollgate.io) - Feature flags made simple.

## Requirements

- Go 1.21+

## Installation

```bash
go get github.com/rollgate/sdks/packages/sdk-go
```

## Quick Start

```go
package main

import (
    "context"
    "log"

    rollgate "github.com/rollgate/sdks/packages/sdk-go"
)

func main() {
    // Create client with default config
    config := rollgate.DefaultConfig("your-api-key")
    client, err := rollgate.NewClient(config)
    if err != nil {
        log.Fatal(err)
    }
    defer client.Close()

    // Initialize (fetches flags)
    ctx := context.Background()
    if err := client.Initialize(ctx); err != nil {
        log.Fatal(err)
    }

    // Check if a flag is enabled
    if client.IsEnabled("new-feature", false) {
        log.Println("New feature is enabled!")
    }
}
```

## Configuration

```go
config := rollgate.Config{
    APIKey:          "your-api-key",
    BaseURL:         "https://api.rollgate.io",  // optional
    Timeout:         5 * time.Second,            // optional
    RefreshInterval: 30 * time.Second,           // optional, 0 to disable polling

    // Retry configuration
    Retry: rollgate.RetryConfig{
        MaxRetries:   3,
        BaseDelay:    100 * time.Millisecond,
        MaxDelay:     10 * time.Second,
        JitterFactor: 0.1,
    },

    // Circuit breaker configuration
    CircuitBreaker: rollgate.CircuitBreakerConfig{
        FailureThreshold: 5,
        RecoveryTimeout:  30 * time.Second,
        MonitoringWindow: 60 * time.Second,
        SuccessThreshold: 3,
    },

    // Cache configuration
    Cache: rollgate.CacheConfig{
        TTL:      5 * time.Minute,
        StaleTTL: 1 * time.Hour,
        Enabled:  true,
    },

    // Optional logger
    Logger: rollgate.NewDefaultLogger(),
}
```

## User Targeting

```go
// Identify a user for targeting
err := client.Identify(ctx, &rollgate.UserContext{
    ID:    "user-123",
    Email: "user@example.com",
    Attributes: map[string]any{
        "plan":    "premium",
        "country": "IT",
    },
})

// Check flag for identified user
enabled := client.IsEnabled("premium-feature", false)

// Reset user context
err = client.Reset(ctx)
```

## API Reference

### Client Methods

| Method                          | Description                       |
| ------------------------------- | --------------------------------- |
| `NewClient(config)`             | Create a new client               |
| `Initialize(ctx)`               | Initialize and fetch flags        |
| `IsEnabled(key, default)`       | Check if flag is enabled          |
| `IsEnabledDetail(key, default)` | Check flag with evaluation reason |
| `GetAllFlags()`                 | Get all flag values               |
| `Identify(ctx, user)`           | Set user context                  |
| `Reset(ctx)`                    | Clear user context                |
| `Refresh(ctx)`                  | Force refresh flags               |
| `GetMetrics()`                  | Get SDK metrics                   |
| `GetCircuitState()`             | Get circuit breaker state         |
| `IsReady()`                     | Check if client is initialized    |
| `Close()`                       | Stop polling and cleanup          |

### Evaluation Reasons

Get detailed information about why a flag evaluated to a particular value:

```go
detail := client.IsEnabledDetail("my-flag", false)
fmt.Println(detail.Value)       // bool
fmt.Println(detail.Reason.Kind) // "OFF", "TARGET_MATCH", "RULE_MATCH", "FALLTHROUGH", "ERROR", "UNKNOWN"
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

| State                  | Description                         |
| ---------------------- | ----------------------------------- |
| `CircuitStateClosed`   | Normal operation, requests allowed  |
| `CircuitStateOpen`     | Too many failures, requests blocked |
| `CircuitStateHalfOpen` | Testing recovery, limited requests  |

## Resilience Features

- **Circuit Breaker**: Protects against cascading failures
- **Retry with Backoff**: Exponential backoff with jitter
- **Request Deduplication**: Prevents duplicate concurrent requests
- **In-Memory Cache**: TTL-based caching with stale-while-revalidate
- **ETag Support**: Efficient 304 Not Modified responses
- **Error Classification**: Categorized errors (Network, Auth, RateLimit, Server)
- **Metrics**: Request latency, success rates, cache hit rates

## Metrics

```go
metrics := client.GetMetrics()

fmt.Printf("Total requests: %d\n", metrics.TotalRequests)
fmt.Printf("Success rate: %.2f%%\n", float64(metrics.SuccessfulRequests)/float64(metrics.TotalRequests)*100)
fmt.Printf("Cache hit rate: %.2f%%\n", metrics.CacheHitRate*100)
fmt.Printf("Average latency: %.2fms\n", metrics.AverageLatency)
fmt.Printf("P99 latency: %dms\n", metrics.P99Latency)
```

## Error Handling

```go
import "errors"

err := client.Refresh(ctx)
if err != nil {
    var rollgateErr *rollgate.RollgateError
    if errors.As(err, &rollgateErr) {
        switch rollgateErr.Category {
        case rollgate.ErrorCategoryAuth:
            log.Fatal("Invalid API key")
        case rollgate.ErrorCategoryRateLimit:
            log.Println("Rate limited, will retry")
        case rollgate.ErrorCategoryNetwork:
            log.Println("Network error, using cached flags")
        }
    }
}
```

## Thread Safety

The SDK is fully thread-safe. You can safely call methods from multiple goroutines.

## Documentation

- [Getting Started](../../docs/GETTING-STARTED.md)
- [Architecture](../../docs/ARCHITECTURE.md)
- [Production Setup](../../docs/PRODUCTION-SETUP.md)

Full documentation: [docs.rollgate.io](https://rollgate.io/docs)

## About Rollgate

[Rollgate](https://rollgate.io) is a feature management platform that helps teams release features safely with gradual rollouts, user targeting, and instant kill switches.

## License

MIT
