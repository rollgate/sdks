#!/bin/bash
# Test All SDKs - Esegue i 90 contract test su tutti gli SDK
#
# Backend SDKs: sdk-node, sdk-go, sdk-python, sdk-java, sdk-dotnet (5 SDK)
# Mobile SDKs: sdk-react-native, sdk-flutter (2 SDK)
# Frontend SDKs: sdk-browser, sdk-react, sdk-vue, sdk-svelte, sdk-angular (5 SDK)
#
# Totale: 12 SDK x 90 test = 1080 test

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
DASHBOARD_DIR="$SCRIPT_DIR/dashboard"

# Colori
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║       Rollgate SDK Contract Test Suite - All SDKs          ║${NC}"
echo -e "${BLUE}║                  12 SDK × 90 tests = 1080                    ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Funzione per verificare se una porta è libera
is_port_free() {
    local port=$1
    ! netstat -ano 2>/dev/null | grep ":$port " | grep -q LISTENING
}

# Funzione per killare processo su una porta specifica
kill_port() {
    local port=$1
    # Windows: trova PID e killa
    local pid=$(netstat -ano 2>/dev/null | grep ":$port " | grep LISTENING | awk '{print $5}' | head -1)
    if [ -n "$pid" ] && [ "$pid" != "0" ]; then
        taskkill //F //PID $pid 2>/dev/null || true
        echo -e "    Killed process on port $port (PID: $pid)"
    fi
}

# Funzione per killare e aspettare che la porta sia libera
kill_and_wait() {
    local port=$1
    local max_wait=10
    local waited=0

    kill_port $port

    while ! is_port_free $port && [ $waited -lt $max_wait ]; do
        sleep 1
        waited=$((waited + 1))
    done

    if ! is_port_free $port; then
        echo -e "    ${RED}Warning: Port $port still in use after ${max_wait}s${NC}"
        return 1
    fi
    return 0
}

# Funzione per killare tutti i processi sulle porte usate
kill_all_ports() {
    echo -e "${YELLOW}Killing processes on required ports...${NC}"
    # Backend ports (node, go, python, java, react-native, dotnet, flutter)
    for port in 8001 8003 8004 8005 8006 8007 8008; do
        kill_and_wait $port
    done
    # Frontend/browser adapter port
    kill_and_wait 8010
    kill_and_wait 8011
    # Vite dev server ports
    for port in 5173 5174 5175 5176 5177; do
        kill_and_wait $port
    done
    # Dashboard port
    kill_and_wait 8080
    echo -e "${GREEN}✓ All ports freed${NC}"
}

# Funzione per cleanup finale
cleanup() {
    echo -e "\n${YELLOW}Cleaning up all processes...${NC}"
    # Kill Java processes (for sdk-java)
    taskkill //F //IM java.exe 2>/dev/null || true
    # Kill Go processes
    pkill -f "go run" 2>/dev/null || true
    # Kill Python processes
    pkill -f "python main.py" 2>/dev/null || true
    # Kill dotnet processes (for sdk-dotnet)
    pkill -f "dotnet run" 2>/dev/null || true
    # Kill dart processes (for sdk-flutter)
    pkill -f "dart run" 2>/dev/null || true
    # Free all ports
    kill_all_ports
}

# Trap per cleanup su exit
trap cleanup EXIT

# ══════════════════════════════════════════════════════════════
# FASE 1: Cleanup e preparazione
# ══════════════════════════════════════════════════════════════
echo -e "${YELLOW}[FASE 1] Cleanup and preparation...${NC}"
kill_all_ports

# Build runner se necessario
cd "$DASHBOARD_DIR"
if [ ! -f runner.exe ] || [ runner.go -nt runner.exe ]; then
    echo -e "  Building test runner..."
    go build -o runner.exe runner.go
fi
echo -e "${GREEN}✓ Runner ready${NC}"

