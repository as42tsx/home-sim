import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyPlan, getFloor } from '../src/model/document.js';
import { checkOpeningPlacement, openingClearance } from '../src/openings/clearance.js';

function wall(id, a, b, thickness, extra = {}) {
  return {
    id, a, b, thickness, height: null, bearing: false, exterior: false, demolished: false,
    virtual: false, finish: { left: 'p', right: 'p' }, ...extra,
  };
}

function withWalls(nodes, walls, openings) {
  const plan = createEmptyPlan({ now: 1, id: 'p', name: 't', floorId: 'f1' });
  const floor = getFloor(plan, 'f1');
  floor.nodes = nodes;
  floor.walls = walls;
  floor.openings = openings;
  return plan;
}

test('entry-like door: 1000 on 1200 between a 120 wall and a 240 wall', () => {
  const plan = withWalls(
    [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 0, y: 1200 },
      { id: 'c', x: 2000, y: 0 },
      { id: 'd', x: 2000, y: 1200 },
      { id: 'e', x: 0, y: 2400 },
    ],
    [
      wall('door', 'a', 'b', 240, { exterior: true }),
      wall('top', 'a', 'c', 120),
      wall('bot', 'b', 'd', 240),
      wall('cont', 'b', 'e', 500, { exterior: true }),
    ],
    [{ id: 'entry', wall: 'door', t: 0.5, kind: 'door', width: 1000, height: 2100, sill: 0, hinge: 'left', swing: 'in' }],
  );
  const info = openingClearance(plan, 'f1', 'entry');
  assert.equal(info.segmentLength, 1200);
  assert.equal(info.freeSpan, 1020);
  assert.equal(info.startGap, 40);
  assert.equal(info.endGap, -20);
  assert.equal(info.startIntrusion, 60);
  assert.equal(info.endIntrusion, 120);
  const codes = checkOpeningPlacement(plan, 'f1', 'entry').map((item) => item.code);
  assert.deepEqual(codes, ['OPENING_CLEARANCE']);
});

test('a centred opening on a long wall clears 100 mm', () => {
  const plan = withWalls(
    [
      { id: 'a', x: 0, y: 0 }, { id: 'b', x: 4000, y: 0 },
      { id: 'c', x: 0, y: 1000 }, { id: 'd', x: 4000, y: 1000 },
    ],
    [
      wall('host', 'a', 'b', 240),
      wall('left', 'a', 'c', 240),
      wall('right', 'b', 'd', 240),
    ],
    [{ id: 'ok', wall: 'host', t: 0.5, kind: 'door', width: 900, height: 2100, sill: 0, hinge: 'left', swing: 'in' }],
  );
  const info = openingClearance(plan, 'f1', 'ok');
  assert.equal(info.freeSpan, 3760);
  assert.equal(info.startGap, 1430);
  assert.equal(info.endGap, 1430);
  assert.deepEqual(checkOpeningPlacement(plan, 'f1', 'ok'), []);
});

test('width past the segment, a node crossing, and a virtual neighbour', () => {
  const wide = withWalls(
    [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1200, y: 0 }],
    [wall('host', 'a', 'b', 120)],
    [{ id: 'wide', wall: 'host', t: 0.5, kind: 'door', width: 1500, height: 2100, sill: 0, hinge: 'left', swing: 'in' }],
  );
  const wideCodes = checkOpeningPlacement(wide, 'f1', 'wide').map((item) => item.code).sort();
  // Wider than the segment also leaves a negative gap at both free-span ends.
  assert.deepEqual(wideCodes, ['OPENING_CLEARANCE', 'OPENING_CROSSES_NODE', 'OPENING_TOO_WIDE']);

  const cross = withWalls(
    [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1000, y: 0 }],
    [wall('host', 'a', 'b', 120)],
    [{ id: 'cross', wall: 'host', t: 0.95, kind: 'door', width: 400, height: 2100, sill: 0, hinge: 'left', swing: 'in' }],
  );
  assert.equal(openingClearance(cross, 'f1', 'cross').crossesNode, true);
  assert.ok(checkOpeningPlacement(cross, 'f1', 'cross').some((item) => item.code === 'OPENING_CROSSES_NODE'));

  const virt = withWalls(
    [
      { id: 'a', x: 0, y: 0 }, { id: 'b', x: 1000, y: 0 }, { id: 'c', x: 0, y: 800 },
    ],
    [
      wall('host', 'a', 'b', 120),
      wall('sep', 'a', 'c', 120, { virtual: true }),
    ],
    [{ id: 'tight', wall: 'host', t: 0.5, kind: 'door', width: 900, height: 2100, sill: 0, hinge: 'left', swing: 'in' }],
  );
  const info = openingClearance(virt, 'f1', 'tight');
  assert.equal(info.freeSpan, 1000);
  assert.equal(info.startGap, 50);
  assert.equal(info.endGap, 50);
  assert.deepEqual(checkOpeningPlacement(virt, 'f1', 'tight').map((item) => item.code), ['OPENING_CLEARANCE']);
});
