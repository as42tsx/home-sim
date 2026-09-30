import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createEmptyPlan, floorAbove, floorBelow, getFloor } from '../src/model/document.js';
import { createIdGenerator } from '../src/model/ids.js';
import { deriveAllFloors, deriveRooms } from '../src/rooms/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function wall(id, a, b, thickness = 240, extra = {}) {
  return {
    id, a, b, thickness, height: null, bearing: false, exterior: true, demolished: false,
    virtual: false, finish: { left: 'paint-white', right: 'paint-white' }, ...extra,
  };
}
function node(id, x, y) { return { id, x, y }; }

function planWith(nodes, walls, rooms = [], openings = [], floorId = 'f1') {
  const plan = createEmptyPlan({ now: 1, id: 'p', name: 't', floorId });
  const floor = getFloor(plan, floorId);
  floor.nodes = nodes;
  floor.walls = walls;
  floor.rooms = rooms;
  floor.openings = openings;
  return plan;
}

function areaOf(result, name) {
  return result.derived.find((face) => face.name === name);
}

test('rectangle 4000×3000 with 240 walls nets 10.3776 m²', () => {
  const plan = planWith(
    [node('a', 0, 0), node('b', 4000, 0), node('c', 4000, 3000), node('d', 0, 3000)],
    [wall('n', 'a', 'b'), wall('e', 'b', 'c'), wall('s', 'c', 'd'), wall('w', 'd', 'a')],
  );
  const before = JSON.stringify(getFloor(plan, 'f1'));
  const result = deriveRooms(plan, 'f1');
  assert.equal(JSON.stringify(getFloor(plan, 'f1')), before);
  assert.equal(result.derived.length, 1);
  assert.equal(result.derived[0].centerlineArea, 12_000_000);
  assert.equal(result.derived[0].area, 10_377_600);
  assert.equal(result.derived[0].areaM2, 10.3776);
  assert.equal(result.unclosed.gap, null);
});

test('L-shape of six walls is one room', () => {
  const plan = planWith(
    [
      node('a', 0, 0), node('b', 4000, 0), node('c', 4000, 2000),
      node('d', 2000, 2000), node('e', 2000, 4000), node('f', 0, 4000),
    ],
    [
      wall('ab', 'a', 'b'), wall('bc', 'b', 'c'), wall('cd', 'c', 'd'),
      wall('de', 'd', 'e'), wall('ef', 'e', 'f'), wall('fa', 'f', 'a'),
    ],
  );
  const result = deriveRooms(plan, 'f1');
  assert.equal(result.normalized.walls.length, 6);
  assert.equal(result.derived.length, 1);
  assert.equal(result.derived[0].centerlineArea, 12_000_000);
  assert.equal(result.derived[0].area, 10_137_600);
});

test('two rooms sharing a 240 wall', () => {
  const plan = planWith(
    [
      node('a', 0, 0), node('b', 4000, 0), node('c', 6000, 0),
      node('d', 6000, 3000), node('e', 4000, 3000), node('f', 0, 3000),
    ],
    [
      wall('ab', 'a', 'b'), wall('bc', 'b', 'c'), wall('cd', 'c', 'd'),
      wall('de', 'd', 'e'), wall('be', 'b', 'e'), wall('ef', 'e', 'f'), wall('fa', 'f', 'a'),
    ],
  );
  const result = deriveRooms(plan, 'f1');
  assert.equal(result.derived.length, 2);
  const sum = result.derived.reduce((acc, face) => acc + face.area, 0);
  assert.equal(sum, 3760 * 2760 + 1760 * 2760);
});

test('T-junctions and an X crossing produce four 2000×2000 rooms', () => {
  const plan = planWith(
    [
      node('nw', 0, 0), node('ne', 4000, 0), node('se', 4000, 4000), node('sw', 0, 4000),
      node('w2', 0, 2000), node('e2', 4000, 2000), node('n2', 2000, 0), node('s2', 2000, 4000),
    ],
    [
      wall('n', 'nw', 'ne'), wall('e', 'ne', 'se'), wall('s', 'se', 'sw'), wall('w', 'sw', 'nw'),
      wall('h', 'w2', 'e2'), wall('v', 'n2', 's2'),
    ],
  );
  const result = deriveRooms(plan, 'f1');
  assert.equal(result.derived.length, 4);
  for (const face of result.derived) assert.equal(face.centerlineArea, 4_000_000);
  assert.ok(result.normalized.walls.some((item) => item.id.startsWith('h_')));
  assert.ok(result.normalized.walls.some((item) => item.id.startsWith('v_')));
});

