/**
 * Configuration
 *
 * All environment-specific settings in one place.
 * Override via environment variables or modify defaults here.
 */

import { execFileSync } from 'child_process';
import os from 'os';
import path from 'path';
import { loadEnv } from './env.js';

/** User-level data home, shared by every project */
const USER_HOME_DIR = path.join(os.homedir(), '.x-social-skill');

/**
 * Root of the git project the agent is working in, or null outside one. Resolved
 * through the common git dir so every worktree of a repository shares the main
 * checkout's accounts instead of each needing its own login.
 */
function projectRoot(): string | null {
  const git = (...args: string[]) =>
    execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    const commonDir = git('rev-parse', '--path-format=absolute', '--git-common-dir');
    return path.basename(commonDir) === '.git' ? path.dirname(commonDir) : git('rev-parse', '--show-toplevel');
  } catch {
    return null;
  }
}

/**
 * Data home, outside the skill directory: a reinstall replaces that directory, and it is
 * committed with the project. Defaults to .x-social/ at the project root, so each project
 * keeps its own accounts; outside a git project it falls back to the user-level home.
 * Override: X_SOCIAL_HOME env var (e.g. ~/.x-social-skill to use the user-level accounts)
 */
const PROJECT_ROOT = process.env.X_SOCIAL_HOME ? null : projectRoot();
const HOME_DIR = process.env.X_SOCIAL_HOME
  ? path.resolve(process.env.X_SOCIAL_HOME.replace(/^~(?=$|\/)/, os.homedir()))
  : PROJECT_ROOT ? path.join(PROJECT_ROOT, '.x-social') : USER_HOME_DIR;

// The project's .env wins over the user-level one, so settings such as CHROME_PATH
// can be made once for all projects
loadEnv(path.join(HOME_DIR, '.env'));
if (HOME_DIR !== USER_HOME_DIR) loadEnv(path.join(USER_HOME_DIR, '.env'));

/**
 * Configuration object with all settings
 */
export const config = {
  // ==========================================================================
  // Browser Settings
  // ==========================================================================

  /** Chrome executable path. Override: CHROME_PATH env var */
  chromePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',

  /** Data home holding .env and the accounts */
  homeDir: HOME_DIR,

  /** Project the data home belongs to; null when it is the user-level home or X_SOCIAL_HOME */
  projectRoot: PROJECT_ROOT,

  /** One directory per account, named by handle, each with a Chrome profile and auth marker */
  accountsDir: path.join(HOME_DIR, 'accounts'),

  /** Account to act as when several are set up. Override: X_ACCOUNT env var */
  account: process.env.X_ACCOUNT?.replace(/^@/, '') || undefined,

  /** Browser viewport dimensions */
  viewport: { width: 1280, height: 800 },

  /** Chrome launch options */
  chrome: {
    args: [
      '--disable-blink-features=AutomationControlled', // Avoid bot detection
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      '--password-store=basic', // Don't use Keychain - allows cookies to persist without encryption
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  },

  // ==========================================================================
  // Timeouts (milliseconds)
  // ==========================================================================

  timeouts: {
    /** Page navigation timeout */
    navigation: 30000,

    /** Wait for element to appear */
    elementWait: 5000,

    /** Wait after page load or form submission */
    loadWait: 3000,

    /** Pause after click or fill actions */
    actionDelay: 1000,

    /** Brief pause for focus/animations */
    shortPause: 500,
  },

  // ==========================================================================
  // X Platform Limits
  // ==========================================================================

  limits: {
    /** Maximum tweet/reply length */
    tweetMaxLength: 280,

    /** Maximum images per tweet */
    maxImages: 4,
  },

  // ==========================================================================
  // X Page Selectors
  // ==========================================================================

  selectors: {
    /** Tweet article container */
    tweet: 'article[data-testid="tweet"]',

    /** Tweet compose textarea */
    tweetTextarea: '[data-testid="tweetTextarea_0"]',

    /** Modal dialog container */
    modalDialog: '[role="dialog"][aria-modal="true"]',

    /** Account switcher (indicates logged in) */
    accountSwitcher: '[data-testid="SideNav_AccountSwitcher_Button"]',

    /** Username input on login page */
    usernameInput: 'input[autocomplete="username"]',

    /** Tweet timestamp link (contains time element, links to tweet status) */
    tweetTimestampLink: 'a[href*="/status/"] time',

    /** File input for media uploads */
    fileInput: 'input[type="file"]',

    /** Attachments preview container */
    attachments: '[data-testid="attachments"]',

    /** Action buttons */
    buttons: {
      postInline: '[data-testid="tweetButtonInline"]',
      postDialog: '[data-testid="tweetButton"]',
      like: '[data-testid="like"]',
      unlike: '[data-testid="unlike"]',
      retweet: '[data-testid="retweet"]',
      unretweet: '[data-testid="unretweet"]',
      retweetConfirm: '[data-testid="retweetConfirm"]',
      reply: '[data-testid="reply"]',
    },
  },
};
