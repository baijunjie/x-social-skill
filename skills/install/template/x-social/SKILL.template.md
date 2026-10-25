---
name: x-social
description: X (Twitter) browser automation skill. Post tweets, like, reply, retweet, quote, search, list and delete your own tweets via Playwright + Chrome. Triggers on "post tweet", "like tweet", "reply tweet", "retweet", "quote tweet", "search x", "delete tweet", "my tweets", "x mentions", "x setup", "twitter".
---

# X Social Skill

## Quick Reference

Run every script through `run.sh` in this skill's directory, by script name: `echo '<json>' | <skill-directory>/run.sh post`. On first run it installs the npm dependencies into the skill directory (output on stderr), so the first call after installing or reinstalling the skill takes longer.

| Action | Script | Input (stdin JSON) | Output `message` on success |
|--------|--------|--------------------|-----------------------------|
| Post | `scripts/post.ts` | `{"content","imagePaths?"}` | `Tweet posted: <url>` |
| Like | `scripts/like.ts` | `{"tweetUrl"}` | `Like successful` |
| Reply | `scripts/reply.ts` | `{"tweetUrl","content","imagePaths?"}` | `Reply posted: <url>` |
| Retweet | `scripts/retweet.ts` | `{"tweetUrl"}` | `Retweet successful` |
| Quote | `scripts/quote.ts` | `{"tweetUrl","comment","imagePaths?"}` | `Quote tweet posted: <url>` |
| Search | `scripts/search.ts` | `{"query","limit?","scrolls?"}` | `Found <n> tweets` |
| List own | `scripts/my-tweets.ts` | `{"tab?","limit?","scrolls?"}` | `Found <n> own tweets on <tab>` |
| Mentions | `scripts/mentions.ts` | `{"limit?","scrolls?"}` | `Found <n> mentions` |
| Delete | `scripts/delete.ts` | `{"tweetUrl"}` or `{"tweetUrls":[...]}` | `Deleted <n>/<total> tweets` |
| Purge | `scripts/purge.ts` | `{"match?","limit?","tab?"}` | `Deleted <n>, skipped <n> non-matching, <n> failed` |

## Destructive Actions

Deleting a tweet is permanent — X offers no undo.

- Run `delete.ts` only on tweets the user asked to remove, and confirm the URLs with them first.
- Run `purge.ts` only when the user asked to clear a whole set of their own tweets. Without `match` it deletes every own tweet the timeline serves, up to `limit`.
- Never delete a tweet to clean up after a failed or duplicated run without telling the user what is being removed.

## IO Protocol

