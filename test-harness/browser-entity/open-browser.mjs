/**
 * Opens a browser and navigates to the Vite dev server.
 * The browser-entity app will connect via WebSocket to the adapter.
 */

import { chromium } from '@playwright/test';

const url = process.env.VITE_URL || process.argv[2] || 'http://localhost:5173';

async function main() {
  console.log(`Opening browser at ${url}...`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox']
  });

  const page = await browser.newPage();

  // Log console messages from the browser
  page.on('console', msg => {
    console.log(`[browser] ${msg.text()}`);
  });

  await page.goto(url);
  console.log('Browser connected to Vite app');

  // Keep browser open
  console.log('Browser running. Press Ctrl+C to stop.');

  // Handle termination
  process.on('SIGINT', async () => {
    console.log('Closing browser...');
    await browser.close();
    process.exit(0);
  });

  // Keep process alive
  await new Promise(() => {});
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
