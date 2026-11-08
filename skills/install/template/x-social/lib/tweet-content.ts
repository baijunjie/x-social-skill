import type { Locator } from 'playwright';

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
    const text = article.querySelector('[data-testid="tweetText"]') as HTMLElement | null;
    const clone = text?.cloneNode(true) as HTMLElement | undefined;
    const bodyLinks = Array.from(text?.querySelectorAll('a') || []);
    const clonedLinks = Array.from(clone?.querySelectorAll('a') || []);
    for (let i = 0; i < clonedLinks.length; i++) {
      clonedLinks[i].replaceWith(`\uFFFCx-social-link-${i}\uFFFC`);
    }
    clone?.querySelectorAll('br').forEach(br => br.replaceWith(' '));
    return {
      texts: [text?.innerText || '', text?.textContent || ''],
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
  if (urls.size === 0 || [...urls].some(url => !evidence.has(url))) return false;

  let body = snapshot.template;
  for (let i = 0; i < snapshot.bodyLinks.length; i++) {
    const link = snapshot.bodyLinks[i];
    const matched = link.urls.some(value => value !== null && urls.has(normalizeUrl(value) || ''));
    body = body.replace(`\uFFFCx-social-link-${i}\uFFFC`, matched ? ' ' : link.text);
  }
  const withoutUrls = content.replace(/https?:\/\/[^\s]+/g, ' ');
  return normalizeText(body) === normalizeText(withoutUrls);
}
