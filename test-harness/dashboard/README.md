# Contract Tests Dashboard

Real-time dashboard for monitoring SDK contract test execution.

## Quick Start

```bash
# Terminal 1: Start dashboard
cd test-harness/dashboard
go mod tidy
go run main.go

# Terminal 2: Run tests with dashboard
cd test-harness/dashboard
go build -o runner runner.go
./runner sdk-node ./internal/tests/... -count=1
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
