# Browser Entity - Angular SDK

Contract test entity for `@rollgate/sdk-angular` running in a real browser.

## Architecture

```
Test Harness (Go) → Adapter (Node.js) → WebSocket → Entity (Vite + Angular) → SDK
```

## Quick Start

```bash
# 1. Build SDK
npm run build --workspace=packages/sdk-angular

# 2. Install dependencies
cd test-harness/browser-entity-angular
npm install

# 3. Start services (in separate terminals)

# Terminal 1: Mock server
cd test-harness/browser-testing
node mock-server.js

# Terminal 2: Adapter
cd test-harness/browser-adapter
node dist/index.js

# Terminal 3: Entity
cd test-harness/browser-entity-angular
npx vite --port 5173

# Terminal 4: Browser (Playwright headless)
cd test-harness/browser-entity-angular
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

| File                          | Purpose                               |
| ----------------------------- | ------------------------------------- |
| `src/ClientEntity.ts`         | Wraps RollgateService with Angular DI |
| `src/TestHarnessWebSocket.ts` | WebSocket connection to adapter       |
| `src/types.ts`                | Shared types                          |
| `src/main.ts`                 | Entry point                           |
| `test-e2e.ts`                 | Playwright browser launcher           |

## Notes

Angular requires Zone.js for change detection. The entity bootstraps a minimal Angular module with RollgateModule.forRoot() to set up dependency injection.

## Supported Commands

- `evaluate` - Evaluate boolean flag via `service.isEnabled()`
- `evaluateAll` - Get all flags via `service.flags`
- `identifyEvent` - Change user via `service.identify()`
- `flushEvents` - No-op (browser SDK doesn't batch)
