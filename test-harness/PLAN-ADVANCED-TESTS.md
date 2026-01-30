# Piano: Test Avanzati SDK Test Harness

## Obiettivo

Implementare test completi per garantire comportamento consistente tra tutti gli SDK Rollgate in scenari avanzati: resilience, streaming, error handling, edge cases.

---

## Fase 1: Error Handling Tests

**File**: `internal/tests/errors_test.go`

### Mock Server Changes

Aggiungere endpoint per simulare errori:

- `POST /api/v1/test/set-error` - configura prossimo errore da ritornare

```go
// internal/mock/server.go
type ErrorSimulation struct {
    StatusCode  int
    Count       int    // quante richieste falliscono (-1 = sempre)
    RetryAfter  int    // per 429
    Delay       time.Duration // per timeout simulation
}
```

### Test Cases

| Test                 | Scenario                  | Expected Behavior                                   |
| -------------------- | ------------------------- | --------------------------------------------------- |
| `TestAuthError`      | 401 Unauthorized          | SDK emette auth-error event, no retry               |
| `TestForbiddenError` | 403 Forbidden             | SDK emette auth-error event, no retry               |
| `TestRateLimitError` | 429 Too Many Requests     | SDK emette rate-limited event, rispetta Retry-After |
| `TestServerError500` | 500 Internal Server Error | SDK fa retry, poi fallback a cache                  |
| `TestServerError502` | 502 Bad Gateway           | SDK fa retry                                        |
| `TestServerError503` | 503 Service Unavailable   | SDK fa retry                                        |
| `TestNetworkTimeout` | Request timeout           | SDK fa retry con backoff                            |
| `TestInvalidJSON`    | Risposta malformata       | SDK gestisce gracefully                             |

### Protocol Extension

```json
// Nuovo comando per test service
{
  "command": "getLastError",
}

// Response
{
  "error": "AuthenticationError",
  "category": "auth",
  "retryable": false
}
```

---

## Fase 2: Resilience Tests (Circuit Breaker)

**File**: `internal/tests/resilience_test.go`

### Test Cases

| Test                          | Scenario                    | Expected                      |
| ----------------------------- | --------------------------- | ----------------------------- |
| `TestCircuitBreakerOpens`     | 5 errori consecutivi        | Circuit passa a OPEN          |
| `TestCircuitBreakerHalfOpen`  | Dopo cooldown               | Circuit passa a HALF_OPEN     |
| `TestCircuitBreakerCloses`    | Successo in HALF_OPEN       | Circuit passa a CLOSED        |
| `TestCircuitBreakerFallback`  | Circuit OPEN                | SDK usa cache, no request     |
| `TestRetryExponentialBackoff` | Errori transitori           | Delay cresce esponenzialmente |
| `TestRetryMaxAttempts`        | Tutti retry falliti         | SDK smette dopo N tentativi   |
| `TestCacheFallback`           | Server down                 | SDK usa valori cached         |
| `TestCacheStale`              | Cache scaduta + server down | SDK usa stale con warning     |

### Protocol Extension

```json
// Comando per verificare stato circuit breaker
{ "command": "getState" }

// Response estesa
{
  "isReady": true,
  "circuitState": "OPEN",
  "circuitStats": {
    "failures": 5,
    "successes": 0,
    "lastFailure": "2026-01-30T12:00:00Z"
  },
  "cacheStats": {
    "hits": 10,
    "misses": 2,
    "staleHits": 1
  }
}
```

---

## Fase 3: SSE Streaming Tests

**File**: `internal/tests/streaming_test.go`

### Mock Server Changes

Migliorare SSE mock per supportare:

- Invio eventi on-demand
- Simulazione disconnect
- Delay configurabile

```go
// Nuovo endpoint
POST /api/v1/test/sse/send-event
{
  "event": "flag-changed",
  "data": {"key": "my-flag", "enabled": true}
}

POST /api/v1/test/sse/disconnect
POST /api/v1/test/sse/delay?ms=5000
```

### Test Cases

| Test                       | Scenario                | Expected                                  |
| -------------------------- | ----------------------- | ----------------------------------------- |
| `TestSSEConnection`        | Init con streaming=true | Connessione SSE stabilita                 |
| `TestSSEInitialFlags`      | Connessione             | SDK riceve evento "init" con tutti i flag |
| `TestSSEFlagUpdate`        | Flag cambia             | SDK riceve evento, aggiorna valore        |
| `TestSSEReconnection`      | Server disconnect       | SDK riconnette automaticamente            |
| `TestSSEHeartbeat`         | Nessun evento per 30s   | Connessione rimane attiva                 |
| `TestSSEFallbackToPolling` | SSE non disponibile     | SDK passa a polling                       |

