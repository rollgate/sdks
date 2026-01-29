# SDK Architecture

This document describes the architecture of Rollgate SDKs and the shared patterns used across all implementations.

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Your Application                         │
├─────────────────────────────────────────────────────────────────┤
│   React SDK   │   Vue SDK   │   Node SDK   │   Go/Java/Python   │
├─────────────────────────────────────────────────────────────────┤
│                         SDK Core (TypeScript)                    │
│    ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│    │  Cache   │  │  Retry   │  │ Circuit  │  │   Polling/   │   │
│    │  Layer   │  │  Logic   │  │ Breaker  │  │   Streaming  │   │
│    └──────────┘  └──────────┘  └──────────┘  └──────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                         Rollgate API                             │
└─────────────────────────────────────────────────────────────────┘
```

## Package Structure

```
packages/
├── sdk-core/        # Shared TypeScript core (cache, retry, circuit breaker)
├── sdk-node/        # Node.js SDK (server-side)
├── sdk-react/       # React SDK (hooks, provider, components)
├── sdk-vue/         # Vue 3 SDK (composables, plugin)
├── sdk-angular/     # Angular SDK (services, directives)
├── sdk-svelte/      # Svelte SDK (stores, context)
├── sdk-go/          # Go SDK (standalone)
├── sdk-java/        # Java SDK (standalone)
└── sdk-python/      # Python SDK (standalone)
```

## SDK Core

The `@rollgate/sdk-core` package provides shared functionality for all TypeScript-based SDKs:

### RollgateClient

The main client class that handles:

- Flag fetching and caching
- User identification
- Real-time updates (polling or SSE)
- Event emission

### Resilience Features

All SDKs implement these resilience patterns:

#### 1. Circuit Breaker

Prevents cascading failures when the API is unavailable.

```
CLOSED ──[failures >= threshold]──> OPEN
   ↑                                  │
   │                                  ↓
   └──[successes >= threshold]── HALF_OPEN
```

| State     | Behavior                            |
| --------- | ----------------------------------- |
| CLOSED    | Normal operation, all requests pass |
| OPEN      | Requests blocked, use cached values |
| HALF_OPEN | Limited requests to test recovery   |

#### 2. Retry with Exponential Backoff

Failed requests are retried with increasing delays:

```
Delay = min(baseDelay * 2^attempt * (1 + jitter), maxDelay)
```

Default configuration:

- Max retries: 3
- Base delay: 100ms
- Max delay: 10s
- Jitter factor: 0.1 (10%)

#### 3. Caching (Stale-While-Revalidate)

Flags are cached locally with two TTLs:

- **TTL** (5 min default): Fresh cache, serve immediately
- **Stale TTL** (1 hour default): Serve stale while fetching new data

```
Request ──> Cache Hit?
              │
       ┌──────┴──────┐
       ↓             ↓
     Fresh        Stale
       │             │
       ↓             ↓
    Return      Return + Revalidate
```

#### 4. ETag Support

HTTP ETag headers enable efficient 304 Not Modified responses, reducing bandwidth and latency.

## Data Flow

### Initialization

```
1. Client created with config
2. Initialize() called
3. Fetch flags from API (with retry)
4. Cache flags locally
5. Start polling/streaming
6. Emit 'ready' event
```

### Flag Evaluation

```
1. isEnabled(flagKey) called
2. Check local cache
3. Return cached value (fast path)
4. Background refresh if stale
```

### User Identification

```
1. identify(user) called
2. Store user context locally
3. Fetch user-specific flags
4. Update cache
5. Emit 'flags-updated' event
```

## Events

All SDKs emit these events:

| Event           | Description                     |
| --------------- | ------------------------------- |
| `ready`         | Client initialized successfully |
| `flags-updated` | Flags refreshed from API        |
| `flag-changed`  | Single flag value changed       |
| `error`         | Error occurred                  |
| `circuit-open`  | Circuit breaker opened          |
| `circuit-close` | Circuit breaker closed          |

## API Keys

Rollgate uses prefixed API keys to distinguish environments:

| Prefix      | Type   | Use Case                    |
| ----------- | ------ | --------------------------- |
| `sb_server` | Server | Node.js, Go, Java, Python   |
| `sb_client` | Client | React, Vue, Angular, Svelte |

**Security**: Never expose server keys in client-side code.

## Framework-Specific Patterns

### React SDK

- **Provider Pattern**: `RollgateProvider` wraps your app
- **Hooks**: `useFlag`, `useFlags`, `useRollgate`
- **Components**: `<Feature>` for declarative rendering

### Vue SDK

- **Plugin Pattern**: `app.use(RollgatePlugin, config)`
- **Composables**: `useFlag`, `useFlags`, `useRollgate`
- **Reactive Refs**: All flag values are reactive

### Angular SDK

- **Module Pattern**: `RollgateModule.forRoot(config)`
- **Services**: `RollgateService` for DI
- **Directives**: `*rollgateFlag` for templates

### Svelte SDK

- **Store Pattern**: Svelte stores for reactivity
- **Context**: `createRollgate()` and `getRollgate()`
- **Helpers**: `getFlag()` for single flags

### Go/Java/Python SDKs

These are standalone implementations with the same API patterns but native to each language. They don't depend on sdk-core.

## Thread Safety

All SDKs are thread-safe:

- Go: Uses `sync.RWMutex` for concurrent access
- Java: Uses `ConcurrentHashMap` and atomic operations
- Python: Uses `asyncio.Lock` for async safety
- TypeScript: Single-threaded, but safe for React concurrent mode

## Performance

Typical latencies:

| Operation      | Latency   |
| -------------- | --------- |
| isEnabled()    | < 1ms     |
| Cache hit      | < 1ms     |
| API call       | 50-200ms  |
| SSE connection | Real-time |

## Best Practices

1. **Initialize once**: Create a single client instance per application
2. **Use streaming for kill switches**: Enable SSE for flags that need instant propagation
3. **Identify users early**: Call `identify()` as soon as user data is available
4. **Handle errors gracefully**: Always provide default values to `isEnabled()`
5. **Clean up**: Call `close()` when the client is no longer needed

## See Also

- [Getting Started](./GETTING-STARTED.md)
- [Production Setup](./PRODUCTION-SETUP.md)
- Individual SDK READMEs in `/packages/`
