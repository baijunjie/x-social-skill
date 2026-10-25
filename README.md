**English** | [中文](README.zh-CN.md)

# x-social-skill

X (Twitter) browser automation skill — post, like, reply, retweet, quote, search, list mentions and delete your own tweets via Playwright + Chrome. Ships as a plugin for Claude Code and Codex that installs the skill into the projects you choose — agents in other projects never see it — with multiple accounts per project.

## Why Browser Automation?

- **API is expensive** — X official API requires a paid subscription ($200+/month) for posting
- **Real browser fingerprint** — Reuses the user's actual Chrome, not a bundled Chromium, so the automation fingerprints X looks for are absent
- **One-time login** — Log in manually once per account, session persists in a Chrome profile
- **Headless when it has to be** — Optional, with the `HeadlessChrome` user agent and client hints masked; see [Headless](#headless)

## Features

| Action | Script (in the installed skill directory) | Description |
|--------|--------|-------------|
| Post | `scripts/post.ts` | Publish tweets with text and/or images (up to 4) |
| Like | `scripts/like.ts` | Like any tweet |
| Reply | `scripts/reply.ts` | Reply to tweets, optionally with images |
| Retweet | `scripts/retweet.ts` | Retweet without comment |
| Quote | `scripts/quote.ts` | Quote tweet with comment, optionally with images |
| Search | `scripts/search.ts` | Search the "Latest" tab, returning structured tweets with author, text, timestamp and counts |
| List own | `scripts/my-tweets.ts` | Enumerate the signed-in account's own tweets from the profile timeline |
| Mentions | `scripts/mentions.ts` | List replies and @-mentions addressed to the signed-in account, from the notifications Mentions tab |
| Delete | `scripts/delete.ts` | Delete one tweet or a batch by URL |
| Purge | `scripts/purge.ts` | Bulk delete own tweets straight from the timeline, optionally filtered by a regex |

**Deleting is permanent — X offers no undo.** `purge.ts` without a `match` filter deletes every own tweet the timeline serves, up to `limit`.

All scripts use stdin/stdout JSON — pipe input in, parse output out. See [SKILL.md](skills/install/template/x-social/SKILL.template.md) for the full IO protocol.

## Getting Started

### Prerequisites

- **Node.js** >= 20 (with npm)
- **Google Chrome** installed

### 1. Install the Plugin

The plugin carries only an installer, which the model cannot invoke on its own, so installing the plugin exposes nothing to agents yet.

Claude Code:

```bash
claude plugin marketplace add baijunjie/x-social-skill
claude plugin install x-social@x-social-skill
# restart Claude Code
```

Codex:

```bash
codex plugin marketplace add baijunjie/x-social-skill
codex plugin add x-social@x-social-skill
# start a new session
```

Install from GitHub rather than a local path: a local marketplace points straight at that directory, and moving or deleting it breaks the skill.

### 2. Install into a Project

In the project that should get X automation, run the installer:

- Claude Code: `/x-social:install` — installs to `.claude/skills/x-social/`
- Codex: `$x-social:install` — installs to `.agents/skills/x-social/`

Commit the installed directory; it carries its own `.gitignore` for `node_modules/`. Then restart Claude Code / start a new Codex session. Only agents in this project see the `x-social` skill.

npm dependencies are installed into the skill directory by `run.sh` on its first run, so nothing else needs installing.

To update: refresh the plugin (`claude plugin marketplace update x-social-skill && claude plugin update x-social@x-social-skill`; Codex: `codex plugin marketplace upgrade x-social-skill && codex plugin add x-social@x-social-skill`), then run the installer again in each project. It reports "up to date" when nothing changed, and lists the files it would overwrite before replacing hand edits.

### 3. Configure Chrome Path

Chrome is expected at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` by default.

If Chrome is installed elsewhere, find it and add it to `~/.x-social-skill/.env`:

```bash
# Find Chrome installation (macOS)
CHROME=$(mdfind "kMDItemCFBundleIdentifier == 'com.google.Chrome'" 2>/dev/null | head -1)

# If found, write to .env
if [ -n "$CHROME" ]; then
  mkdir -p ~/.x-social-skill
  echo "CHROME_PATH=$CHROME/Contents/MacOS/Google Chrome" >> ~/.x-social-skill/.env
  echo "Added CHROME_PATH to ~/.x-social-skill/.env"
else
  echo "Chrome not found. Please install Google Chrome first."
fi
```

### 4. Authenticate with X

Ask the agent to set up X, or run the setup script yourself from the installed skill directory:

```bash
./run.sh setup
```

This opens Chrome on a fresh profile for you to log in to X manually. The script auto-detects login completion (timeout: 5 minutes), reads the account's handle and saves the session under `.x-social/accounts/<handle>/` at the project root — accounts belong to the project the agent is working in. Run it outside a git project, or with `X_SOCIAL_HOME=~/.x-social-skill`, to set up user-level accounts shared by all projects.

Run it again with another account to add it. Once several accounts are set up, choose one with `X_ACCOUNT` — scripts refuse to guess.

## Usage

The agent runs the scripts for you. To run them by hand, from the skill directory:

```bash
# Post a tweet
echo '{"content":"Hello world"}' | ./run.sh post

# Post with images
echo '{"content":"Check this out","imagePaths":["/path/to/image.png"]}' | ./run.sh post

# Like a tweet
echo '{"tweetUrl":"https://x.com/user/status/123"}' | ./run.sh like

# Reply to a tweet
echo '{"tweetUrl":"https://x.com/user/status/123","content":"Great post!"}' | ./run.sh reply

# Retweet
echo '{"tweetUrl":"https://x.com/user/status/123"}' | ./run.sh retweet

# Quote tweet
echo '{"tweetUrl":"https://x.com/user/status/123","comment":"Interesting"}' | ./run.sh quote

# Search ("Latest" tab; X search operators work)
echo '{"query":"\"where did I put\" lang:en -filter:replies","limit":20}' | ./run.sh search

# List your own tweets
echo '{"tab":"with_replies","limit":200}' | ./run.sh my-tweets

# List mentions
echo '{"limit":40}' | ./run.sh mentions

# Delete your own tweets by URL
echo '{"tweetUrls":["https://x.com/me/status/123"]}' | ./run.sh delete

# Bulk delete your own tweets matching a regex
echo '{"match":"keyword|other","limit":500}' | ./run.sh purge

# Act as another account
echo '{"content":"Hello"}' | X_ACCOUNT=other_handle ./run.sh post
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
| `X_ACCOUNT` | unset (the only account set up) | Handle of the account to act as; required once several are set up |
| `X_HEADLESS` | unset (headful) | `1` runs Chrome headless |
| `X_SOCIAL_HOME` | `.x-social/` at the project root, else `~/.x-social-skill` | Data home; environment only |

Set them in the environment, the project's `.x-social/.env`, or `~/.x-social-skill/.env`, in that order of precedence. Put settings that hold for every project, such as `CHROME_PATH`, in the user-level one.

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

`lib/config.ts` in the installed skill holds the following; edits there are lost when the installer runs again:

- Browser navigation timeout (default: 30s)
- Element wait timeout (default: 5s)
- Tweet character limit (default: 280)
- Max images per tweet (default: 4)
- Viewport size (default: 1280x800)

### Data Directories

Data lives outside the installed skill, which the installer replaces. The data home is `.x-social/` at the root of the git project the agent works in — every worktree of a repository shares the main checkout's — or `~/.x-social-skill/` outside a git project or when `X_SOCIAL_HOME` points there.

| Path (under the data home) | Purpose |
|------|---------|
| `.env` | Settings |
| `accounts/<handle>/profile/` | Chrome profile with the account's login session |
| `accounts/<handle>/auth.json` | Authentication state marker |

The profile holds live session cookies, so anyone who has it is logged in as that account. Setup writes a `.gitignore` into a project's `.x-social/` that ignores everything in it, and refuses to set up into one git already tracks. Never commit or share it; teammates set up their own logins.

Before 1.1.0 the profile lived in `data/` under the working directory; it is not migrated, so run the setup once per account.

## Troubleshooting

### Authentication Expired

Re-run the setup and log in with that account; it replaces the account's old session:

```bash
./run.sh setup
```

### Chrome Fails to Launch

Scripts clear stale Chrome lock files on launch; if launch still fails, make sure no other run is using the same account, then clear them by hand:

```bash
rm -f .x-social/accounts/<handle>/profile/Singleton{Lock,Socket,Cookie}
```

### X UI Selector Changes

If scripts fail with element-not-found errors, X may have updated their UI. Update `config.selectors` in `skills/install/template/x-social/lib/config.ts` and reinstall.

## License

[MIT](LICENSE)