### Protocol Extension

```json
// Init con streaming
{
  "command": "init",
  "config": {
    "apiKey": "test-key",
    "baseUrl": "http://localhost:9000",
    "enableStreaming": true
  }
}

// Nuovo comando
{ "command": "isStreaming" }
// Response: { "streaming": true }
```

---

## Fase 4: ETag/Conditional Requests Tests

**File**: `internal/tests/etag_test.go`

### Test Cases

| Test                   | Scenario               | Expected                         |
| ---------------------- | ---------------------- | -------------------------------- |
| `TestETagFirstRequest` | Prima richiesta        | Response include ETag header     |
| `TestETagNotModified`  | Flags non cambiano     | 304 Not Modified, no body        |
| `TestETagModified`     | Flag cambia            | 200 OK con nuovo ETag            |
| `TestETagBandwidth`    | 10 refresh senza cambi | Bandwidth ridotta (solo headers) |

### Mock Server Changes

Il mock già supporta ETag. Aggiungere tracking per verificare:

- Contatore richieste con If-None-Match
- Contatore risposte 304

---

## Fase 5: Advanced Operators Tests

**File**: `internal/tests/operators_test.go`

### Mock Server Changes

Estendere `evaluateCondition()` per supportare tutti gli operatori:

```go
// Operatori da aggiungere
"neq"         // not equals
"contains"    // string contains
"not_contains"
"starts_with"
"ends_with"
"gt"          // greater than (numbers)
"gte"         // greater than or equal
"lt"          // less than
"lte"         // less than or equal
"in"          // value in array
"not_in"
"regex"       // regex match
"semver_eq"   // semantic version equals
"semver_gt"   // semantic version greater
```

### Test Cases

| Test                     | Operator    | Example                             |
| ------------------------ | ----------- | ----------------------------------- | ------------ |
| `TestOperatorNeq`        | neq         | plan != "free"                      |
| `TestOperatorContains`   | contains    | email contains "@company.com"       |
| `TestOperatorStartsWith` | starts_with | email starts_with "admin"           |
| `TestOperatorEndsWith`   | ends_with   | email ends_with ".io"               |
| `TestOperatorGt`         | gt          | age > 18                            |
| `TestOperatorGte`        | gte         | level >= 5                          |
| `TestOperatorLt`         | lt          | score < 100                         |
| `TestOperatorLte`        | lte         | tries <= 3                          |
| `TestOperatorIn`         | in          | country in ["IT", "US", "UK"]       |
| `TestOperatorNotIn`      | not_in      | role not_in ["banned", "suspended"] |
| `TestOperatorRegex`      | regex       | email matches ".\*@(gmail           | yahoo)\.com" |
| `TestOperatorSemverEq`   | semver_eq   | version == "2.0.0"                  |
| `TestOperatorSemverGt`   | semver_gt   | version > "1.5.0"                   |

---

## Fase 6: Edge Cases Tests

**File**: `internal/tests/edge_cases_test.go`

### Test Cases

| Test                        | Scenario                  | Expected                      |
| --------------------------- | ------------------------- | ----------------------------- |
| `TestUserIdSpecialChars`    | ID con emoji 🎉           | Funziona correttamente        |
| `TestUserIdUnicode`         | ID con unicode ñ, ü, 中文 | Funziona correttamente        |
| `TestUserIdVeryLong`        | ID 1000+ caratteri        | Funziona o errore chiaro      |
| `TestFlagKeySpecialChars`   | Key con "-", "\_", "."    | Funziona                      |
| `TestFlagKeyVeryLong`       | Key 500+ caratteri        | Funziona o errore chiaro      |
| `TestAttributeNull`         | Attributo null            | Non matcha nessuna rule       |
| `TestAttributeEmpty`        | Attributo stringa vuota   | Gestito correttamente         |
| `TestAttributeBoolean`      | Attributo true/false      | Type coercion corretto        |
| `TestAttributeNumber`       | Attributo numerico        | Comparazioni corrette         |
| `TestManyFlags`             | 1000 flags                | Performance accettabile (<1s) |
| `TestManyAttributes`        | User con 100 attributi    | Funziona                      |
| `TestConcurrentEvaluations` | 100 isEnabled() paralleli | Thread-safe                   |
| `TestRapidIdentify`         | 10 identify() in 1s       | Nessun race condition         |

