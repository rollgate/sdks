# Browser Contract Testing

Infrastructure for testing browser SDKs in real browsers (not JSDOM).

## Architecture

Based on [LaunchDarkly js-core contract-tests](https://github.com/launchdarkly/js-core/tree/main/packages/sdk/browser/contract-tests).

```
┌─────────────────┐     HTTP      ┌─────────────────┐    WebSocket    ┌─────────────────┐
│  Test Harness   │ ──────────►  │     Adapter     │ ◄─────────────► │     Entity      │
│     (Go)        │  :8000       │   (Node.js)     │    :8001        │  (Vite + SDK)   │
└─────────────────┘              └─────────────────┘                 └─────────────────┘
```

## Browser Entities

Each framework SDK has its own browser entity:

| SDK         | Entity Directory          | Status     |
| ----------- | ------------------------- | ---------- |
| sdk-browser | `browser-entity/`         | ✅ Tested  |
| sdk-react   | `browser-entity-react/`   | ✅ Tested  |
| sdk-vue     | `browser-entity-vue/`     | ✅ Tested  |
| sdk-svelte  | `browser-entity-svelte/`  | ✅ Tested  |
| sdk-angular | `browser-entity-angular/` | ✅ Created |

## Components

### browser-adapter (`test-harness/browser-adapter/`)

- Node.js server bridging test harness and browser
- REST API on port 8000 for test harness
- WebSocket on port 8001 for browser entity

### browser-entity-_ (`test-harness/browser-entity-_/`)

- Vite apps running in real browser
- Connect to adapter via WebSocket
- Execute SDK commands in browser context

### mock-server.js

Simple mock Rollgate API server returning test flags:

- `test-flag`: true
- `enabled-flag`: true
- `disabled-flag`: false

## Quick Start

### Test a specific SDK

```bash
# 1. Build the SDK
npm run build --workspace=packages/sdk-react

# 2. Install entity dependencies
cd test-harness/browser-entity-react
npm install

# 3. Start services (4 terminals)

# Terminal 1: Mock server (port 9000)
cd test-harness/browser-testing
node mock-server.js

# Terminal 2: Adapter (ports 8000, 8001)
cd test-harness/browser-adapter
node dist/index.js

# Terminal 3: Entity (port 5173)
cd test-harness/browser-entity-react
npx vite --port 5173

# Terminal 4: Browser (Playwright headless)
cd test-harness/browser-entity-react
npx tsx test-e2e.ts

# 4. Test via curl
curl http://localhost:8000/  # Get capabilities
```

### Run E2E script (sdk-browser only)

```bash
cd test-harness/browser-testing
./run-e2e.sh  # Linux/Mac/Git Bash
run-e2e.bat   # Windows CMD
```

## Protocol

### Endpoints (Adapter REST API)

| Method | Endpoint       | Description      |
| ------ | -------------- | ---------------- |
| GET    | `/`            | Get capabilities |
| POST   | `/`            | Create client    |
| POST   | `/clients/:id` | Run command      |
| DELETE | `/clients/:id` | Delete client    |
| DELETE | `/`            | Shutdown         |

### Commands

```json
// evaluate - Check flag value
{
  "command": "evaluate",
  "evaluate": {
    "flagKey": "test-flag",
    "valueType": "bool",
    "defaultValue": false
  }
}

// evaluateAll - Get all flags
{ "command": "evaluateAll" }

// identifyEvent - Change user
{
  "command": "identifyEvent",
  "identifyEvent": {
    "user": { "id": "user-1", "email": "test@example.com" }
  }
}

// flushEvents - Flush events (no-op for browser SDKs)
{ "command": "flushEvents" }
```

### Responses

```json
// evaluate
{ "value": true }

// evaluateAll
{ "state": { "test-flag": true, "disabled-flag": false } }
```

## Manual Testing

With services running:

```bash
# Create client
curl -X POST http://localhost:8000/ \
  -H "Content-Type: application/json" \
  -d '{
    "tag": "test-client",
    "configuration": {
      "credential": "test-api-key",
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

## Go Test Harness Integration

After starting browser services:

```bash
cd test-harness
go test -v ./internal/tests/... -services sdk-browser=http://localhost:8000
```

## Why Browser Testing?

1. **Real browser environment** - Tests actual DOM, WebSocket, fetch behavior
2. **Framework integration** - Tests React hooks, Vue composables, Angular DI
3. **Cross-SDK consistency** - Same tests for all SDKs verify identical behavior
4. **Bug detection** - Catches issues that mocked unit tests miss (e.g., API format mismatches)

## Test Results

All browser SDKs pass contract tests:

| SDK     | Create Client | Flag Evaluation | Identify | Result |
| ------- | ------------- | --------------- | -------- | ------ |
| React   | ✅            | ✅              | ✅       | PASS   |
| Vue     | ✅            | ✅              | ✅       | PASS   |
| Svelte  | ✅            | ✅              | ✅       | PASS   |
| Angular | ✅            | ✅              | ✅       | PASS   |
