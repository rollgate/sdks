/**
 * React Contract Test Entity - Entry Point
 */
import TestHarnessWebSocket from "./TestHarnessWebSocket";
import { log } from "./types";

async function runContractTests() {
  log("Starting React contract test entity...");

  // Connect to adapter WebSocket (React uses port 8011)
  const wsPort = import.meta.env.VITE_WS_PORT || "8011";
  const ws = new TestHarnessWebSocket(`ws://localhost:${wsPort}`);
  ws.connect();
}

// Start when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", runContractTests);
} else {
  runContractTests();
}
