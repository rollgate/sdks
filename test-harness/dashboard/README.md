# Contract Tests Dashboard

Real-time dashboard for monitoring SDK contract test execution.

## Quick Start

```bash
# Terminal 1: Start dashboard (http://localhost:8080)
cd test-harness/dashboard
go run main.go

# Terminal 2: Start test service (es. sdk-node)
cd packages/sdk-node/test-service
npm start

# Terminal 3: Run tests with dashboard
cd test-harness/dashboard
TEST_SERVICES="sdk-node=http://localhost:8001" ./runner.exe sdk-node ./internal/tests/... -count=1
```

## Build

```bash
# Dashboard server
go build -o dashboard.exe main.go

# Test runner
go build -o runner.exe runner.go
```

## Architecture

```
┌─────────────────┐     HTTP POST      ┌─────────────────┐
│   Test Runner   │ ─────────────────► │    Dashboard    │
│   (runner.go)   │                    │    (main.go)    │
└─────────────────┘                    └────────┬────────┘
        │                                       │
        │ go test -json                         │ WebSocket
        ▼                                       ▼
┌─────────────────┐                    ┌─────────────────┐
│  Go Test Suite  │                    │     Browser     │
└─────────────────┘                    └─────────────────┘
```

## Event Protocol

Events sent to `/api/event`:

```json
{"type": "start", "sdk": "sdk-node", "total": 84}
{"type": "test", "sdk": "sdk-node", "test": "TestInit", "status": "pass"}
{"type": "done", "sdk": "sdk-node", "passed": 80, "failed": 2, "skipped": 2}
```

Status values: `pass`, `fail`, `skip`
