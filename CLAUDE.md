# Rollgate SDKs

**Riferimento principale**: Vedi `C:\Projects\rollgate\CLAUDE.md` per regole di lavoro, infrastruttura e convenzioni.

Questo repo contiene gli SDK client per Rollgate. Le regole generali sono le stesse del progetto principale.

---

## SEMPRE all'inizio sessione

1. **Leggere `.claude/session-state.md`** - contiene stato attuale, bug noti, prossimi step
2. **Leggere `docs/SDK-ARCHITECTURE.md`** - prima di modificare qualsiasi SDK

---

## File di Contesto

| File | Scopo | Quando leggere |
|------|-------|----------------|
| `CLAUDE.md` | Contesto progetto SDK | Sempre (automatico) |
| `.claude/session-state.md` | Storico sessioni e stato corrente | Inizio sessione |
| `docs/SDK-ARCHITECTURE.md` | Architettura SDK | Prima di modificare SDK |
| `test-harness/CONTRACT_TESTS.md` | Lista 84 contract tests | Per debug test |

---

## Struttura Progetto

```
packages/
  sdk-core/        → Logica condivisa (internal)
  sdk-node/        → @rollgate/sdk-node
  sdk-browser/     → @rollgate/sdk-browser
  sdk-react/       → @rollgate/sdk-react (wrappa sdk-browser)
  sdk-vue/         → @rollgate/sdk-vue (wrappa sdk-browser)
  sdk-svelte/      → @rollgate/sdk-svelte (wrappa sdk-browser)
  sdk-angular/     → @rollgate/sdk-angular (wrappa sdk-browser)
  sdk-go/          → github.com/rollgate/sdk-go
  sdk-python/      → rollgate (PyPI)
  sdk-java/        → io.rollgate:sdk-java
  sdk-react-native/ → @rollgate/sdk-react-native
test-harness/      → Cross-SDK contract tests (Go)
  dashboard/       → Real-time test monitoring
  internal/        → Test suite (84 tests)
```

---

## Contract Tests & Dashboard

### Avviare la Dashboard

```bash
# Terminal 1: Dashboard (http://localhost:8080)
cd test-harness/dashboard
go run main.go

# Terminal 2: Eseguire test con runner
cd test-harness/dashboard
./runner.exe sdk-node ./internal/tests/... -count=1
```

### Test Services (porte)

| SDK | Porta | Comando |
|-----|-------|---------|
| sdk-node | 8001 | `cd packages/sdk-node/test-service && npm start` |
| sdk-go | 8003 | `cd packages/sdk-go/test-service && go run .` |
| sdk-python | 8004 | `cd packages/sdk-python/test-service && python main.py` |
| sdk-java | 8005 | `cd packages/sdk-java/test-service && java -jar target/*.jar` |

### Eseguire Contract Tests

```bash
# Singolo SDK
TEST_SERVICES="sdk-node=http://localhost:8001" go test -v ./internal/tests/... -count=1

# Multipli SDK
TEST_SERVICES="sdk-node=http://localhost:8001,sdk-go=http://localhost:8003" go test -v ./internal/tests/...

# Con dashboard (runner invia eventi real-time)
cd test-harness/dashboard
./runner.exe sdk-node ./internal/tests/... -count=1
```

---

## Regole Specifiche SDK

- Mantieni API consistente tra tutti gli SDK
- Ogni nuova feature va implementata in TUTTI gli SDK
- Ogni SDK deve passare i 84 contract tests
- Test services in `packages/sdk-*/test-service/`
- **sdk-react/vue/angular/svelte DEVONO wrappare sdk-browser** (non implementare logica HTTP/cache)

---

## Comandi Utili

```bash
# Build tutti gli SDK
npm run build

# Test singolo SDK
npm test --workspace=packages/sdk-node

# Format (OBBLIGATORIO prima di commit)
npm run format

# Build runner dashboard
cd test-harness/dashboard && go build -o runner.exe runner.go
```

---

## Workflow Sessione

1. Leggere `.claude/session-state.md` per contesto
2. Lavorare sul task
3. Aggiornare session-state.md con lavoro completato
4. Commit e push
