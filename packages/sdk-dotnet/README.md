# Rollgate .NET SDK

[![CI](https://github.com/rollgate/sdks/actions/workflows/ci.yml/badge.svg)](https://github.com/rollgate/sdks/actions/workflows/ci.yml)
[![NuGet](https://img.shields.io/nuget/v/Rollgate.SDK.svg)](https://www.nuget.org/packages/Rollgate.SDK)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Official .NET SDK for [Rollgate](https://rollgate.io) - Feature flags made simple.

## Requirements

- .NET 8.0+
- No external dependencies (uses only BCL: System.Text.Json, System.Net.Http, System.Security.Cryptography)

## Installation

```bash
dotnet add package Rollgate.SDK
```

## Quick Start

```csharp
using Rollgate.SDK;

// Create client
var config = new RollgateConfig { ApiKey = "your-api-key" };
using var client = new RollgateClient(config);

// Initialize (fetches flags)
await client.InitializeAsync();

// Check if a flag is enabled
if (client.IsEnabled("new-feature"))
{
    Console.WriteLine("New feature is enabled!");
}
```

## Configuration

```csharp
var config = new RollgateConfig
{
    ApiKey = "your-api-key",
    BaseUrl = "https://api.rollgate.io",       // optional
    Timeout = TimeSpan.FromSeconds(5),          // optional
    RefreshInterval = TimeSpan.FromSeconds(30), // optional, TimeSpan.Zero to disable polling
    EnableStreaming = false,                     // optional, enable SSE for real-time updates
    SseUrl = null,                              // optional, custom SSE URL

    // Retry configuration
    Retry = new RetryConfig
    {
        MaxRetries = 3,
        BaseDelay = TimeSpan.FromMilliseconds(100),
        MaxDelay = TimeSpan.FromSeconds(10),
        JitterFactor = 0.1,
    },

    // Circuit breaker configuration
    CircuitBreaker = new CircuitBreakerConfig
    {
        FailureThreshold = 5,
        RecoveryTimeout = TimeSpan.FromSeconds(30),
        MonitoringWindow = TimeSpan.FromSeconds(60),
        SuccessThreshold = 3,
    },

    // Cache configuration
    Cache = new CacheConfig
    {
        Ttl = TimeSpan.FromMinutes(5),
        StaleTtl = TimeSpan.FromHours(1),
        Enabled = true,
    },
};
```

## User Targeting

```csharp
// Identify a user for targeting
await client.IdentifyAsync(new UserContext
{
    Id = "user-123",
    Email = "user@example.com",
    Attributes = new Dictionary<string, object?>
    {
        ["plan"] = "premium",
        ["country"] = "IT",
    },
});

// Check flag for identified user
var enabled = client.IsEnabled("premium-feature");

// Reset user context
await client.ResetAsync();
```

## API Reference

### RollgateClient

| Method                          | Description                       |
| ------------------------------- | --------------------------------- |
| `InitializeAsync(ct)`           | Initialize and fetch flags        |
| `IsEnabled(key, default)`       | Check if flag is enabled          |
| `IsEnabledDetail(key, default)` | Check flag with evaluation reason |
| `GetAllFlags()`                 | Get all flag values               |
| `GetString(key, default)`       | Get string flag value             |
| `GetNumber(key, default)`       | Get number flag value             |
| `GetJson(key, default)`         | Get JSON flag value               |
| `IdentifyAsync(user, ct)`       | Set user context                  |
| `ResetAsync(ct)`                | Clear user context                |
| `RefreshAsync(ct)`              | Force refresh flags               |
| `GetMetrics()`                  | Get SDK metrics                   |
| `GetCacheStats()`               | Get cache statistics              |
| `GetCircuitState()`             | Get circuit breaker state         |
| `IsReady`                       | Check if client is initialized    |
| `Dispose()`                     | Stop polling and cleanup          |

### Evaluation Reasons

Get detailed information about why a flag evaluated to a particular value:

```csharp
var detail = client.IsEnabledDetail("my-flag", false);
Console.WriteLine(detail.Value);       // bool
Console.WriteLine(detail.Reason.Kind); // OFF, TARGET_MATCH, RULE_MATCH, FALLTHROUGH, ERROR, UNKNOWN
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
| `Closed`   | Normal operation, requests allowed  |
| `Open`     | Too many failures, requests blocked |
| `HalfOpen` | Testing recovery, limited requests  |

## Resilience Features

- **Circuit Breaker**: Protects against cascading failures
- **Retry with Backoff**: Exponential backoff with jitter
- **Request Deduplication**: Prevents duplicate concurrent requests
- **In-Memory Cache**: TTL-based caching with stale-while-revalidate
- **ETag Support**: Efficient 304 Not Modified responses
- **Error Classification**: Categorized errors (Network, Auth, RateLimit, Server)
- **SSE Streaming**: Real-time flag updates via Server-Sent Events

## Metrics

```csharp
var metrics = client.GetMetrics();

Console.WriteLine($"Total requests: {metrics.TotalRequests}");
Console.WriteLine($"Successful: {metrics.SuccessfulRequests}");
Console.WriteLine($"Cache hits: {metrics.CacheHits}");
Console.WriteLine($"Circuit state: {metrics.CircuitState}");
Console.WriteLine($"Total evaluations: {metrics.TotalEvaluations}");
```

## Error Handling

```csharp
try
{
    await client.InitializeAsync();
}
catch (RollgateException ex) when (ex.Category == ErrorCategory.Auth)
{
    Console.WriteLine("Invalid API key");
}
catch (RollgateException ex) when (ex.Category == ErrorCategory.RateLimit)
{
    Console.WriteLine("Rate limited, will retry");
}
catch (RollgateException ex) when (ex.Category == ErrorCategory.Network)
{
    Console.WriteLine("Network error, using cached flags");
}
```

Error categories:

| Category     | Description                  |
| ------------ | ---------------------------- |
| `Network`    | Connection or timeout errors |
| `Auth`       | Invalid API key              |
| `RateLimit`  | Rate limited (429)           |
| `Server`     | Server error (5xx)           |
| `Validation` | Invalid configuration        |

## Thread Safety

The SDK is fully thread-safe. All public methods use internal locking and can be safely called from multiple threads.

## Documentation

- [Getting Started](../../docs/GETTING-STARTED.md)
- [Architecture](../../docs/SDK-ARCHITECTURE.md)
- [Production Setup](../../docs/PRODUCTION-SETUP.md)

Full documentation: [docs.rollgate.io](https://rollgate.io/docs)

## About Rollgate

[Rollgate](https://rollgate.io) is a feature management platform that helps teams release features safely with gradual rollouts, user targeting, and instant kill switches.

## License

MIT
