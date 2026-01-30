#!/bin/bash
# Run browser contract tests
#
# This script starts both the adapter and entity services for browser SDK testing.
# Based on LaunchDarkly's run-test-service.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "[browser-tests] Starting browser contract test services..."

# Start adapter in background
echo "[browser-tests] Starting adapter on port 8000/8001..."
cd "$SCRIPT_DIR/browser-adapter"
yarn build && node dist/index.js &
ADAPTER_PID=$!

# Wait for adapter to start
sleep 2

# Start entity (Vite dev server)
echo "[browser-tests] Starting entity on port 5173..."
cd "$SCRIPT_DIR/browser-entity"
yarn start &
ENTITY_PID=$!

# Cleanup on exit
cleanup() {
  echo "[browser-tests] Shutting down..."
  kill $ADAPTER_PID 2>/dev/null || true
  kill $ENTITY_PID 2>/dev/null || true
}
trap cleanup EXIT

# Wait for both processes
wait
