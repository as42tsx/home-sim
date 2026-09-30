import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('clean-room identifier scan passes', () => {
  const output = execFileSync(process.execPath, ['scripts/cleanroom-check.js'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.match(output, /clean-room check ok/);
});
