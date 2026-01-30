# Browser Contract Testing

Infrastruttura per testare SDK browser nel browser reale (non JSDOM).

## Architettura

Basata su [LaunchDarkly js-core contract-tests](https://github.com/launchdarkly/js-core/tree/main/packages/sdk/browser/contract-tests).

```
┌─────────────────┐     HTTP      ┌─────────────────┐    WebSocket    ┌─────────────────┐
│  Test Harness   │ ──────────►  │     Adapter     │ ◄─────────────► │     Entity      │
│     (Go)        │  :8000       │   (Node.js)     │    :8001        │  (Vite + SDK)   │
└─────────────────┘              └─────────────────┘                 └─────────────────┘
```

## Componenti

### browser-adapter (`test-harness/browser-adapter/`)

- Server Node.js che fa da ponte tra test harness e browser
- REST API su porta 8000 per test harness
- WebSocket su porta 8001 per browser entity

### browser-entity (`test-harness/browser-entity/`)

- App Vite che gira nel browser
- Si connette all'adapter via WebSocket
- Esegue comandi SDK nel browser reale

### sdk-browser (`packages/sdk-browser/`)

- SDK JavaScript per browser
- API simile a LaunchDarkly: `createClient()`, `isEnabled()`, etc.

## Quickstart

### 1. Build

```bash
# Dalla root del monorepo
cd /c/Projects/rollgate-sdks

# Build sdk-browser
npm run build --workspace=packages/sdk-browser

# Build adapter
cd test-harness/browser-adapter && npm install && npm run build

# Install entity deps
cd ../browser-entity && npm install
```

### 2. Avvio servizi

In terminali separati:

```bash
# Terminale 1: Adapter
cd test-harness/browser-adapter
node dist/index.js

# Terminale 2: Entity (apre browser automaticamente)
cd test-harness/browser-entity
npx vite --open
```

### 3. Test manuale

Con i servizi avviati, puoi testare via curl:

```bash
# Get capabilities
curl http://localhost:8000/

# Create client
curl -X POST http://localhost:8000/ \
  -H "Content-Type: application/json" \
  -d '{
    "tag": "test-client",
    "configuration": {
      "credential": "test-api-key",
      "serviceEndpoints": {
        "polling": "http://localhost:9000"
      }
    }
  }'

# Evaluate flag (dopo aver creato client)
curl -X POST http://localhost:8000/clients/0 \
  -H "Content-Type: application/json" \
  -d '{
    "command": "evaluate",
    "evaluate": {
      "flagKey": "test-flag",
      "valueType": "bool",
      "defaultValue": false,
      "detail": false
    }
  }'

# Delete client
curl -X DELETE http://localhost:8000/clients/0
```

## Protocollo

### Endpoints (Adapter REST API)

| Method | Endpoint       | Descrizione      |
| ------ | -------------- | ---------------- |
| GET    | `/`            | Get capabilities |
| POST   | `/`            | Create client    |
| POST   | `/clients/:id` | Run command      |
| DELETE | `/clients/:id` | Delete client    |
| DELETE | `/`            | Shutdown         |

### Comandi supportati

- `evaluate` - Valuta flag booleano
- `evaluateAll` - Ottieni tutti i flag
- `identifyEvent` - Cambia utente
- `flushEvents` - Flush eventi

## Quick Start (E2E Test)

### Windows

```cmd
cd test-harness\browser-testing
run-e2e.bat
```

### Linux/Mac (Git Bash su Windows)

```bash
cd test-harness/browser-testing
./run-e2e.sh
```

Lo script avvia automaticamente:

1. Mock server (porta 9000)
2. Browser adapter (porte 8000, 8001)
3. Vite dev server (porta 5173)
4. Browser Playwright (headless)

## Test con Go Harness

Dopo aver avviato i servizi:

```bash
cd test-harness
go test -v ./internal/tests/... -services sdk-browser=http://localhost:8000
```

## Prossimi passi

1. ~~Adattare test harness Go per usare questo protocollo~~ ✓
2. ~~Aggiungere test automatici con Playwright~~ ✓
3. Integrare in CI (GitHub Actions)
