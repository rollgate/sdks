# Rollgate SDK Architecture

Architettura target degli SDK Rollgate, basata esattamente sul pattern LaunchDarkly.

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

## Implementazioni Separate (Nessun Codice Condiviso)

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

Questi SDK sono implementazioni complete e indipendenti nelle rispettive lingue.
Non condividono codice con gli SDK TypeScript.

## Contract Tests

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           TEST HARNESS (Go)                                      │
│  - Orchestratore test                                                           │
│  - Mock Rollgate API                                                            │
│  - Test cases parametrizzati                                                    │
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

I contract test validano che TUTTI gli SDK abbiano comportamento identico:

- Stessi test case parametrizzati
- Stesse risposte attese
- Stessa gestione errori

## Componenti

### sdk-core (interno)

Utilities TypeScript condivise tra tutti gli SDK JavaScript:

- Type definitions
- HTTP client base class
- Event emitter
- Cache utilities
- Error types

**NON è un SDK standalone** - è una libreria interna.

### sdk-node

SDK per applicazioni server-side Node.js:

- `RollgateClient` class
- Polling e SSE per aggiornamenti real-time
- Context server-side (no localStorage)
- Circuit breaker e retry

### sdk-browser

SDK core per browser - **TUTTE le implementazioni browser derivano da questo**:

- `createClient()` factory
- `isEnabled()`, `getString()`, `getNumber()`, `getJSON()`
- `identify()` per cambio utente
- `getAllFlags()` per tutti i flag
- localStorage per cache
- Fetch API per HTTP

### sdk-react, sdk-vue, sdk-angular, sdk-svelte

**Thin wrappers** (~50-100 LOC) attorno a sdk-browser:

- Aggiungono SOLO: Provider/Context, hooks/composables, reattività
- Delegano TUTTO il resto a sdk-browser
- Non duplicano logica HTTP, cache, polling

## Stato Implementazione

| Componente       | Stato       | Note                          |
| ---------------- | ----------- | ----------------------------- |
| sdk-core         | ✅ Completo | Utilities condivise           |
| sdk-node         | ✅ Completo | Server-side SDK               |
| sdk-browser      | ✅ Completo | Core browser SDK              |
| sdk-react        | ✅ Completo | Wrapper sdk-browser           |
| sdk-vue          | ✅ Completo | Wrapper sdk-browser           |
| sdk-angular      | ✅ Completo | Wrapper sdk-browser           |
| sdk-svelte       | ✅ Completo | Wrapper sdk-browser           |
| sdk-react-native | ✅ Completo | Mobile SDK (AsyncStorage)     |
| sdk-go           | ✅ Completo | Implementazione nativa Go     |
| sdk-python       | ✅ Completo | Implementazione nativa Python |
| sdk-java         | ✅ Completo | Implementazione nativa Java   |
| sdk-dotnet       | ✅ Completo | Implementazione nativa C#/.NET 8 |
| sdk-flutter      | ✅ Completo | Implementazione nativa Dart (polling only) |

## Evaluation Reasons

Tutti gli SDK supportano Evaluation Reasons - metadati che spiegano perché un flag ha un determinato valore.

### Reason Kinds

| Kind           | Descrizione                                    |
| -------------- | ---------------------------------------------- |
| `OFF`          | Flag disabilitato                              |
| `TARGET_MATCH` | Utente nella lista target                      |
| `RULE_MATCH`   | Utente ha matchato una regola di targeting     |
| `FALLTHROUGH`  | Nessuna regola matchata, usato rollout globale |
| `ERROR`        | Errore durante la valutazione                  |
| `UNKNOWN`      | Flag non trovato                               |

### API Pattern

Tutti gli SDK seguono lo stesso pattern API:

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

### Tipi Condivisi

I tipi per le reasons sono definiti in `sdk-core` e ri-esportati da tutti gli SDK:

- `EvaluationReason` - Oggetto reason con `kind`, `ruleId`, `ruleIndex`, `inRollout`, `errorKind`
- `EvaluationDetail<T>` - Risultato con `value`, `reason`, `variationId`
- `EvaluationReasonKind` - Tipo union per i kind
- `EvaluationErrorKind` - Tipo per errori (`FLAG_NOT_FOUND`, `CLIENT_NOT_READY`, etc.)

## Principi Architetturali

### 1. DRY (Don't Repeat Yourself)

La logica core (HTTP, cache, polling) esiste in UN solo posto:

- sdk-node per server JS
- sdk-browser per client JS
- Implementazioni native per Go/Python/Java

### 2. Thin Wrappers

I framework wrapper (React, Vue, Angular, Svelte) sono SOTTILI:

- Massimo 50-100 LOC
- Solo binding framework-specific
- Zero logica di business

### 3. Contract Testing

Tutti gli SDK sono validati dagli stessi test:

- Comportamento identico garantito
- Regressioni catturate immediatamente
- Documentazione vivente del comportamento atteso

### 4. Separation of Concerns

- sdk-core: utilities condivise
- sdk-browser/sdk-node: logica SDK
- sdk-react/vue/etc: binding framework
- Test harness: validazione cross-SDK

## Riferimenti

- [LaunchDarkly js-core](https://github.com/launchdarkly/js-core)
- [LaunchDarkly browser contract-tests](https://github.com/launchdarkly/js-core/tree/main/packages/sdk/browser/contract-tests)
- [Task Plan](../test-harness/browser-testing/task_plan.md)
