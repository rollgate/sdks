@echo off
REM Browser SDK E2E Test Runner for Windows
REM Usage: run-e2e.bat

echo === Browser SDK E2E Test Runner ===

set SCRIPT_DIR=%~dp0
set ROOT_DIR=%SCRIPT_DIR%..\..

echo Root directory: %ROOT_DIR%

REM Cleanup any existing processes
echo.
echo Stopping any existing processes...
taskkill /F /IM node.exe 2>nul
timeout /t 2 /nobreak >nul

REM Build SDK
echo.
echo === Building sdk-browser ===
cd /d %ROOT_DIR%\packages\sdk-browser
call npm run build

REM Build adapter
echo.
echo === Building browser-adapter ===
cd /d %ROOT_DIR%\test-harness\browser-adapter
call npm install --silent
call npm run build

REM Install entity dependencies
echo.
echo === Installing browser-entity dependencies ===
cd /d %ROOT_DIR%\test-harness\browser-entity
call npm install --silent

REM Start mock server
echo.
echo === Starting mock server (port 9000) ===
cd /d %SCRIPT_DIR%
start /B node mock-server.js
timeout /t 2 /nobreak >nul

REM Start adapter
echo.
echo === Starting browser-adapter (ports 8000, 8001) ===
cd /d %ROOT_DIR%\test-harness\browser-adapter
start /B node dist\index.js
timeout /t 2 /nobreak >nul

REM Start Vite
echo.
echo === Starting Vite dev server (port 5173) ===
cd /d %ROOT_DIR%\test-harness\browser-entity
start /B npx vite --port 5173
timeout /t 3 /nobreak >nul

REM Start browser with Playwright
echo.
echo === Starting browser (Playwright headless) ===
cd /d %ROOT_DIR%\test-harness\browser-entity
start /B npx tsx test-e2e.ts
timeout /t 8 /nobreak >nul

echo.
echo === Services started ===
echo.
echo Mock server: http://localhost:9000
echo Adapter REST: http://localhost:8000
echo Adapter WS: ws://localhost:8001
echo Vite: http://localhost:5173
echo.
echo To test manually:
echo   curl http://localhost:8000/
echo.
echo To run Go contract tests:
echo   cd %ROOT_DIR%\test-harness
echo   go test -v ./internal/tests/... -services sdk-browser=http://localhost:8000
echo.
echo Press Ctrl+C to stop all services.
pause
