import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { navigateToTweet } from '../lib/browser.js';
import { config } from '../lib/config.js';

// Local fixtures never contact X or use the account's persistent profile.
test('tweet navigation waits for content rendered after the initial page settles', async () => {
  const browser = await chromium.launch({ executablePath: config.chromePath, headless: true });
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.route('https://x.com/example/status/123', route => route.fulfill({
      contentType: 'text/html',
      body: `<body>Loading<script>setTimeout(() => {
        document.body.innerHTML = '<article data-testid="tweet">Delayed tweet</article>';
      }, 4000)</script></body>`,
    }));
    const result = await navigateToTweet(context, 'https://x.com/example/status/123');
    assert.equal(result.success, true);
    assert.equal(await page.locator('article').innerText(), 'Delayed tweet');
  } finally {
    await browser.close();
  }
});

test('missing content reports a loading timeout without asserting deletion', async () => {
  const browser = await chromium.launch({ executablePath: config.chromePath, headless: true });
  const context = await browser.newContext();
  const originalTimeout = config.timeouts.navigation;
  try {
    const page = await context.newPage();
    await page.route('https://x.com/example/status/123', route => route.fulfill({
      contentType: 'text/html', body: '<body>Loading</body>',
    }));
    config.timeouts.navigation = 500;
    const result = await navigateToTweet(context, 'https://x.com/example/status/123');
    assert.equal(result.success, false);
    assert.match(result.error!, /did not become visible within 500 ms/);
    assert.doesNotMatch(result.error!, /deleted|invalid/);
  } finally {
    config.timeouts.navigation = originalTimeout;
    await browser.close();
  }
});
