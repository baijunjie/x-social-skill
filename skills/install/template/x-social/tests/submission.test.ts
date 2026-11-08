import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { config } from '../lib/config.js';
import { tweetMatchesContent } from '../lib/tweet-content.js';
import {
  checkLoginStatus, getOwnHandle, getTargetTweet, clickTweetButton,
  fillDialogAndSubmit, verifySubmission, verifyOwnReplyOnTweetPage, verifyNewTweet,
} from '../lib/utils.js';

let browser: Browser;
const original = { ...config.timeouts };
before(async () => {
  browser = await chromium.launch({ executablePath: config.chromePath, headless: true });
  Object.assign(config.timeouts, { navigation: 700, elementWait: 500, loadWait: 20, actionDelay: 0, shortPause: 0 });
});
after(async () => { Object.assign(config.timeouts, original); await browser?.close(); });
async function fixture(run: (page: Page) => Promise<void>) {
  const context = await browser.newContext();
  try { await run(await context.newPage()); } finally { await context.close(); }
}
const dialog = `<div role="dialog" aria-modal="true"><div data-testid="tweetTextarea_0" contenteditable="true"></div>
<button data-testid="tweetButton">Reply</button></div>`;
const statusId = (time: number) => ((BigInt(time) - 1288834974657n) << 22n).toString();
const article = (handle: string, id: string, text: string) => `<article data-testid="tweet">
<a href="/${handle}/status/${id}"><time>now</time></a><div data-testid="tweetText">${text}</div></article>`;

test('login and sidebar checks wait for asynchronously rendered account UI', async () => fixture(async page => {
  await page.setContent(`<script>setTimeout(() => { document.body.innerHTML =
    '<button data-testid="SideNav_AccountSwitcher_Button">me</button><a data-testid="AppTabBar_Profile_Link" href="/MyAccount">Profile</a>';
  }, 100)</script>`);
  assert.deepEqual(await checkLoginStatus(page), { loggedIn: true, onLoginPage: false });
  assert.equal(await getOwnHandle(page, '@myaccount'), 'MyAccount');
}));

test('sidebar identity independently waits and distinguishes timeout from mismatch', async () => fixture(async page => {
  await page.setContent(`<script>setTimeout(() => { document.body.innerHTML =
    '<a data-testid="AppTabBar_Profile_Link" href="/right">Profile</a>'; }, 100)</script>`);
  assert.equal(await getOwnHandle(page, 'right'), 'right');
  await assert.rejects(getOwnHandle(page, 'wrong'), /Account mismatch: expected @wrong, but sidebar shows @right/);
  await page.setContent('<body>Loading</body>');
  await assert.rejects(getOwnHandle(page, 'right'), /identity is unknown/);
  await assert.rejects(checkLoginStatus(page), /login status is unknown/);
}));

test('a visible login input means login is required, not a sidebar loading timeout', async () => fixture(async page => {
  await page.setContent('<input autocomplete="username">');
  assert.deepEqual(await checkLoginStatus(page), { loggedIn: false, onLoginPage: true });
}));

test('reply button targets the requested status rather than its parent', async () => fixture(async page => {
  await page.setContent(`${article('parent', '12', 'parent').replace('</article>', '<button data-testid="reply" onclick="window.clicked=12">Reply</button></article>')}
    ${article('other', '123', 'target').replace('</article>', '<button data-testid="reply" onclick="window.clicked=123">Reply</button></article>')}`);
  await clickTweetButton(getTargetTweet(page, '123'), config.selectors.buttons.reply, page);
  assert.equal(await page.evaluate('window.clicked'), 123);
}));

test('dialog waits beyond loadWait for asynchronous completion and submits only once', async () => fixture(async page => {
  await page.setContent(`${dialog}<script>window.clicks=0; document.querySelector('button').onclick=()=>{
    window.clicks++; setTimeout(()=>document.querySelector('[role=dialog]').remove(),150);
  }</script>`);
  const result = await fillDialogAndSubmit({ page, content: 'Hello', contentLabel: 'Reply' });
  assert.equal(result.success, true);
  assert.equal(result.submitted, true);
  assert.equal(await page.evaluate('window.clicks'), 1);
}));

test('uncertain dialog result still verifies in a new page without a second click or composer navigation', async () => fixture(async page => {
  await page.setContent(`${dialog}<script>window.clicks=0; document.querySelector('button').onclick=()=>window.clicks++;</script>`);
  const result = await fillDialogAndSubmit({ page, content: 'Hello', contentLabel: 'Reply' });
  assert.equal(result.success, false);
  assert.equal(result.submitted, true);
  let check: Page | undefined;
  const verified = await verifySubmission(page, 'Reply', async verificationPage => {
    check = verificationPage;
    assert.notEqual(verificationPage, page);
    assert.equal(verificationPage.context(), page.context());
    await verificationPage.setContent('<body>Read only</body>');
    return 'https://x.com/me/status/123';
  });
  assert.equal(verified.success, true);
  assert.match(verified.message, /https:\/\/x.com\/me\/status\/123/);
  assert.equal(check?.isClosed(), true);
  assert.equal(await page.locator('[role=dialog]').count(), 1);
  assert.equal(await page.evaluate('window.clicks'), 1);
}));

test('missing URLs and verification exceptions both report an unknown non-retryable outcome', async () => fixture(async page => {
  for (const verify of [async () => null, async () => { throw new Error('navigation timed out'); }]) {
    const result = await verifySubmission(page, 'Reply', verify);
    assert.equal(result.success, false);
    assert.deepEqual(result.data, { outcome: 'unknown', submitted: true, retrySafe: false });
    assert.match(result.message, /Do not resubmit/);
    assert.equal(page.context().pages().length, 1);
  }
}));

