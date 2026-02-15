# Rollgate Python SDK

[![CI](https://github.com/rollgate/sdks/actions/workflows/ci.yml/badge.svg)](https://github.com/rollgate/sdks/actions/workflows/ci.yml)
[![PyPI version](https://img.shields.io/pypi/v/rollgate.svg)](https://pypi.org/project/rollgate/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Official Python SDK for [Rollgate](https://rollgate.io) - Feature flags made simple.

## Requirements

- Python 3.9+
- httpx >= 0.25.0
- httpx-sse >= 0.4.0

## Installation

```bash
pip install rollgate
```

## Quick Start

```python
import asyncio
from rollgate import RollgateClient, RollgateConfig, UserContext

async def main():
    # Initialize client
    config = RollgateConfig(api_key="your-api-key")
    client = RollgateClient(config)

    # Initialize and fetch flags
    await client.init()

    # Check if feature is enabled
    if client.is_enabled("new-feature"):
        print("New feature is enabled!")

    # With user targeting
    await client.identify(UserContext(
        id="user-123",
        email="user@example.com",
        attributes={"plan": "pro", "country": "IT"}
    ))

    if client.is_enabled("premium-feature"):
        print("Premium feature is enabled for this user!")

    # Cleanup
    await client.close()

asyncio.run(main())
```

## Context Manager

```python
async with RollgateClient(RollgateConfig(api_key="your-api-key")) as client:
    if client.is_enabled("my-feature"):
        # Feature is enabled
        pass
```

## Configuration

```python
from rollgate import (
    RollgateConfig,
    RetryConfig,
    CircuitBreakerConfig,
    CacheConfig,
)

config = RollgateConfig(
    api_key="your-api-key",
    base_url="https://api.rollgate.io",  # Custom API URL
    refresh_interval_ms=30000,  # Polling interval (30s default)
    enable_streaming=False,  # Use SSE for real-time updates
    timeout_ms=5000,  # Request timeout

    # Retry configuration
    retry=RetryConfig(
        max_retries=3,
        base_delay_ms=100,
        max_delay_ms=10000,
        jitter_factor=0.1,
    ),

    # Circuit breaker configuration
    circuit_breaker=CircuitBreakerConfig(
        failure_threshold=5,
        recovery_timeout_ms=30000,
        monitoring_window_ms=60000,
        success_threshold=3,
    ),

    # Cache configuration
    cache=CacheConfig(
        ttl_ms=300000,  # 5 minutes
        stale_ttl_ms=3600000,  # 1 hour
        persist_path="/tmp/rollgate-cache.json",  # Optional persistence
    ),
)
```

## Events

```python
client = RollgateClient(config)

# Register event callbacks
client.on("ready", lambda: print("Client ready"))
client.on("flags_updated", lambda flags: print(f"Flags updated: {flags}"))
client.on("flag_changed", lambda key, new, old: print(f"{key}: {old} -> {new}"))
client.on("error", lambda err: print(f"Error: {err}"))
client.on("circuit_open", lambda *args: print("Circuit breaker opened"))
client.on("circuit_closed", lambda: print("Circuit breaker closed"))

await client.init()
```

## Event Tracking

Track conversion events for A/B testing experiments:

```python
from rollgate import TrackEventOptions

# Track a conversion event
client.track(TrackEventOptions(
    flag_key="checkout-redesign",
    event_name="purchase",
    user_id="user-123",
))

# Track with all options
client.track(TrackEventOptions(
    flag_key="checkout-redesign",
    event_name="purchase",
    user_id="user-123",
    variation_id="variant-b",
    value=29.99,
    metadata={"currency": "EUR", "item_count": 3},
))

# Manually flush pending events
await client.flush_events()
```

Events are buffered in memory and flushed automatically every 30 seconds or when the buffer reaches 100 events. A final flush is attempted when the client is closed.

### TrackEventOptions

| Field          | Type              | Required | Description                      |
| -------------- | ----------------- | -------- | -------------------------------- |
| `flag_key`     | `str`             | Yes      | The flag key for the experiment  |
| `event_name`   | `str`             | Yes      | Name of the conversion event     |
| `user_id`      | `str`             | Yes      | The user who triggered the event |
| `variation_id` | `Optional[str]`   | No       | The variation the user saw       |
| `value`        | `Optional[float]` | No       | Numeric value (e.g. revenue)     |
| `metadata`     | `Optional[Dict]`  | No       | Additional event metadata        |

## Features

### Polling (Default)

By default, the SDK polls for flag updates every 30 seconds.

```python
config = RollgateConfig(
    api_key="your-api-key",
    refresh_interval_ms=30000,  # Poll every 30s
)
```

### SSE Streaming

Enable Server-Sent Events for real-time flag updates:

```python
config = RollgateConfig(
    api_key="your-api-key",
    enable_streaming=True,
)
```

### Circuit Breaker

The SDK includes a circuit breaker to prevent cascading failures:

```python
# Check circuit state
state = client.circuit_state  # CircuitState.CLOSED, OPEN, or HALF_OPEN

# Get statistics
stats = client.get_circuit_stats()

# Force reset
client.reset_circuit()
```

### Caching

Flags are cached locally with stale-while-revalidate support:

```python
# Get cache statistics
stats = client.get_cache_stats()
hit_rate = client.get_cache_hit_rate()

# Clear cache
client.clear_cache()
```

### Error Handling

```python
from rollgate import (
    RollgateError,
    AuthenticationError,
    NetworkError,
    RateLimitError,
)

try:
    await client.init()
except AuthenticationError as e:
    print(f"Invalid API key: {e}")
except NetworkError as e:
    print(f"Network error: {e}")
except RateLimitError as e:
    print(f"Rate limited, retry after: {e.retry_after}s")
except RollgateError as e:
    print(f"Rollgate error: {e}")
```

## API Reference

### RollgateClient

| Method                                  | Description                        |
| --------------------------------------- | ---------------------------------- |
| `init(user?)`                           | Initialize client and fetch flags  |
| `is_enabled(flag_key, default?)`        | Check if flag is enabled           |
| `is_enabled_detail(flag_key, default?)` | Check flag with evaluation reason  |
| `get_all_flags()`                       | Get all flags as dictionary        |
| `identify(user)`                        | Set user context and refresh flags |
| `reset()`                               | Clear user context                 |
| `refresh()`                             | Force refresh flags                |
| `track(options)`                        | Track a conversion event           |
| `flush_events()`                        | Flush pending conversion events    |
| `close()`                               | Cleanup resources                  |

### Evaluation Reasons

Get detailed information about why a flag evaluated to a particular value:

```python
detail = client.is_enabled_detail("my-flag", False)
print(detail.value)        # bool
print(detail.reason.kind)  # "OFF", "TARGET_MATCH", "RULE_MATCH", "FALLTHROUGH", "ERROR", "UNKNOWN"
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

### UserContext

| Field        | Type    | Description                     |
| ------------ | ------- | ------------------------------- |
| `id`         | `str`   | User identifier (required)      |
| `email`      | `str?`  | User email                      |
| `attributes` | `dict?` | Custom attributes for targeting |

## Documentation

- [Getting Started](../../docs/GETTING-STARTED.md)
- [Architecture](../../docs/ARCHITECTURE.md)
- [Production Setup](../../docs/PRODUCTION-SETUP.md)

Full documentation: [docs.rollgate.io](https://rollgate.io/docs)

## About Rollgate

[Rollgate](https://rollgate.io) is a feature management platform that helps teams release features safely with gradual rollouts, user targeting, and instant kill switches.

## License

MIT
