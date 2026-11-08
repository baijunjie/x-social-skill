/**
 * Utility functions
 * Validation, UI interaction, and display helpers
 */

import fs from 'fs';
import { Page, Locator } from 'playwright';
import { ScriptResult } from './script.js';
import { config } from './config.js';
import { navigateTo } from './browser.js';

// Shorthand for selectors
const sel = config.selectors;
const btn = sel.buttons;

// ── Validation ──────────────────────────────────────────────────────────────

export function validateTweetUrl(tweetUrl: string | undefined): ScriptResult | null {
  if (!tweetUrl) {
    return { success: false, message: 'Please provide a tweet URL' };
  }
  return null;
}

export function validateContent(content: string | undefined, type = 'Tweet'): ScriptResult | null {
  if (!content || content.length === 0) {
    return { success: false, message: `${type} content cannot be empty` };
  }
  if (content.length > config.limits.tweetMaxLength) {
    return {
      success: false,
      message: `${type} exceeds ${config.limits.tweetMaxLength} character limit (current: ${content.length})`
    };
  }
  return null;
}

export function validateImagePaths(imagePaths?: string[]): ScriptResult | null {
  if (!imagePaths) return null;
  if (imagePaths.length > config.limits.maxImages) {
    return { success: false, message: `Too many images: ${imagePaths.length} (max ${config.limits.maxImages})` };
  }
  for (const p of imagePaths) {
    if (!fs.existsSync(p)) {
      return { success: false, message: `Image not found: ${p}` };
    }
  }
  return null;
}

// ── Image upload ─────────────────────────────────────────────────────────────

export async function uploadImages(container: Locator, page: Page, imagePaths?: string[]): Promise<void> {
  if (!imagePaths || imagePaths.length === 0) return;
  const fileInput = container.locator(sel.fileInput);
  await fileInput.setInputFiles(imagePaths);
  await container.locator(sel.attachments).waitFor({ timeout: 15000 });
  await page.waitForTimeout(config.timeouts.actionDelay);
}

// ── UI interaction ──────────────────────────────────────────────────────────

export async function isButtonDisabled(button: Locator): Promise<boolean> {
  const ariaDisabled = await button.getAttribute('aria-disabled');
  return ariaDisabled === 'true';
}

export function getFirstTweet(page: Page): Locator {
  return page.locator(sel.tweet).first();
}

