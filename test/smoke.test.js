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

test('pure modules import under Node', async () => {
  const files = walk(path.join(root, 'src')).filter((abs) => path.basename(abs) !== 'app.js');
  assert.ok(files.length > 10);
  for (const abs of files) {
    const loaded = await import(pathToFileURL(abs).href);
    assert.equal(typeof loaded, 'object');
  }
});
