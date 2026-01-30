# Rollgate SDK Test Harness

Cross-SDK contract testing framework inspired by [LaunchDarkly's sdk-test-harness](https://github.com/launchdarkly/sdk-test-harness).

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│              TEST HARNESS (Go)                          │
│  - Orchestrates tests                                   │
│  - Runs mock Rollgate API (flags, SSE)                  │
│  - Parameterized test cases                             │
└────────────┬────────────────────────────────────────────┘
             │ HTTP
┌────────────▼────────────────────────────────────────────┐
│           TEST SERVICES (one per SDK)                   │
│  Node.js │ Go │ React │ Vue │ Angular │ Svelte │ ...   │
│  Wrap SDK and expose standard REST API                  │
└─────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Start the Mock Server

```bash
cd test-harness
go run ./cmd/harness -scenario=basic
```

### 2. Start Test Services

Each SDK has a test service that wraps it:

```bash
# SDK Node.js (port 8001)
cd packages/sdk-node/test-service
npm install && npm run build
PORT=8001 node dist/index.js

# SDK Go (port 8002)
cd packages/sdk-go/testservice
go build -o testservice . && PORT=8002 ./testservice
```

### 3. Run Tests

```bash
cd test-harness
go test -v ./internal/tests/... \
  -services="sdk-node=http://localhost:8001,sdk-go=http://localhost:8002"
```

## HTTP Protocol

Test services expose a simple HTTP interface:

| Method | Endpoint | Description      |
| ------ | -------- | ---------------- |
| GET    | `/`      | Health check     |
| POST   | `/`      | Execute command  |
| DELETE | `/`      | Cleanup/shutdown |

### Commands

```json
// Initialize SDK
{
  "command": "init",
  "config": {
    "apiKey": "test-key",
    "baseUrl": "http://localhost:9000",
    "refreshInterval": 0,
    "enableStreaming": false,
    "timeout": 5000
  },
  "user": { "id": "user-1", "email": "test@example.com" }
}

// Check flag
{
  "command": "isEnabled",
  "flagKey": "feature-x",
  "defaultValue": false
}

// Identify user
{
  "command": "identify",
  "user": { "id": "user-2", "attributes": { "plan": "pro" } }
}

// Other commands
{ "command": "reset" }
{ "command": "getAllFlags" }
{ "command": "getState" }
{ "command": "close" }
```

### Responses

```json
// isEnabled
{ "value": true }

// getAllFlags
{ "flags": { "feature-x": true, "feature-y": false } }

// getState
{
  "isReady": true,
  "circuitState": "closed",
  "cacheStats": { "hits": 10, "misses": 2 }
}

// Error
{ "error": "AuthenticationError", "message": "Invalid API key" }
```

## Test Scenarios

The mock server supports different scenarios:

| Scenario    | Description                   |
| ----------- | ----------------------------- |
| `basic`     | Simple enabled/disabled flags |
| `targeting` | User targeting rules          |
| `rollout`   | Percentage rollout (0-100%)   |
| `empty`     | No flags                      |

## Test Categories

| Category           | Tests                                            |
| ------------------ | ------------------------------------------------ |
| Initialization     | Init with valid config, invalid API key, timeout |
| Flag Evaluation    | Enabled/disabled, missing (default), rollout     |
| User Targeting     | Identify, reset, attribute matching              |
| Consistent Hashing | Same user = same result across SDKs              |

## Adding a New SDK Test Service

1. Create a directory: `packages/sdk-XXX/test-service/`
2. Implement HTTP server with the protocol above
3. Add to CI workflow: `.github/workflows/contract-tests.yml`

### Example (TypeScript)

```typescript
import { createServer } from "http";
import { RollgateClient } from "@rollgate/sdk-XXX";

let client: RollgateClient | null = null;

const server = createServer(async (req, res) => {
  if (req.method === "GET") {
    res.writeHead(200);
    res.end(JSON.stringify({ success: true }));
    return;
  }

  if (req.method === "POST") {
    const body = await getBody(req);
    const cmd = JSON.parse(body);
    const result = await handleCommand(cmd);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
    return;
  }

  if (req.method === "DELETE") {
    if (client) await client.close();
    client = null;
    res.writeHead(200);
    res.end();
  }
});

server.listen(process.env.PORT || 8000);
```

## CI Integration

Contract tests run automatically on push/PR via GitHub Actions.

See `.github/workflows/contract-tests.yml`.

## Development

```bash
# Build harness
cd test-harness
go build -o harness ./cmd/harness

# Run with verbose logging
./harness -verbose -services="sdk-node=http://localhost:8001"

# Run specific test
go test -v ./internal/tests/... -run TestFlagEvaluation
```
