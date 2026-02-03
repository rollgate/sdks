#!/bin/bash
# Run contract tests against the real rollgate server
# Usage: ./test-real-server.sh [test-pattern]
#
# Prerequisites:
#   - Rollgate server running on localhost:4000
#   - SDK test service running (e.g., sdk-node on localhost:8001)

export EXTERNAL_SERVER_URL="http://localhost:4000"
export EXTERNAL_API_KEY="test-sdk-key-12345"

# Default: sdk-node
export TEST_SERVICES="${TEST_SERVICES:-sdk-node=http://localhost:8001}"

cd "$(dirname "$0")"

if [ -n "$1" ]; then
    go test -v -run "$1" ./internal/tests/... -count=1
else
    go test -v ./internal/tests/... -count=1
fi
