#!/usr/bin/env npx tsx
/**
 * Bulk delete own tweets straight from the profile timeline
 * Usage: echo '{"match":"keyword|other","limit":500}' | npx tsx scripts/purge.ts
 *
 * DESTRUCTIVE. Deleting is permanent — X offers no undo. Omitting `match` deletes every
 * own tweet the timeline serves, up to `limit`. Only run this when the user asked for
 * these specific tweets to be deleted; never to tidy up after a failed run.
 *
 * Deleting from the timeline avoids two page loads per tweet, and X removes the article
 * from the DOM on confirm, so the next target is already on screen. `match` is a regex
 * over the tweet text: a tweet that does not match is left alone and counted as skipped.
 */

import { Page } from 'playwright';
import { getBrowserContext, navigateTo } from '../lib/browser.js';
import { runScript, ScriptResult } from '../lib/script.js';
import { getOwnHandle } from '../lib/utils.js';
import { config } from '../lib/config.js';

interface PurgeInput {
  match?: string;
  limit?: number;
  tab?: 'posts' | 'with_replies';
}

const DELETE_LABEL = /^(Delete|削除|删除|刪除|Eliminar|Supprimer|Löschen)/i;
const RELOAD_EVERY = 25;          // periodic reload keeps the timeline from drifting
const EMPTY_SCANS_TO_STOP = 8;   // the timeline lazy-loads; give up only after real emptiness
const THROTTLE_MS = [1500, 4000]; // pause between deletions, so the run does not look like a script
const STOP_AFTER_STUCK = 5;       // consecutive "still there" results mean X is refusing; stop

/** Is this tweet still rendered on the page? */
async function stillOnPage(page: Page, tweetId: string): Promise<boolean> {
  const hrefs = await page.$$eval(config.selectors.tweet, articles =>
    articles.map(article => {
      const timeEl = article.querySelector('a[href*="/status/"] time');
      const link = timeEl ? (timeEl.closest('a') as HTMLAnchorElement | null) : null;
      return link?.getAttribute('href') || '';
    })
  );
  return hrefs.some(href => href.includes(`/status/${tweetId}`));
}

