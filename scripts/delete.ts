#!/usr/bin/env npx tsx
/**
 * Delete Tweet(s)
 * Usage: echo '{"tweetUrl":"https://x.com/user/status/123"}' | npx tsx scripts/delete.ts
 *        echo '{"tweetUrls":["...","..."]}' | npx tsx scripts/delete.ts
 *
 * Deleting is permanent — X offers no undo. A batch reuses one browser session and
 * reports each tweet separately; one failure does not stop the rest.
 */

import { Page } from 'playwright';
import { getBrowserContext, navigateTo } from '../lib/browser.js';
import { runScript, ScriptResult } from '../lib/script.js';
import { validateTweetUrl } from '../lib/utils.js';
import { config } from '../lib/config.js';

interface DeleteInput {
  tweetUrl?: string;
  tweetUrls?: string[];
}

interface DeleteOutcome {
  tweetUrl: string;
  deleted: boolean;
  message: string;
}

// The menu item carries no stable test id, so match its label across UI languages.
const DELETE_LABEL = /^(Delete|削除|删除|刪除|Eliminar|Supprimer|Löschen)/i;

async function deleteOne(page: Page, tweetUrl: string): Promise<DeleteOutcome> {
  await navigateTo(page, tweetUrl);

  // On a reply's permalink the first article is the parent tweet, which belongs to
  // someone else — pick the article whose own timestamp link points at this tweet.
  const tweetId = (tweetUrl.match(/\/status\/(\d+)/) || [])[1] || tweetUrl.trim();
  const hrefs = await page.$$eval(config.selectors.tweet, articles =>
    articles.map(article => {
      const timeEl = article.querySelector('a[href*="/status/"] time');
      const link = timeEl ? (timeEl.closest('a') as HTMLAnchorElement | null) : null;
      return link?.getAttribute('href') || '';
    })
  );
  const index = hrefs.findIndex(href => href.includes(`/status/${tweetId}`));
  if (index < 0) {
    // Already gone counts as done: a retry of a partly finished batch must not fail here.
    return { tweetUrl, deleted: true, message: 'Not on the page — already deleted or unavailable' };
  }

  const caret = page.locator(config.selectors.tweet).nth(index).locator('[data-testid="caret"]').first();
  const hasCaret = await caret.waitFor({ timeout: config.timeouts.elementWait }).then(() => true).catch(() => false);
  if (!hasCaret) return { tweetUrl, deleted: false, message: 'No menu button on the tweet' };

  await caret.click({ force: true });
  await page.waitForTimeout(config.timeouts.actionDelay);

  const deleteItem = page.getByRole('menuitem').filter({ hasText: DELETE_LABEL }).first();
  const hasDelete = await deleteItem.waitFor({ timeout: config.timeouts.elementWait }).then(() => true).catch(() => false);
  if (!hasDelete) {
    await page.keyboard.press('Escape');
    return { tweetUrl, deleted: false, message: 'No Delete item in the menu — the tweet may belong to another account' };
  }

  await deleteItem.click();
  await page.waitForTimeout(config.timeouts.shortPause);

  const confirm = page.locator('[data-testid="confirmationSheetConfirm"]');
  const hasConfirm = await confirm.waitFor({ timeout: config.timeouts.elementWait }).then(() => true).catch(() => false);
  if (!hasConfirm) return { tweetUrl, deleted: false, message: 'Confirmation button never appeared' };

  await confirm.click();
  await page.waitForTimeout(config.timeouts.loadWait);

  // Confirm it is really gone: this tweet must no longer be among the page's articles.
  await navigateTo(page, tweetUrl);
  const hrefsAfter = await page.$$eval(config.selectors.tweet, articles =>
    articles.map(article => {
      const timeEl = article.querySelector('a[href*="/status/"] time');
      const link = timeEl ? (timeEl.closest('a') as HTMLAnchorElement | null) : null;
      return link?.getAttribute('href') || '';
    })
  );
  if (hrefsAfter.some(href => href.includes(`/status/${tweetId}`))) {
    return { tweetUrl, deleted: false, message: 'Tweet still visible after confirming deletion' };
  }

  return { tweetUrl, deleted: true, message: 'Deleted' };
}

async function deleteTweets(input: DeleteInput): Promise<ScriptResult> {
  const urls = input.tweetUrls ?? (input.tweetUrl ? [input.tweetUrl] : []);
  if (!urls.length) return { success: false, message: 'tweetUrl or tweetUrls is required' };

  for (const url of urls) {
    const urlError = validateTweetUrl(url);
    if (urlError) return urlError;
  }

  let context = null;
  try {
    context = await getBrowserContext();
    const page = context.pages()[0] || await context.newPage();

    const results: DeleteOutcome[] = [];
    for (const url of urls) {
      try {
        results.push(await deleteOne(page, url));
      } catch (err) {
        results.push({ tweetUrl: url, deleted: false, message: err instanceof Error ? err.message : String(err) });
      }
      // Progress to stderr so a long batch is visible without touching the JSON result.
      const done = results.filter(r => r.deleted).length;
      process.stderr.write(`[${results.length}/${urls.length}] deleted=${done} ${url}\n`);
    }

    const deleted = results.filter(r => r.deleted).length;
    return {
      success: deleted === urls.length,
      message: `Deleted ${deleted}/${urls.length} tweets`,
      data: { deleted, total: urls.length, results },
    };
  } finally {
    if (context) await context.close();
  }
}

runScript<DeleteInput>(deleteTweets);
