import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createEmptyPlan } from '../src/model/document.js';
import { checkStair, computeStair, footprintArea } from '../src/stairs/stairs.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rules = {
  cn: JSON.parse(fs.readFileSync(path.join(root, 'rules/cn.json'), 'utf8')),
  jp: JSON.parse(fs.readFileSync(path.join(root, 'rules/jp.json'), 'utf8')),
  us: JSON.parse(fs.readFileSync(path.join(root, 'rules/us.json'), 'utf8')),
};

function twoFloors(rise = 2900) {
  const plan = createEmptyPlan({ now: 1, id: 'p', name: 't', floorId: 'f1' });
  plan.floors.push({
    id: 'f2', name: '2F', elevation: rise, height: 2900, slab: 200, ceiling: 2800,
    nodes: [], walls: [], openings: [], rooms: [], furniture: [], voids: [],
  });
  return plan;
}

function stair(extra = {}) {
  return {
    id: 's', kind: 'straight', from: 'f1', to: 'f2', x: 0, y: 0, rot: 0,
    width: 900, tread: 260, maxRiser: 200, handrail: 'both', opening: 'auto',
    ...extra,
  };
}

test('US-23 AC1: rise 2900 / maxRiser 200 → 15 risers of 2900/15', () => {
  const plan = twoFloors();
  const result = computeStair(stair(), plan);
  assert.equal(result.rise, 2900);
  assert.equal(result.n, 15);
  assert.equal(result.riser, 2900 / 15);
  assert.equal(result.treads, 14);
  assert.equal(result.runLength, 14 * 260);
  assert.equal(footprintArea(result.footprint), 3640 * 900);
});

test('L and U footprints match the documented split', () => {
  const plan = twoFloors();
  const lStair = stair({ kind: 'L', landing: { at: 0.5, size: 900 }, turn: 'left' });
  const l = computeStair(lStair, plan);
  assert.deepEqual(l.flights.map((item) => item.risers), [8, 7]);
  assert.equal(l.flights[0].treads + l.flights[1].treads, 13);
  assert.equal(l.treads, 14);
  assert.equal(l.runLength, 7 * 260 + 6 * 260);
  assert.equal(l.flights[1].rot, -90);
  assert.equal(footprintArea(l.footprint), (1820 + 1560 + 900) * 900);

  const right = computeStair(stair({ kind: 'L', landing: { at: 0.5, size: 900 }, turn: 'right' }), plan);
  assert.equal(right.flights[1].rot, 90);

  const u = computeStair(stair({ kind: 'U', landing: { at: 0.5, size: 900 }, well: 100 }), plan);
  assert.equal(u.landing.width, 2 * 900 + 100);
  assert.equal(u.flights[1].rot, 180);
  const overlap = 900 * 900;
  const expected = 1820 * 900 + 1560 * 900 + 900 * 1900 - overlap;
  assert.equal(footprintArea(u.footprint), expected);
});

test('rule warnings are hints with clause and source', () => {
  const plan = twoFloors();
  const ok = checkStair(stair(), plan, rules.cn);
  assert.deepEqual(ok.map((item) => item.code), ['HANDRAIL_REMINDER', 'GUARD_REMINDER']);
  assert.equal(ok[0].actual, null);
  assert.ok(ok[0].clause.length > 0);

  const high = checkStair(stair({ maxRiser: 250 }), plan, rules.cn);
  assert.equal(computeStair(stair({ maxRiser: 250 }), plan).n, 12);
  assert.ok(Math.abs(computeStair(stair({ maxRiser: 250 }), plan).riser - 2900 / 12) < 1e-9);
  assert.ok(high.some((item) => item.code === 'RISER_TOO_HIGH'));

  assert.ok(checkStair(stair({ tread: 200 }), plan, rules.cn).some((item) => item.code === 'TREAD_TOO_SHALLOW'));
  assert.ok(checkStair(stair({ width: 800 }), plan, rules.cn).some((item) => item.code === 'WIDTH_TOO_NARROW'));
  assert.ok(checkStair(stair(), plan, rules.us).some((item) => item.code === 'WIDTH_TOO_NARROW' && item.limit === 914));

  const many = twoFloors(3700);
  const long = checkStair(stair(), many, rules.cn);
  assert.equal(computeStair(stair(), many).n, 19);
  assert.ok(long.some((item) => item.code === 'FLIGHT_RISERS_OUT_OF_RANGE'));
  assert.equal(long.some((item) => item.code === 'RISER_TOO_HIGH'), false);

  const shallow = checkStair(stair({ kind: 'L', landing: { at: 0.5, size: 800 } }), plan, rules.cn);
  assert.ok(shallow.some((item) => item.code === 'LANDING_TOO_SHALLOW' && item.limit === 1200));

  const jp = checkStair(stair(), plan, rules.jp);
  assert.deepEqual(jp.map((item) => item.code), ['HANDRAIL_REMINDER']);
  assert.equal(rules.jp.limits.headroom.value, null);
  assert.equal(rules.jp.limits.headroom.verified, false);
});

test('fixture stair matches the hand arithmetic', () => {
  const plan = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/two-floor-stair.json'), 'utf8'));
  const expected = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/two-floor-stair.expected.json'), 'utf8'));
  const result = computeStair(plan.stairs[0], plan);
  assert.equal(result.n, expected.stair.n);
  assert.equal(result.riser, 2900 / 15);
  assert.equal(result.treads, expected.stair.treads);
  assert.equal(result.runLength, expected.stair.runLength);
  assert.equal(footprintArea(result.footprint), expected.stair.footprintArea);
});
