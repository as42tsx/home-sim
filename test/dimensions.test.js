import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { exteriorDimensions } from '../src/editor/dimensions.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const template = JSON.parse(fs.readFileSync(path.join(root, 'templates/apt-2br.json'), 'utf8'));
const floor = template.plan.floors.find((item) => item.id === 'f1');

test('apt-2br top dimension segments sum to the overall width', () => {
  const dims = exteriorDimensions(floor);
  assert.ok(dims);
  const sum = dims.top.lengths.reduce((total, length) => total + length, 0);
  assert.ok(Math.abs(sum - dims.top.overall) < 1, `sum ${sum} overall ${dims.top.overall}`);
  assert.ok(Math.abs(dims.top.overall - 9600) < 1, `overall width ${dims.top.overall}`);
  assert.equal(dims.top.lengths.length, 4);
  const leftSum = dims.left.lengths.reduce((total, length) => total + length, 0);
  assert.ok(Math.abs(leftSum - dims.left.overall) < 1);
});
