import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readChromeMajor, getBrowserContext } from '../lib/browser.js';
import { config } from '../lib/config.js';

test('macOS reads bundle metadata even if the executable version probe would fail', { skip: process.platform !== 'darwin' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'x-social-version-'));
  try {
    const contents = path.join(root, 'Chrome.app', 'Contents');
    const executable = path.join(contents, 'MacOS', 'Google Chrome');
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    fs.writeFileSync(executable, '#!/bin/sh\nexit 42\n', { mode: 0o755 });
    fs.writeFileSync(path.join(contents, 'Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>157.0.8103.38</string></dict></plist>');
    assert.equal(readChromeMajor(executable), '157');
    const link = path.join(root, 'chrome');
    fs.symlinkSync(executable, link);
    assert.equal(readChromeMajor(link), '157');
    fs.writeFileSync(path.join(contents, 'Info.plist'), '<plist><dict/></plist>');
    assert.throws(() => readChromeMajor(executable), /Cannot read Chrome version.*refusing to run headless/s);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('non-bundle executables retain a bounded version probe and useful errors', { skip: process.platform === 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'x-social-version-'));
  try {
    const executable = path.join(root, 'chrome');
    fs.writeFileSync(executable, '#!/bin/sh\nprintf "Google Chrome 157.0.8103.38\\n"\n', { mode: 0o755 });
    assert.equal(readChromeMajor(executable, 'linux'), '157');
    fs.writeFileSync(executable, '#!/bin/sh\nexit 42\n', { mode: 0o755 });
    assert.throws(() => readChromeMajor(executable, 'linux'), /Cannot read Chrome version.*Command failed/s);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('installed Chrome launches headless with its matching headful UA in an isolated profile', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'x-social-headless-'));
  const previous = process.env.X_HEADLESS;
  process.env.X_HEADLESS = '1';
  try {
    const context = await getBrowserContext(root);
    try {
      const page = context.pages()[0] || await context.newPage();
      const ua = await page.evaluate(() => navigator.userAgent);
      assert.doesNotMatch(ua, /HeadlessChrome/);
      assert.match(ua, new RegExp(`Chrome/${readChromeMajor(config.chromePath)}\\.0\\.0\\.0`));
    } finally { await context.close(); }
  } finally {
    if (previous === undefined) delete process.env.X_HEADLESS; else process.env.X_HEADLESS = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
