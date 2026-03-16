#!/bin/bash
cd "$(dirname "$0")"

echo "=== SDK-NODE CONTRACT TESTS ==="
export TEST_SERVICES="sdk-node=http://localhost:8001"
./dashboard/test-suite.exe -test.v -test.count=1 2>&1
NODE_EXIT=$?

echo ""
echo "=== SDK-GO CONTRACT TESTS ==="
export TEST_SERVICES="sdk-go=http://localhost:8003"
./dashboard/test-suite.exe -test.v -test.count=1 2>&1
GO_EXIT=$?

echo ""
echo "=== RESULTS ==="
echo "sdk-node: exit code $NODE_EXIT"
echo "sdk-go: exit code $GO_EXIT"