async function purge(input: PurgeInput): Promise<ScriptResult> {
  const limit = Math.min(Math.max(input.limit ?? 200, 1), 5000);
  const tab = input.tab === 'posts' ? 'posts' : 'with_replies';
  let pattern: RegExp | null = null;
  if (input.match) {
    try {
      pattern = new RegExp(input.match, 'i');
    } catch (err) {
      return { success: false, message: `Invalid match regex: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  let context = null;
  try {
    context = await getBrowserContext();
    const page = context.pages()[0] || await context.newPage();

    await navigateTo(page, 'https://x.com/home');
    const username = await getOwnHandle(page);
    if (!username) return { success: false, message: 'Could not find profile link in sidebar' };

    const profileUrl = `https://x.com/${username}${tab === 'posts' ? '' : '/with_replies'}`;
    await navigateTo(page, profileUrl);

    let deleted = 0;
    const skipped = new Set<string>();
    const processed = new Set<string>();   // never act on the same tweet twice in a run
    const failures: { tweetId: string; message: string }[] = [];
    let emptyScans = 0;
    let stuckStreak = 0;
    let abortReason = '';

    while (deleted < limit) {
      const items = await page.$$eval(config.selectors.tweet, articles =>
        articles.map(article => {
          const timeEl = article.querySelector('a[href*="/status/"] time');
          const link = timeEl ? (timeEl.closest('a') as HTMLAnchorElement | null) : null;
          const textEl = article.querySelector('[data-testid="tweetText"]') as HTMLElement | null;
          return { href: link?.getAttribute('href') || '', text: textEl?.innerText || '' };
        })
      );

      let index = -1;
      let tweetId = '';
      for (let i = 0; i < items.length; i++) {
        const m = items[i].href.match(/^\/([^/]+)\/status\/(\d+)/);
        if (!m || m[1] !== username) continue;
        if (skipped.has(m[2]) || processed.has(m[2])) continue;
        if (pattern && !pattern.test(items[i].text)) {
          skipped.add(m[2]);
          continue;
        }
        index = i;
        tweetId = m[2];
        break;
      }

      if (index < 0) {
        emptyScans++;
        if (emptyScans >= EMPTY_SCANS_TO_STOP) break;
        // Alternate reloading and scrolling: an empty scan usually means the timeline has
        // not rendered yet, not that there is nothing left to delete.
        if (emptyScans % 2 === 1) {
          await navigateTo(page, profileUrl);
        } else {
          await page.mouse.wheel(0, config.viewport.height * 2);
        }
        await page.waitForTimeout(config.timeouts.loadWait * 2);
        continue;
      }
      emptyScans = 0;
      processed.add(tweetId);

      try {
        const caret = page.locator(config.selectors.tweet).nth(index).locator('[data-testid="caret"]').first();
        await caret.waitFor({ timeout: config.timeouts.elementWait });
        await caret.click({ force: true });
        await page.waitForTimeout(config.timeouts.shortPause);

        const deleteItem = page.getByRole('menuitem').filter({ hasText: DELETE_LABEL }).first();
        const hasDelete = await deleteItem.waitFor({ timeout: config.timeouts.elementWait }).then(() => true).catch(() => false);
        if (!hasDelete) {
          await page.keyboard.press('Escape');
          failures.push({ tweetId, message: 'No Delete item in the menu' });
          continue;
        }
        await deleteItem.click();
        await page.waitForTimeout(config.timeouts.shortPause);

        const confirm = page.locator('[data-testid="confirmationSheetConfirm"]');
        const hasConfirm = await confirm.waitFor({ timeout: config.timeouts.elementWait }).then(() => true).catch(() => false);
        if (!hasConfirm) {
          await page.keyboard.press('Escape');
          failures.push({ tweetId, message: 'Confirmation button never appeared' });
          continue;
        }
        await confirm.click();
        await page.waitForTimeout(config.timeouts.actionDelay);

        // X removes the article on a successful delete. If it is still there the delete
        // did not go through — count it as a failure instead of trying the same one forever.
        if (await stillOnPage(page, tweetId)) {
          await navigateTo(page, profileUrl);
          if (await stillOnPage(page, tweetId)) {
            stuckStreak++;
            failures.push({ tweetId, message: 'Still on the page after confirming — delete did not go through' });
            process.stderr.write(`[stuck ${stuckStreak}] ${tweetId}\n`);
            if (stuckStreak >= STOP_AFTER_STUCK) {
              abortReason = `${STOP_AFTER_STUCK} deletions in a row did not go through — stopping, likely rate limited`;
              break;
            }
            continue;
          }
        }

        stuckStreak = 0;
        deleted++;
        process.stderr.write(`[${deleted}/${limit}] deleted ${tweetId} (skipped=${skipped.size} failed=${failures.length})\n`);

        await page.waitForTimeout(
          THROTTLE_MS[0] + Math.floor(Math.random() * (THROTTLE_MS[1] - THROTTLE_MS[0]))
        );

        if (deleted % RELOAD_EVERY === 0) {
          await navigateTo(page, profileUrl);
        }
      } catch (err) {
        failures.push({ tweetId, message: err instanceof Error ? err.message : String(err) });
        await navigateTo(page, profileUrl);
      }
    }

    return {
      success: failures.length === 0 && !abortReason,
      message: abortReason
        ? `Deleted ${deleted}, then stopped: ${abortReason}`
        : `Deleted ${deleted}, skipped ${skipped.size} non-matching, ${failures.length} failed`,
      data: { username, tab, deleted, skipped: skipped.size, abortReason, failures },
    };
  } finally {
    if (context) await context.close();
  }
}

runScript<PurgeInput>(purge);
