# Rollgate SDK Architecture

Multi-platform SDK architecture designed for consistency, minimal code duplication, and cross-SDK behavioral parity through contract testing.

## Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           ROLLGATE SDK ARCHITECTURE                              │
└─────────────────────────────────────────────────────────────────────────────────┘

                              ┌─────────────────┐
                              │   sdk-core      │  TypeScript utilities
                              │  (internal)     │  - Types, interfaces
                              │                 │  - HTTP client base
                              │                 │  - Event emitter
                              │                 │  - Cache utilities
                              └────────┬────────┘
                                       │
           ┌───────────────────────────┼───────────────────────────┐
           │                           │                           │
           ▼                           ▼                           ▼
┌─────────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│    sdk-node         │    │    sdk-browser      │    │  sdk-react-native   │
│  (Server-side JS)   │    │  (Browser JS)       │    │  (Mobile)           │
│                     │    │                     │    │                     │
│ - RollgateClient    │    │ - createClient()    │    │ - Provider/hooks    │
│ - Polling/SSE       │    │ - isEnabled()       │    │ - AsyncStorage      │
│ - Server context    │    │ - identify()        │    │ - Polling only      │
└─────────────────────┘    │ - Browser context   │    └─────────────────────┘
                           │ - LocalStorage      │
                           │ - Fetch API         │
                           └──────────┬──────────┘
                                      │
                                      │ wraps
           ┌──────────────────────────┼──────────────────────────┐
           │              │           │           │              │
           ▼              ▼           ▼           ▼              ▼
    ┌───────────┐  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐
    │sdk-react  │  │ sdk-vue   │ │sdk-angular│ │sdk-svelte │ │sdk-solid  │
    │           │  │           │ │           │ │           │ │ (future)  │
    │- Provider │  │- Plugin   │ │- Module   │ │- Store    │ │           │
    │- useFlag  │  │- useFlag  │ │- Service  │ │- useFlag  │ │           │
    │- hooks    │  │- composable│ │- Directive│ │           │ │           │
    └───────────┘  └───────────┘ └───────────┘ └───────────┘ └───────────┘
         │              │             │             │
         └──────────────┴─────────────┴─────────────┘
                                │
                     Framework wrappers (~50-100 LOC each)
                     Only add: Provider, hooks/composables, reactivity
```

## Standalone Implementations (No Shared Code)

```
    ┌───────────────┐    ┌───────────────┐    ┌───────────────┐
    │    sdk-go     │    │  sdk-python   │    │   sdk-java    │
    │               │    │               │    │               │
    │ Go native     │    │ Python native │    │ Java native   │
    │ Full impl     │    │ Full impl     │    │ Full impl     │
    └───────────────┘    └───────────────┘    └───────────────┘

    ┌───────────────┐    ┌───────────────┐
    │  sdk-dotnet   │    │ sdk-flutter   │
    │               │    │               │
    │ C#/.NET 8     │    │ Dart native   │
    │ Full impl     │    │ Polling only  │
    │ SSE support   │    │ (no SSE)      │
    └───────────────┘    └───────────────┘
```

These SDKs are fully independent implementations in their respective languages, sharing no code with the TypeScript SDKs.

## Contract Tests

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           TEST HARNESS (Go)                                      │
│  - Test orchestrator                                                            │
│  - Mock Rollgate API                                                            │
│  - Parameterized test cases                                                     │
└───────────────────────────────────────────────────────────────────────────────────┘
                                    │ HTTP Protocol
                                    ▼
┌──────────┬──────────┬──────────┬──────────┬──────────┬──────────┬──────────┬──────────┐
│TestSvc   │TestSvc   │TestSvc   │TestSvc   │TestSvc   │TestSvc   │TestSvc   │BrowserSvc│
│sdk-node  │ sdk-go   │sdk-python│ sdk-java │sdk-dotnet│sdk-flutter│sdk-rn   │sdk-browser│
│ :8001    │  :8003   │  :8004   │  :8005   │  :8007   │  :8008   │ :8006   │  :8010   │
└──────────┴──────────┴──────────┴──────────┴──────────┴──────────┴────┬─────┴──────────┘
                                                 │
                    ┌────────────────────────────┼────────────────────────────┐
                    │                            │                            │
              ┌─────▼─────┐              ┌───────▼───────┐              ┌─────▼─────┐
              │  Adapter  │◄─WebSocket──►│    Entity     │              │  Browser  │
              │  Node.js  │              │  (Vite app)   │◄────────────►│ Playwright│
              │ :8000/:8001│              │    :5173      │              │ headless  │
              └───────────┘              └───────────────┘              └───────────┘
```

Contract tests validate that ALL SDKs have identical behavior:

- Same parameterized test cases
- Same expected responses
- Same error handling

## Components

### sdk-core (internal)

Shared TypeScript utilities used by all JavaScript SDKs:

- Type definitions
- HTTP client base class
- Event emitter
- Cache utilities
- Error types

