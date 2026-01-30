/**
 * E2E test script for browser entity.
 * Opens browser, loads entity, and keeps it running for contract tests.
 */
import { chromium } from "@playwright/test";

async function main() {
  console.log("[test-e2e] Launching browser...");

  const browser = await chromium.launch({
    headless: true, // Set to false to see browser
  });

  const page = await browser.newPage();

  // Listen to console messages from the page
  page.on("console", (msg) => {
    console.log(`[browser] ${msg.type()}: ${msg.text()}`);
  });

  page.on("pageerror", (error) => {
    console.error(`[browser] Error: ${error.message}`);
  });

  console.log("[test-e2e] Navigating to http://localhost:5173...");
  await page.goto("http://localhost:5173");

  console.log("[test-e2e] Page loaded. Waiting for entity to connect...");

  // Wait for the entity to indicate it's ready
  await page
    .waitForFunction(
      () => {
        // @ts-expect-error window global
        return window.__entityReady === true;
      },
      { timeout: 10000 },
    )
    .catch(() => {
      console.log("[test-e2e] Entity ready flag not set, but continuing...");
    });

  console.log("[test-e2e] Browser entity is running. Press Ctrl+C to stop.");

  // Keep the browser open
  await new Promise(() => {}); // Never resolves
}

main().catch((error) => {
  console.error("[test-e2e] Error:", error);
  process.exit(1);
});
