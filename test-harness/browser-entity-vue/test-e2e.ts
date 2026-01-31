/**
 * E2E test script for Vue browser entity.
 * Opens browser, loads entity, and keeps it running for contract tests.
 */
import { chromium } from "@playwright/test";

async function main() {
  console.log("[test-e2e] Launching browser for Vue entity...");

  const browser = await chromium.launch({
    headless: true,
  });

  const page = await browser.newPage();

  page.on("console", (msg) => {
    console.log(`[browser] ${msg.type()}: ${msg.text()}`);
  });

  page.on("pageerror", (error) => {
    console.error(`[browser] Error: ${error.message}`);
  });

  console.log("[test-e2e] Navigating to http://localhost:5175...");
  await page.goto("http://localhost:5175");

  console.log("[test-e2e] Page loaded. Waiting for entity to connect...");

  // Wait a bit for WebSocket connection
  await new Promise((resolve) => setTimeout(resolve, 3000));

  console.log(
    "[test-e2e] Vue browser entity is running. Press Ctrl+C to stop.",
  );

  // Keep the browser open
  await new Promise(() => {});
}

main().catch((error) => {
  console.error("[test-e2e] Error:", error);
  process.exit(1);
});
