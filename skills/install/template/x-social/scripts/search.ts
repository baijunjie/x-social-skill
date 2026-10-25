#!/usr/bin/env npx tsx
/**
 * Search X
 * Usage: echo '{"query":"\"where did I put\" lang:en -filter:replies","limit":20}' | npx tsx scripts/search.ts
 *
 * Returns tweet cards from the "Latest" tab as structured data. Counts come from the
 * action buttons, which render abbreviated values ("1.2K"), so they are approximate.
 */

import { getBrowserContext, navigateTo } from '../lib/browser.js';
import { runScript, ScriptResult } from '../lib/script.js';
import { config } from '../lib/config.js';

interface SearchInput {
  query: string;
  limit?: number;
  scrolls?: number;
}

const DEFAULT_LIMIT = 20;
const DEFAULT_SCROLLS = 4;

/** Action buttons render abbreviated counts: "1.2K" / "3万" / "" when zero. */
function toCount(raw: string): number {
  const text = (raw || '').trim().replace(/,/g, '');
  if (!text) return 0;
  const m = text.match(/^([\d.]+)\s*([KkMm万億]?)/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  if (!isFinite(n)) return 0;
  const unit = m[2].toLowerCase();
  if (unit === 'k') return Math.round(n * 1e3);
  if (unit === 'm') return Math.round(n * 1e6);
  if (unit === '万') return Math.round(n * 1e4);
  if (unit === '億') return Math.round(n * 1e8);
  return Math.round(n);
}

async function search(input: SearchInput): Promise<ScriptResult> {
  const query = (input.query || '').trim();
  if (!query) return { success: false, message: 'query is required' };

  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), 100);
  const scrolls = Math.min(Math.max(input.scrolls ?? DEFAULT_SCROLLS, 0), 15);

  let context = null;
  try {
    context = await getBrowserContext();
    const page = context.pages()[0] || await context.newPage();

    // f=live = the "Latest" tab; the default "Top" tab buries recent posts.
    const url = `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`;
    await navigateTo(page, url);

    const collected = new Map<string, Record<string, unknown>>();

    for (let round = 0; round <= scrolls && collected.size < limit; round++) {
      // Everything inside $$eval must stay inline: tsx injects a __name helper into named
      // functions, which is not defined in the page context and throws. Counts come back
      // as the raw abbreviated strings and are parsed here in Node.
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
            rawLikes: (article.querySelector('[data-testid="like"], [data-testid="unlike"]') as HTMLElement | null)?.innerText || '',
            rawReplies: (article.querySelector('[data-testid="reply"]') as HTMLElement | null)?.innerText || '',
            rawReposts: (article.querySelector('[data-testid="retweet"], [data-testid="unretweet"]') as HTMLElement | null)?.innerText || '',
            liked: !!article.querySelector('[data-testid="unlike"]'),
            hasMedia: !!article.querySelector('[data-testid="tweetPhoto"], [data-testid="videoPlayer"]'),
            isRepost: !!article.querySelector('[data-testid="socialContext"]'),
            links: Array.from(article.querySelectorAll('[data-testid="tweetText"] a[href^="http"]')).map(
              a => a.getAttribute('href') || ''
            ),
          };
        })
      );

      for (const item of batch) {
        if (!item.tweetId || !item.author) continue;
        if (collected.has(item.tweetId)) continue;
        const { rawLikes, rawReplies, rawReposts, ...rest } = item;
        collected.set(item.tweetId, {
          ...rest,
          likes: toCount(rawLikes),
          replies: toCount(rawReplies),
          reposts: toCount(rawReposts),
          tweetUrl: `https://x.com/${item.author}/status/${item.tweetId}`,
        });
        if (collected.size >= limit) break;
      }

      if (round < scrolls && collected.size < limit) {
        await page.mouse.wheel(0, config.viewport.height * 2);
        await page.waitForTimeout(config.timeouts.loadWait);
      }
    }

    const results = Array.from(collected.values());
    return {
      success: true,
      message: `Found ${results.length} tweets`,
      data: { query, count: results.length, tweets: results },
    };
  } finally {
    if (context) await context.close();
  }
}

runScript<SearchInput>(search);
