/**
 * Angular Contract Test Entity - Entry Point
 *
 * Simplified version that doesn't use Angular decorators in the main file
 * to avoid build issues with vite-plugin-angular.
 */
import "@angular/compiler";
import "zone.js";

// Simple logging
function log(message: string): void {
  const timestamp = new Date().toISOString().split("T")[1].slice(0, -1);
  console.log(`[${timestamp}] ${message}`);
}

log("Starting Angular contract test entity...");

// Dynamic import to avoid build issues
import("./TestHarnessWebSocket")
  .then(({ default: TestHarnessWebSocket }) => {
    log("Connecting to adapter...");
    // Angular uses port 8041
    const wsPort = (import.meta as any).env?.VITE_WS_PORT || "8041";
    const ws = new TestHarnessWebSocket(`ws://localhost:${wsPort}`);
    ws.connect();
  })
  .catch((err) => {
    log(`Error loading TestHarnessWebSocket: ${err}`);
    console.error(err);
  });

// Create minimal UI
const app = document.querySelector("app-root");
if (app) {
  app.innerHTML = `
    <div style="padding: 20px; font-family: monospace;">
      <h1>Rollgate Angular SDK - Contract Test Entity</h1>
      <p>Connected to adapter via WebSocket</p>
      <p>Check console for logs</p>
    </div>
  `;
}
