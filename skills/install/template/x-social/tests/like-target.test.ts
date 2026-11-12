import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { config } from '../lib/config.js';
import { getTargetTweet, toggleTweetAction } from '../lib/utils.js';

// Only local HTML is used: no real account or X action.
async function fixture(run: (page: import('playwright').Page) => Promise<void>) {
  const browser = await chromium.launch({ executablePath: config.chromePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<article data-testid="tweet" id="parent">
      <a href="/me/status/12"><time>parent</time></a><button data-testid="like">like</button>
      <div><a href="/other/status/123">quoted link</a></div>
    </article><article data-testid="tweet" id="reply">
      <a href="/other/status/123"><time>reply</time></a><button data-testid="like">like</button>
    </article><article data-testid="tweet" id="other">
      <a href="/other/status/1234"><time>other</time></a><button data-testid="like">like</button>
    </article><article data-testid="tweet" id="edited">
      <a href="/other/status/77/history"><time>edited</time></a><button data-testid="like">like</button>
      <a href="/other/status/78"><time>latest edit</time></a>
    </article><script>document.addEventListener('click', e => {
      if (e.target.dataset.testid === 'like') e.target.dataset.testid = 'unlike';
    });</script>`);
    await run(page);
  } finally { await browser.close(); }
}

test('likes the requested reply, leaving the parent and other statuses untouched', async () => {
  await fixture(async page => {
    const result = await toggleTweetAction({
      tweet: getTargetTweet(page, 'https://x.com/other/status/123'), page,
      actionButtonSelector: '[data-testid="like"]', doneButtonSelector: '[data-testid="unlike"]', actionName: 'Like',
    });
    assert.equal(result.success, true);
    assert.equal(await page.locator('#reply [data-testid="unlike"]').count(), 1);
    assert.equal(await page.locator('#parent [data-testid="like"]').count(), 1);
    assert.equal(await page.locator('#other [data-testid="like"]').count(), 1);
  });
});

test('matches raw IDs and standalone posts; missing targets never fall back to the parent', async () => {
  await fixture(async page => {
    assert.equal(await getTargetTweet(page, '123').getAttribute('id'), 'reply');
    assert.equal(await getTargetTweet(page, 'https://x.com/me/status/12').getAttribute('id'), 'parent');
    assert.equal(await getTargetTweet(page, 'https://x.com/no/status/999').count(), 0);
    assert.equal(await getTargetTweet(page, 'https://x.com/other/status/77').getAttribute('id'), 'edited');
    assert.equal(await getTargetTweet(page, 'https://x.com/other/status/7').count(), 0);
    assert.equal(await getTargetTweet(page, 'https://x.com/other/status/177').count(), 0);
  });
});

test('likes an edited post whose timestamp links to its edit history', async () => {
  await fixture(async page => {
    const result = await toggleTweetAction({
      tweet: getTargetTweet(page, 'https://x.com/other/status/77'), page,
      actionButtonSelector: '[data-testid="like"]', doneButtonSelector: '[data-testid="unlike"]', actionName: 'Like',
    });
    assert.equal(result.success, true);
    assert.equal(await page.locator('#edited [data-testid="unlike"]').count(), 1);
    assert.equal(await page.locator('#reply [data-testid="like"]').count(), 1);
  });
});

test('already liked reply is not toggled off', async () => {
  await fixture(async page => {
    await page.locator('#reply button').evaluate(el => el.setAttribute('data-testid', 'unlike'));
    const result = await toggleTweetAction({
      tweet: getTargetTweet(page, '123'), page,
      actionButtonSelector: '[data-testid="like"]', doneButtonSelector: '[data-testid="unlike"]', actionName: 'Like',
    });
    assert.equal(result.alreadyDone, true);
    assert.equal(await page.locator('#reply [data-testid="unlike"]').count(), 1);
    assert.equal(await page.locator('#parent [data-testid="like"]').count(), 1);
  });
});
