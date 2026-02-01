/**
 * Svelte Contract Test Entity - Entry Point
 */
import TestHarnessWebSocket from "./TestHarnessWebSocket";
import { log } from "./types";

function runContractTests() {
  log("Starting Svelte contract test entity...");

  // Connect to adapter WebSocket (Svelte uses port 8031)
  const wsPort = import.meta.env.VITE_WS_PORT || "8031";
  const ws = new TestHarnessWebSocket(`ws://localhost:${wsPort}`);
  ws.connect();
}

// Create minimal UI
const app = document.getElementById("app");
if (app) {
  app.innerHTML = `
    <div style="padding: 20px; font-family: monospace;">
      <h1>Rollgate Svelte SDK - Contract Test Entity</h1>
      <p>Connected to adapter via WebSocket</p>
      <p>Check console for logs</p>
    </div>
  `;
}

// Start contract tests
runContractTests();
