import assert from 'node:assert/strict';
import test from 'node:test';
import { renameCommand, wallAddCommand, nodesMoveCommand } from '../src/editor/commands.js';
import { createEditorStore } from '../src/editor/store.js';
import { createEmptyPlan, getFloor } from '../src/model/document.js';
import { UNDO_LIMIT } from '../src/model/constants.js';
import { validatePlan } from '../src/model/validate.js';

function rect(store, floorId) {
  const pts = [
    { x: 0, y: 0 },
    { x: 4000, y: 0 },
    { x: 4000, y: 3000 },
    { x: 0, y: 3000 },
  ];
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const floor = getFloor(store.getPlan(), floorId);
    const nodeA = floor.nodes.find((node) => node.x === a.x && node.y === a.y);
    const nodeB = floor.nodes.find((node) => node.x === b.x && node.y === b.y);
    store.dispatch(wallAddCommand(floorId, { ...a, nodeId: nodeA?.id }, { ...b, nodeId: nodeB?.id }, { thickness: 240 }));
  }
}

test('rectangle of four clicks stores one room at 10.3776 m²', () => {
  const plan = createEmptyPlan({ now: 1, id: 'p', name: '空白', floorId: 'f1' });
  const store = createEditorStore(plan);
  rect(store, 'f1');
  const floor = getFloor(store.getPlan(), 'f1');
  assert.equal(floor.walls.length, 4);
  const derived = store.derivation('f1');
  assert.equal(derived.derived.length, 1);
  assert.equal(derived.derived[0].area, 10_377_600);
  assert.equal(derived.rooms[0].name, '房间 1');
  const errors = validatePlan(store.getPlan()).filter((item) => item.severity !== 'warning');
  assert.deepEqual(errors, []);
});

test('undo and redo restore names and emit the same descriptor', () => {
  const store = createEditorStore(createEmptyPlan({ now: 1, id: 'p', name: 'N0', floorId: 'f1' }));
  const seen = [];
  store.subscribe((_plan, change) => seen.push(change));
  store.dispatch(renameCommand('N1'));
  store.dispatch(renameCommand('N2'));
  assert.equal(store.getPlan().meta.name, 'N2');
  assert.deepEqual(seen.at(-1), { kind: 'meta' });
  store.undo();
  assert.equal(store.getPlan().meta.name, 'N1');
  assert.deepEqual(seen.at(-1), { kind: 'meta' });
  store.redo();
  assert.equal(store.getPlan().meta.name, 'N2');
  assert.equal(store.canRedo(), false);
});

test('a drag transaction is one undo step and cancel drops it', () => {
  const store = createEditorStore(createEmptyPlan({ now: 1, id: 'p', name: 't', floorId: 'f1' }));
  rect(store, 'f1');
  const floor = getFloor(store.getPlan(), 'f1');
  const node = floor.nodes[0];
  const origin = { x: node.x, y: node.y };
  const before = store.historySize();
  store.begin();
  store.dispatch(nodesMoveCommand('f1', [{ id: node.id, x: origin.x + 100, y: origin.y }]));
  store.dispatch(nodesMoveCommand('f1', [{ id: node.id, x: origin.x + 200, y: origin.y }]));
  assert.equal(store.historySize(), before);
  assert.equal(store.isTransacting(), true);
  store.commit();
  assert.equal(store.historySize(), before + 1);
  store.undo();
  const restored = getFloor(store.getPlan(), 'f1').nodes.find((item) => item.id === node.id);
  assert.equal(restored.x, origin.x);

  store.begin();
  store.dispatch(nodesMoveCommand('f1', [{ id: node.id, x: origin.x + 50, y: origin.y }]));
  store.cancel();
  assert.equal(getFloor(store.getPlan(), 'f1').nodes.find((item) => item.id === node.id).x, origin.x);
  assert.equal(store.historySize(), before);
});

test('undo stack keeps the newest UNDO_LIMIT steps', () => {
  const store = createEditorStore(createEmptyPlan({ now: 1, id: 'p', name: 'N0', floorId: 'f1' }));
  const steps = UNDO_LIMIT + 5;
  for (let i = 1; i <= steps; i += 1) store.dispatch(renameCommand(`N${i}`));
  assert.equal(store.historySize(), UNDO_LIMIT);
  for (let i = 0; i < UNDO_LIMIT; i += 1) store.undo();
  assert.equal(store.canUndo(), false);
  assert.equal(store.getPlan().meta.name, 'N5');
});

test('structure descriptor survives undo', () => {
  const store = createEditorStore(createEmptyPlan({ now: 1, id: 'p', name: 't', floorId: 'f1' }));
  const kinds = [];
  store.subscribe((_plan, change) => kinds.push(change.kind));
  store.dispatch(wallAddCommand('f1', { x: 0, y: 0 }, { x: 1000, y: 0 }, { thickness: 240 }));
  assert.equal(kinds.at(-1), 'structure');
  store.undo();
  assert.equal(kinds.at(-1), 'structure');
  assert.equal(getFloor(store.getPlan(), 'f1').walls.length, 0);
});