test('deleting or demolishing the shared wall merges; re-adding splits at the seed', () => {
  const nodes = [
    node('a', 0, 0), node('b', 4000, 0), node('c', 6000, 0),
    node('d', 6000, 3000), node('e', 4000, 3000), node('f', 0, 3000),
  ];
  const walls = [
    wall('ab', 'a', 'b'), wall('bc', 'b', 'c'), wall('cd', 'c', 'd'),
    wall('de', 'd', 'e'), wall('be', 'b', 'e'), wall('ef', 'e', 'f'), wall('fa', 'f', 'a'),
  ];
  const rooms = [
    { id: 'big', name: '大', type: 'living', floor: 'wood', floorOffset: 0, seed: { x: 2000, y: 1500 } },
    { id: 'small', name: '小', type: 'bedroom', floor: 'wood', floorOffset: 0, seed: { x: 5000, y: 1500 } },
  ];
  const first = deriveRooms(planWith(nodes, walls, rooms), 'f1');
  assert.equal(first.derived.length, 2);
  const left = areaOf(first, '大');
  const right = areaOf(first, '小');
  assert.ok(left.centerlineArea > right.centerlineArea);

  const mergedPlan = planWith(nodes, walls.filter((item) => item.id !== 'be'), rooms);
  const merged = deriveRooms(mergedPlan, 'f1', { previousDerived: first.derived });
  assert.equal(merged.derived.length, 1);
  assert.equal(merged.rooms[0].id, 'big');
  assert.equal(merged.rooms[0].name, '大');
  assert.equal(merged.rooms[0].type, 'living');
  assert.equal(merged.derived[0].area, left.area + right.area + 2760 * 240);

  const demolished = walls.map((item) => (item.id === 'be' ? { ...item, demolished: true } : item));
  const viaFlag = deriveRooms(planWith(nodes, demolished, rooms), 'f1', { previousDerived: first.derived });
  assert.equal(viaFlag.derived.length, 1);
  assert.equal(viaFlag.rooms[0].id, 'big');
  assert.equal(viaFlag.derived[0].area, merged.derived[0].area);

  const split = deriveRooms(planWith(nodes, walls, merged.rooms), 'f1', {
    previousDerived: merged.derived,
    idGenerator: createIdGenerator('new'),
  });
  assert.equal(split.derived.length, 2);
  const kept = split.rooms.find((room) => room.id === 'big');
  const fresh = split.rooms.find((room) => room.id !== 'big');
  assert.equal(kept.name, '大');
  assert.ok(kept.seed.x < 4000);
  assert.equal(fresh.name, '房间 1');
  assert.equal(fresh.id, 'new1');
});

test('open U reports the gap and no rooms', () => {
  const plan = planWith(
    [node('a', 0, 0), node('b', 4000, 0), node('c', 4000, 3000), node('d', 0, 3000)],
    [wall('n', 'a', 'b'), wall('e', 'b', 'c'), wall('w', 'd', 'a')],
  );
  const result = deriveRooms(plan, 'f1');
  assert.equal(result.derived.length, 0);
  assert.equal(result.unclosed.gap, 4000);
  assert.equal(result.unclosed.endpoints.length, 2);
});

