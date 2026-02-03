/**
 * Browser Contract Test Service - Entry Point
 *
 * This application runs in the browser and communicates with the adapter
 * via WebSocket to execute SDK commands from the test harness.
 */

import TestHarnessWebSocket from "./TestHarnessWebSocket";
import { log } from "./types";

async function runContractTests() {
  log("Starting browser contract test service...");

  // Connect to adapter WebSocket (default port 8011, same as other entities)
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
