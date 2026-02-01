#!/bin/bash
# Start all test services for full SDK testing
#
# Services:
# - SDK Node: 8002
# - SDK Go: 8003
# - SDK Python: 8004
# - SDK Java: 8005
# - SDK Browser: adapter 8000/8001, entity 5173
# - SDK React: adapter 8010/8011, entity 5174
# - SDK Vue: adapter 8020/8021, entity 5175
# - SDK Svelte: adapter 8030/8031, entity 5176
# - SDK Angular: adapter 8040/8041, entity 5177
#
# Note: Mock server is built into the Go test harness (port 9000)

set -e
cd "$(dirname "$0")"

echo "Starting all SDK test services..."

# SDK Node
echo "[1/13] Starting SDK Node on :8002..."
cd ../packages/sdk-node/test-service && PORT=8002 node dist/index.js &

# SDK Go
echo "[2/13] Starting SDK Go on :8003..."
cd ../../packages/sdk-go/testservice && PORT=8003 ./testservice &

# SDK Python
echo "[3/13] Starting SDK Python on :8004..."
cd ../../packages/sdk-python/test_service && PORT=8004 python -m uvicorn main:app --port 8004 &

# SDK Java
echo "[4/13] Starting SDK Java on :8005..."
cd ../../packages/sdk-java/test-service && PORT=8005 java -jar target/test-service-1.0-shaded.jar &

# Browser SDK (base)
echo "[5/13] Starting Browser Adapter on :8000/:8001..."
cd ../../test-harness/browser-adapter && PORT=8000 WS_PORT=8001 SDK_NAME=browser node dist/index.js &
echo "[6/13] Starting Browser Entity on :5173..."
cd ../browser-entity && npm run dev -- --port 5173 &

# React SDK
echo "[7/13] Starting React Adapter on :8010/:8011..."
cd ../browser-adapter && PORT=8010 WS_PORT=8011 SDK_NAME=react node dist/index.js &
echo "[8/13] Starting React Entity on :5174..."
cd ../browser-entity-react && VITE_WS_PORT=8011 npm run dev -- --port 5174 &

# Vue SDK
echo "[9/13] Starting Vue Adapter on :8020/:8021..."
cd ../browser-adapter && PORT=8020 WS_PORT=8021 SDK_NAME=vue node dist/index.js &
echo "[10/13] Starting Vue Entity on :5175..."
cd ../browser-entity-vue && VITE_WS_PORT=8021 npm run dev -- --port 5175 &

# Svelte SDK
echo "[11/13] Starting Svelte Adapter on :8030/:8031..."
cd ../browser-adapter && PORT=8030 WS_PORT=8031 SDK_NAME=svelte node dist/index.js &
echo "[12/13] Starting Svelte Entity on :5176..."
cd ../browser-entity-svelte && VITE_WS_PORT=8031 npm run dev -- --port 5176 &

# Angular SDK
echo "[13/13] Starting Angular Adapter on :8040/:8041..."
cd ../browser-adapter && PORT=8040 WS_PORT=8041 SDK_NAME=angular node dist/index.js &

echo ""
echo "All services starting..."
echo ""
echo "Open these URLs in browser to activate frontend SDKs:"
echo "  - http://localhost:5173 (Browser SDK)"
echo "  - http://localhost:5174 (React SDK)"
echo "  - http://localhost:5175 (Vue SDK)"
echo "  - http://localhost:5176 (Svelte SDK)"
echo ""
echo "Run tests with:"
echo "  cd test-harness && TEST_SERVICES=\"sdk-node=http://localhost:8002\" go test -v ./internal/tests/..."
echo ""

wait