test('tolerance closes a 5 mm gap and leaves a 30 mm gap open', () => {
  const base = [node('a', 0, 0), node('b', 4000, 0), node('c', 4000, 3000), node('d', 0, 3000)];
  const wallsOf = (endId) => [wall('n', 'a', 'b'), wall('e', 'b', 'c'), wall('s', 'c', endId), wall('w', 'd', 'a')];
  const gap5 = planWith([...base, node('e', 5, 3000)], wallsOf('e'));
  assert.equal(deriveRooms(gap5, 'f1').derived.length, 1);
  assert.equal(getFloor(gap5, 'f1').nodes.find((item) => item.id === 'e').x, 5);

  const gap30 = planWith([...base, node('e', 30, 3000)], wallsOf('e'));
  const open = deriveRooms(gap30, 'f1');
  assert.equal(open.derived.length, 0);
  assert.equal(open.unclosed.gap, 30);
  const closed = deriveRooms(gap30, 'f1', { tolerance: 40 });
  assert.equal(closed.derived.length, 1);
});

test('near-collinear duplicates and walls under 50 mm do not add rooms', () => {
  const dup = planWith(
    [node('a', 0, 0), node('b', 4000, 0), node('c', 4000, 3000), node('d', 0, 3000), node('a2', 0, 4), node('b2', 4000, 4)],
    [wall('n', 'a', 'b'), wall('n2', 'a2', 'b2'), wall('e', 'b', 'c'), wall('s', 'c', 'd'), wall('w', 'd', 'a')],
  );
  const dupResult = deriveRooms(dup, 'f1');
  assert.equal(dupResult.derived.length, 1);
  assert.equal(dupResult.derived[0].centerlineArea, 12_000_000);

  const tiny = planWith(
    [node('a', 0, 0), node('b', 4000, 0), node('c', 4000, 3000), node('d', 0, 3000), node('p', 1000, 1000), node('q', 1030, 1000)],
    [wall('n', 'a', 'b'), wall('e', 'b', 'c'), wall('s', 'c', 'd'), wall('w', 'd', 'a'), wall('tiny', 'p', 'q', 120, { exterior: false })],
  );
  const tinyResult = deriveRooms(tiny, 'f1');
  assert.equal(tinyResult.derived.length, 1);
  assert.equal(tinyResult.normalized.walls.some((item) => item.id === 'tiny'), false);
});

test('dangling stub, diagonal room, mixed thickness, virtual separator', () => {
  const stub = planWith(
    [node('a', 0, 0), node('b', 4000, 0), node('c', 4000, 3000), node('d', 0, 3000), node('p', 2000, 1000), node('q', 2500, 1000)],
    [wall('n', 'a', 'b'), wall('e', 'b', 'c'), wall('s', 'c', 'd'), wall('w', 'd', 'a'), wall('stub', 'p', 'q', 120, { exterior: false })],
  );
  const stubResult = deriveRooms(stub, 'f1');
  assert.equal(stubResult.derived.length, 1);
  assert.equal(stubResult.derived[0].area, 10_377_600);
  assert.equal(stubResult.unclosed.endpoints.length, 2);
  assert.equal(stubResult.unclosed.gap, 500);

  const tri = planWith(
    [node('a', 0, 0), node('b', 4000, 0), node('c', 0, 3000)],
    [wall('ab', 'a', 'b'), wall('bc', 'b', 'c'), wall('ca', 'c', 'a')],
  );
  assert.equal(deriveRooms(tri, 'f1').derived[0].centerlineArea, 6_000_000);

  const mixed = planWith(
    [node('a', 0, 0), node('b', 4000, 0), node('c', 4000, 3000), node('d', 0, 3000)],
    [wall('n', 'a', 'b', 240), wall('s', 'c', 'd', 240), wall('e', 'b', 'c', 120), wall('w', 'd', 'a', 120)],
  );
  assert.equal(deriveRooms(mixed, 'f1').derived[0].area, 3880 * 2760);

  const virt = planWith(
    [node('a', 0, 0), node('m1', 2000, 0), node('b', 4000, 0), node('c', 4000, 3000), node('m2', 2000, 3000), node('d', 0, 3000)],
    [
      wall('n1', 'a', 'm1'), wall('n2', 'm1', 'b'), wall('e', 'b', 'c'),
      wall('s2', 'c', 'm2'), wall('s1', 'm2', 'd'), wall('w', 'd', 'a'),
      wall('v', 'm1', 'm2', 120, { virtual: true, exterior: false }),
    ],
  );
  const virtResult = deriveRooms(virt, 'f1');
  assert.equal(virtResult.derived.length, 2);
  for (const face of virtResult.derived) assert.equal(face.area, 1880 * 2760);
  const sum = virtResult.derived.reduce((acc, face) => acc + face.area, 0);
  assert.equal(sum, 3760 * 2760);
});

