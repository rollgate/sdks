# Contract Tests - Lista Completa

## Test Categories

### Initialization Tests

- `TestInit` - Inizializzazione SDK
- `TestInitTimeout` - Timeout durante init
- `TestDoubleInit` - Init multipla
- `TestCloseBeforeInit` - Close prima di init

### Flag Evaluation Tests

- `TestFlagEvaluation` - Valutazione flag base
- `TestFlagTypes` - Tipi di flag (bool, string, number, json)
- `TestGetAllFlags` - Recupero tutti i flag
- `TestRollout` - Rollout percentuale
- `TestConsistentHashing` - Hash consistente per rollout
- `TestEmptyFlags` - Scenario senza flag

### Typed Flags Tests

- `TestGetStringFlag` - Flag stringa
- `TestGetStringFlagDefault` - Default stringa
- `TestGetNumberFlag` - Flag numerico
- `TestGetNumberFlagDefault` - Default numerico
- `TestGetJSONFlag` - Flag JSON
- `TestGetJSONFlagDefault` - Default JSON
- `TestTypeMismatch` - Mismatch di tipo
- `TestAllTypedFlagsNotSupported` - Quando typed flags non supportati

### User Targeting Tests

- `TestIdentify` - Identificazione utente
- `TestReset` - Reset contesto utente
- `TestTargetUsers` - Targeting utenti specifici
- `TestAttributeTargeting` - Targeting per attributi
- `TestMultipleConditions` - Condizioni multiple

### Operator Tests

- `TestOperatorEq` - Operatore uguale
- `TestOperatorNeq` - Operatore non uguale
- `TestOperatorContains` - Operatore contiene
- `TestOperatorStartsWith` - Operatore inizia con
- `TestOperatorEndsWith` - Operatore finisce con
- `TestOperatorGt` - Operatore maggiore
- `TestOperatorLte` - Operatore minore o uguale
- `TestOperatorIn` - Operatore in array
- `TestOperatorNotIn` - Operatore non in array
- `TestOperatorRegex` - Operatore regex
- `TestOperatorSemverEq` - Semver uguale
- `TestOperatorSemverGt` - Semver maggiore
- `TestCombinedOperators` - Operatori combinati
- `TestMissingAttribute` - Attributo mancante

### Edge Cases Tests

- `TestUserIdSpecialChars` - Caratteri speciali in user ID
- `TestUserIdUnicode` - Unicode in user ID
- `TestUserIdVeryLong` - User ID molto lungo
- `TestFlagKeySpecialChars` - Caratteri speciali in flag key
- `TestFlagKeyVeryLong` - Flag key molto lunga
- `TestAttributeNull` - Attributo null
- `TestAttributeEmpty` - Attributo vuoto
- `TestAttributeBoolean` - Attributo boolean
- `TestAttributeNumber` - Attributo numerico
- `TestManyFlags` - Molti flag
- `TestManyAttributes` - Molti attributi
- `TestConcurrentEvaluations` - Valutazioni concorrenti
- `TestRapidIdentify` - Identify rapide
- `TestEmptyFlagKey` - Flag key vuota
- `TestNonExistentFlag` - Flag inesistente

### Error Handling Tests

- `TestAuthError` - Errore autenticazione (401)
- `TestForbiddenError` - Errore forbidden (403)
- `TestRateLimitError` - Rate limit (429)
- `TestServerError500` - Server error 500
- `TestServerError502` - Bad gateway 502
- `TestServerError503` - Service unavailable 503
- `TestBadRequestError` - Bad request (400)
- `TestNetworkTimeout` - Timeout di rete
- `TestTransientErrorRecovery` - Recovery dopo errore transitorio
- `TestErrorThenSuccess` - Errore seguito da successo
- `TestDefaultValueOnError` - Default value in caso di errore

### Resilience Tests

- `TestCircuitBreakerOpens` - Circuit breaker si apre
- `TestCircuitBreakerFallback` - Fallback con circuit breaker
- `TestCacheFallback` - Fallback su cache
- `TestCacheStatsTracking` - Tracking statistiche cache
- `TestGetStateReportsCircuitInfo` - Stato circuit breaker
- `TestRetryOnTransientFailure` - Retry su errori transitori
- `TestServerRecovery` - Recovery server

### ETag/Caching Tests

- `TestETagFirstRequest` - Prima richiesta con ETag
- `TestETagCacheEfficiency` - Efficienza cache ETag
- `TestFlagChangeInvalidatesCache` - Invalidazione cache
- `TestNoUnnecessaryRefreshes` - No refresh non necessari
- `TestCacheConsistency` - Consistenza cache
- `TestETagWithUserContext` - ETag con contesto utente
- `TestPollingWithETag` - Polling con ETag

### Streaming Tests (SSE)

- `TestSSEConnectionEstablished` - Connessione SSE stabilita
- `TestSSEInitialFlags` - Flag iniziali via SSE
- `TestSSEFlagUpdate` - Aggiornamento flag via SSE
- `TestSSEDisconnectRecovery` - Recovery dopo disconnect SSE
- `TestSSEFallbackToPolling` - Fallback a polling
- `TestSSEWithPollingDisabled` - SSE senza polling
- `TestMultipleSSEClients` - Client SSE multipli

---

## Esecuzione Tests

### Tutti i test

```bash
cd test-harness
TEST_SERVICES="sdk-node=http://localhost:8002" go test -v ./internal/tests/... -count=1
```

### Test specifico

```bash
TEST_SERVICES="sdk-node=http://localhost:8002" go test -v ./internal/tests/... -run "TestIdentify$"
```

### Test multipli SDK

```bash
TEST_SERVICES="sdk-node=http://localhost:8002,sdk-go=http://localhost:8003" go test -v ./internal/tests/...
```

### Browser SDK (via adapter)

```bash
TEST_SERVICES="sdk-browser=http://localhost:8000,sdk-react=http://localhost:8010" go test -v ./internal/tests/...
```
