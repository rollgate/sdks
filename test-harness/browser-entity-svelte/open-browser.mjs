/**
 * Opens a headless browser using Playwright and connects to the Vite dev server.
 * This script should be run after the Vite dev server is started.
 */
import { chromium } from '@playwright/test';

const url = process.env.VITE_URL || 'http://localhost:5176';

console.log(`Opening browser at ${url}...`);

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});

const context = await browser.newContext();
const page = await context.newPage();

// Forward console messages
page.on('console', msg => {
  console.log(`[browser] ${msg.text()}`);
});

// Forward page errors
page.on('pageerror', error => {
  console.error(`[browser] Page error: ${error.message}`);
});

await page.goto(url);
console.log('Browser connected to Vite app');
console.log('Browser running. Press Ctrl+C to stop.');

// Keep the script running
process.on('SIGINT', async () => {
  console.log('Closing browser...');
  await browser.close();
  process.exit(0);
});
