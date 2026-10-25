/**
 * Environment loader
 * Loads a .env file
 */

import fs from 'fs';

/**
 * Load environment variables from a .env file.
 * Only sets variables that are not already defined in process.env.
 */
export function loadEnv(envPath: string): void {
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Remove surrounding quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    // Only set if not already defined
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
