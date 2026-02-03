# Rollgate SDKs

**Riferimento principale**: Vedi `C:\Projects\rollgate\CLAUDE.md` per regole di lavoro, infrastruttura e convenzioni.

Questo repo contiene gli SDK client per Rollgate. Le regole generali sono le stesse del progetto principale.

---

## SEMPRE all'inizio sessione

1. **Leggere `.claude/session-state.md`** - contiene stato attuale, bug noti, prossimi step
2. **Leggere `docs/SDK-ARCHITECTURE.md`** - prima di modificare qualsiasi SDK

---

## File di Contesto

| File                             | Scopo                             | Quando leggere          |
| -------------------------------- | --------------------------------- | ----------------------- |
| `CLAUDE.md`                      | Contesto progetto SDK             | Sempre (automatico)     |
| `.claude/session-state.md`       | Storico sessioni e stato corrente | Inizio sessione         |
| `docs/SDK-ARCHITECTURE.md`       | Architettura SDK                  | Prima di modificare SDK |
| `test-harness/CONTRACT_TESTS.md` | Lista 90 contract tests           | Per debug test          |

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
  sdk-dotnet/      → Rollgate.SDK (NuGet)
  sdk-react-native/ → @rollgate/sdk-react-native
  sdk-flutter/     → rollgate (pub.dev)
test-harness/      → Cross-SDK contract tests (Go)
  dashboard/       → Real-time test monitoring
  internal/        → Test suite (90 tests)
```

---

## Contract Tests & Dashboard

### Eseguire TUTTI i 1080 Contract Tests (12 SDK)

```bash
# Comando unico per testare tutti gli SDK
cd test-harness
./test-all.sh
```

Questo script:

1. Killa processi esistenti sulle porte usate
2. Avvia la dashboard e apre il browser
3. Avvia tutti i backend test services (node, go, python, java, dotnet, flutter)
4. Esegue i test sequenzialmente per ogni SDK
5. Cleanup automatico alla fine

Dashboard: http://localhost:8080/static/

### Test Services (porte)

| SDK              | Porta | Tipo                           |
| ---------------- | ----- | ------------------------------ |
| sdk-node         | 8001  | Backend                        |
| sdk-go           | 8003  | Backend                        |
| sdk-python       | 8004  | Backend                        |
| sdk-java         | 8005  | Backend                        |
| sdk-react-native | 8006  | Mobile                         |
| sdk-dotnet       | 8007  | Backend                        |
| sdk-flutter      | 8008  | Mobile                         |
| sdk-browser      | 8010  | Frontend (via browser-adapter) |
| sdk-react        | 8010  | Frontend (via browser-adapter) |
| sdk-vue          | 8010  | Frontend (via browser-adapter) |
| sdk-svelte       | 8010  | Frontend (via browser-adapter) |
| sdk-angular      | 8010  | Frontend (via browser-adapter) |

### Eseguire Test Singolo SDK

```bash
# Backend SDK (avvia test service prima)
cd packages/sdk-node/test-service && PORT=8001 node dist/index.js &
cd test-harness/dashboard
TEST_SERVICES="sdk-node=http://localhost:8001" ./runner.exe sdk-node ./internal/tests/... -count=1

# Frontend SDK (avvia browser-adapter + entity prima)
cd test-harness/browser-adapter && PORT=8010 WS_PORT=8011 node dist/index.js &
cd test-harness/browser-entity-react && npm run dev &
cd test-harness/browser-entity-react && node open-browser.mjs &
cd test-harness/dashboard
TEST_SERVICES="sdk-react=http://localhost:8010" ./runner.exe sdk-react ./internal/tests/... -count=1
```

### Solo Dashboard (senza test)

```bash
cd test-harness/dashboard
go run main.go
# Apri http://localhost:8080/static/
```

---

## Regole Specifiche SDK

- Mantieni API consistente tra tutti gli SDK
- Ogni nuova feature va implementata in TUTTI gli SDK
- Ogni SDK deve passare i 90 contract tests
- Test services in `packages/sdk-*/test-service/`
- **sdk-react/vue/angular/svelte DEVONO wrappare sdk-browser** (non implementare logica HTTP/cache)
- **sdk-flutter** usa solo polling (no SSE), come sdk-react-native

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

---

## Preferenze Utente (OBBLIGATORIO)

- **MAI CONCATENARE comandi bash** - Non usare MAI `&&`, `;`, `||` per concatenare comandi. Ogni comando deve essere una chiamata Bash separata. Questo è CRITICO perché i comandi singoli matchano i permessi in `settings.local.json` ma quelli concatenati no, causando richieste di permesso continue che rallentano il lavoro.
  - ❌ `sleep 3 && curl http://localhost:4000/health`
  - ✅ Due chiamate Bash separate: `sleep 3` poi `curl http://localhost:4000/health`
- **Usare wrapper script per comandi con env vars multiple** - Quando servono più variabili d'ambiente, creare uno script .sh e eseguirlo direttamente, MAI inline tipo `VAR1=x VAR2=y command`
  - ❌ `EXTERNAL_SERVER_URL="..." TEST_SERVICES="..." go test ...`
  - ✅ Creare script wrapper ed eseguire `./script.sh`