# ══════════════════════════════════════════════════════════════
# FASE 2: Avvia Dashboard
# ══════════════════════════════════════════════════════════════
echo -e "\n${YELLOW}[FASE 2] Starting dashboard...${NC}"
cd "$DASHBOARD_DIR"
go run main.go > /tmp/dashboard.log 2>&1 &
DASHBOARD_PID=$!
sleep 2

# Verifica dashboard
if curl -s "http://localhost:8080" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Dashboard running at http://localhost:8080/static/${NC}"
    # Apri browser con la dashboard
    start "http://localhost:8080/static/" 2>/dev/null || \
    xdg-open "http://localhost:8080/static/" 2>/dev/null || \
    open "http://localhost:8080/static/" 2>/dev/null || true
else
    echo -e "${RED}✗ Dashboard failed to start${NC}"
    exit 1
fi

# ══════════════════════════════════════════════════════════════
# FASE 3: Avvia Backend Test Services
# ══════════════════════════════════════════════════════════════
echo -e "\n${YELLOW}[FASE 3] Starting backend test services...${NC}"

# sdk-node (porta 8001)
echo -e "  Starting sdk-node on port 8001..."
cd "$ROOT_DIR/packages/sdk-node/test-service"
PORT=8001 node dist/index.js > /tmp/sdk-node.log 2>&1 &

# sdk-go (porta 8003)
echo -e "  Starting sdk-go on port 8003..."
cd "$ROOT_DIR/packages/sdk-go/testservice"
PORT=8003 go run . > /tmp/sdk-go.log 2>&1 &

# sdk-python (porta 8004)
echo -e "  Starting sdk-python on port 8004..."
cd "$ROOT_DIR/packages/sdk-python/test_service"
PORT=8004 python main.py > /tmp/sdk-python.log 2>&1 &

# sdk-java (porta 8005)
echo -e "  Starting sdk-java on port 8005..."
cd "$ROOT_DIR/packages/sdk-java/test-service"
PORT=8005 java -jar target/rollgate-sdk-test-service-0.1.0-shaded.jar > /tmp/sdk-java.log 2>&1 &

# sdk-react-native (porta 8006)
echo -e "  Starting sdk-react-native on port 8006..."
cd "$ROOT_DIR/packages/sdk-react-native/test-service"
PORT=8006 node dist/index.js > /tmp/sdk-react-native.log 2>&1 &

# sdk-dotnet (porta 8007)
echo -e "  Starting sdk-dotnet on port 8007..."
cd "$ROOT_DIR/packages/sdk-dotnet/test-service"
PORT=8007 dotnet run --no-build > /tmp/sdk-dotnet.log 2>&1 &

# sdk-flutter (porta 8008)
echo -e "  Starting sdk-flutter on port 8008..."
cd "$ROOT_DIR/packages/sdk-flutter/test-service"
PORT=8008 dart run bin/server.dart > /tmp/sdk-flutter.log 2>&1 &

# Attendi avvio
echo -e "  Waiting for services to start..."
sleep 8

# Verifica servizi
echo -e "  Verifying services..."
for port in 8001 8003 8004 8005 8006 8007 8008; do
    if curl -s "http://localhost:$port" > /dev/null 2>&1; then
        echo -e "    ${GREEN}✓ Port $port OK${NC}"
    else
        echo -e "    ${RED}✗ Port $port FAILED${NC}"
    fi
done

# ══════════════════════════════════════════════════════════════
# FASE 4: Test Backend SDKs (sequenziali, schede separate)
# ══════════════════════════════════════════════════════════════
echo -e "\n${YELLOW}[FASE 4] Testing backend SDKs (sequential, separate tabs)...${NC}"

cd "$DASHBOARD_DIR"

# Test backend SDK uno alla volta (così la dashboard mostra il progresso)
echo -e "\n  ${BLUE}Testing sdk-node...${NC}"
TEST_SERVICES="sdk-node=http://localhost:8001" ./runner.exe sdk-node ./internal/tests/... -count=1
echo -e "  ${GREEN}✓ sdk-node complete${NC}"

echo -e "\n  ${BLUE}Testing sdk-go...${NC}"
TEST_SERVICES="sdk-go=http://localhost:8003" ./runner.exe sdk-go ./internal/tests/... -count=1
echo -e "  ${GREEN}✓ sdk-go complete${NC}"

