import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    if (fs.statSync(abs).isDirectory()) out.push(...walk(abs));
    else if (name.endsWith('.js')) out.push(abs);
  }
  return out;
}

function isBrowserOnly(abs) {
  const fd = fs.openSync(abs, 'r');
  const buf = Buffer.alloc(64);
  const n = fs.readSync(fd, buf, 0, 64, 0);
  fs.closeSync(fd);
  const first = buf.subarray(0, n).toString('utf8').split(/\r?\n/, 1)[0];
  return first === '// @browser-only';
}

test('pure modules import under Node', async () => {
  const files = walk(path.join(root, 'src')).filter((abs) => !isBrowserOnly(abs));
  assert.ok(files.length > 10);
  for (const abs of files) {
    const loaded = await import(pathToFileURL(abs).href);
    assert.equal(typeof loaded, 'object');
  }
});

test('app.js is marked browser-only', () => {
  const app = path.join(root, 'src', 'app.js');
  assert.equal(isBrowserOnly(app), true);
});
