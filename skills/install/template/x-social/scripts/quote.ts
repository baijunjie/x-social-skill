#!/usr/bin/env npx tsx
/**
 * Quote Tweet
 * Usage: echo '{"tweetUrl":"https://x.com/user/status/123","comment":"My thoughts"}' | npx tsx scripts/quote.ts
 */

import { getBrowserContext, navigateToTweet } from '../lib/browser.js';
import { resolveAccount } from '../lib/account.js';
import { runScript, ScriptResult } from '../lib/script.js';
import {
  validateTweetUrl,
  validateContent,
  validateImagePaths,
  getTargetTweet,
  clickTweetButton,
  fillDialogAndSubmit,
  captureProfileState,
  verifyNewTweet,
  getOwnHandle,
  verifySubmission
} from '../lib/utils.js';
import { config } from '../lib/config.js';

const btn = config.selectors.buttons;

interface QuoteInput {
  tweetUrl: string;
  comment: string;
  imagePaths?: string[];
}

async function quoteTweet(input: QuoteInput): Promise<ScriptResult> {
  const { tweetUrl, comment, imagePaths } = input;

  const urlError = validateTweetUrl(tweetUrl);
  if (urlError) return urlError;

  const validationError = validateContent(comment, 'Comment');
  if (validationError) return validationError;

  const imageError = validateImagePaths(imagePaths);
  if (imageError) return imageError;

  let context = null;
  try {
    context = await getBrowserContext();
    const { page, success, error } = await navigateToTweet(context, tweetUrl);

    if (!success) {
      return { success: false, message: error || 'Navigation failed' };
    }

    await getOwnHandle(page, resolveAccount().handle);

    // A quote tweet lands on our own Posts tab, not under Replies.
    const state = await captureProfileState(page, 'posts');
    if (!state) {
      return { success: false, message: 'Could not find profile link in sidebar' };
    }

    // Navigate back to tweet page
    const revisited = await navigateToTweet(context, tweetUrl);
    if (!revisited.success) return { success: false, message: revisited.error || 'Navigation failed' };

    // Click retweet button to open menu
    const tweet = getTargetTweet(page, tweetUrl);
    await clickTweetButton(tweet, `${btn.retweet}, ${btn.unretweet}`, page);

    // Click quote option
    const quoteOption = page.getByRole('menuitem').filter({ hasText: /Quote/i });
    await quoteOption.waitFor({ timeout: config.timeouts.elementWait });
    await quoteOption.click();
    await page.waitForTimeout(config.timeouts.actionDelay);

    // Fill dialog and submit
    const result = await fillDialogAndSubmit({
      page,
      content: comment,
      contentLabel: 'Comment',
      imagePaths,
    });

    if (!result.success && !result.submitted) {
      return { success: false, message: result.error || 'Failed to submit quote' };
    }

    return await verifySubmission(page, 'Quote tweet', verificationPage =>
      verifyNewTweet(verificationPage, state, comment));

  } finally {
    if (context) await context.close().catch(() => {});
  }
}

runScript<QuoteInput>(quoteTweet);