/** Match the requested status, since a reply page can show its parent first. */
export function getTargetTweet(page: Page, tweetUrl: string): Locator {
  const match = tweetUrl.match(/\/status\/(\d+)(?:[/?#]|$)/) || tweetUrl.trim().match(/^(\d+)$/);
  if (!match) throw new Error('Cannot identify the target tweet status ID');
  return page.locator(sel.tweet).filter({
    has: page.locator(`a[href$="/status/${match[1]}"] time`),
  }).first();
}

export async function clickTweetButton(tweet: Locator, selector: string, page: Page): Promise<void> {
  const button = tweet.locator(selector);
  await button.waitFor({ timeout: config.timeouts.elementWait });
  await button.click({ force: true });
  await page.waitForTimeout(config.timeouts.actionDelay);
}

export async function checkLoginStatus(page: Page): Promise<{ loggedIn: boolean; onLoginPage: boolean }> {
  // isVisible() is a snapshot, even when passed a timeout.
  await page.locator(`${sel.accountSwitcher}, ${sel.usernameInput}`).filter({ visible: true }).first()
    .waitFor({ state: 'visible', timeout: config.timeouts.navigation })
    .catch(err => {
      throw new Error(`Account UI did not become visible within ${config.timeouts.navigation} ms; login status is unknown. ${err instanceof Error ? err.message : String(err)}`);
    });
  const loggedIn = await page.locator(sel.accountSwitcher).isVisible();
  return { loggedIn, onLoginPage: !loggedIn && await page.locator(sel.usernameInput).isVisible() };
}

// ── Dialog submit ───────────────────────────────────────────────────────────

export interface DialogSubmitOptions {
  page: Page;
  content: string;
  contentLabel: string;
  imagePaths?: string[];
}

export interface DialogSubmitResult {
  success: boolean;
  error?: string;
  /** A click was attempted; verify read-only before deciding whether it posted. */
  submitted?: boolean;
}

export async function fillDialogAndSubmit(options: DialogSubmitOptions): Promise<DialogSubmitResult> {
  const { page, content, contentLabel, imagePaths } = options;

  const dialog = page.locator(sel.modalDialog);
  await dialog.waitFor({ timeout: config.timeouts.elementWait });

  const textInput = dialog.locator(sel.tweetTextarea);
  await textInput.waitFor({ timeout: config.timeouts.elementWait });
  await textInput.click();
  await page.waitForTimeout(config.timeouts.shortPause);
  await textInput.type(content + ' ');  // Trailing space closes hashtag/mention popups
  await page.waitForTimeout(config.timeouts.actionDelay);

  await uploadImages(dialog, page, imagePaths);

  const submitButton = dialog.locator(btn.postDialog);
  await submitButton.waitFor({ timeout: config.timeouts.elementWait });

  if (await isButtonDisabled(submitButton)) {
    return {
      success: false,
      error: `Submit button disabled. ${contentLabel} may be empty or exceed character limit.`
    };
  }

  try {
    // Never retry a click: a timeout can arrive after X accepted it.
    await submitButton.click({ force: true });
    await dialog.waitFor({ state: 'hidden', timeout: config.timeouts.navigation });
    return { success: true, submitted: true };
  } catch {
    return { success: false, submitted: true, error: 'Submission outcome unknown; verify read-only. Do not resubmit.' };
  }
}

// ── Post verification ───────────────────────────────────────────────────────

/** How many times to re-check the profile before giving up on verification. */
const VERIFY_ATTEMPTS = 5;

/** How many articles to look at on a profile page. */
const SCAN_ARTICLES = 30;

/**
 * Which profile tab proves the new item exists.
 * A standalone post lands on the Posts tab; a reply or quote only shows under Replies.
 */
export type ProfileTab = 'posts' | 'with_replies';

export interface ProfileState {
  profilePath: string;
  username: string;
  tab: ProfileTab;
  urlsBefore: string[];
  capturedAt: number;
}

/**
 * Capture the user's profile state before posting.
 * Navigates to the given profile tab and snapshots the user's current tweet URLs.
 * Must be called on a page where the left sidebar is visible.
 */
export async function captureProfileState(page: Page, tab: ProfileTab = 'with_replies'): Promise<ProfileState | null> {
  const capturedAt = Date.now();
  const username = await getOwnHandle(page);
  if (!username) return null;
  const profilePath = `/${username}`;
  const urlsBefore = await getProfileTweetUrls(page, profilePath, username, tab);
  return { profilePath, username, tab, urlsBefore, capturedAt };
}

/**
 * Verify a tweet was posted by comparing profile state before and after.
 * Navigates to the user's profile and checks for a new tweet (higher status ID).
 *
 * The new post can take several seconds to show up on the profile, so this polls.
 * Reporting a failure for a post that actually went out is the worst outcome here —
 * the caller would retry and post twice.
 *
 * @returns The new tweet URL, or null if no new tweet was found.
 */
export async function verifyNewTweet(page: Page, state: ProfileState, content: string): Promise<string | null> {
  for (let attempt = 0; attempt < VERIFY_ATTEMPTS; attempt++) {
    if (attempt > 0) await page.waitForTimeout(config.timeouts.loadWait);
    const urlsAfter = await getProfileTweetUrls(page, state.profilePath, state.username, state.tab, content);
    const fresh = urlsAfter.filter(url => Number((getStatusId(url) >> 22n) + 1288834974657n) >= state.capturedAt);
    const found = findNewTweetUrl(state.urlsBefore, fresh);
    if (found) return found;
  }
  return null;
}

/** Wait for the sidebar before reading identity; setup can omit the expected handle. */
export async function getOwnHandle(page: Page, expectedHandle?: string): Promise<string | null> {
  const profile = page.locator('a[data-testid="AppTabBar_Profile_Link"]');
  try {
    await profile.waitFor({ state: 'visible', timeout: config.timeouts.navigation });
  } catch {
    throw new Error(`Account sidebar did not become visible within ${config.timeouts.navigation} ms; account identity is unknown.`);
  }
  const href = await profile.getAttribute('href');
  const handle = href?.match(/^\/([A-Za-z0-9_]+)\/?$/)?.[1] || null;
  if (!handle) throw new Error('Account sidebar has no valid profile handle; account identity is unknown.');
  if (expectedHandle && handle.toLowerCase() !== expectedHandle.replace(/^@/, '').toLowerCase()) {
    throw new Error(`Account mismatch: expected @${expectedHandle.replace(/^@/, '')}, but sidebar shows @${handle}. No action was taken.`);
  }
  return handle;
}

/** Verify on a separate page so navigation cannot cancel a pending submit. */
export async function verifySubmission(
  page: Page,
  label: string,
  verify: (verificationPage: Page) => Promise<string | null>
): Promise<ScriptResult> {
  let verificationPage: Page | undefined;
  try {
    verificationPage = await page.context().newPage();
    const url = await verify(verificationPage);
    if (url) return { success: true, message: `${label} posted: ${url}`, data: { outcome: 'confirmed', url } };
  } catch {
    // A verification error does not prove that the write failed.
  } finally {
    await verificationPage?.close().catch(() => {});
  }
  return {
    success: false,
    message: `${label} submission outcome unknown: could not confirm its URL. Do not resubmit; check read-only first.`,
    data: { outcome: 'unknown', submitted: true, retrySafe: false },
  };
}

/**
 * Verify our own reply by looking for it on the target tweet's own page.
 *
 * The profile "Replies" tab serves stale, out-of-order data and routinely omits a reply
 * posted seconds ago, so comparing profile snapshots reports failures for replies that
 * actually went out — and the caller then posts a second copy. The thread page shows it.
 *
 * @returns The reply URL, or null if it never showed up.
 */
export async function verifyOwnReplyOnTweetPage(
  page: Page,
  tweetUrl: string,
  username: string,
  content: string,
  submittedAfter: number
): Promise<string | null> {
  const needle = content.trim().replace(/\s+/g, ' ');

  for (let attempt = 0; attempt < VERIFY_ATTEMPTS; attempt++) {
    if (attempt > 0) await page.waitForTimeout(config.timeouts.loadWait);
    const target = tweetUrl.trim().match(/^(\d+)$/)?.[1];
    await navigateTo(page, target ? `https://x.com/i/status/${target}` : tweetUrl);
    await page.locator(sel.tweet).first().waitFor({ state: 'visible', timeout: config.timeouts.navigation });

    const href = await page.$$eval(
      sel.tweet,
      (articles, args) =>
        articles
          .map(article => {
            const timeEl = article.querySelector('a[href*="/status/"] time');
            const link = timeEl ? (timeEl.closest('a') as HTMLAnchorElement | null) : null;
            const textEl = article.querySelector('[data-testid="tweetText"]') as HTMLElement | null;
            return { href: link?.getAttribute('href') || '', texts: [textEl?.innerText || '', textEl?.textContent || ''] };
          })
          .filter(item => {
            const match = item.href.match(/^\/([^/]+)\/status\/(\d+)$/);
            return match && match[1].toLowerCase() === args.username.toLowerCase()
              && Number((BigInt(match[2]) >> 22n) + 1288834974657n) >= args.submittedAfter
              && item.texts.some(text => text.trim().replace(/\s+/g, ' ') === args.needle);
          })
          .map(item => item.href)[0] || '',
      { username, needle, submittedAfter }
    );

    if (href) return `https://x.com${href}`;
  }

  return null;
}

// ── Toggle action (like/retweet) ────────────────────────────────────────────

export interface ToggleActionOptions {
  tweet: Locator;
  page: Page;
  doneButtonSelector: string;
  actionButtonSelector: string;
  actionName: string;
  onAfterClick?: () => Promise<void>;
}

export interface ToggleActionResult {
  success: boolean;
  message: string;
  alreadyDone?: boolean;
}

export async function toggleTweetAction(options: ToggleActionOptions): Promise<ToggleActionResult> {
  const { tweet, page, doneButtonSelector, actionButtonSelector, actionName, onAfterClick } = options;

  const doneButton = tweet.locator(doneButtonSelector);
  const actionButton = tweet.locator(actionButtonSelector);

  const alreadyDone = await doneButton.isVisible().catch(() => false);
  if (alreadyDone) {
    return {
      success: true,
      message: `Tweet already ${actionName.toLowerCase()}d`,
      alreadyDone: true
    };
  }

  await actionButton.waitFor({ timeout: config.timeouts.elementWait });
  await actionButton.click({ force: true });
  await page.waitForTimeout(config.timeouts.actionDelay);

  if (onAfterClick) {
    await onAfterClick();
  }

  const nowDone = await doneButton.isVisible().catch(() => false);
  if (nowDone) {
    return { success: true, message: `${actionName} successful` };
  }

  return {
    success: false,
    message: `${actionName} action completed but could not verify success`
  };
}

// ── Internal helpers (not exported) ─────────────────────────────────────────

async function getTweetUrl(tweet: Locator): Promise<string | null> {
  const timestampLink = tweet.locator(sel.tweetTimestampLink).first();
  const isVisible = await timestampLink.isVisible({ timeout: config.timeouts.elementWait }).catch(() => false);
  if (!isVisible) return null;

  const link = timestampLink.locator('xpath=ancestor::a');
  const href = await link.getAttribute('href').catch(() => null);
  if (!href) return null;

  return href.startsWith('http') ? href : `https://x.com${href}`;
}

/**
 * Collect the user's own tweet URLs from the profile page currently open.
 * Scans a wide window and keeps every match: the Replies tab is not reliably
 * newest-first, so stopping at the first few would miss a just-posted item.
 */
async function getOwnTweetUrls(page: Page, username: string, content?: string, scan = SCAN_ARTICLES): Promise<string[]> {
  const tweets = page.locator(sel.tweet);
  const count = await tweets.count();
  const urls: string[] = [];

  for (let i = 0; i < Math.min(count, scan); i++) {
    const tweet = tweets.nth(i);
    if (content !== undefined) {
      const texts = await tweet.locator('[data-testid="tweetText"]').first()
        .evaluate(el => [(el as HTMLElement).innerText, el.textContent || '']).catch(() => []);
      if (!texts.some(text => text.trim().replace(/\s+/g, ' ') === content.trim().replace(/\s+/g, ' '))) continue;
    }
    const url = await getTweetUrl(tweet);
    if (url && url.toLowerCase().includes(`/${username.toLowerCase()}/`)) {
      urls.push(url);
    }
  }

  return urls;
}

async function getProfileTweetUrls(
  page: Page,
  profilePath: string,
  username: string,
  tab: ProfileTab = 'with_replies',
  content?: string
): Promise<string[]> {
  const suffix = tab === 'posts' ? '' : '/with_replies';
  await navigateTo(page, `https://x.com${profilePath}${suffix}`);
  await page.locator(`${sel.tweet}, [data-testid="emptyState"]`).first()
    .waitFor({ state: 'visible', timeout: config.timeouts.navigation });
  return getOwnTweetUrls(page, username, content);
}

function getStatusId(url: string): bigint {
  const match = url.match(/\/status\/(\d+)/);
  return match ? BigInt(match[1]) : 0n;
}

function findNewTweetUrl(urlsBefore: string[], urlsAfter: string[]): string | null {
  const maxIdBefore = urlsBefore.reduce((max, url) => {
    const id = getStatusId(url);
    return id > max ? id : max;
  }, 0n);

  let newestUrl: string | null = null;
  let newestId = 0n;
  for (const url of urlsAfter) {
    const id = getStatusId(url);
    if (id > newestId) {
      newestId = id;
      newestUrl = url;
    }
  }

  if (newestUrl && newestId > maxIdBefore) {
    return newestUrl;
  }

  return null;
}
