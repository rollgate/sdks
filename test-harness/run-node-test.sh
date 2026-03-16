#!/bin/bash
cd "$(dirname "$0")/dashboard"
export TEST_SERVICES="sdk-node=http://localhost:8001"
export TEST_BINARY="./test-suite.exe"
./runner.exe sdk-node
