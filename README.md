**English** | [中文](README.zh-CN.md)

# skill-x-social

X (Twitter) browser automation skill — post, like, reply, retweet, quote, search, and delete your own tweets via Playwright + Chrome.

## Why Browser Automation?

- **API is expensive** — X official API requires a paid subscription ($200+/month) for posting
- **Real browser fingerprint** — Reuses the user's actual Chrome, not a bundled Chromium, so the automation fingerprints X looks for are absent
- **One-time login** — Log in manually once, session persists in Chrome profile
- **Headless when it has to be** — Optional, with the `HeadlessChrome` user agent and client hints masked; see [Headless](#headless)

## Features

| Action | Script | Description |
|--------|--------|-------------|
| Post | `scripts/post.ts` | Publish tweets with text and/or images (up to 4) |
| Like | `scripts/like.ts` | Like any tweet |
| Reply | `scripts/reply.ts` | Reply to tweets, optionally with images |
| Retweet | `scripts/retweet.ts` | Retweet without comment |
| Quote | `scripts/quote.ts` | Quote tweet with comment, optionally with images |
| Search | `scripts/search.ts` | Search the "Latest" tab, returning structured tweets with author, text, timestamp and counts |
| List own | `scripts/my-tweets.ts` | Enumerate the signed-in account's own tweets from the profile timeline |
| Delete | `scripts/delete.ts` | Delete one tweet or a batch by URL |
| Purge | `scripts/purge.ts` | Bulk delete own tweets straight from the timeline, optionally filtered by a regex |

**Deleting is permanent — X offers no undo.** `purge.ts` without a `match` filter deletes every own tweet the timeline serves, up to `limit`.

All scripts use stdin/stdout JSON — pipe input in, parse output out. See [SKILL.md](SKILL.md) for the full IO protocol.

## Getting Started

### Prerequisites

- **Node.js** >= 20
- **Google Chrome** installed

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Chrome Path

Chrome is expected at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` by default.

If Chrome is installed elsewhere, find it and add to `.env`:

```bash
# Find Chrome installation (macOS)
CHROME=$(mdfind "kMDItemCFBundleIdentifier == 'com.google.Chrome'" 2>/dev/null | head -1)

# If found, write to .env
if [ -n "$CHROME" ]; then
  echo "CHROME_PATH=$CHROME/Contents/MacOS/Google Chrome" >> .env
  echo "Added CHROME_PATH to .env"
else
  echo "Chrome not found. Please install Google Chrome first."
fi
```

### 3. Authenticate with X

```bash
npx tsx scripts/setup.ts
```

This opens Chrome for you to log in to X manually. The script auto-detects login completion (timeout: 5 minutes).

Verify:

```bash
cat data/x-auth.json  # {"authenticated": true, ...}
```

## Usage

```bash
# Post a tweet
echo '{"content":"Hello world"}' | npx tsx scripts/post.ts

# Post with images
echo '{"content":"Check this out","imagePaths":["/path/to/image.png"]}' | npx tsx scripts/post.ts

# Like a tweet
echo '{"tweetUrl":"https://x.com/user/status/123"}' | npx tsx scripts/like.ts

# Reply to a tweet
echo '{"tweetUrl":"https://x.com/user/status/123","content":"Great post!"}' | npx tsx scripts/reply.ts

# Retweet
echo '{"tweetUrl":"https://x.com/user/status/123"}' | npx tsx scripts/retweet.ts

# Quote tweet
echo '{"tweetUrl":"https://x.com/user/status/123","comment":"Interesting"}' | npx tsx scripts/quote.ts

# Search ("Latest" tab; X search operators work)
echo '{"query":"\"where did I put\" lang:en -filter:replies","limit":20}' | npx tsx scripts/search.ts

# List your own tweets
echo '{"tab":"with_replies","limit":200}' | npx tsx scripts/my-tweets.ts

# Delete your own tweets by URL
echo '{"tweetUrls":["https://x.com/me/status/123"]}' | npx tsx scripts/delete.ts

# Bulk delete your own tweets matching a regex
echo '{"match":"keyword|other","limit":500}' | npx tsx scripts/purge.ts
```

Output is a JSON line:

```json
{"success": true, "message": "Tweet posted: https://x.com/user/status/123456"}
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CHROME_PATH` | `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` | Chrome executable path |
| `X_HEADLESS` | unset (headful) | `1` runs Chrome headless |

Set in `.env` at the project root.

### Headless

A headful Chrome window becomes the frontmost application on launch, so an unattended run
steals focus from whoever is using the machine — and keystrokes from other automation land
in Chrome. `X_HEADLESS=1` avoids that: a headless process has no window and never comes
to the front.

Headless Chrome reports itself as `HeadlessChrome/<ver>` in both `navigator.userAgent` and
the `Sec-CH-UA` client hints, which sites read. The launcher overrides both with the headful
user agent, built from the installed Chrome's own major version so it does not drift behind
Chrome updates; if that version cannot be read it refuses to launch rather than run exposed.

Leave `X_HEADLESS` unset when you want to watch the browser to debug a selector.

### Timeouts and Limits

Edit `lib/config.ts` to adjust:

- Browser navigation timeout (default: 30s)
- Element wait timeout (default: 5s)
- Tweet character limit (default: 280)
- Max images per tweet (default: 4)
- Viewport size (default: 1280x800)

### Data Directories

| Path | Purpose |
|------|---------|
| `data/x-browser-profile/` | Chrome profile with login session |
| `data/x-auth.json` | Authentication state marker |

Both are gitignored.

## Troubleshooting

### Authentication Expired

Re-run the setup:

```bash
npx tsx scripts/setup.ts
```

### Chrome Fails to Launch

Clear browser lock files:

```bash
rm -f data/x-browser-profile/SingletonLock data/x-browser-profile/SingletonSocket data/x-browser-profile/SingletonCookie
```

### X UI Selector Changes

If scripts fail with element-not-found errors, X may have updated their UI. Update `config.selectors` in `lib/config.ts`.

## License

[MIT](LICENSE)
