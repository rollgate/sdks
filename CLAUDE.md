# Rollgate SDKs

**Riferimento principale**: Vedi `C:\Projects\rollgate\CLAUDE.md` per regole di lavoro, infrastruttura e convenzioni.

Questo repo contiene solo gli SDK client. Le regole generali sono le stesse del progetto principale.

---

## Struttura Progetto

```
packages/
  sdk-node/        → @rollgate/sdk-node
  sdk-react/       → @rollgate/sdk-react
  sdk-vue/         → @rollgate/sdk-vue
  sdk-svelte/      → @rollgate/sdk-svelte
  sdk-angular/     → @rollgate/sdk-angular
  sdk-go/          → github.com/rollgate/sdk-go
  sdk-python/      → rollgate (PyPI)
  sdk-java/        → io.rollgate:sdk-java
test-harness/      → Cross-SDK contract tests (Go)
```

## Architettura SDK

**LEGGERE SEMPRE**: `docs/SDK-ARCHITECTURE.md`

Contiene:

- Diagramma architettura target
- Relazioni tra SDK (sdk-browser → sdk-react/vue/angular/svelte)
- Stato implementazione
- Principi architetturali

## Regole Specifiche SDK

- Mantieni API consistente tra tutti gli SDK
- Ogni nuova feature va implementata in TUTTI gli SDK
- Ogni SDK deve passare i contract test del test-harness
- Test services in `packages/sdk-*/test-service/`
- **sdk-react/vue/angular/svelte DEVONO wrappare sdk-browser** (non implementare logica HTTP/cache)

## Comandi Utili

```bash
# Build tutti gli SDK
npm run build

# Test singolo SDK
npm test --workspace=packages/sdk-node

# Contract tests (tutti gli SDK)
cd test-harness/cmd && go run . -services all

# Format (OBBLIGATORIO prima di commit)
npm run format
```

## Test Harness

```bash
# Avvia test services
cd test-harness/cmd && go run . -services node,go,react,vue,svelte,angular

# Esegui contract tests
cd test-harness/cmd && go test -v ./...
```
