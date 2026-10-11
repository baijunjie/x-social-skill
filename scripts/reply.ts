#!/usr/bin/env npx tsx
/**
 * Reply to Tweet
 * Usage: echo '{"tweetUrl":"https://x.com/user/status/123","content":"Great post!"}' | npx tsx scripts/reply.ts
 */

import { getBrowserContext, navigateToTweet, navigateTo } from '../lib/browser.js';
import { runScript, ScriptResult } from '../lib/script.js';
import {
  validateTweetUrl,
  validateContent,
  validateImagePaths,
  getFirstTweet,
  clickTweetButton,
  fillDialogAndSubmit,
  getOwnHandle,
  verifyOwnReplyOnTweetPage
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

    const username = await getOwnHandle(page);
    if (!username) {
      return { success: false, message: 'Could not find profile link in sidebar' };
    }

    // Click reply button
    const tweet = getFirstTweet(page);
    await clickTweetButton(tweet, btn.reply, page);

    // Fill dialog and submit
    const result = await fillDialogAndSubmit({
      page,
      content,
      contentLabel: 'Reply',
      imagePaths,
    });

    if (!result.success) {
      return { success: false, message: result.error || 'Failed to submit reply' };
    }

    // Verify on the thread page: the profile Replies tab is stale and misses fresh replies.
    const newUrl = await verifyOwnReplyOnTweetPage(page, tweetUrl, username, content);

    if (!newUrl) {
      return { success: false, message: 'Reply not found on the tweet page after submitting' };
    }

    return { success: true, message: `Reply posted: ${newUrl}` };

  } finally {
    if (context) await context.close();
  }
}

runScript<ReplyInput>(replyToTweet);
