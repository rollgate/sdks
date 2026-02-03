# Session State - Rollgate SDKs

Questo file traccia il lavoro svolto in ogni sessione Claude.

---

## Future Pipeline (Post-PR)

| Feature            | Priorità | Effort     | Note                                                  |
| ------------------ | -------- | ---------- | ----------------------------------------------------- |
| Evaluation Reasons | P1       | 2-3 giorni | ✅ COMPLETED - Perché un flag ha un certo valore      |
| Analytics Events   | P1       | 3-4 giorni | ✅ COMPLETED - Tracciamento evaluations per analytics |
| Multi-Context      | P2       | 2-3 giorni | User + Organization + Device contexts                 |
| Hooks              | P2       | 1-2 giorni | Before/after evaluation callbacks                     |
| HTTP Proxy         | P3       | 1 giorno   | Supporto proxy enterprise                             |
| Persistence Stores | P3       | 3-5 giorni | Redis, DynamoDB backends                              |
| SDK Android        | P3       | 5 giorni   | SDK nativo Kotlin con contract tests                  |

---

## Sessione 2026-02-03 #13 (SDK .NET + SDK Flutter)

### Obiettivo

Aggiungere due nuovi SDK: sdk-dotnet (C#/.NET 8) e sdk-flutter (Dart/Flutter).

### Lavoro Completato

#### 1. SDK .NET (C#/.NET 8) ✅

- **Struttura**: `packages/sdk-dotnet/`
  - `src/Rollgate.SDK/` - SDK library (net8.0, zero external dependencies)
    - `Config.cs` - Configuration with defaults
    - `UserContext.cs` - User context for targeting
    - `Reasons.cs` - EvaluationReason, EvaluationDetail<T>
    - `Errors.cs` - Error types and classification
    - `Cache.cs` - In-memory cache with TTL and stale-while-revalidate
    - `CircuitBreaker.cs` - Circuit breaker (closed/open/half_open)
    - `Retry.cs` - Exponential backoff with jitter
    - `Dedup.cs` - Request deduplication
    - `Metrics.cs` - SDK metrics
    - `Evaluate.cs` - Evaluation engine (17 operators, SHA-256 rollout)
    - `SSEClient.cs` - SSE streaming with auto-reconnect
    - `RollgateClient.cs` - Main client class
  - `test-service/` - ASP.NET Core minimal API on port 8007, 12 commands

#### 2. SDK Flutter (Dart) ✅

- **Struttura**: `packages/sdk-flutter/`
  - `lib/src/` - SDK library (Dart, polling only, no SSE)
    - `config.dart`, `user_context.dart`, `reasons.dart`, `errors.dart`
    - `cache.dart`, `circuit_breaker.dart`, `retry.dart`, `dedup.dart`, `metrics.dart`
    - `evaluate.dart` - Evaluation engine (17 operators, SHA-256 rollout)
    - `client.dart` - Main client (polling only)
  - `test-service/bin/server.dart` - HTTP server on port 8008, 12 commands

#### 3. Integration ✅

- **test-harness/test-all.sh**: Added ports 8007/8008, sdk-dotnet/sdk-flutter startup and test execution
- **test-harness/dashboard/static/index.html**: Added sdk-dotnet to Backend, sdk-flutter to Mobile
- **CLAUDE.md**: Updated ports table, project structure, test counts
- **docs/SDK-ARCHITECTURE.md**: Added sdk-dotnet and sdk-flutter to diagrams and status table

### Test Services (Porte)

| SDK | Porta | Tipo |
|-----|-------|------|
| sdk-dotnet | 8007 | Backend |
| sdk-flutter | 8008 | Mobile |

### Come Testare

```bash
# sdk-dotnet
cd packages/sdk-dotnet/test-service
PORT=8007 dotnet run
# In another terminal:
cd test-harness/dashboard
TEST_SERVICES="sdk-dotnet=http://localhost:8007" ./runner.exe sdk-dotnet ./internal/tests/... -count=1

# sdk-flutter
cd packages/sdk-flutter/test-service
PORT=8008 dart run bin/server.dart
# In another terminal:
cd test-harness/dashboard
TEST_SERVICES="sdk-flutter=http://localhost:8008" ./runner.exe sdk-flutter ./internal/tests/... -count=1
```

### Branch

`feat/test-dashboard`

#### 4. .NET SDK IPv4 Fix ✅

- **Problema**: `TestInitTimeout` (100ms timeout) falliva perché .NET HttpClient su Windows tenta prima IPv6 (::1) per "localhost", con fallback lento a IPv4 (127.0.0.1)
- **Fix**: `ConnectCallback` custom in `SocketsHttpHandler` che forza `AddressFamily.InterNetwork` (IPv4)
- **Fix**: Timeout per-request via `CancellationTokenSource` invece di `HttpClient.Timeout`
- **Fix**: `CircuitBreaker.ExecuteAsync()` per eliminare sync-over-async pattern
- **Confronto LaunchDarkly**: Usano `SocketsHttpHandler` con `ConnectTimeout` separato da `ResponseStartTimeout`

#### 5. Dashboard Timing ✅

- **Runner**: Aggiunto `elapsed` per test e `totalElapsed` per SDK nell'evento `done`
- **Dashboard**: Tempi per singolo test, per SDK, e globale nel header

### Dipendenze Installate

- **.NET SDK 8.0.417**: `winget install Microsoft.DotNet.SDK.8`
- **Dart SDK 3.10.7**: `winget install Google.DartSDK` (path: `C:\Users\domen\AppData\Local\Microsoft\WinGet\Packages\Google.DartSDK_Microsoft.Winget.Source_8wekyb3d8bbwe\dart-sdk`)

### Test Results

| SDK | Test | Note |
|-----|------|------|
| sdk-dotnet | **90/90 pass** | Con IPv4 ConnectCallback fix |
| sdk-flutter | **90/90 pass** | Prima esecuzione |

### Prossimi Step

- [ ] Run test-all.sh with all 12 SDKs (1080 tests)
- [ ] Merge PR

---

## Sessione 2026-02-03 #12 (Evaluation Reasons - Test Completi)

### Obiettivo

Completare test Evaluation Reasons su tutti i 10 SDK e creare PR.

### Lavoro Completato

#### 1. Fix Browser Service per Reason Tests ✅

- **File**: `test-harness/internal/harness/browser_service.go`
  - Aggiunto case `CommandIsEnabledDetail` in `convertToLDCommand()` - converte a `evaluate` con `detail: true`
  - Aggiunto parsing reason in `convertFromLDResponse()` - estrae `kind`, `ruleId`, `ruleIndex`, `inRollout`, `errorKind`
  - Aggiunto handling quando client non inizializzato - ritorna ERROR reason

#### 2. Test Reasons - Tutti i 10 SDK Passano ✅

| SDK | Reason Tests |
|-----|-------------|
| sdk-node | 6/6 PASS |
| sdk-go | 6/6 PASS |
| sdk-python | 6/6 PASS |
| sdk-java | 6/6 PASS |
| sdk-react-native | 6/6 PASS |
| sdk-browser | 6/6 PASS |
| sdk-react | 6/6 PASS |
| sdk-vue | 6/6 PASS |
| sdk-svelte | 6/6 PASS |
| sdk-angular | 6/6 PASS |

**Totale: 60/60 reason tests passano**

#### 3. Commits e PR ✅

- **rollgate-sdks** (`feat/test-dashboard`):
  - `666d0df` - feat: add Evaluation Reasons support to all SDKs (44 files, +2850 lines)
  - `32e85ec` - feat(test-harness): add support for testing against real server
  - PR #1 aggiornata: https://github.com/rollgate/sdks/pull/1

- **rollgate** (`main`):
  - `dd6b8c3` - feat(api): add Evaluation Reasons to SDK flags endpoint

#### 4. Supporto Test Server Reale ✅

- **File**: `test-harness/internal/harness/harness.go`
  - Aggiunto `ExternalServerURL` a Config
  - Modificato `Start()` per verificare server esterno invece di avviare mock
  - Modificato `InitSDKConfig()` per usare URL esterno

- **File**: `test-harness/internal/tests/init_test.go`
  - Aggiunto supporto env vars `EXTERNAL_SERVER_URL` e `EXTERNAL_API_KEY`

**Usage**:
```bash
EXTERNAL_SERVER_URL=http://localhost:4000 \
EXTERNAL_API_KEY=your-api-key \
TEST_SERVICES="sdk-node=http://localhost:8001" \
go test ./internal/tests/...
```

#### 5. Verifica Allineamento Mock vs Server ✅

| Campo | Mock Server | Real Server |
|-------|-------------|-------------|
| `kind` | ✅ `json:"kind"` | ✅ `json:"kind"` |
| `ruleId` | ✅ `json:"ruleId,omitempty"` | ✅ `json:"ruleId,omitempty"` |
| `ruleIndex` | ✅ `json:"ruleIndex,omitempty"` | ✅ `json:"ruleIndex,omitempty"` |
| `inRollout` | ✅ `json:"inRollout,omitempty"` | ✅ `json:"inRollout,omitempty"` |
| `errorKind` | ✅ `json:"errorKind,omitempty"` | ✅ `json:"errorKind,omitempty"` |

### Test Server Reale - In Progress

#### Setup Completato ✅

1. **PostgreSQL** container `rollgate-db` avviato su porta 5432
2. **Redis** container `rollgate-redis` avviato su porta 6379
3. **Database** seeded con:
   - Organization `Test Org`
   - User `test-user@example.com`
   - Project `test-project`
   - Environment `Development`
   - Feature flags: `enabled-flag`, `disabled-flag`, `test-flag`
   - API key `test-sdk-key-12345` (hash SHA256)
   - Pricing tier `free`
   - Org subscription attiva

4. **Server rollgate** compilato e avviato su porta 4000

#### Bug Trovato e Fixato ✅

- Endpoint `/api/v1/sdk/flags` ritornava 500 Internal Server Error
- **Causa**: `f.description` nullable nel DB ma modello Go usava `string` (non `*string`)
- **Fix**: Aggiunto `COALESCE(f.description, '')` nelle query in `apps/api/internal/repository/postgres/flag.go`
- **File aggiuntivo**: Aggiunto `log.Printf` in `apps/api/internal/handlers/sdk.go` per debugging

#### Risultati Test E2E ✅

| Stato | Count | Note |
|-------|-------|------|
| PASS | 49 | Test contro server reale |
| SKIP | 41 | Richiedono mock server (scenari specifici) |
| FAIL | 0 | |

Script: `test-harness/test-real-server.sh`

### Commits

- **rollgate-sdks** (`feat/test-dashboard`):
  - `112de30` - feat(test-harness): add external server support for contract tests
- **rollgate** (`main`):
  - `247a7c9` - fix(api): handle NULL description in SDK flags endpoint

### Prossimi Step

- [x] Commit modifiche test harness
- [x] Commit fix server rollgate
- [x] Push entrambi i repo
- [ ] Merge PR

### Branch

`feat/test-dashboard` (rollgate-sdks)

---

## Sessione 2026-02-02 #11 (Evaluation Reasons + Analytics Events)

### Obiettivo

Implementare Evaluation Reasons e Analytics Events su tutti gli SDK + server rollgate.

### Lavoro Completato

**NOTE**: Questo lavoro modifica DUE repository:

- `C:\Projects\rollgate-sdks` - SDK clients
- `C:\Projects\rollgate` - Server API

#### 1. SDK Core - Reason Types ✅

- Creato `packages/sdk-core/src/reasons.ts` - Tipi per evaluation reasons
- Creato `packages/sdk-core/src/events.ts` - Tipi per analytics events
- Aggiornato `packages/sdk-core/src/index.ts` - Exports

#### 2. SDK Node - Detail Methods ✅

- Aggiornato `packages/sdk-node/src/evaluate.ts`:
  - Aggiunta import reason types
  - Aggiunto `evaluateFlagWithReason()` function
  - Aggiornato `evaluateFlagValue()` per includere reasons
- Aggiornato `packages/sdk-node/src/index.ts`:
  - Aggiunto `isEnabledDetail()` method
  - Aggiunto `getValueDetail()` method
  - Aggiunta proprietà `flagReasons` alla classe
  - Esportati reason types
- Aggiornato `packages/sdk-node/test-service/src/index.ts`:
  - Aggiunto supporto per `isEnabledDetail` command
  - Aggiunto supporto per `getValueDetail` command

#### 3. Mock Server - Reasons ✅

- Aggiornato `test-harness/internal/mock/flags.go`:
  - Aggiunto `EvaluationReason` struct
  - Aggiunto `EvaluationResult` struct
- Aggiornato `test-harness/internal/mock/server.go`:
  - Aggiunto `evaluateFlagWithReason()` method
  - Aggiornato `handleFlags()` per supportare `?withReasons=true` query param

#### 4. Test Protocol ✅

- Aggiornato `test-harness/internal/protocol/commands.go`:
  - Aggiunto `CommandIsEnabledDetail`
  - Aggiunto `CommandGetValueDetail`
  - Aggiunte helper functions
- Aggiornato `test-harness/internal/protocol/responses.go`:
  - Aggiunto `EvaluationReason` struct
  - Aggiunto `Reason` e `VariationID` fields a Response
  - Aggiunte helper functions per detail responses

#### 5. Rollgate Server (rollgate repo) ✅

- Aggiornato `apps/api/internal/evaluation/evaluate.go`:
  - Aggiunto `EvaluationReason` struct
  - Modificato `EvaluationResult` per usare struct reason invece di stringa
  - Aggiornato `EvaluateFlagValue()` per ritornare reasons strutturate
- Aggiornato `apps/api/internal/handlers/sdk_types.go`:
  - Aggiunto `SDKEvaluationReason` struct
  - Aggiornato `SDKFlagsResponse` per includere reasons opzionali
  - Aggiornato `SDKFlagValueV2` per includere reason e variationId
- Aggiornato `apps/api/internal/handlers/sdk_v2.go`:
  - Incluso reason nella risposta flags V2

#### 6. Backend SDKs - Detail Methods ✅

- **sdk-go**:
  - Creato `packages/sdk-go/reasons.go` - EvaluationReason, EvaluationDetail tipi
  - Aggiornato `packages/sdk-go/client.go` - IsEnabledDetail(), BoolVariationDetail()
  - Aggiornato `packages/sdk-go/testservice/main.go` - isEnabledDetail, getValueDetail commands
- **sdk-python**:
  - Creato `packages/sdk-python/rollgate/reasons.py` - EvaluationReason, EvaluationDetail dataclasses
  - Aggiornato `packages/sdk-python/rollgate/client.py` - is_enabled_detail(), bool_variation_detail()
  - Aggiornato `packages/sdk-python/rollgate/__init__.py` - exports
  - Aggiornato `packages/sdk-python/test_service/main.py` - isEnabledDetail, getValueDetail commands
- **sdk-java**:
  - Creato `packages/sdk-java/src/main/java/io/rollgate/EvaluationReason.java`
  - Creato `packages/sdk-java/src/main/java/io/rollgate/EvaluationDetail.java`
  - Aggiornato `packages/sdk-java/src/main/java/io/rollgate/RollgateClient.java` - isEnabledDetail(), boolVariationDetail()
  - Aggiornato `packages/sdk-java/test-service/src/main/java/io/rollgate/testservice/Main.java` - isEnabledDetail, getValueDetail commands

#### 7. Frontend/Mobile SDKs - Detail Methods ✅

- **sdk-browser**:
  - Aggiornato `packages/sdk-browser/src/index.ts` - imports, isEnabledDetail(), boolVariationDetail(), exports
- **sdk-react**:
  - Aggiornato `packages/sdk-react/src/index.tsx` - imports, useFlagDetail() hook, exports
- **sdk-vue**:
  - Aggiornato `packages/sdk-vue/src/index.ts` - imports, useFlagDetail() composable, exports
- **sdk-svelte**:
  - Aggiornato `packages/sdk-svelte/src/index.ts` - imports, exports
- **sdk-angular**:
  - Aggiornato `packages/sdk-angular/src/index.ts` - imports, exports
- **sdk-react-native**:
  - Aggiornato `packages/sdk-react-native/src/client.ts` - imports, isEnabledDetail()
  - Aggiornato `packages/sdk-react-native/src/index.ts` - imports, useFlagDetail() hook, exports
- **browser-entity** (test harness):
  - Aggiornato `test-harness/browser-entity/src/ClientEntity.ts` - handle detail evaluations with reasons

#### 8. Documentation Updates ✅

- **SDK READMEs aggiornati**:
  - `packages/sdk-node/README.md` - API table + Evaluation Reasons section
  - `packages/sdk-react/README.md` - useFlagDetail hook
  - `packages/sdk-go/README.md` - API table + Evaluation Reasons section
  - `packages/sdk-python/README.md` - API table + Evaluation Reasons section
  - `packages/sdk-java/README.md` - API table + Evaluation Reasons section
  - `packages/sdk-react-native/README.md` - useFlagDetail hook

- **Architecture documentation**:
  - `docs/SDK-ARCHITECTURE.md` - Evaluation Reasons section già presente

#### 9. Contract Tests per Evaluation Reasons ✅

- **Creato `test-harness/internal/tests/reasons_test.go`** - 6 nuovi test:
  - `TestReasonFallthrough` - verifica reason.kind = "FALLTHROUGH"
  - `TestReasonUnknown` - verifica reason.kind = "UNKNOWN" per flag non esistenti
  - `TestReasonOff` - verifica reason.kind = "OFF" per flag disabilitati
  - `TestReasonTargetMatch` - verifica reason.kind = "TARGET_MATCH"
  - `TestReasonValueConsistency` - verifica che isEnabledDetail ritorni sempre un reason
  - `TestReasonHasKind` - verifica che reason abbia sempre kind

- **Fix parsing enums**:
  - `packages/sdk-python/rollgate/client.py` - Convertito stringhe in EvaluationReasonKind enum
  - `packages/sdk-java/src/main/java/io/rollgate/EvaluationReason.java` - Aggiunto `fromStrings()` factory method
  - `packages/sdk-java/src/main/java/io/rollgate/RollgateClient.java` - Usato `fromStrings()` per parsing JSON

- **Fix sdk-react-native test service**:
  - Aggiunto imports per `EvaluationReason`, `EvaluationDetail`, reason helpers
  - Aggiunto `flagReasons` property e `reasons` a `FlagsResponse`
  - Aggiunto `isEnabledDetail` method e command handler
  - Aggiunto `withReasons=true` a URL e storage dei reasons

- **Fix browser_service.go**:
  - Aggiunto handling per `CommandIsEnabledDetail` in `convertToLDCommand()`
  - Aggiunto parsing della response con reason in `convertFromLDResponse()`
  - Aggiunto return di default value con ERROR reason quando client non inizializzato

- **Risultati test reasons - TUTTI PASS ✓**:
  - sdk-node: 6/6 PASS ✓
  - sdk-go: 6/6 PASS ✓
  - sdk-python: 6/6 PASS ✓ (dopo fix enum)
  - sdk-java: 6/6 PASS ✓ (dopo fix fromStrings)
  - sdk-react-native: 6/6 PASS ✓ (dopo fix test service)
  - sdk-browser: 6/6 PASS ✓ (dopo fix browser_service.go)
  - sdk-react: 6/6 PASS ✓
  - sdk-vue: 6/6 PASS ✓
  - sdk-svelte: 6/6 PASS ✓
  - sdk-angular: 6/6 PASS ✓

### Prossimi Step

- [x] Implementare backend SDKs (Go, Python, Java)
- [x] Implementare frontend SDKs (browser, react, vue, svelte, angular, react-native)
- [x] Aggiornare documentazione
- [x] Creare nuovi contract tests per reasons
- [x] Testare tutti gli SDK con reason tests (10/10 PASS)

### Branch

`feat/test-dashboard` (rollgate-sdks)

---

## Sessione 2026-02-02 #10 (Memory Leak Fixes)

### Obiettivo

Verificare e fixare potenziali memory leak in tutti gli SDK.

### Lavoro Completato

1. **Audit completo memory leak** ✅
   - Identificati 4 problemi critici + 4 moderati

2. **Fix sdk-core** ✅
   - `circuit-breaker.ts`: Aggiunto `off()` e `removeAllListeners()`
   - `metrics.ts`: Aggiunto `removeAllListeners()`

3. **Fix TypeScript SDKs** ✅
   - `sdk-browser`, `sdk-node`, `sdk-react-native`: Cleanup di circuitBreaker, metrics, dedup in close()

4. **Fix Java SDK** ✅
   - `RollgateClient.java`: awaitTermination + shutdownNow fallback
   - `SSEClient.java`: shutdownNow fallback dopo timeout

5. **Fix Python SDK** ✅
   - `cache.py`: Clear callbacks in close()
   - `circuit_breaker.py`: Aggiunto clear_callbacks()
   - `metrics.py`: Aggiunto clear_listeners()
   - `client.py`: Cleanup completo in close()

### Test Results

**900/900 test passano** dopo i fix.

### Commit

`5d40df9` - fix: prevent memory leaks in SDK close() methods

---

## Sessione 2026-02-02 #9 (Typed Flags React Native + Test Script Update)

### Obiettivo

Implementare typed flags per React Native SDK, aggiungere sdk-react-native a test-all.sh, e fixare sdk-browser issue nella dashboard.

### Lavoro Completato

1. **Typed flags per React Native SDK** ✅
   - Aggiunto `getValue<T>`, `getString`, `getNumber`, `getJSON` a `packages/sdk-react-native/src/client.ts`
   - Aggiunto `useStringFlag`, `useNumberFlag`, `useJSONFlag` hooks a `packages/sdk-react-native/src/index.ts`
   - Aggiunto supporto typed flags al test service `packages/sdk-react-native/test-service/src/index.ts`
   - **Risultato: 90/90 test passano (0 skipped)**

2. **Fix test harness per sdk-react-native** ✅
   - Problema: sdk-react-native era rilevato come browser SDK (perché inizia con "sdk-react")
   - Fix in `test-harness/internal/tests/init_test.go`: escluso esplicitamente sdk-react-native dalla detection browser

3. **Aggiunto sdk-react-native a test-all.sh** ✅
   - Porta 8006 per test service
   - Aggiunto alle fasi di avvio e test backend
   - **Totale test: 10 SDK × 84 tests = 840**

4. **Fix sdk-browser dashboard 0 tests issue** ✅
   - Problema: browser-entity connetteva a WS porta 8001, ma adapter usava 8011
   - Fix in `test-harness/browser-entity/src/main.ts`: cambiato default 8001 → 8011
   - Fix in `test-harness/test-all.sh`: aggiunto `VITE_WS_PORT=8011` al comando npm run dev

### File Modificati

- `packages/sdk-react-native/src/client.ts` - Typed flag methods
- `packages/sdk-react-native/src/index.ts` - Typed flag hooks
- `packages/sdk-react-native/test-service/src/index.ts` - Typed flag commands
- `test-harness/internal/tests/init_test.go` - Exclude RN from browser detection
- `test-harness/test-all.sh` - Add sdk-react-native, fix WS port
- `test-harness/browser-entity/src/main.ts` - Fix default WS port

### Branch

`feat/test-dashboard`

### Prossimi Step

- [ ] Verificare sdk-browser con test-all.sh
- [ ] Creare PR

---

## Sessione 2026-02-01 #5 (Test Framework SDK - COMPLETO)

### Obiettivo

Testare i framework wrapper SDK (React, Vue, Svelte, Angular) con i 90 contract test.

### Lavoro Completato

1. **Fix test harness** (`test-harness/internal/tests/init_test.go`)
   - Aggiunto riconoscimento sdk-react, sdk-vue, sdk-svelte, sdk-angular come browser services

2. **Fix browser-adapter package.json** (`test-harness/browser-adapter/package.json`)
   - Cambiato `yarn build` → `npm run build`

3. **Fix WebSocket ports** (tutti i framework usano porta 8011)
   - `browser-entity-angular/src/main.ts`: 8041 → 8011
   - `browser-entity-vue/src/main.ts`: 8021 → 8011
   - `browser-entity-svelte/src/main.ts`: 8031 → 8011

4. **Fix retry logic per errori 5xx** (BUG CRITICO)
   - `sdk-core/src/errors.ts`: Default `retryable` basato su status code quando risposta JSON non lo specifica
   - `sdk-core/src/retry.ts`: Check `error.retryable` property prima del message-based check
   - `test-harness/internal/mock/server.go`: Formato errore JSON corretto con struttura `{error: {code, message, retryable}}`

5. **Test Results - TUTTI 90/90**
   - ✅ sdk-react: 90/90 pass
   - ✅ sdk-vue: 90/90 pass
   - ✅ sdk-svelte: 90/90 pass
   - ✅ sdk-angular: 90/90 pass

### Stato SDK Attuale - TUTTI COMPLETI

| SDK              | Porta | Pass | Fail | Note        |
| ---------------- | ----- | ---- | ---- | ----------- |
| sdk-node         | 8001  | 90   | 0    | ✅ Completo |
| sdk-go           | 8003  | 90   | 0    | ✅ Completo |
| sdk-java         | 8005  | 90   | 0    | ✅ Completo |
| sdk-python       | 8004  | 90   | 0    | ✅ Completo |
| sdk-browser      | 8010  | 90   | 0    | ✅ Completo |
| sdk-react        | 8010  | 90   | 0    | ✅ Completo |
| sdk-vue          | 8010  | 90   | 0    | ✅ Completo |
| sdk-svelte       | 8010  | 90   | 0    | ✅ Completo |
| sdk-angular      | 8010  | 90   | 0    | ✅ Completo |
| sdk-react-native | 8006  | 90   | 0    | ✅ Completo |

### Prossimi Step

- [x] Test sdk-react
- [x] Test sdk-vue
- [x] Test sdk-svelte
- [x] Test sdk-angular
- [x] Fix retry bug
- [x] Commit tutti i fix (fb877b5)
- [x] Push branch
- [x] Script test-all.sh (sessione #7)
- [x] Dashboard con categorie e persistenza (sessione #7)
- [ ] Creare PR

---

## Sessione 2026-02-02 #8 (Verifica Mock + SDK React Native + PR)

### Obiettivo

Verificare allineamento mock server con API reale, completare sdk-react-native, creare PR.

### Lavoro Completato

1. **Verifica Mock Server vs API Reale** ✅
   - Confrontato `test-harness/internal/mock/server.go` (735 righe) con `docs/SDK-DOCUMENTATION.md` (2179 righe)
   - **RISULTATO: Mock server perfettamente allineato con specifica API reale**

   | Aspetto             | Status | Note                                        |
   | ------------------- | ------ | ------------------------------------------- |
   | Endpoints           | ✅     | `/api/v1/sdk/flags`, `/stream`, `/identify` |
   | Authentication      | ✅     | Bearer token, query param per SSE           |
   | Response format     | ✅     | `{flags: {...}}`                            |
   | Error format        | ✅     | `{error: {code, message, retryable}}`       |
   | SSE events          | ✅     | `init`, `flag-changed`                      |
   | Evaluation priority | ✅     | disabled → targets → rules → global         |
   | Operators           | ✅     | eq, contains, in, regex, semver\_\*         |
   | ETag caching        | ✅     | If-None-Match → 304                         |
   | Rate limiting       | ✅     | 429, Retry-After                            |
   | CORS                | ✅     | Access-Control-Allow-Origin: \*             |

2. **SDK React Native completato** ✅
   - Aggiunto `Feature` component per rendering dichiarativo
   - Aggiunto `useMetrics` hook alla documentazione
   - Fixato tabella Platform Differences (no SSE in React Native)
   - Aggiornato SDK-ARCHITECTURE.md con sdk-react-native nel diagramma
   - Build verificato OK

3. **Fix documentazione SDK**
   - ✅ Creato `packages/sdk-browser/README.md`
   - ✅ Creato `packages/sdk-core/README.md`
   - ✅ Aggiornato `packages/sdk-react-native/README.md`
   - ✅ Fix porte in `docs/SDK-ARCHITECTURE.md`
   - ✅ Aggiunto sdk-react-native allo stato implementazione
   - ✅ Spostato reference LaunchDarkly in `docs/reference-launchdarkly/`

4. **PR creata e aggiornata**
   - Branch: `feat/test-dashboard`
   - URL: https://github.com/rollgate/sdks/pull/1
   - Pronta per review

### SDK React Native - Feature Complete

| Feature              | Status |
| -------------------- | ------ |
| RollgateProvider     | ✅     |
| useFlag hook         | ✅     |
| useFlags hook        | ✅     |
| useRollgate hook     | ✅     |
| useMetrics hook      | ✅     |
| Feature component    | ✅     |
| AsyncStorage caching | ✅     |
| Circuit breaker      | ✅     |
| Retry logic          | ✅     |

### SDK React Native - Contract Tests COMPLETO ✅

Test service creato in `packages/sdk-react-native/test-service/`.
Usa in-memory storage per simulare AsyncStorage.

| Risultato | Count |
| --------- | ----- |
| Pass      | 84    |
| Skip      | 0     |
| Total     | 84    |

Typed flags (getString, getNumber, getJSON) implementati nella sessione #9.

### Conclusione

> **Stato attuale:**
>
> - 10 SDK testati con 90 contract test ciascuno (900/900 pass)
> - Tutti gli SDK passano tutti i contract test
> - sdk-core è libreria interna (non SDK standalone)

---

## Sessione 2026-02-02 #7 (Test All Script + Dashboard Migliorata)

### Obiettivo

Creare script per testare tutti i 9 SDK e migliorare la dashboard con categorie e persistenza.

### Lavoro Completato

1. **Creato `test-harness/test-all.sh`** (commit 9433f30, 208c662)
   - Testa tutti i 9 SDK (4 backend + 5 frontend)
   - Kill automatico dei processi sulle porte usate con verifica
   - Backend e frontend tests in sequenza (parallelo non funzionava con dashboard WebSocket)
   - Avvio automatico dashboard e apertura browser
   - 900 test totali (10 SDK × 90 test)

2. **Dashboard migliorata** (`test-harness/dashboard/static/index.html`) (commit ad27f56)
   - **Toggle Cards/Table**: due modalità di visualizzazione
   - **11 Categorie test**: Input Validation, Scale & Performance, Error Handling, Caching & ETag, Flag Evaluation, Identity & Targeting, Initialization, Operators, Resilience, SSE Streaming, Typed Flags
   - **Cards view**: categorie collassabili, quelle con errori espanse di default
   - **Table view**: SDK sulle colonne, test sulle righe, separatori categoria
   - **localStorage persistence**: risultati sopravvivono al refresh per 1 ora
   - **Clear button**: per resettare tutti i risultati

### Come usare

```bash
cd test-harness
./test-all.sh
```

Dashboard: http://localhost:8080/static/

### Commits

```
ad27f56 feat(dashboard): add categories, table view, and localStorage persistence
208c662 fix(test-harness): run backend tests sequentially for dashboard visibility
9433f30 feat(test-harness): add test-all.sh script for running all SDK tests
```

---

## Sessione 2026-02-01 #6 (MERGED INTO #7)

---

## Sessione 2026-02-01 #4 (Test SDK Browser)

### Obiettivo

Configurare browser-adapter e testare sdk-browser con i 90 contract test.

### Lavoro Completato

1. **Fix CORS mock server** (`test-harness/internal/mock/server.go`)
   - Aggiunto header `Access-Control-Allow-Headers: *` per browser SDK

2. **Fix BrowserTestService** (`test-harness/internal/harness/browser_service.go`)
   - Return error in Response invece di Go error per init failure
   - Gestione getState e close commands
   - Gestione flag evaluation quando init fallisce (return default value)

3. **Fix browser adapter** (`test-harness/browser-adapter/src/index.ts`)
   - Rimosso `process.exit()` su DELETE / (era problema per test multipli)

4. **Fix browser entity** (`test-harness/browser-entity/src/ClientEntity.ts`)
   - Aggiunto supporto comando `reset`
   - Aggiunto `notifyMockIdentify` in identify handler (per targeting rules)
   - Passato baseUrl e apiKey al ClientEntity

5. **Fix types** (`test-harness/browser-entity/src/types.ts`)
   - Aggiunto `CommandType.Reset`

6. **Risultato: 90/90 test passano**

### Stato SDK Attuale

| SDK              | Porta | Pass | Fail | Note                      |
| ---------------- | ----- | ---- | ---- | ------------------------- |
| sdk-node         | 8001  | 84   | 0    | ✅ Completo               |
| sdk-go           | 8003  | 84   | 0    | ✅ Fixato sessione #2     |
| sdk-java         | 8005  | 84   | 0    | ✅ Fixato sessione #2     |
| sdk-python       | 8004  | 84   | 0    | ✅ Fixato sessione #3     |
| sdk-browser      | 8000  | 84   | 0    | ✅ Fixato questa sessione |
| sdk-react        | 8010  | 83   | 1    | ✅ Wrappa sdk-browser     |
| sdk-vue          | 8010  | 83   | 1    | ✅ Wrappa sdk-browser     |
| sdk-svelte       | 8010  | 83   | 1    | ✅ Wrappa sdk-browser     |
| sdk-angular      | 8010  | 84   | 0    | ✅ Wrappa sdk-browser     |
| sdk-react-native | -     | -    | -    | Non testabile (mobile)    |

### Come Testare sdk-browser

```bash
# Terminal 1: Browser adapter (porta 8000)
cd /c/Projects/rollgate-sdks/test-harness/browser-adapter
npm run dev

# Terminal 2: Browser entity (Vite + Playwright)
cd /c/Projects/rollgate-sdks/test-harness/browser-entity
node open-browser.mjs

# Terminal 3: Run tests
cd /c/Projects/rollgate-sdks/test-harness/dashboard
TEST_SERVICES="sdk-browser=http://localhost:8000" ./runner.exe sdk-browser ./internal/tests/... -count=1
```

### Branch

`feat/test-dashboard`

### Prossimi Step

- [ ] Commit fix sdk-browser
- [ ] Testare sdk-react, sdk-vue, sdk-svelte, sdk-angular

---

## Sessione 2026-02-01 #3 (Test SDK Python)

### Obiettivo

Eseguire i 90 contract test su sdk-python e fixare eventuali bug.

### Lavoro Completato

1. **Fix sdk-python test service** (`packages/sdk-python/test_service/main.py`)
   - Fix `getState` command: `CacheStats` è un dataclass, non un dict - accedere con `.hits`/`.misses` invece di `.get()`
   - Fix `circuit_state`: usare `.value` per ottenere il valore stringa dall'enum
   - Ottimizzazione `notify_mock_identify`: usare un shared `httpx.AsyncClient` invece di crearne uno nuovo ad ogni chiamata (riduceva TestRapidIdentify da 5.5s a 0.6s)
   - **Risultato: 90/90 test passano**

### Stato SDK Attuale

| SDK              | Porta | Pass | Fail | Note                                  |
| ---------------- | ----- | ---- | ---- | ------------------------------------- |
| sdk-node         | 8001  | 84   | 0    | ✅ Completo                           |
| sdk-go           | 8003  | 84   | 0    | ✅ Fixato sessione #2                 |
| sdk-java         | 8005  | 84   | 0    | ✅ Fixato sessione #2                 |
| sdk-python       | 8004  | 84   | 0    | ✅ Fixato questa sessione             |
| sdk-browser      | 8000  | ?    | ?    | Richiede browser-adapter + Playwright |
| sdk-react        | 8010  | ?    | ?    | Wrappa sdk-browser                    |
| sdk-vue          | 8020  | ?    | ?    | Wrappa sdk-browser                    |
| sdk-svelte       | 8030  | ?    | ?    | Wrappa sdk-browser                    |
| sdk-angular      | 8040  | ?    | ?    | Wrappa sdk-browser                    |
| sdk-react-native | -     | -    | -    | Non testabile (mobile)                |

### Branch

`feat/test-dashboard`

### Prossimi Step

- [x] Commit fix sdk-python
- [x] Configurare browser-adapter + browser-entity per sdk-browser (sessione #4)
- [ ] Testare sdk-react, sdk-vue, sdk-svelte, sdk-angular

---

## Sessione 2026-02-01 #2 (Fix SDK e estensione test)

### Obiettivo

Fixare bug negli SDK rilevati dai contract test e preparare estensione a tutti gli SDK.

### Lavoro Completato

1. **Fix sdk-go** (`packages/sdk-go/`)
   - Aggiunto `sendIdentify()` in `client.go` per POST attributi utente al server
   - Aggiunti alias operatori in `evaluate.go`: eq, neq, gt, gte, lt, lte
   - Commit: `897ffc7 fix(sdk-go): add identify endpoint and operator aliases`
   - **Risultato: 90/90 test passano**

2. **Fix sdk-java** (`packages/sdk-java/test-service/`)
   - Fix gestione attributi null (skip invece di getAsString su JsonNull)
   - Aggiunto thread pool (50 thread) e backlog (100) per concurrent requests
   - Import `java.util.concurrent.Executors`
   - Commit: `ce40b72 fix(sdk-java): handle null attributes and concurrent requests`
   - **Risultato: 90/90 test passano**

3. **Formatting sdk-react-native**
   - Commit: `3a31a3e style(sdk-react-native): apply prettier formatting`

### Stato SDK Attuale

| SDK              | Porta | Pass | Fail | Note                                          |
| ---------------- | ----- | ---- | ---- | --------------------------------------------- |
| sdk-node         | 8001  | 84   | 0    | ✅ Completo                                   |
| sdk-go           | 8003  | 84   | 0    | ✅ Fixato questa sessione                     |
| sdk-java         | 8005  | 84   | 0    | ✅ Fixato questa sessione                     |
| sdk-python       | 8004  | ?    | ?    | Test service completo, SDK esiste, da testare |
| sdk-browser      | 8000  | ?    | ?    | Richiede browser-adapter + Playwright         |
| sdk-react        | 8010  | ?    | ?    | Wrappa sdk-browser                            |
| sdk-vue          | 8020  | ?    | ?    | Wrappa sdk-browser                            |
| sdk-svelte       | 8030  | ?    | ?    | Wrappa sdk-browser                            |
| sdk-angular      | 8040  | ?    | ?    | Wrappa sdk-browser                            |
| sdk-react-native | -     | -    | -    | Non testabile (mobile)                        |

### Come Avviare Test Services

```bash
# Kill processi esistenti
taskkill //F //IM java.exe 2>/dev/null
taskkill //F //IM node.exe 2>/dev/null

# sdk-node (porta 8001)
cd /c/Projects/rollgate-sdks/packages/sdk-node/test-service
PORT=8001 nohup node dist/index.js > /tmp/sdk-node.log 2>&1 &

# sdk-go (porta 8003) - NOTA: cartella è "testservice" non "test-service"
cd /c/Projects/rollgate-sdks/packages/sdk-go/testservice
PORT=8003 nohup go run . > /tmp/sdk-go.log 2>&1 &

# sdk-java (porta 8005)
cd /c/Projects/rollgate-sdks/packages/sdk-java/test-service
PORT=8005 nohup java -jar target/rollgate-sdk-test-service-0.1.0-shaded.jar > /tmp/sdk-java.log 2>&1 &

# sdk-python (porta 8004)
cd /c/Projects/rollgate-sdks/packages/sdk-python/test_service
PORT=8004 python main.py

# Verifica
curl -s http://localhost:8001 && echo " - node OK"
curl -s http://localhost:8003 && echo " - go OK"
curl -s http://localhost:8005 && echo " - java OK"
```

### Come Eseguire Contract Tests

```bash
# Dashboard (http://localhost:8080/static/)
cd /c/Projects/rollgate-sdks/test-harness/dashboard
go run main.go

# Runner per singolo SDK (invia eventi real-time alla dashboard)
cd /c/Projects/rollgate-sdks/test-harness/dashboard
TEST_SERVICES="sdk-node=http://localhost:8001" ./runner.exe sdk-node ./internal/tests/... -count=1
TEST_SERVICES="sdk-go=http://localhost:8003" ./runner.exe sdk-go ./internal/tests/... -count=1
TEST_SERVICES="sdk-java=http://localhost:8005" ./runner.exe sdk-java ./internal/tests/... -count=1

# Tutti insieme (mostra come "all" nella dashboard)
TEST_SERVICES="sdk-node=http://localhost:8001,sdk-go=http://localhost:8003,sdk-java=http://localhost:8005" ./runner.exe all ./internal/tests/... -count=1
```

### Browser SDK Testing (da configurare)

Struttura:

- `test-harness/browser-adapter/` - Express + WebSocket bridge
- `test-harness/browser-entity/` - Vite app con @rollgate/sdk-browser
- `test-harness/browser-entity-react/` - Per sdk-react
- `test-harness/browser-entity-vue/` - Per sdk-vue
- `test-harness/browser-entity-svelte/` - Per sdk-svelte
- `test-harness/browser-entity-angular/` - Per sdk-angular

Flusso:

1. Test harness → HTTP → browser-adapter (Express :8000)
2. browser-adapter → WebSocket → browser-entity (Vite :5173)
3. browser-entity esegue SDK e risponde via WebSocket

### Branch

`feat/test-dashboard`

### Commits questa sessione

```
3a31a3e style(sdk-react-native): apply prettier formatting
ce40b72 fix(sdk-java): handle null attributes and concurrent requests
897ffc7 fix(sdk-go): add identify endpoint and operator aliases
```

### Prossimi Step

- [ ] Push branch e creare PR
- [ ] Testare sdk-python (test service già pronto)
- [ ] Configurare browser-adapter + browser-entity per sdk-browser
- [ ] Testare sdk-react, sdk-vue, sdk-svelte, sdk-angular

---

## Sessione 2026-02-01 #1 (Contract Test Dashboard)

### Obiettivo

Implementare dashboard per monitorare contract tests e fixare bug conteggio.

### Lavoro Completato

1. **Fix bug conteggio runner** (`test-harness/dashboard/runner.go`)
   - Problema: il runner contava il primo evento (pass/fail/skip) per ogni test, ma quando un subtest falliva prima del parent, veniva contato come fallimento
   - Soluzione: ignorare eventi subtest (quelli con "/" nel nome) e contare solo eventi parent test
   - Commit: `38fbc0f fix(dashboard): count only parent test events, ignore subtests`

2. **Documentazione**
   - Creato `.claude/session-state.md` per tracciare sessioni
   - Aggiornato `CLAUDE.md` con info dashboard e workflow
   - Aggiornato `test-harness/dashboard/README.md`
   - Commit: `1f9531a docs: add session-state tracking and update CLAUDE.md`

3. **Miglioramenti dashboard frontend** (`test-harness/dashboard/static/index.html`)
   - Aumentato altezza lista test da 200px a 400px
   - Mostra tutti gli 84 test invece degli ultimi 10
   - Test falliti mostrati per primi (in rosso), poi skipped, poi passed
   - Commit: `520b026 feat(dashboard): show all tests with failed first`

### Commits

```
520b026 feat(dashboard): show all tests with failed first
1f9531a docs: add session-state tracking and update CLAUDE.md
38fbc0f fix(dashboard): count only parent test events, ignore subtests
```

---

## Template Nuova Sessione

```markdown
## Sessione YYYY-MM-DD (Titolo)

### Obiettivo

[Descrizione obiettivo]

### Lavoro Completato

1. [Task 1]
2. [Task 2]

### Branch

[nome branch]

### Prossimi Step

- [ ] [Step 1]
- [ ] [Step 2]
```
