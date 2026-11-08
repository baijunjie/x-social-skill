#!/usr/bin/env npx tsx
/**
 * Post Tweet
 * Usage: echo '{"content":"Hello world"}' | npx tsx scripts/post.ts
 */

import { getBrowserContext, navigateTo } from '../lib/browser.js';
import { resolveAccount } from '../lib/account.js';
import { runScript, ScriptResult } from '../lib/script.js';
import {
  checkLoginStatus,
  isButtonDisabled,
  uploadImages,
  validateContent,
  validateImagePaths,
  captureProfileState,
  verifyNewTweet,
  getOwnHandle,
  verifySubmission
} from '../lib/utils.js';
import { config } from '../lib/config.js';
import { SETUP_HINT } from '../lib/account.js';

const sel = config.selectors;
const btn = sel.buttons;

interface PostInput {
  content: string;
  imagePaths?: string[];
}

async function postTweet(input: PostInput): Promise<ScriptResult> {
  const { content, imagePaths } = input;

  const validationError = validateContent(content, 'Tweet');
  if (validationError) return validationError;

  const imageError = validateImagePaths(imagePaths);
  if (imageError) return imageError;

  let context = null;
  try {
    context = await getBrowserContext();
    const page = context.pages()[0] || await context.newPage();

    await navigateTo(page, 'https://x.com/home');

    const { loggedIn, onLoginPage } = await checkLoginStatus(page);
    if (!loggedIn && onLoginPage) {
      return { success: false, message: `X login expired. ${SETUP_HINT}` };
    }

    await getOwnHandle(page, resolveAccount().handle);

    // Capture profile state before posting
    // A standalone post shows up on the Posts tab; the Replies tab is not newest-first.
    const state = await captureProfileState(page, 'posts');
    if (!state) {
      return { success: false, message: 'Could not find profile link in sidebar' };
    }

    // Navigate back to home to compose tweet
    await navigateTo(page, 'https://x.com/home');

    const tweetInput = page.locator(sel.tweetTextarea);
    await tweetInput.waitFor({ timeout: config.timeouts.elementWait * 2 });
    await tweetInput.click();
    await page.waitForTimeout(config.timeouts.shortPause);
    await tweetInput.type(content + ' ');  // Trailing space closes hashtag/mention popups
    await page.waitForTimeout(config.timeouts.actionDelay);

    await uploadImages(page.locator('body'), page, imagePaths);

    const postButton = page.locator(btn.postInline);
    await postButton.waitFor({ timeout: config.timeouts.elementWait });

    if (await isButtonDisabled(postButton)) {
      return { success: false, message: 'Post button disabled. Content may be empty or exceed character limit.' };
    }

    try {
      await postButton.click({ force: true });
      await tweetInput.waitFor({ state: 'hidden', timeout: config.timeouts.loadWait });
    } catch {
      // A click timeout can arrive after acceptance; verify without another write.
    }
    return await verifySubmission(page, 'Tweet', verificationPage =>
      verifyNewTweet(verificationPage, state, content));

  } finally {
    if (context) await context.close().catch(() => {});
  }
}

runScript<PostInput>(postTweet);
