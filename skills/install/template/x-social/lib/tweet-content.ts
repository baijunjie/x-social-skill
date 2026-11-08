import type { Locator } from 'playwright';
import { config } from './config.js';

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function normalizeUrl(value: string): string | null {
  if (!/^(https?:\/\/|\/)/.test(value)) return null;
  try {
    const url = new URL(value, 'https://x.com');
    // X status links can carry share parameters or use the former domain.
    if (['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname)) {
      const status = url.pathname.match(/^\/([\w]+)\/status\/(\d+)\/?$/);
      if (status) return `https://x.com/${status[1].toLowerCase()}/status/${status[2]}`;
    }
    return url.href.replace(/\/$/, '');
  } catch {
    return null;
  }
}

/** Exact body matching, with original URLs proved by link metadata or a quote card. */
export async function tweetMatchesContent(tweet: Locator, content: string): Promise<boolean> {
  const snapshot = await tweet.evaluate(article => {
    const text = Array.from(article.querySelectorAll('[data-testid="tweetText"]'))
      .find(text => !article.contains(text.closest('[role="link"]'))) as HTMLElement | undefined;
    const clone = text?.cloneNode(true) as HTMLElement | undefined;
    const bodyLinks = Array.from(text?.querySelectorAll('a') || []);
    const clonedLinks = Array.from(clone?.querySelectorAll('a') || []);
    for (let i = 0; i < clonedLinks.length; i++) {
      clonedLinks[i].replaceWith(`\uFFFCx-social-link-${i}\uFFFC`);
    }
    clone?.querySelectorAll('br').forEach(br => br.replaceWith(' '));
    return {
      texts: [text?.innerText || '', text?.textContent || ''],
      ownHref: article.querySelector('a[href*="/status/"] time')?.closest('a')?.getAttribute('href') || '',
      quoteCardCount: Array.from(article.querySelectorAll('[role="link"]:not(a)'))
        .filter(card => !!card.querySelector('[data-testid="tweetText"]') && !text?.contains(card)).length,
      template: clone?.textContent || '',
      bodyLinks: bodyLinks.map(a => ({
        text: a.textContent || '',
        urls: [a.getAttribute('href'), a.getAttribute('data-expanded-url'), a.getAttribute('title'), a.textContent],
      })),
      links: Array.from(article.querySelectorAll('a')).flatMap(a =>
        [a.getAttribute('href'), a.getAttribute('data-expanded-url'), a.getAttribute('title'), a.textContent]),
    };
  });
  if (snapshot.texts.some(text => normalizeText(text) === normalizeText(content))) return true;

  const expected = content.match(/https?:\/\/[^\s]+/g) || [];
  if (expected.length === 0) return false;
  const urls = new Set(expected.map(normalizeUrl).filter(url => url !== null));
  const evidence = new Set(snapshot.links.filter(value => value !== null).map(normalizeUrl));
  if (urls.size === 0) return false;

  let body = snapshot.template;
  for (let i = 0; i < snapshot.bodyLinks.length; i++) {
    const link = snapshot.bodyLinks[i];
    const matched = link.urls.some(value => value !== null && urls.has(normalizeUrl(value) || ''));
    body = body.replace(`\uFFFCx-social-link-${i}\uFFFC`, matched ? ' ' : link.text);
  }
  const withoutUrls = content.replace(/https?:\/\/[^\s]+/g, ' ');
  if (normalizeText(body) !== normalizeText(withoutUrls)) return false;
  const missing = [...urls].filter(url => !evidence.has(url));
  if (missing.length === 0) return true;
  if (missing.some(url => !/^https:\/\/x\.com\/\w+\/status\/\d+$/.test(url))) return false;
  const resolved = await resolveQuoteCards(tweet, snapshot.ownHref, snapshot.quoteCardCount);
  return missing.every(url => resolved.has(url));
}

/** X quote cards can be React links with no href. Resolve them by read-only navigation. */
async function resolveQuoteCards(tweet: Locator, ownHref: string, quoteCardCount: number): Promise<Set<string>> {
  const found = new Set<string>();
  const ownStatus = ownHref.match(/^\/(\w+)\/status\/(\d+)$/);
  if (!ownStatus || quoteCardCount === 0) return found;
  const ownUrl = `https://x.com${ownHref}`;
  for (let index = 0; index < Math.min(quoteCardCount, 3); index++) {
    const page = await tweet.page().context().newPage();
    try {
      // Keep the caller's thread/profile page and locators intact.
      await page.goto(ownUrl, { waitUntil: 'domcontentloaded', timeout: config.timeouts.navigation });
      const article = page.locator(config.selectors.tweet).filter({
        has: page.locator(`a[href$="/status/${ownStatus[2]}"] time`),
      }).first();
      await article.waitFor({ state: 'visible', timeout: config.timeouts.navigation });
      const card = article.locator('[role="link"]:not(a)').filter({
        has: page.locator('[data-testid="tweetText"]'),
      }).nth(index);
      // Recheck the semantic quote content after navigation; never click action buttons.
      await card.locator('[data-testid="tweetText"]').first()
        .waitFor({ state: 'visible', timeout: config.timeouts.navigation });
      await card.click({ timeout: config.timeouts.elementWait });
      await page.waitForURL(url => url.href !== ownUrl && /^\/\w+\/status\/\d+\/?$/.test(url.pathname),
        { timeout: config.timeouts.navigation, waitUntil: 'domcontentloaded' });
      const resolved = normalizeUrl(page.url());
      if (resolved) found.add(resolved);
    } catch {
      // Missing evidence leaves the submission unknown, never safe to repeat.
    } finally {
      await page.close().catch(() => {});
    }
  }
  return found;
}
