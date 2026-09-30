import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { aboutNetM2, planNetM2 } from '../src/editor/area.js';
import { clonePlanFresh } from '../src/editor/clone.js';
import { roomThumbModel } from '../src/editor/thumb.js';
import { validatePlan } from '../src/model/validate.js';
import { formatAreaM2 } from '../src/editor/format.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function load(id) {
  return JSON.parse(fs.readFileSync(path.join(root, 'templates', `${id}.json`), 'utf8'));
}

test('template cards use derived net area, with the index value as fallback', () => {
  const index = JSON.parse(fs.readFileSync(path.join(root, 'templates', 'index.json'), 'utf8'));
  const expectRound = { 'apt-1br': 34, 'apt-2br': 57, 'apt-3br': 81 };
  for (const entry of index.templates) {
    const doc = load(entry.id);
    const net = planNetM2(doc.plan);
    assert.equal(aboutNetM2(net, entry.netAreaM2), expectRound[entry.id]);
    assert.equal(aboutNetM2(null, entry.netAreaM2), Math.round(entry.netAreaM2));
    const thumb = roomThumbModel(doc.plan);
    assert.ok(thumb.polys.length >= 5);
    if (entry.id === 'apt-2br') assert.equal(thumb.roomCount, 7);
  }
});

test('cloning a template keeps the template id, new ids, and the same net area', () => {
  const doc = load('apt-2br');
  let n = 0;
  const copy = clonePlanFresh(doc.plan, {
    name: '我的两居',
    now: 99,
    template: doc.plan.meta.template,
    ids: (prefix) => `${prefix}${n += 1}`,
  });
  assert.equal(copy.meta.template, 'apt-2br');
  assert.equal(copy.meta.name, '我的两居');
  assert.notEqual(copy.meta.id, doc.plan.meta.id);
  assert.notEqual(copy.floors[0].id, doc.plan.floors[0].id);
  const errors = validatePlan(copy).filter((item) => item.severity !== 'warning');
  assert.deepEqual(errors, []);
  assert.ok(Math.abs(planNetM2(copy) - planNetM2(doc.plan)) < 1e-6);
  assert.equal(formatAreaM2(10.3776), '10.38');
});
