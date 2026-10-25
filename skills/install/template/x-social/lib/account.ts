/**
 * Accounts
 *
 * Each account set up by scripts/setup.ts lives in its own directory under
 * config.accountsDir, named by the X handle it signed in as.
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { config } from './config.js';

export interface Account {
  handle: string;
  /** Chrome profile holding the login session */
  profileDir: string;
  /** Auth state marker - indicates X login is complete */
  authPath: string;
}

export const SETUP_HINT = 'Run the setup script ("run.sh setup" in the skill directory) to log in.';

export function accountPaths(handle: string): Account {
  const dir = path.join(config.accountsDir, handle);
  return { handle, profileDir: path.join(dir, 'profile'), authPath: path.join(dir, 'auth.json') };
}

/** Handles of the accounts whose login completed. */
export function listAccounts(): string[] {
  if (!fs.existsSync(config.accountsDir)) return [];
  return fs.readdirSync(config.accountsDir)
    .filter(name => !name.startsWith('.') && fs.existsSync(accountPaths(name).authPath))
    .sort();
}

/**
 * The account to act as: X_ACCOUNT when set, otherwise the only one set up.
 * Several accounts without X_ACCOUNT is an error rather than a guess, so nothing
 * gets posted from the wrong account.
 */
export function resolveAccount(): Account {
  const handles = listAccounts();
  if (handles.length === 0) {
    throw new Error(`X authentication not configured. ${SETUP_HINT}`);
  }

  if (config.account) {
    const wanted = config.account.toLowerCase();
    const handle = handles.find(h => h.toLowerCase() === wanted);
    if (!handle) {
      throw new Error(`Account @${config.account} is not set up (set up: ${handles.map(h => '@' + h).join(', ')}). ${SETUP_HINT}`);
    }
    return accountPaths(handle);
  }

  if (handles.length > 1) {
    throw new Error(`Several accounts are set up (${handles.map(h => '@' + h).join(', ')}); set X_ACCOUNT to choose one.`);
  }
  return accountPaths(handles[0]);
}

/**
 * Create the data home for setup. A project-level home holds live login sessions, so it
 * gets its own catch-all .gitignore - that keeps it out of the project's commits without
 * editing the project's .gitignore - and setup refuses to write into one git already tracks.
 */
export function prepareHome(): void {
  const root = config.projectRoot;
  if (root) {
    const tracked = execFileSync('git', ['-C', root, 'ls-files', '--', config.homeDir], { encoding: 'utf8' }).trim();
    if (tracked) {
      throw new Error(`${config.homeDir} is tracked by git; remove it from the index (git rm -r --cached) before setting up accounts there.`);
    }
  }
  fs.mkdirSync(config.accountsDir, { recursive: true });
  if (root) {
    const ignorePath = path.join(config.homeDir, '.gitignore');
    if (!fs.existsSync(ignorePath)) {
      fs.writeFileSync(ignorePath, '# Login sessions of x-social-skill accounts; never commit\n*\n');
    }
  }
}
