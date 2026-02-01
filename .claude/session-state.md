# Session State - Rollgate SDKs

Questo file traccia il lavoro svolto in ogni sessione Claude.

---

## Sessione 2026-02-01 #4 (Test SDK Browser)

### Obiettivo
Configurare browser-adapter e testare sdk-browser con i 84 contract test.

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

6. **Risultato: 84/84 test passano**

### Stato SDK Attuale

| SDK | Porta | Pass | Fail | Note |
|-----|-------|------|------|------|
| sdk-node | 8001 | 84 | 0 | ✅ Completo |
| sdk-go | 8003 | 84 | 0 | ✅ Fixato sessione #2 |
| sdk-java | 8005 | 84 | 0 | ✅ Fixato sessione #2 |
| sdk-python | 8004 | 84 | 0 | ✅ Fixato sessione #3 |
| sdk-browser | 8000 | 84 | 0 | ✅ Fixato questa sessione |
| sdk-react | 8010 | ? | ? | Wrappa sdk-browser |
| sdk-vue | 8020 | ? | ? | Wrappa sdk-browser |
| sdk-svelte | 8030 | ? | ? | Wrappa sdk-browser |
| sdk-angular | 8040 | ? | ? | Wrappa sdk-browser |
| sdk-react-native | - | - | - | Non testabile (mobile) |

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
Eseguire i 84 contract test su sdk-python e fixare eventuali bug.

### Lavoro Completato

1. **Fix sdk-python test service** (`packages/sdk-python/test_service/main.py`)
   - Fix `getState` command: `CacheStats` è un dataclass, non un dict - accedere con `.hits`/`.misses` invece di `.get()`
   - Fix `circuit_state`: usare `.value` per ottenere il valore stringa dall'enum
   - Ottimizzazione `notify_mock_identify`: usare un shared `httpx.AsyncClient` invece di crearne uno nuovo ad ogni chiamata (riduceva TestRapidIdentify da 5.5s a 0.6s)
   - **Risultato: 84/84 test passano**

### Stato SDK Attuale

| SDK | Porta | Pass | Fail | Note |
|-----|-------|------|------|------|
| sdk-node | 8001 | 84 | 0 | ✅ Completo |
| sdk-go | 8003 | 84 | 0 | ✅ Fixato sessione #2 |
| sdk-java | 8005 | 84 | 0 | ✅ Fixato sessione #2 |
| sdk-python | 8004 | 84 | 0 | ✅ Fixato questa sessione |
| sdk-browser | 8000 | ? | ? | Richiede browser-adapter + Playwright |
| sdk-react | 8010 | ? | ? | Wrappa sdk-browser |
| sdk-vue | 8020 | ? | ? | Wrappa sdk-browser |
| sdk-svelte | 8030 | ? | ? | Wrappa sdk-browser |
| sdk-angular | 8040 | ? | ? | Wrappa sdk-browser |
| sdk-react-native | - | - | - | Non testabile (mobile) |

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
   - **Risultato: 84/84 test passano**

2. **Fix sdk-java** (`packages/sdk-java/test-service/`)
   - Fix gestione attributi null (skip invece di getAsString su JsonNull)
   - Aggiunto thread pool (50 thread) e backlog (100) per concurrent requests
   - Import `java.util.concurrent.Executors`
   - Commit: `ce40b72 fix(sdk-java): handle null attributes and concurrent requests`
   - **Risultato: 84/84 test passano**

3. **Formatting sdk-react-native**
   - Commit: `3a31a3e style(sdk-react-native): apply prettier formatting`

### Stato SDK Attuale

| SDK | Porta | Pass | Fail | Note |
|-----|-------|------|------|------|
| sdk-node | 8001 | 84 | 0 | ✅ Completo |
| sdk-go | 8003 | 84 | 0 | ✅ Fixato questa sessione |
| sdk-java | 8005 | 84 | 0 | ✅ Fixato questa sessione |
| sdk-python | 8004 | ? | ? | Test service completo, SDK esiste, da testare |
| sdk-browser | 8000 | ? | ? | Richiede browser-adapter + Playwright |
| sdk-react | 8010 | ? | ? | Wrappa sdk-browser |
| sdk-vue | 8020 | ? | ? | Wrappa sdk-browser |
| sdk-svelte | 8030 | ? | ? | Wrappa sdk-browser |
| sdk-angular | 8040 | ? | ? | Wrappa sdk-browser |
| sdk-react-native | - | - | - | Non testabile (mobile) |

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
