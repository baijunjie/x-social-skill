/**
 * Browser context and navigation
 */

import { chromium, BrowserContext, Page } from 'playwright';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { config } from './config.js';
import { resolveAccount } from './account.js';

// Track current context for cleanup on termination
let currentContext: BrowserContext | null = null;

// Graceful shutdown on SIGTERM
process.on('SIGTERM', async () => {
  if (currentContext) {
    await currentContext.close().catch(() => {});
  }
  process.exit(0);
});

/**
 * Clean up browser lock files to prevent "browser already running" errors
 */
function cleanupLockFiles(profileDir: string): void {
  for (const lockFile of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    const lockPath = path.join(profileDir, lockFile);
    if (fs.existsSync(lockPath)) {
      try {
        fs.unlinkSync(lockPath);
      } catch {
      }
    }
  }
}

/**
 * Headless Chrome reports itself as "HeadlessChrome/<ver>" in both navigator.userAgent
 * and the Sec-CH-UA client hints, which X reads. Build the matching headful UA so the
 * two modes are indistinguishable; the major version comes from the binary so it does
 * not drift behind Chrome updates.
 */
function headfulUserAgent(): string {
  let major = '';
  try {
    const raw = execFileSync(config.chromePath, ['--version'], { encoding: 'utf8', timeout: 10000 });
    major = (raw.match(/(\d+)\./) || [])[1] || '';
  } catch {
  }
  if (!major) {
    throw new Error(`Cannot read Chrome version from ${config.chromePath}; refusing to run headless with a HeadlessChrome user agent.`);
  }
  return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

/**
 * Get browser context with persistent profile
 * @param profileDir - Profile to launch; defaults to the resolved account's (setup passes its own)
 */
export async function getBrowserContext(profileDir = resolveAccount().profileDir): Promise<BrowserContext> {
  cleanupLockFiles(profileDir);

  const headless = process.env.X_HEADLESS === '1';
  const userAgent = headless ? headfulUserAgent() : undefined;

  currentContext = await chromium.launchPersistentContext(profileDir, {
    executablePath: config.chromePath,
    headless,
    viewport: config.viewport,
    ...(userAgent ? { userAgent } : {}),
    args: userAgent ? [...config.chrome.args, `--user-agent=${userAgent}`] : config.chrome.args,
    ignoreDefaultArgs: config.chrome.ignoreDefaultArgs,
  });

  return currentContext;
}

/**
 * Navigate to a URL and wait for page to settle.
 */
export async function navigateTo(page: Page, url: string): Promise<void> {
  await page.goto(url, { timeout: config.timeouts.navigation, waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(config.timeouts.loadWait);
}

/**
 * Extract tweet ID from URL or raw ID string
 */
function extractTweetId(input: string): string | null {
  const urlMatch = input.match(/(?:x\.com|twitter\.com)\/\w+\/status\/(\d+)/);
  if (urlMatch) return urlMatch[1];
  if (/^\d+$/.test(input.trim())) return input.trim();
  return null;
}

/**
 * Navigate to a tweet page and verify it exists
 */
export async function navigateToTweet(
  context: BrowserContext,
  tweetUrl: string
): Promise<{ page: Page; success: boolean; error?: string }> {
  const page = context.pages()[0] || await context.newPage();

  let url = tweetUrl;
  const tweetId = extractTweetId(tweetUrl);
  if (tweetId && !tweetUrl.startsWith('http')) {
    url = `https://x.com/i/status/${tweetId}`;
  }

  try {
    await navigateTo(page, url);

    // X renders tweet content after the initial document has loaded.
    try {
      await page.locator(config.selectors.tweet).first().waitFor({
        state: 'visible', timeout: config.timeouts.navigation,
      });
    } catch (err) {
      if (!(err instanceof Error) || err.name !== 'TimeoutError') throw err;
      return {
        page, success: false,
        error: `Tweet content did not become visible within ${config.timeouts.navigation} ms. The page may still be loading or the post may be unavailable.`,
      };
    }

    return { page, success: true };
  } catch (err) {
    return { page, success: false, error: `Navigation failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