**Not a standalone SDK** — it is an internal library.

### sdk-node

SDK for server-side Node.js applications:

- `RollgateClient` class
- Polling and SSE for real-time updates
- Server-side context (no localStorage)
- Circuit breaker and retry

### sdk-browser

Core browser SDK — **all browser implementations derive from this**:

- `createClient()` factory
- `isEnabled()`, `getString()`, `getNumber()`, `getJSON()`
- `identify()` for user switching
- `getAllFlags()` for all flags
- localStorage for caching
- Fetch API for HTTP

### sdk-react, sdk-vue, sdk-angular, sdk-svelte

**Thin wrappers** (~50-100 LOC) around sdk-browser:

- Only add: Provider/Context, hooks/composables, reactivity
- Delegate everything else to sdk-browser
- No duplicated HTTP, cache, or polling logic

## Implementation Status

| Component        | Status   | Notes                                     |
| ---------------- | -------- | ----------------------------------------- |
| sdk-core         | Complete | Shared utilities                          |
| sdk-node         | Complete | Server-side SDK                           |
| sdk-browser      | Complete | Core browser SDK                          |
| sdk-react        | Complete | sdk-browser wrapper                       |
| sdk-vue          | Complete | sdk-browser wrapper                       |
| sdk-angular      | Complete | sdk-browser wrapper                       |
| sdk-svelte       | Complete | sdk-browser wrapper                       |
| sdk-react-native | Complete | Mobile SDK (AsyncStorage)                 |
| sdk-go           | Complete | Native Go implementation                  |
| sdk-python       | Complete | Native Python implementation              |
| sdk-java         | Complete | Native Java implementation                |
| sdk-dotnet       | Complete | Native C#/.NET 8 implementation           |
| sdk-flutter      | Complete | Native Dart implementation (polling only) |

## Evaluation Reasons

All SDKs support Evaluation Reasons — metadata explaining why a flag has a given value.

### Reason Kinds

| Kind           | Description                          |
| -------------- | ------------------------------------ |
| `OFF`          | Flag is disabled                     |
| `TARGET_MATCH` | User is in the target list           |
| `RULE_MATCH`   | User matched a targeting rule        |
| `FALLTHROUGH`  | No rule matched, global rollout used |
| `ERROR`        | Error during evaluation              |
| `UNKNOWN`      | Flag not found                       |

### API Pattern

All SDKs follow the same API pattern:

```typescript
// TypeScript (Node, Browser, React, Vue, etc.)
const detail = client.isEnabledDetail("flag-key", false);
// detail.value: boolean
// detail.reason: { kind: 'FALLTHROUGH', inRollout: true }

// React hook
const { value, reason } = useFlagDetail("flag-key", false);
```

```go
// Go
detail := client.IsEnabledDetail("flag-key", false)
// detail.Value: bool
// detail.Reason.Kind: "FALLTHROUGH"
```

```python
# Python
detail = client.is_enabled_detail("flag-key", False)
# detail.value: bool
# detail.reason.kind: "FALLTHROUGH"
```

```java
// Java
EvaluationDetail<Boolean> detail = client.isEnabledDetail("flag-key", false);
// detail.getValue(): Boolean
// detail.getReason().getKind(): Kind.FALLTHROUGH
```

```csharp
// C# (.NET)
var detail = client.IsEnabledDetail("flag-key", false);
// detail.Value: bool
// detail.Reason.Kind: EvaluationReasonKind.FALLTHROUGH
```

```dart
// Dart (Flutter)
final detail = client.isEnabledDetail("flag-key", false);
// detail.value: bool
// detail.reason.kind: EvaluationReasonKind.FALLTHROUGH
```

### Shared Types

Reason types are defined in `sdk-core` and re-exported by all SDKs:

- `EvaluationReason` — reason object with `kind`, `ruleId`, `ruleIndex`, `inRollout`, `errorKind`
- `EvaluationDetail<T>` — result with `value`, `reason`, `variationId`
- `EvaluationReasonKind` — union type for kinds
- `EvaluationErrorKind` — error type (`FLAG_NOT_FOUND`, `CLIENT_NOT_READY`, etc.)

## Architectural Principles

### 1. DRY (Don't Repeat Yourself)

Core logic (HTTP, cache, polling) exists in ONE place only:

- sdk-node for server JS
- sdk-browser for client JS
- Native implementations for Go/Python/Java/C#/Dart

### 2. Thin Wrappers

Framework wrappers (React, Vue, Angular, Svelte) are THIN:

- Maximum 50-100 LOC
- Only framework-specific bindings
- Zero business logic

### 3. Contract Testing

All SDKs are validated by the same tests:

- Identical behavior guaranteed
- Regressions caught immediately
- Living documentation of expected behavior

### 4. Separation of Concerns

- sdk-core: shared utilities
- sdk-browser/sdk-node: SDK logic
- sdk-react/vue/etc: framework bindings
- Test harness: cross-SDK validation
