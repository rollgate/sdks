#!/bin/bash
cd "$(dirname "$0")/dashboard"
export TEST_SERVICES="sdk-go=http://localhost:8003"
export TEST_BINARY="./test-suite.exe"
./runner.exe sdk-go
