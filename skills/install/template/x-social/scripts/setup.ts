#!/usr/bin/env npx tsx
/**
 * Authentication Setup
 * Usage: ./run.sh setup
 *
 * Opens browser for manual login and auto-detects when login is complete.
 * Logs in on a fresh profile, then files it under the handle it signed in as,
 * replacing that account's previous profile. Run once per account.
 */

import fs from 'fs';
import path from 'path';
import { getBrowserContext } from '../lib/browser.js';
import { checkLoginStatus, getOwnHandle } from '../lib/utils.js';
import { config } from '../lib/config.js';
import { accountPaths, listAccounts, prepareHome } from '../lib/account.js';

const POLL_INTERVAL_MS = 3000;
const MAX_WAIT_MINUTES = 5;
const MAX_WAIT_MS = MAX_WAIT_MINUTES * 60 * 1000;

async function setup(): Promise<void> {
  console.log('=== X (Twitter) Authentication Setup ===\n');
  console.log('This will open Chrome for you to log in to X.');
  console.log('Your login session will be saved for automated interactions.\n');
  console.log(`Chrome path: ${config.chromePath}`);
  console.log(`Accounts dir: ${config.accountsDir}`);
  console.log(config.projectRoot
    ? `(project-level, for ${config.projectRoot}; set X_SOCIAL_HOME=~/.x-social-skill for the user-level accounts)\n`
    : '\n');

  prepareHome();

  // The handle is unknown until login completes, so log in on a pending profile
  const pendingDir = path.join(config.accountsDir, `.pending-${process.pid}`);
  fs.mkdirSync(pendingDir, { recursive: true });

  console.log('Launching browser...\n');

  const context = await getBrowserContext(pendingDir);
  const page = context.pages()[0] || await context.newPage();

  // Navigate to login page
  await page.goto('https://x.com/login');

  console.log('Please log in to X in the browser window.');
  console.log('Waiting for login to complete (auto-detecting)...\n');

  // Poll for login completion
  let elapsed = 0;
  let loggedIn = false;

  while (elapsed < MAX_WAIT_MS) {
    await page.waitForTimeout(POLL_INTERVAL_MS);
    elapsed += POLL_INTERVAL_MS;

    // Check if we're on the home page or still on login
    const url = page.url();
    if (url.includes('/home') || url === 'https://x.com/' || url === 'https://twitter.com/') {
      const status = await checkLoginStatus(page);
      if (status.loggedIn) {
        loggedIn = true;
        break;
      }
    }

    // Also try navigating to home to check
    if (elapsed % 15000 === 0) { // Every 15 seconds
      console.log('Still waiting for login...');
      try {
        await page.goto('https://x.com/home', { timeout: 10000 });
        await page.waitForTimeout(config.timeouts.loadWait);
        const status = await checkLoginStatus(page);
        if (status.loggedIn) {
          loggedIn = true;
          break;
        }
        // If not logged in, go back to login page
        if (status.onLoginPage) {
          await page.goto('https://x.com/login');
        }
      } catch {
        // Ignore navigation errors
      }
    }
  }

  const handle = loggedIn ? await getOwnHandle(page) : null;
  await context.close();

  if (!loggedIn) {
    fs.rmSync(pendingDir, { recursive: true, force: true });
    console.log(`\n❌ Login timed out after ${MAX_WAIT_MINUTES} minutes.`);
    console.log('Please run the setup again and complete the login.');
    return;
  }
  if (!handle) {
    fs.rmSync(pendingDir, { recursive: true, force: true });
    console.log('\n❌ Logged in, but could not read the account handle from the sidebar.');
    console.log('Please run the setup again.');
    return;
  }

  const account = accountPaths(handle);
  const accountDir = path.dirname(account.profileDir);
  fs.rmSync(accountDir, { recursive: true, force: true });
  fs.mkdirSync(accountDir, { recursive: true });
  fs.renameSync(pendingDir, account.profileDir);
  fs.writeFileSync(account.authPath, JSON.stringify({
    authenticated: true,
    handle,
    timestamp: new Date().toISOString()
  }, null, 2));

  const accounts = listAccounts();
  console.log(`\n✅ Authentication successful as @${handle}!`);
  console.log(`Session saved to: ${account.profileDir}`);
  if (accounts.length > 1) {
    console.log(`\nAccounts set up: ${accounts.map(h => '@' + h).join(', ')}`);
    console.log('Set X_ACCOUNT to choose which one the scripts act as.');
  } else {
    console.log('\nYou can now use X integration features.');
  }
}

setup().catch(err => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