All scripts except setup communicate via **stdin/stdout JSON**. The setup script is an exception — see [Setup](#setup).

**Input:** Pipe JSON to stdin.

**Output:** A single JSON line to stdout:

```json
{"success": true, "message": "Tweet posted: https://x.com/user/status/123456"}
{"success": false, "message": "X login expired. Run the setup script (\"run.sh setup\" in the skill directory) to log in."}
```

Parse the output JSON, check `success` to determine result, and relay `message` to the user.

**Auth errors:** Scripts automatically check authentication before executing. If auth is missing or expired, they return `success: false` with a message indicating the issue — no need to pre-check manually. When this happens, guide the user through the [Authentication](#2-run-authentication) setup steps.

**Accounts:** Several X accounts can be set up. With more than one, scripts refuse to run until `X_ACCOUNT` names the account to act as (`X_ACCOUNT=handle`, with or without `@`), passed on the command line or set in `.env`. When the user has several accounts and has not said which one to use, ask before posting, replying, liking or deleting.

**Timeout:** Set command timeout to at least **120 seconds** — browser automation involves launching Chrome, navigating pages, and verifying results.

## Input Validation

- `content` / `comment`: 1–280 characters (configurable in `lib/config.ts`), required for post/reply/quote
- `tweetUrl`: Required for like/reply/retweet/quote. Accepts full URL (`https://x.com/user/status/123`) or raw tweet ID (`123`)
- `imagePaths`: Optional array, max 4 items, each must be an absolute path to an existing file
- `query`: Required for search, passed to X as-is; it is a search query, so operators such as `lang:ja`, `-filter:replies` and `since_time:<epoch>` work
- `tab`: `posts` or `with_replies` (default), selecting which profile timeline to read or purge
- `match`: Optional regex over the tweet text for purge; a tweet that does not match is skipped

## Setup

Accounts belong to the project by default: data lives in `.x-social/` at the root of the git project the command runs in (every worktree of a repository uses the main checkout's), so each project has its own accounts. Outside a git project, or with `X_SOCIAL_HOME` set, it lives there instead; `X_SOCIAL_HOME=~/.x-social-skill` selects the user-level accounts shared by all projects. Only use the user-level accounts when the user asks for them.

| Path (under the data home) | Purpose |
|------|---------|
| `.env` | Settings from [Configuration](#configuration); a project's `.env` overrides `~/.x-social-skill/.env` |
| `accounts/<handle>/profile/` | Chrome profile with the account's login session |
| `accounts/<handle>/auth.json` | Authentication state marker |

The profile holds live session cookies — anyone with it is logged in as that account. Setup gives a project-level `.x-social/` its own `.gitignore` that ignores everything in it, and refuses to set up into one git already tracks; never commit or share it.

### 1. Configure Chrome Path

Check if Chrome exists at the default path:

```bash
ls -la "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

If not found, search and write to `~/.x-social-skill/.env`:

```bash
CHROME=$(mdfind "kMDItemCFBundleIdentifier == 'com.google.Chrome'" 2>/dev/null | head -1)
[ -n "$CHROME" ] && mkdir -p ~/.x-social-skill && echo "CHROME_PATH=$CHROME/Contents/MacOS/Google Chrome" >> ~/.x-social-skill/.env
```

### 2. Run Authentication

```bash
<skill-directory>/run.sh setup
```

> The setup script outputs human-readable text (not JSON), requires no stdin input, and waits up to **5 minutes** for login. Set command timeout to at least **300 seconds**. Do not set `X_HEADLESS` for it — the user needs the window.

This step requires the user to act in the browser:
1. The script opens a Chrome window to `x.com/login` on a fresh profile.
2. **Tell the user** to complete the X login in the browser window, with the account they want to add.
3. The script auto-detects login completion, reads the handle, saves the session under `accounts/<handle>/` in the data home it printed (replacing an earlier session of that account) and exits.
4. Verify: the output ends with `Authentication successful as @<handle>`.

Run it once per account; re-run it for an account whose login expired.

## Usage

```bash
echo '{"content":"Hello world"}' | <skill-directory>/run.sh post
echo '{"content":"Check this out","imagePaths":["/path/to/image.png"]}' | <skill-directory>/run.sh post
echo '{"tweetUrl":"https://x.com/user/status/123"}' | <skill-directory>/run.sh like
echo '{"tweetUrl":"https://x.com/user/status/123","content":"Great post!"}' | <skill-directory>/run.sh reply
echo '{"tweetUrl":"https://x.com/user/status/123"}' | <skill-directory>/run.sh retweet
echo '{"tweetUrl":"https://x.com/user/status/123","comment":"Interesting"}' | <skill-directory>/run.sh quote
echo '{"query":"\"where did I put\" lang:en -filter:replies","limit":20}' | <skill-directory>/run.sh search
echo '{"tab":"with_replies","limit":200}' | <skill-directory>/run.sh my-tweets
echo '{"limit":40}' | <skill-directory>/run.sh mentions
echo '{"tweetUrls":["https://x.com/me/status/123","https://x.com/me/status/456"]}' | <skill-directory>/run.sh delete
echo '{"content":"Hello from my other account"}' | X_ACCOUNT=other_handle <skill-directory>/run.sh post
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `CHROME_PATH` | `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` | Chrome executable path |
| `X_ACCOUNT` | unset (the only account set up) | Handle of the account to act as; required once several are set up |
| `X_HEADLESS` | unset (headful) | `1` runs Chrome headless, so no window takes focus. Needed for unattended runs that must not fight with whoever is using the machine. |

Set them in the environment, the project's `.x-social/.env`, or `~/.x-social-skill/.env`, in that order of precedence; settings such as `CHROME_PATH` that hold for every project go in the user-level one. `X_SOCIAL_HOME` (default: `.x-social/` at the project root, else `~/.x-social-skill`) moves the data home and can only come from the environment.

Headless Chrome reports itself as `HeadlessChrome/<ver>` in both `navigator.userAgent` and the `Sec-CH-UA` client hints; the launcher replaces both with the headful user agent built from the installed Chrome's version. Leave `X_HEADLESS` unset when watching the browser to debug a selector.

`lib/config.ts` in the skill directory holds browser timeouts, viewport size, and tweet character limits; edits there are lost when the skill is reinstalled.