test('nested component is a hole and still emits its own room', () => {
  const plan = planWith(
    [
      node('a', 0, 0), node('b', 8000, 0), node('c', 8000, 6000), node('d', 0, 6000),
      node('e', 2000, 2000), node('f', 4000, 2000), node('g', 4000, 4000), node('h', 2000, 4000),
    ],
    [
      wall('n', 'a', 'b'), wall('e', 'b', 'c'), wall('s', 'c', 'd'), wall('w', 'd', 'a'),
      wall('in', 'e', 'f'), wall('ie', 'f', 'g'), wall('is', 'g', 'h'), wall('iw', 'h', 'e'),
    ],
  );
  const result = deriveRooms(plan, 'f1');
  assert.equal(result.derived.length, 2);
  const areas = result.derived.map((face) => face.centerlineArea).sort((a, b) => a - b);
  assert.deepEqual(areas, [4_000_000, 44_000_000]);
});

test('opening t is recomputed after a wall split', () => {
  const plan = planWith(
    [node('a', 0, 0), node('b', 4000, 0), node('c', 4000, 3000), node('d', 0, 3000), node('m', 2000, 0), node('mid', 2000, 3000)],
    [
      wall('n', 'a', 'b'), wall('e', 'b', 'c'), wall('s', 'c', 'd'), wall('w', 'd', 'a'),
      wall('stem', 'm', 'mid', 120, { exterior: false }),
    ],
    [],
    [{ id: 'o1', wall: 'n', t: 0.75, kind: 'door', width: 900, height: 2100, sill: 0, hinge: 'left', swing: 'in' }],
  );
  const result = deriveRooms(plan, 'f1');
  const opening = result.normalized.openings.find((item) => item.id === 'o1');
  assert.equal(opening.wall, 'n_2');
  assert.ok(Math.abs(opening.t - 0.5) < 1e-9);
  assert.deepEqual(result.normalized.map.n, ['n_1', 'n_2']);
});

test('face order is deterministic and floors do not affect each other', () => {
  const nodes = [node('a', 0, 0), node('b', 4000, 0), node('c', 4000, 3000), node('d', 0, 3000)];
  const forward = [wall('n', 'a', 'b'), wall('e', 'b', 'c'), wall('s', 'c', 'd'), wall('w', 'd', 'a')];
  const a = deriveRooms(planWith(nodes, forward), 'f1');
  const b = deriveRooms(planWith(nodes, [...forward].reverse()), 'f1');
  assert.equal(a.derived[0].area, b.derived[0].area);
  assert.equal(a.derived[0].centroid.x, b.derived[0].centroid.x);

  const fixture = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/two-floor-stair.json'), 'utf8'));
  const expected = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/two-floor-stair.expected.json'), 'utf8'));
  const derived = deriveAllFloors(fixture);
  for (const floorId of Object.keys(expected.floors)) {
    const got = derived[floorId];
    assert.equal(got.derived.length, expected.floors[floorId].roomCount);
    for (const row of expected.floors[floorId].rooms) {
      const face = got.derived.find((item) => item.name === row.name);
      assert.equal(face.centerlineArea, row.centerlineArea);
      assert.equal(face.area, row.netArea);
    }
  }
  const before = JSON.stringify(derived.f1);
  getFloor(fixture, 'f2').walls.pop();
  const after = deriveRooms(fixture, 'f1');
  assert.equal(JSON.stringify(after), before);
  assert.equal(floorBelow(fixture, 'f1'), null);
  assert.equal(floorAbove(fixture, 'f1').id, 'f2');
  assert.equal(floorBelow(fixture, 'f2').id, 'f1');
  assert.throws(() => deriveRooms(fixture, 'missing'), (error) => error.code === 'UNKNOWN_FLOOR');
});
