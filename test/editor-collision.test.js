import assert from 'node:assert/strict';
import test from 'node:test';
import { firstOverlap, ignoresCollision, satOverlap, warningIds, obbCorners } from '../src/editor/collision.js';
import { snapFurnitureToWall } from '../src/editor/furniture-snap.js';
import { wallQuad } from '../src/editor/wall-shape.js';

function item(id, cx, cy, w, d, rot = 0) {
  return { id, cx, cy, w, d, rot };
}

test('axis-aligned footprints overlap, and a shared edge does not', () => {
  const a = obbCorners(item('a', 0, 0, 1000, 1000));
  const overlap = obbCorners(item('b', 500, 0, 1000, 1000));
  const touch = obbCorners(item('c', 1000, 0, 1000, 1000));
  const apart = obbCorners(item('d', 1001, 0, 1000, 1000));
  assert.equal(satOverlap(a, overlap), true);
  assert.equal(satOverlap(a, touch), false);
  assert.equal(satOverlap(a, apart), false);
});

test('rotated rectangles report a real overlap', () => {
  const a = obbCorners(item('a', 0, 0, 1000, 200, 45));
  const b = obbCorners(item('b', 0, 0, 1000, 200, -45));
  const c = obbCorners(item('c', 2000, 0, 1000, 200, 45));
  assert.equal(satOverlap(a, b), true);
  assert.equal(satOverlap(a, c), false);
});

test('warnings mark both overlapping items, wall crossings, and outsiders', () => {
  const sofa = item('sofa', 500, 500, 800, 800);
  const chair = item('chair', 700, 500, 400, 400);
  const outside = item('plant', 5000, 5000, 400, 400);
  const faces = [{
    polygon: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 2000 }, { x: 0, y: 2000 }],
    holePolygons: [],
  }];
  const quads = [wallQuad({ x: 0, y: 0 }, { x: 2000, y: 0 }, 200)];
  const ids = warningIds([sofa, chair, outside], quads, faces);
  assert.equal(ids.has('sofa'), true);
  assert.equal(ids.has('chair'), true);
  assert.equal(ids.has('plant'), true);

  const alone = warningIds([item('bed', 1000, 1000, 400, 400)], [], faces);
  assert.equal(alone.has('bed'), false);
});

test('rugs and noCollide items stay out of furniture and wall checks', () => {
  const faces = [{
    polygon: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 4000 }, { x: 0, y: 4000 }],
    holePolygons: [],
  }];
  const rug = { id: 'rug', type: 'rug', cx: 800, cy: 800, w: 2000, d: 1400, rot: 0 };
  const sofa = { id: 'sofa', type: 'sofa-3', cx: 800, cy: 800, w: 2100, d: 900, rot: 0 };
  const bed = { id: 'bed', type: 'bed-double', cx: 900, cy: 900, w: 1800, d: 2000, rot: 0 };
  const mat = { id: 'mat', noCollide: true, cx: 100, cy: 100, w: 3000, d: 3000, rot: 0 };
  assert.equal(ignoresCollision(rug), true);
  assert.equal(ignoresCollision(mat), true);
  assert.equal(ignoresCollision(sofa), false);
  const quads = [wallQuad({ x: 0, y: 0 }, { x: 4000, y: 0 }, 240)];
  const ids = warningIds([rug, sofa, bed, mat], quads, faces);
  assert.equal(ids.has('rug'), false);
  assert.equal(ids.has('mat'), false);
  assert.equal(ids.has('sofa'), true);
  assert.equal(ids.has('bed'), true);
  const pair = firstOverlap([rug, mat, sofa, bed]);
  assert.ok(pair);
  assert.equal(pair.a.type === 'rug' || pair.b.type === 'rug', false);
  assert.equal(pair.a.noCollide || pair.b.noCollide, undefined);
});

test('furniture back edge snaps onto the nearest wall face', () => {
  const walls = [{ id: 'north', a: 'a', b: 'b', thickness: 240, virtual: false, demolished: false }];
  const nodes = new Map([
    ['a', { x: 0, y: 0 }],
    ['b', { x: 4000, y: 0 }],
  ]);
  const snapped = snapFurnitureToWall(
    { cx: 2000, cy: -400, w: 1800, d: 900, rot: 10 },
    walls,
    nodes,
  );
  assert.ok(snapped);
  assert.equal(snapped.wallId, 'north');
  assert.ok(Math.abs(snapped.cx - 2000) < 1e-6);
  assert.ok(Math.abs(snapped.cy - (-120 - 450)) < 1e-6);
  assert.ok(Math.abs(Math.abs(snapped.rot) - 180) < 1e-6);
});
