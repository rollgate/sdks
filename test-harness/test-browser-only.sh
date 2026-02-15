#!/bin/bash
# Test only sdk-browser with verbose timing output
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
DASHBOARD_DIR="$SCRIPT_DIR/dashboard"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Port management
is_port_free() {
    local port=$1
    ! netstat -ano 2>/dev/null | grep ":$port " | grep -q LISTENING
}

kill_port() {
    local port=$1
    local pid=$(netstat -ano 2>/dev/null | grep ":$port " | grep LISTENING | awk '{print $5}' | head -1)
    if [ -n "$pid" ] && [ "$pid" != "0" ]; then
        taskkill //F //PID $pid 2>/dev/null || true
    fi
}

kill_and_wait() {
    local port=$1
    kill_port $port
    local waited=0
    while ! is_port_free $port && [ $waited -lt 10 ]; do
        sleep 1
        waited=$((waited + 1))
    done
}

cleanup() {
    echo -e "\n${YELLOW}Cleaning up...${NC}"
    pkill -f "open-browser" 2>/dev/null || true
    pkill -f "chromium" 2>/dev/null || true
    kill_port 8010
    kill_port 8011
    kill_port 5173
    kill_port 8080
}

trap cleanup EXIT

echo -e "${BLUE}=== sdk-browser ONLY test with timing ===${NC}"

# Kill existing
cleanup
sleep 2

# Build runner
cd "$DASHBOARD_DIR"
if [ ! -f runner.exe ] || [ runner.go -nt runner.exe ]; then
    echo "Building runner..."
    go build -o runner.exe runner.go
fi

# Start dashboard (mock server)
echo -e "${YELLOW}Starting dashboard/mock...${NC}"
go run main.go > /tmp/dashboard.log 2>&1 &
sleep 2

if ! curl -s "http://localhost:8080" > /dev/null 2>&1; then
    echo -e "${RED}Dashboard failed to start${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Dashboard running${NC}"

# Start browser-adapter
echo -e "${YELLOW}Starting browser-adapter...${NC}"
cd "$SCRIPT_DIR/browser-adapter"
PORT=8010 WS_PORT=8011 node dist/index.js > /tmp/browser-adapter.log 2>&1 &
sleep 1

# Start browser entity
echo -e "${YELLOW}Starting browser entity...${NC}"
cd "$SCRIPT_DIR/browser-entity"
VITE_WS_PORT=8011 npm run dev -- --port 5173 > /tmp/browser-entity.log 2>&1 &
sleep 3

# Open browser
echo -e "${YELLOW}Opening Playwright browser...${NC}"
VITE_URL="http://localhost:5173" node open-browser.mjs > /tmp/browser.log 2>&1 &
sleep 2

# Run tests with JSON output and capture per-test timing
echo -e "\n${BLUE}Running sdk-browser tests (95)...${NC}"
TEST_START=$SECONDS

cd "$SCRIPT_DIR"
TEST_SERVICES="sdk-browser=http://localhost:8010" go test -json ./internal/tests/... -count=1 2>&1 | tee /tmp/browser-test-json.log | while IFS= read -r line; do
    # Parse JSON test events
    action=$(echo "$line" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('Action',''))" 2>/dev/null || echo "")
    test=$(echo "$line" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('Test',''))" 2>/dev/null || echo "")
    elapsed=$(echo "$line" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('Elapsed',''))" 2>/dev/null || echo "")

    if [ "$action" = "pass" ] && [ -n "$test" ] && [ -n "$elapsed" ] && [[ ! "$test" == *"/"* ]]; then
        printf "  ${GREEN}✓${NC} %-50s %ss\n" "$test" "$elapsed"
    elif [ "$action" = "fail" ] && [ -n "$test" ] && [[ ! "$test" == *"/"* ]]; then
        printf "  ${RED}✗${NC} %-50s %ss\n" "$test" "$elapsed"
    fi
done

TEST_TIME=$((SECONDS - TEST_START))
echo -e "\n${BLUE}Total test time: ${TEST_TIME}s${NC}"

# Also extract top-10 slowest tests
echo -e "\n${YELLOW}Top 10 slowest tests:${NC}"
python3 -c "
import json, sys
tests = {}
for line in open('/tmp/browser-test-json.log'):
    try:
        d = json.loads(line)
        if d.get('Action') in ('pass','fail') and d.get('Test') and '/' not in d.get('Test','') and d.get('Elapsed'):
            tests[d['Test']] = d['Elapsed']
    except: pass
for name, elapsed in sorted(tests.items(), key=lambda x: -x[1])[:10]:
    print(f'  {elapsed:6.2f}s  {name}')
print(f'\nTotal tests: {len(tests)}')
print(f'Sum of test times: {sum(tests.values()):.1f}s')
print(f'Avg per test: {sum(tests.values())/len(tests):.3f}s')
" 2>/dev/null || echo "  (python3 not available for analysis)"
