import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pattern = /floors\s*\[\s*0\s*\]|floors\s*\.at\s*\(\s*0\s*\)/;

function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    if (fs.statSync(abs).isDirectory()) {
      if (abs === path.join(root, 'src', 'ui')) continue;
      out.push(...walk(abs));
    } else if (name.endsWith('.js')) out.push(abs);
  }
  return out;
}

test('model code does not index the first floor', () => {
  const hits = [];
  for (const abs of walk(path.join(root, 'src'))) {
    const text = fs.readFileSync(abs, 'utf8');
    if (pattern.test(text)) hits.push(path.relative(root, abs));
  }
  assert.deepEqual(hits, []);
});
