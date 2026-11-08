#!/usr/bin/env npx tsx
/**
 * Reply to Tweet
 * Usage: echo '{"tweetUrl":"https://x.com/user/status/123","content":"Great post!"}' | npx tsx scripts/reply.ts
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
  getOwnHandle,
  verifyOwnReplyOnTweetPage,
  verifySubmission
} from '../lib/utils.js';
import { config } from '../lib/config.js';

const btn = config.selectors.buttons;

interface ReplyInput {
  tweetUrl: string;
  content: string;
  imagePaths?: string[];
}

async function replyToTweet(input: ReplyInput): Promise<ScriptResult> {
  const { tweetUrl, content, imagePaths } = input;

  const urlError = validateTweetUrl(tweetUrl);
  if (urlError) return urlError;

  const validationError = validateContent(content, 'Reply');
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

    const username = await getOwnHandle(page, resolveAccount().handle);
    if (!username) {
      return { success: false, message: 'Could not find profile link in sidebar' };
    }

    // Click reply button
    const tweet = getTargetTweet(page, tweetUrl);
    await clickTweetButton(tweet, btn.reply, page);

    const submittedAfter = Date.now();

    // Fill dialog and submit
    const result = await fillDialogAndSubmit({
      page,
      content,
      contentLabel: 'Reply',
      imagePaths,
    });

    if (!result.success && !result.submitted) {
      return { success: false, message: result.error || 'Failed to submit reply' };
    }

    return await verifySubmission(page, 'Reply', verificationPage =>
      verifyOwnReplyOnTweetPage(verificationPage, tweetUrl, username, content, submittedAfter));

  } finally {
    if (context) await context.close().catch(() => {});
  }
}

runScript<ReplyInput>(replyToTweet);
