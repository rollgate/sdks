/**
 * React Contract Test Entity - Entry Point
 */
import TestHarnessWebSocket from "./TestHarnessWebSocket";
import { log } from "./types";

function App() {
  return (
    <div style={{ padding: "20px", fontFamily: "monospace" }}>
      <h1>Rollgate React SDK - Contract Test Entity</h1>
      <p>Connected to adapter via WebSocket</p>
      <p>Check console for logs</p>
    </div>
  );
}

async function runContractTests() {
  log("Starting React contract test entity...");

  // Connect to adapter WebSocket on port 8001
  const ws = new TestHarnessWebSocket("ws://localhost:8001");
  ws.connect();
}

// Start when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", runContractTests);
} else {
  runContractTests();
}
