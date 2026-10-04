import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { messageKeyForCode } from '../src/ui/issues.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const zh = JSON.parse(fs.readFileSync(path.join(root, 'i18n/zh.json'), 'utf8'));
const en = JSON.parse(fs.readFileSync(path.join(root, 'i18n/en.json'), 'utf8'));
const CODE = /[A-Z_]{4,}/;

test('user-facing error sentences do not contain error codes', () => {
  for (const code of ['NEWER_VERSION', 'UNSUPPORTED_VERSION', 'INVALID_JSON', 'INVALID_TYPE', 'NO_SUCH_CODE']) {
    const key = messageKeyForCode(code);
    assert.equal(CODE.test(key), false, key);
    assert.equal(typeof zh[key], 'string', key);
    assert.equal(typeof en[key], 'string', key);
    assert.equal(CODE.test(zh[key]), false, zh[key]);
    assert.equal(CODE.test(en[key]), false, en[key]);
  }
  assert.equal(zh['share.incomplete'].includes('链接不完整'), true);
  assert.equal(zh['error.newer'].includes('更新的版本'), true);
});
