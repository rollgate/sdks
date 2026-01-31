/**
 * Vue Contract Test Entity - Entry Point
 */
import { createApp } from "vue";
import TestHarnessWebSocket from "./TestHarnessWebSocket";
import { log } from "./types";

const App = {
  template: `
    <div style="padding: 20px; font-family: monospace;">
      <h1>Rollgate Vue SDK - Contract Test Entity</h1>
      <p>Connected to adapter via WebSocket</p>
      <p>Check console for logs</p>
    </div>
  `,
};

function runContractTests() {
  log("Starting Vue contract test entity...");

  // Connect to adapter WebSocket on port 8001
  const ws = new TestHarnessWebSocket("ws://localhost:8001");
  ws.connect();
}

// Mount minimal app for UI
createApp(App).mount("#app");

// Start contract tests
runContractTests();
