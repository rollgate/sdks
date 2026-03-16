#!/bin/bash
cd "$(dirname "$0")"
export TEST_SERVICES="sdk-node=http://localhost:8001"
./dashboard/test-suite.exe -test.v -test.count=1 -test.run TestInit 2>&1 | head -50
