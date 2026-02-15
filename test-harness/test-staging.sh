#!/bin/bash
# Run contract tests against staging API (k3s homelab)
# Usage: ./test-staging.sh [test-pattern]
#
# This script:
#   1. Starts the sdk-node test service
#   2. Runs contract tests against staging
#   3. Cleans up on exit

set -e

STAGING_URL="http://192.168.1.212:30510"
STAGING_API_KEY="rg_live_staging_contract_tests_key_2026"
NODE_SERVICE_PORT=8001
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Cleanup function
cleanup() {
    echo "Cleaning up..."
    if [ -n "$NODE_PID" ]; then
        kill "$NODE_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT

# Check staging API health
echo "Checking staging API health..."
curl -sf "$STAGING_URL/health" > /dev/null || { echo "ERROR: Staging API not reachable at $STAGING_URL"; exit 1; }
echo "Staging API healthy!"

# Start sdk-node test service
echo "Starting sdk-node test service on port $NODE_SERVICE_PORT..."
PORT=$NODE_SERVICE_PORT node "$SCRIPT_DIR/../packages/sdk-node/test-service/dist/index.js" &
NODE_PID=$!
sleep 2

# Verify test service is running
curl -sf "http://localhost:$NODE_SERVICE_PORT" > /dev/null || { echo "ERROR: sdk-node test service failed to start"; exit 1; }
echo "sdk-node test service running!"

# Run tests
export EXTERNAL_SERVER_URL="$STAGING_URL"
export EXTERNAL_API_KEY="$STAGING_API_KEY"
export TEST_SERVICES="sdk-node=http://localhost:$NODE_SERVICE_PORT"

cd "$SCRIPT_DIR"

echo ""
echo "=========================================="
echo "Running contract tests against staging"
echo "Server: $STAGING_URL"
echo "SDK: sdk-node"
echo "=========================================="
echo ""

if [ -n "$1" ]; then
    go test -v -run "$1" ./internal/tests/... -count=1 -timeout=5m
else
    go test -v ./internal/tests/... -count=1 -timeout=5m
fi