echo -e "\n  ${BLUE}Testing sdk-python...${NC}"
TEST_SERVICES="sdk-python=http://localhost:8004" ./runner.exe sdk-python ./internal/tests/... -count=1
echo -e "  ${GREEN}✓ sdk-python complete${NC}"

echo -e "\n  ${BLUE}Testing sdk-java...${NC}"
TEST_SERVICES="sdk-java=http://localhost:8005" ./runner.exe sdk-java ./internal/tests/... -count=1
echo -e "  ${GREEN}✓ sdk-java complete${NC}"

echo -e "\n  ${BLUE}Testing sdk-react-native...${NC}"
TEST_SERVICES="sdk-react-native=http://localhost:8006" ./runner.exe sdk-react-native ./internal/tests/... -count=1
echo -e "  ${GREEN}✓ sdk-react-native complete${NC}"

echo -e "\n  ${BLUE}Testing sdk-dotnet...${NC}"
TEST_SERVICES="sdk-dotnet=http://localhost:8007" ./runner.exe sdk-dotnet ./internal/tests/... -count=1
echo -e "  ${GREEN}✓ sdk-dotnet complete${NC}"

echo -e "\n  ${BLUE}Testing sdk-flutter...${NC}"
TEST_SERVICES="sdk-flutter=http://localhost:8008" ./runner.exe sdk-flutter ./internal/tests/... -count=1
echo -e "  ${GREEN}✓ sdk-flutter complete${NC}"

echo -e "\n${GREEN}✓ All backend SDK tests complete${NC}"

# ══════════════════════════════════════════════════════════════
# FASE 5: Test Frontend SDKs (sequenziali)
# ══════════════════════════════════════════════════════════════
echo -e "\n${YELLOW}[FASE 5] Testing frontend SDKs (sequential)...${NC}"

FRONTEND_SDKS=("browser" "react" "vue" "svelte" "angular")
VITE_PORTS=(5173 5174 5175 5176 5177)

for i in "${!FRONTEND_SDKS[@]}"; do
    SDK="${FRONTEND_SDKS[$i]}"
    VITE_PORT="${VITE_PORTS[$i]}"
    ENTITY_DIR="$SCRIPT_DIR/browser-entity"

    if [ "$SDK" != "browser" ]; then
        ENTITY_DIR="$SCRIPT_DIR/browser-entity-$SDK"
    fi

    echo -e "\n  ${BLUE}Testing sdk-$SDK...${NC}"

    # Kill processes on browser/adapter ports and wait for them to be free
    kill_and_wait 8010
    kill_and_wait 8011
    kill_and_wait $VITE_PORT

    # Start browser-adapter
    cd "$SCRIPT_DIR/browser-adapter"
    PORT=8010 WS_PORT=8011 node dist/index.js > /tmp/browser-adapter.log 2>&1 &
    sleep 2

    # Start browser entity with WebSocket port
    cd "$ENTITY_DIR"
    VITE_WS_PORT=8011 npm run dev -- --port $VITE_PORT > /tmp/browser-entity-$SDK.log 2>&1 &
    sleep 3

    # Open browser
    VITE_URL="http://localhost:$VITE_PORT" node open-browser.mjs > /tmp/browser-$SDK.log 2>&1 &
    sleep 3

    # Run tests
    cd "$DASHBOARD_DIR"
    TEST_SERVICES="sdk-$SDK=http://localhost:8010" ./runner.exe "sdk-$SDK" ./internal/tests/... -count=1

    echo -e "  ${GREEN}✓ sdk-$SDK complete${NC}"
done

# ══════════════════════════════════════════════════════════════
# RISULTATI FINALI
# ══════════════════════════════════════════════════════════════
echo -e "\n${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                    ALL TESTS COMPLETE                       ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "Check dashboard at: ${BLUE}http://localhost:8080/static/${NC}"
echo -e "Logs in: /tmp/sdk-*.log"
echo ""
