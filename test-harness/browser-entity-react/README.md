# Browser Entity - React SDK

Contract test entity for `@rollgate/sdk-react` running in a real browser.

## Architecture

```
Test Harness (Go) → Adapter (Node.js) → WebSocket → Entity (Vite + React) → SDK
```

## Quick Start

```bash
# 1. Build SDK
npm run build --workspace=packages/sdk-react

# 2. Install dependencies
cd test-harness/browser-entity-react
npm install

# 3. Start services (in separate terminals)

# Terminal 1: Mock server
cd test-harness/browser-testing
node mock-server.js

# Terminal 2: Adapter
cd test-harness/browser-adapter
node dist/index.js

# Terminal 3: Entity
cd test-harness/browser-entity-react
npx vite --port 5173

# Terminal 4: Browser (Playwright headless)
cd test-harness/browser-entity-react
npx tsx test-e2e.ts
```

## Manual Testing

With all services running:

```bash
# Get capabilities
curl http://localhost:8000/

# Create client
curl -X POST http://localhost:8000/ \
  -H "Content-Type: application/json" \
  -d '{
    "tag": "test",
    "configuration": {
      "credential": "api-key",
      "serviceEndpoints": {"polling": "http://localhost:9000"}
    }
  }'

# Evaluate flag
curl -X POST http://localhost:8000/clients/0 \
  -H "Content-Type: application/json" \
  -d '{"command": "evaluate", "evaluate": {"flagKey": "test-flag", "valueType": "bool", "defaultValue": false}}'

# Delete client
curl -X DELETE http://localhost:8000/clients/0
```

## Files

| File                          | Purpose                          |
| ----------------------------- | -------------------------------- |
| `src/ClientEntity.tsx`        | Wraps RollgateProvider and hooks |
| `src/TestHarnessWebSocket.ts` | WebSocket connection to adapter  |
| `src/types.ts`                | Shared types                     |
| `src/main.tsx`                | Entry point                      |
| `test-e2e.ts`                 | Playwright browser launcher      |

## Supported Commands

- `evaluate` - Evaluate boolean flag via `useRollgate().isEnabled()`
- `evaluateAll` - Get all flags via `rollgate.flags`
- `identifyEvent` - Change user via `rollgate.identify()`
- `flushEvents` - No-op (browser SDK doesn't batch)
