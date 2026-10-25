#!/usr/bin/env npx tsx
/**
 * List replies and mentions addressed to the signed-in account
 * Usage: echo '{"limit":40}' | npx tsx scripts/mentions.ts
 *
 * Reads the Mentions tab of the notifications page, which lists every reply to the
 * account and every post that @-mentions it. X search does not reliably index
 * conversations around one's own account, so this does not use search.
 */

import { getBrowserContext, navigateTo } from '../lib/browser.js';
import { runScript, ScriptResult } from '../lib/script.js';
import { getOwnHandle } from '../lib/utils.js';
import { config } from '../lib/config.js';

interface MentionsInput {
  limit?: number;
  scrolls?: number;
}

const DEFAULT_LIMIT = 40;
const DEFAULT_SCROLLS = 4;

async function mentions(input: MentionsInput): Promise<ScriptResult> {
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), 200);
  const scrolls = Math.min(Math.max(input.scrolls ?? DEFAULT_SCROLLS, 0), 15);

  let context = null;
  try {
    context = await getBrowserContext();
    const page = context.pages()[0] || await context.newPage();

    await navigateTo(page, 'https://x.com/notifications/mentions');
    const username = await getOwnHandle(page);
    if (!username) return { success: false, message: 'Could not find profile link in sidebar' };

    const collected = new Map<string, Record<string, unknown>>();

    for (let round = 0; round <= scrolls && collected.size < limit; round++) {
      // Keep the callback inline: tsx injects a __name helper that the page context lacks.
      const batch = await page.$$eval(config.selectors.tweet, articles =>
        articles.map(article => {
          const timeEl = article.querySelector('a[href*="/status/"] time') as HTMLTimeElement | null;
          const link = timeEl?.closest('a') as HTMLAnchorElement | null;
          const href = link?.getAttribute('href') || '';
          const idMatch = href.match(/\/status\/(\d+)/);
          const handleMatch = href.match(/^\/([^/]+)\/status\//);
          const textEl = article.querySelector('[data-testid="tweetText"]') as HTMLElement | null;
          const nameEl = article.querySelector('[data-testid="User-Name"]') as HTMLElement | null;

          return {
            tweetId: idMatch ? idMatch[1] : '',
            author: handleMatch ? handleMatch[1] : '',
            displayName: (nameEl?.innerText || '').split('\n')[0],
            text: textEl?.innerText || '',
            createdAt: timeEl?.getAttribute('datetime') || '',
            liked: !!article.querySelector('[data-testid="unlike"]'),
            isRepost: !!article.querySelector('[data-testid="socialContext"]'),
          };
        })
      );

      for (const item of batch) {
        if (!item.tweetId || !item.author) continue;
        if (item.author.toLowerCase() === username.toLowerCase()) continue;
        if (collected.has(item.tweetId)) continue;
        collected.set(item.tweetId, {
          ...item,
          tweetUrl: `https://x.com/${item.author}/status/${item.tweetId}`,
        });
        if (collected.size >= limit) break;
      }

      if (round < scrolls && collected.size < limit) {
        await page.mouse.wheel(0, config.viewport.height * 2);
        await page.waitForTimeout(config.timeouts.loadWait);
      }
    }

    const tweets = Array.from(collected.values());
    return {
      success: true,
      message: `Found ${tweets.length} mentions`,
      data: { username, count: tweets.length, tweets },
    };
  } finally {
    if (context) await context.close();
  }
}

runScript<MentionsInput>(mentions);
