#!/bin/bash
# Run contract tests against mock server (default mode)
# Usage: ./test-mock.sh [test-pattern]

export TEST_SERVICES="sdk-node=http://localhost:8001"

cd "$(dirname "$0")"

if [ -n "$1" ]; then
    go test -v -run "$1" ./internal/tests/... -count=1 -timeout=5m
else
    go test -v ./internal/tests/... -count=1 -timeout=5m
fi
