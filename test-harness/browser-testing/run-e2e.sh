#!/bin/bash
# Browser SDK E2E Test Runner
# Usage: ./run-e2e.sh
#
# This script starts all services needed for browser SDK contract testing:
# 1. Mock Rollgate API server (port 9000)
# 2. Browser adapter (REST:8000, WebSocket:8001)
# 3. Vite dev server (port 5173)
# 4. Playwright browser (headless)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=== Browser SDK E2E Test Runner ==="
echo "Root directory: $ROOT_DIR"

# Cleanup function
cleanup() {
    echo ""
    echo "=== Cleaning up ==="
    pkill -f "mock-server.js" 2>/dev/null || true
    pkill -f "browser-adapter" 2>/dev/null || true
    pkill -f "vite" 2>/dev/null || true
    pkill -f "test-e2e.ts" 2>/dev/null || true
    pkill -f "chromium" 2>/dev/null || true
    echo "Done"
}

trap cleanup EXIT

# Kill any existing processes
echo "Stopping any existing processes..."
cleanup 2>/dev/null || true
sleep 2

# Build SDK if needed
echo ""
echo "=== Building sdk-browser ==="
cd "$ROOT_DIR/packages/sdk-browser"
npm run build

# Build adapter if needed
echo ""
echo "=== Building browser-adapter ==="
cd "$ROOT_DIR/test-harness/browser-adapter"
npm install --silent
npm run build

# Install entity dependencies if needed
echo ""
echo "=== Installing browser-entity dependencies ==="
cd "$ROOT_DIR/test-harness/browser-entity"
npm install --silent

# Start mock server
echo ""
echo "=== Starting mock server (port 9000) ==="
cd "$SCRIPT_DIR"
node mock-server.js > /tmp/mock.log 2>&1 &
MOCK_PID=$!
sleep 2

# Verify mock server
if ! curl -s http://localhost:9000/api/v1/sdk/flags > /dev/null 2>&1; then
    echo "ERROR: Mock server failed to start"
    exit 1
fi
echo "Mock server running (PID: $MOCK_PID)"

# Start adapter
echo ""
echo "=== Starting browser-adapter (ports 8000, 8001) ==="
cd "$ROOT_DIR/test-harness/browser-adapter"
node dist/index.js > /tmp/adapter.log 2>&1 &
ADAPTER_PID=$!
sleep 2
echo "Adapter running (PID: $ADAPTER_PID)"

# Start Vite
echo ""
echo "=== Starting Vite dev server (port 5173) ==="
cd "$ROOT_DIR/test-harness/browser-entity"
npx vite --port 5173 > /tmp/vite.log 2>&1 &
VITE_PID=$!
sleep 3

# Verify Vite
if ! curl -s http://localhost:5173 > /dev/null 2>&1; then
    echo "ERROR: Vite failed to start"
    exit 1
fi
echo "Vite running (PID: $VITE_PID)"

# Start browser with Playwright
echo ""
echo "=== Starting browser (Playwright headless) ==="
cd "$ROOT_DIR/test-harness/browser-entity"
npx tsx test-e2e.ts > /tmp/browser.log 2>&1 &
BROWSER_PID=$!
sleep 6
echo "Browser running (PID: $BROWSER_PID)"

# Wait for browser to connect
echo ""
echo "=== Waiting for browser entity to connect ==="
for i in {1..10}; do
    if curl -s http://localhost:8000/ > /dev/null 2>&1; then
        echo "Browser entity connected!"
        break
    fi
    if [ $i -eq 10 ]; then
        echo "ERROR: Browser entity failed to connect"
        cat /tmp/browser.log
        exit 1
    fi
    sleep 1
done

# Run basic test
echo ""
echo "=== Running basic E2E test ==="

echo "1. Get capabilities..."
curl -s http://localhost:8000/ | head -c 100
echo ""

echo "2. Create client..."
CREATE_RESPONSE=$(curl -s -X POST http://localhost:8000/ \
    -H "Content-Type: application/json" \
    -w "%{http_code}" \
    -d '{
        "tag": "e2e-test",
        "configuration": {
            "credential": "test-api-key",
            "startWaitTimeMs": 5000,
            "serviceEndpoints": {"polling": "http://localhost:9000"},
            "clientSide": {"initialContext": {"kind": "user", "key": "test-user"}}
        }
    }')
HTTP_CODE="${CREATE_RESPONSE: -3}"
if [ "$HTTP_CODE" != "201" ]; then
    echo "ERROR: Create client failed with HTTP $HTTP_CODE"
    exit 1
fi
echo "Client created (HTTP 201)"

echo "3. Evaluate flag..."
EVAL_RESPONSE=$(curl -s -X POST http://localhost:8000/clients/0 \
    -H "Content-Type: application/json" \
    -d '{
        "command": "evaluate",
        "evaluate": {"flagKey": "test-flag", "valueType": "bool", "defaultValue": false}
    }')
echo "Response: $EVAL_RESPONSE"

echo "4. Delete client..."
curl -s -X DELETE http://localhost:8000/clients/0 > /dev/null
echo "Client deleted"

echo ""
echo "=== E2E Test PASSED ==="
echo ""
echo "Services are still running. Press Ctrl+C to stop."
echo "You can now run Go contract tests with:"
echo "  cd $ROOT_DIR/test-harness"
echo "  go test -v ./internal/tests/... -services sdk-browser=http://localhost:8000"
echo ""

# Wait for Ctrl+C
wait
