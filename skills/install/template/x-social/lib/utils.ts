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

export async function clickTweetButton(tweet: Locator, selector: string, page: Page): Promise<void> {
  const button = tweet.locator(selector);
  await button.waitFor({ timeout: config.timeouts.elementWait });
  await button.click({ force: true });
  await page.waitForTimeout(config.timeouts.actionDelay);
}

export async function checkLoginStatus(page: Page): Promise<{ loggedIn: boolean; onLoginPage: boolean }> {
  const isLoggedIn = await page.locator(sel.accountSwitcher).isVisible().catch(() => false);
  if (isLoggedIn) {
    return { loggedIn: true, onLoginPage: false };
  }

  const onLoginPage = await page.locator(sel.usernameInput).isVisible().catch(() => false);
  return { loggedIn: false, onLoginPage };
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

  await submitButton.click({ force: true });

  // Verify dialog closed (confirms submission)
  const dialogClosed = await dialog.waitFor({ state: 'hidden', timeout: config.timeouts.loadWait })
    .then(() => true)
    .catch(() => false);

  if (!dialogClosed) {
    return { success: false, error: 'Dialog still visible after submit — tweet may not have been posted.' };
  }

  return { success: true };
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
}

/**
 * Capture the user's profile state before posting.
 * Navigates to the given profile tab and snapshots the user's current tweet URLs.
 * Must be called on a page where the left sidebar is visible.
 */
export async function captureProfileState(page: Page, tab: ProfileTab = 'with_replies'): Promise<ProfileState | null> {
  const profileLink = page.locator('a[data-testid="AppTabBar_Profile_Link"]');
  const profilePath = await profileLink.getAttribute('href').catch(() => null);
  if (!profilePath) return null;

  const username = profilePath.replace('/', '');
  const urlsBefore = await getProfileTweetUrls(page, profilePath, username, tab);
  return { profilePath, username, tab, urlsBefore };
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
export async function verifyNewTweet(page: Page, state: ProfileState): Promise<string | null> {
  for (let attempt = 0; attempt < VERIFY_ATTEMPTS; attempt++) {
    if (attempt > 0) await page.waitForTimeout(config.timeouts.loadWait);
    const urlsAfter = await getProfileTweetUrls(page, state.profilePath, state.username, state.tab);
    const found = findNewTweetUrl(state.urlsBefore, urlsAfter);
    if (found) return found;
  }
  return null;
}

/** The signed-in account's handle, read from the sidebar without navigating away. */
export async function getOwnHandle(page: Page): Promise<string | null> {
  const href = await page
    .locator('a[data-testid="AppTabBar_Profile_Link"]')
    .getAttribute('href')
    .catch(() => null);
  return href ? href.replace('/', '') : null;
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
  content: string
): Promise<string | null> {
  const needle = content.trim().slice(0, 30);

  for (let attempt = 0; attempt < VERIFY_ATTEMPTS; attempt++) {
    if (attempt > 0) await page.waitForTimeout(config.timeouts.loadWait);
    await navigateTo(page, tweetUrl);

    const href = await page.$$eval(
      sel.tweet,
      (articles, args) =>
        articles
          .map(article => {
            const timeEl = article.querySelector('a[href*="/status/"] time');
            const link = timeEl ? (timeEl.closest('a') as HTMLAnchorElement | null) : null;
            const textEl = article.querySelector('[data-testid="tweetText"]') as HTMLElement | null;
            return { href: link?.getAttribute('href') || '', text: textEl?.innerText || '' };
          })
          .filter(item => item.href.startsWith(`/${args.username}/status/`) && item.text.includes(args.needle))
          .map(item => item.href)[0] || '',
      { username, needle }
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
async function getOwnTweetUrls(page: Page, username: string, scan = SCAN_ARTICLES): Promise<string[]> {
  const tweets = page.locator(sel.tweet);
  const count = await tweets.count();
  const urls: string[] = [];

  for (let i = 0; i < Math.min(count, scan); i++) {
    const url = await getTweetUrl(tweets.nth(i));
    if (url && url.includes(`/${username}/`)) {
      urls.push(url);
    }
  }

  return urls;
}

async function getProfileTweetUrls(
  page: Page,
  profilePath: string,
  username: string,
  tab: ProfileTab = 'with_replies'
): Promise<string[]> {
  const suffix = tab === 'posts' ? '' : '/with_replies';
  await navigateTo(page, `https://x.com${profilePath}${suffix}`);
  return getOwnTweetUrls(page, username);
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