---

## Fase 7: Typed Flags Tests (V2)

**File**: `internal/tests/typed_flags_test.go`

### Protocol Extension

```json
// Nuovi comandi
{
  "command": "getString",
  "flagKey": "banner-text",
  "defaultValue": "Welcome"
}

{
  "command": "getNumber",
  "flagKey": "max-items",
  "defaultValue": 10
}

{
  "command": "getJSON",
  "flagKey": "config",
  "defaultValue": {"theme": "dark"}
}
```

### Test Cases

| Test                    | Type   | Scenario                 |
| ----------------------- | ------ | ------------------------ |
| `TestStringFlag`        | string | Ritorna stringa corretta |
| `TestStringFlagDefault` | string | Flag mancante → default  |
| `TestNumberFlag`        | number | Ritorna numero corretto  |
| `TestNumberFlagDefault` | number | Flag mancante → default  |
| `TestJSONFlag`          | json   | Ritorna oggetto corretto |
| `TestJSONFlagDefault`   | json   | Flag mancante → default  |
| `TestTypeMismatch`      | any    | Tipo sbagliato → default |

---

## Struttura File Finale

```
test-harness/
├── internal/
│   ├── mock/
│   │   ├── server.go         # + error simulation, SSE controls
│   │   ├── flags.go          # + typed flags
│   │   └── operators.go      # NEW: all operators
│   ├── protocol/
│   │   ├── commands.go       # + nuovi comandi
│   │   └── responses.go      # + nuovi campi
│   └── tests/
│       ├── main_test.go
│       ├── runner.go
│       ├── init_test.go      # ✅ esistente
│       ├── flags_test.go     # ✅ esistente
│       ├── identify_test.go  # ✅ esistente
│       ├── errors_test.go    # NEW
│       ├── resilience_test.go# NEW
│       ├── streaming_test.go # NEW
│       ├── etag_test.go      # NEW
│       ├── operators_test.go # NEW
│       ├── edge_cases_test.go# NEW
│       └── typed_flags_test.go # NEW
└── testdata/
    ├── flags.json
    └── scenarios/
        ├── operators.json    # NEW
        ├── typed-flags.json  # NEW
        └── edge-cases.json   # NEW
```

---

## Effort Stimato

| Fase       | Componente                  | Effort   |
| ---------- | --------------------------- | -------- |
| 1          | Error Handling              | 2h       |
| 2          | Resilience                  | 3h       |
| 3          | SSE Streaming               | 3h       |
| 4          | ETag                        | 1h       |
| 5          | Operators                   | 2h       |
| 6          | Edge Cases                  | 2h       |
| 7          | Typed Flags                 | 2h       |
| -          | Test Service updates (Node) | 2h       |
| -          | Test Service updates (Go)   | 2h       |
| **Totale** |                             | **~19h** |

---

## Priorità Implementazione

### P0 - Critici (prima del lancio)

1. **Error Handling** - comportamento in caso di errori
2. **Resilience** - circuit breaker, cache fallback

### P1 - Importanti

3. **Operators** - completezza targeting
4. **Edge Cases** - robustezza

### P2 - Nice to Have

5. **SSE Streaming** - real-time updates
6. **ETag** - ottimizzazione bandwidth
7. **Typed Flags** - V2 features

---

## Ordine di Implementazione

```
1. Mock Server: Error simulation
2. errors_test.go
3. Mock Server: Circuit breaker tracking
4. resilience_test.go
5. Mock Server: All operators
6. operators_test.go
7. edge_cases_test.go
8. Mock Server: SSE controls
9. streaming_test.go
10. etag_test.go
11. Mock Server: Typed flags
12. typed_flags_test.go
13. Update sdk-node test-service
14. Update sdk-go test-service
15. CI workflow update
```

---

## Verifica

Per ogni fase:

1. Implementare mock server changes
2. Implementare test cases
3. Verificare con sdk-node
4. Verificare con sdk-go
5. Aggiornare CI

```bash
# Test singola fase
go test -v ./internal/tests/... -run TestError

# Test completi
go test -v ./internal/tests/... -services="sdk-node=http://localhost:8001,sdk-go=http://localhost:8002"
```
