import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { computeSlab } from '../src/slab/slab.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('two-floor fixture slab openings merge the stair and the void', () => {
  const plan = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/two-floor-stair.json'), 'utf8'));
  const expected = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/two-floor-stair.expected.json'), 'utf8'));
  const lower = computeSlab(plan, 'f1');
  const upper = computeSlab(plan, 'f2');
  assert.ok(Math.abs(lower.outlineArea - expected.slab.f1.outlineArea) < 1);
  assert.ok(Math.abs(lower.openingArea - expected.slab.f1.openingArea) < 1);
  assert.ok(Math.abs(lower.slabArea - expected.slab.f1.slabArea) < 1);
  assert.ok(Math.abs(upper.outlineArea - expected.slab.f2.outlineArea) < 10000);
  assert.ok(Math.abs(upper.openingArea - expected.slab.f2.openingArea) < 10000);
  assert.ok(Math.abs(upper.slabArea - expected.slab.f2.slabArea) < 10000);
  const stairOnly = 3640 * 900;
  const voidOnly = 2000 * 1500;
  assert.ok(Math.abs(upper.openingArea - (stairOnly + voidOnly)) > 1);
  assert.ok(Math.abs(upper.slabArea - (upper.outlineArea - upper.openingArea)) < 1);
});