test('disabled button has no attempted submission', async () => fixture(async page => {
  await page.setContent(dialog.replace('<button ', '<button aria-disabled="true" '));
  const result = await fillDialogAndSubmit({ page, content: 'Hello', contentLabel: 'Reply' });
  assert.equal(result.success, false);
  assert.notEqual(result.submitted, true);
}));

test('reply verification rejects old same-content replies, matching prefixes and other authors', async () => fixture(async page => {
  const started = Date.now();
  const fresh = statusId(started + 100);
  const content = 'The first thirty characters match, but this reply is different.';
  await page.route('https://x.com/i/status/123', route => route.fulfill({
    contentType: 'text/html', body: article('ME', statusId(started - 10000), content)
      + article('me', statusId(started + 1), content.slice(0, 35) + ' other ending')
      + article('other', statusId(started + 2), content)
      + article('ME', fresh, content),
  }));
  assert.equal(await verifyOwnReplyOnTweetPage(page, '123', 'me', content, started), `https://x.com/ME/status/${fresh}`);
}));

test('profile verification matches content instead of choosing an unrelated newer post', async () => fixture(async page => {
  const started = Date.now();
  const wanted = statusId(started + 1);
  await page.route('https://x.com/me', route => route.fulfill({
    contentType: 'text/html', body: article('me', statusId(started + 2), 'Unrelated post') + article('me', wanted, 'Expected content'),
  }));
  assert.equal(await verifyNewTweet(page, {
    username: 'me', profilePath: '/me', tab: 'posts', urlsBefore: [], capturedAt: started,
  }, 'Expected content'), `https://x.com/me/status/${wanted}`);
}));


test('verification preserves full link text hidden by X display spans', async () => fixture(async page => {
  const started = Date.now();
  const fresh = statusId(started + 1);
  const body = article('me', fresh, 'Read <a href="https://t.co/short"><span style="display:none">https://</span>github.com/baijunjie/octoboard</a>');
  await page.route('https://x.com/i/status/123', route => route.fulfill({ contentType: 'text/html', body }));
  assert.equal(await verifyOwnReplyOnTweetPage(page, '123', 'me',
    'Read https://github.com/baijunjie/octoboard', started), `https://x.com/me/status/${fresh}`);
}));

for (const [label, text, card] of [
  ['expanded URL', 'Read <a href="https://t.co/short" data-expanded-url="https://x.com/hifumi369/status/555">x.com/hifumi369/sta…</a>', ''],
  ['link title', 'Read <a href="https://t.co/short" title="https://x.com/hifumi369/status/555">x.com/hifumi369/sta…</a>', ''],
  ['full href', 'Read <a href="https://x.com/hifumi369/status/555">x.com/hifumi369/sta…</a>', ''],
  ['quote card', 'Read', '<div role="link"><a href="/hifumi369/status/555"><time>quoted post</time></a><div data-testid="tweetText">Quoted content</div></div>'],
]) {
  test(`reply and profile verification recover original links from ${label}`, async () => fixture(async page => {
    const started = Date.now();
    const fresh = statusId(started + 1);
    const body = article('me', fresh, text).replace('</article>', card + '</article>');
    await page.route('https://x.com/i/status/123', route => route.fulfill({ contentType: 'text/html', body }));
    await page.route('https://x.com/me', route => route.fulfill({ contentType: 'text/html', body }));
    const content = 'Read https://x.com/hifumi369/status/555';
    const expected = `https://x.com/me/status/${fresh}`;
    assert.equal(await verifyOwnReplyOnTweetPage(page, '123', 'me', content, started), expected);
    assert.equal(await verifyNewTweet(page, {
      username: 'me', profilePath: '/me', tab: 'posts', urlsBefore: [], capturedAt: started,
    }, content), expected);
  }));
}

test('a shortened prefix or an unrelated quote cannot prove the expected URL', async () => fixture(async page => {
  const started = Date.now();
  const body = article('me', statusId(started + 1), 'Read <a href="https://t.co/short">x.com/hifumi369/sta…</a>')
    + article('me', statusId(started + 2), 'Read').replace('</article>', '<a href="/hifumi369/status/556">Other quote</a></article>');
  await page.route('https://x.com/i/status/123', route => route.fulfill({ contentType: 'text/html', body }));
  assert.equal(await verifyOwnReplyOnTweetPage(page, '123', 'me', 'Read https://x.com/hifumi369/status/555', started), null);
}));


test('URL evidence cannot replace matching body text or prove a second missing link', async () => fixture(async page => {
  await page.setContent(article('me', '123', 'Different body <a title="https://x.com/hifumi369/status/555">x.com/…</a>'));
  assert.equal(await tweetMatchesContent(page.locator('article'), 'Read https://x.com/hifumi369/status/555'), false);
  await page.setContent(article('me', '123', 'Read <a title="https://x.com/hifumi369/status/556">x.com/hifumi369/sta…</a>'));
  assert.equal(await tweetMatchesContent(page.locator('article'), 'Read https://x.com/hifumi369/status/555'), false);
  await page.setContent(article('me', '123', 'Read <a title="https://x.com/hifumi369/status/555">x.com/…</a>'));
  assert.equal(await tweetMatchesContent(page.locator('article'),
    'Read https://x.com/hifumi369/status/555 https://github.com/baijunjie/octoboard'), false);
}));
