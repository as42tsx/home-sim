import assert from 'node:assert/strict';
import test from 'node:test';
import { previewOpening } from '../src/editor/opening-preview.js';
import { previewDemolish } from '../src/editor/demolish.js';
import { wallDemolishCommand } from '../src/editor/commands.js';
import { createEditorStore } from '../src/editor/store.js';
import { createEmptyPlan, getFloor } from '../src/model/document.js';

function wall(id, a, b, thickness = 240, extra = {}) {
  return {
    id, a, b, thickness, height: null, bearing: false, exterior: false, demolished: false,
    virtual: false, finish: { left: '', right: '' }, ...extra,
  };
}

function planWith(nodes, walls, rooms = [], openings = []) {
  const plan = createEmptyPlan({ now: 1, id: 'p', name: 't', floorId: 'f1' });
  const floor = getFloor(plan, 'f1');
  floor.nodes = nodes;
  floor.walls = walls;
  floor.rooms = rooms;
  floor.openings = openings;
  return plan;
}

const door = { kind: 'door', width: 900, height: 2100, sill: 0, hinge: 'left', swing: 'in' };

test('a 900 mm door is rejected on a short wall and accepted on a long one', () => {
  const plan = planWith(
    [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 4000, y: 0 },
      { id: 'c', x: 4000, y: 3000 },
      { id: 'd', x: 0, y: 3000 },
      { id: 'e', x: 0, y: 4000 },
      { id: 'f', x: 780, y: 4000 },
    ],
    [
      wall('n', 'a', 'b'),
      wall('e', 'b', 'c'),
      wall('s', 'c', 'd'),
      wall('w', 'd', 'a'),
      wall('short', 'e', 'f', 120),
    ],
  );
  const bad = previewOpening(plan, 'f1', { x: 390, y: 4000 }, door, 0.1);
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'OPENING_TOO_WIDE');
  assert.equal(bad.wallId, 'short');

  const good = previewOpening(plan, 'f1', { x: 2000, y: 0 }, door, 0.1);
  assert.equal(good.ok, true);
  assert.equal(good.wallId, 'n');
  assert.ok(good.startGap >= 100 - 1e-6);
  assert.ok(good.endGap >= 100 - 1e-6);
});

test('cursor near a wall end is pushed back inside the clearance', () => {
  const plan = planWith(
    [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 4000, y: 0 }],
    [wall('n', 'a', 'b')],
  );
  const preview = previewOpening(plan, 'f1', { x: 40, y: 0 }, door, 0.1);
  assert.equal(preview.ok, true);
  assert.ok(preview.t > 40 / 4000);
  assert.ok(preview.startGap >= 100 - 1e-6);
});

test('virtual separators reject openings', () => {
  const plan = planWith(
    [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 3000, y: 0 }],
    [wall('v', 'a', 'b', 120, { virtual: true })],
  );
  const preview = previewOpening(plan, 'f1', { x: 1500, y: 0 }, door, 0.1);
  assert.equal(preview.ok, false);
  assert.equal(preview.code, 'OPENING_ON_VIRTUAL');
});

test('demolishing the shared wall merges rooms and undo restores both names', () => {
  const nodes = [
    { id: 'a', x: 0, y: 0 }, { id: 'b', x: 4000, y: 0 }, { id: 'c', x: 6000, y: 0 },
    { id: 'd', x: 6000, y: 3000 }, { id: 'e', x: 4000, y: 3000 }, { id: 'f', x: 0, y: 3000 },
  ];
  const walls = [
    wall('ab', 'a', 'b'), wall('bc', 'b', 'c'), wall('cd', 'c', 'd'),
    wall('de', 'd', 'e'), wall('be', 'b', 'e', 240, { bearing: false }), wall('ef', 'e', 'f'), wall('fa', 'f', 'a'),
  ];
  const rooms = [
    { id: 'big', name: '大', type: 'living', floor: 'wood', floorOffset: 0, seed: { x: 2000, y: 1500 } },
    { id: 'small', name: '小', type: 'bedroom', floor: 'tile', floorOffset: 0, seed: { x: 5000, y: 1500 } },
  ];
  const plan = planWith(nodes, walls, rooms);
  const preview = previewDemolish(plan, 'f1', 'be');
  assert.equal(preview.bearing, false);
  assert.ok(Math.abs(preview.wallFootprint - 2760 * 240) < 1);
  assert.equal(preview.merged, preview.aArea + preview.bArea + preview.wallFootprint);
  assert.equal(preview.largerRoom.name, '大');

  const store = createEditorStore(plan);
  store.dispatch(wallDemolishCommand('f1', 'be'));
  const merged = store.derivation('f1');
  assert.equal(merged.derived.length, 1);
  assert.equal(merged.rooms[0].id, 'big');
  assert.equal(merged.rooms[0].name, '大');
  assert.equal(merged.rooms[0].floor, 'wood');
  store.undo();
  const floor = getFloor(store.getPlan(), 'f1');
  assert.equal(floor.walls.find((item) => item.id === 'be').demolished, false);
  assert.equal(floor.rooms.find((room) => room.id === 'big').name, '大');
  assert.equal(floor.rooms.find((room) => room.id === 'small').name, '小');
  assert.equal(floor.rooms.find((room) => room.id === 'small').floor, 'tile');
  assert.equal(store.derivation('f1').derived.length, 2);
});
