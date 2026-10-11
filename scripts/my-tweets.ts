#!/usr/bin/env npx tsx
/**
 * List the signed-in account's own tweets
 * Usage: echo '{"tab":"with_replies","limit":200}' | npx tsx scripts/my-tweets.ts
 *
 * X search does not reliably index one's own replies, so this reads the profile
 * timeline and scrolls until nothing new loads.
 */

import { getBrowserContext, navigateTo } from '../lib/browser.js';
import { runScript, ScriptResult } from '../lib/script.js';
import { getOwnHandle } from '../lib/utils.js';
import { config } from '../lib/config.js';

interface MyTweetsInput {
  tab?: 'posts' | 'with_replies';
  limit?: number;
  scrolls?: number;
}

async function myTweets(input: MyTweetsInput): Promise<ScriptResult> {
  const tab = input.tab === 'posts' ? 'posts' : 'with_replies';
  const limit = Math.min(Math.max(input.limit ?? 200, 1), 2000);
  const maxScrolls = Math.min(Math.max(input.scrolls ?? 60, 0), 400);

  let context = null;
  try {
    context = await getBrowserContext();
    const page = context.pages()[0] || await context.newPage();

    await navigateTo(page, 'https://x.com/home');
    const username = await getOwnHandle(page);
    if (!username) return { success: false, message: 'Could not find profile link in sidebar' };

    await navigateTo(page, `https://x.com/${username}${tab === 'posts' ? '' : '/with_replies'}`);

    const collected = new Map<string, Record<string, unknown>>();
    let idleRounds = 0;

    for (let round = 0; round <= maxScrolls && collected.size < limit; round++) {
      const batch = await page.$$eval(config.selectors.tweet, articles =>
        articles.map(article => {
          const timeEl = article.querySelector('a[href*="/status/"] time') as HTMLTimeElement | null;
          const link = timeEl ? (timeEl.closest('a') as HTMLAnchorElement | null) : null;
          const textEl = article.querySelector('[data-testid="tweetText"]') as HTMLElement | null;
          const socialContext = article.querySelector('[data-testid="socialContext"]') as HTMLElement | null;
          return {
            href: link?.getAttribute('href') || '',
            text: textEl?.innerText || '',
            createdAt: timeEl?.getAttribute('datetime') || '',
            isRepost: !!socialContext,
          };
        })
      );

      const sizeBefore = collected.size;
      for (const item of batch) {
        const match = item.href.match(/^\/([^/]+)\/status\/(\d+)/);
        if (!match) continue;
        if (match[1] !== username) continue;
        if (collected.has(match[2])) continue;
        collected.set(match[2], {
          tweetId: match[2],
          tweetUrl: `https://x.com/${username}/status/${match[2]}`,
          text: item.text,
          createdAt: item.createdAt,
          isRepost: item.isRepost,
        });
      }

      idleRounds = collected.size === sizeBefore ? idleRounds + 1 : 0;
      if (idleRounds >= 3) break;

      await page.mouse.wheel(0, config.viewport.height * 2);
      await page.waitForTimeout(config.timeouts.loadWait);
    }

    const tweets = Array.from(collected.values()).sort((a, b) =>
      String(b.tweetId).localeCompare(String(a.tweetId))
    );
    return {
      success: true,
      message: `Found ${tweets.length} own tweets on ${tab}`,
      data: { username, tab, count: tweets.length, tweets },
    };
  } finally {
    if (context) await context.close();
  }
}

runScript<MyTweetsInput>(myTweets);
