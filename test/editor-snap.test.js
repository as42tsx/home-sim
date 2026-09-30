import assert from 'node:assert/strict';
import test from 'node:test';
import { SNAP_PX, ORTHO_SNAP_DEG } from '../src/model/constants.js';
import { resolveSnap } from '../src/editor/snap.js';
import { formatMm } from '../src/editor/format.js';

const pxPerMm = 1;

test('endpoint snap uses the screen pixel threshold', () => {
  const nodes = [{ id: 'a', x: 0, y: 0 }];
  const inside = resolveSnap({
    origin: { x: 500, y: 0 },
    cursor: { x: SNAP_PX - 1, y: 0 },
    nodes,
    pxPerMm,
  });
  assert.equal(inside.kind, 'endpoint');
  assert.equal(inside.nodeId, 'a');
  assert.equal(inside.point.x, 0);

  const outside = resolveSnap({
    origin: { x: 500, y: 0 },
    cursor: { x: SNAP_PX + 1, y: 0 },
    nodes,
    pxPerMm,
  });
  assert.notEqual(outside.kind, 'endpoint');
});

test('orthogonal snap is ±5° and Shift disables every snap', () => {
  const origin = { x: 0, y: 0 };
  const rad = ((ORTHO_SNAP_DEG - 1) * Math.PI) / 180;
  const near = resolveSnap({
    origin,
    cursor: { x: Math.cos(rad) * 1000, y: Math.sin(rad) * 1000 },
    pxPerMm,
  });
  assert.equal(near.kind, 'ortho');
  assert.ok(Math.abs(near.point.y) < 1e-6);
  assert.ok(Math.abs(near.angle) < 1e-6 || Math.abs(near.angle - 360) < 1e-6);

  const farRad = ((ORTHO_SNAP_DEG + 1) * Math.PI) / 180;
  const far = resolveSnap({
    origin,
    cursor: { x: Math.cos(farRad) * 1000, y: Math.sin(farRad) * 1000 },
    pxPerMm,
  });
  assert.equal(far.kind, 'free');

  const shifted = resolveSnap({
    origin,
    cursor: { x: 4, y: 0 },
    nodes: [{ id: 'a', x: 0, y: 0 }],
    pxPerMm,
    shift: true,
  });
  assert.equal(shifted.kind, 'free');
  assert.equal(shifted.point.x, 4);
});

test('centerline snap projects onto the wall and loses to an endpoint', () => {
  const walls = [{ id: 'w', a: { x: 0, y: 0 }, b: { x: 2000, y: 0 } }];
  const hit = resolveSnap({
    origin: { x: 0, y: 800 },
    cursor: { x: 1000, y: 6 },
    walls,
    nodes: [],
    pxPerMm,
  });
  assert.equal(hit.kind, 'centerline');
  assert.equal(hit.point.y, 0);
  assert.equal(hit.point.x, 1000);

  const endpoint = resolveSnap({
    origin: { x: 0, y: 800 },
    cursor: { x: 4, y: 3 },
    walls,
    nodes: [{ id: 'a', x: 0, y: 0 }],
    pxPerMm,
  });
  assert.equal(endpoint.kind, 'endpoint');
  assert.equal(endpoint.nodeId, 'a');
});

test('typed length runs along the snapped direction', () => {
  const placed = resolveSnap({
    origin: { x: 0, y: 0 },
    cursor: { x: 100, y: 3 },
    pxPerMm,
    lengthMm: 3600,
  });
  assert.equal(placed.kind, 'length');
  assert.ok(Math.abs(placed.point.x - 3600) < 1e-6);
  assert.ok(Math.abs(placed.point.y) < 1e-6);
  assert.equal(placed.length, 3600);
});

test('millimetre labels use a thin space', () => {
  assert.equal(formatMm(2760), `2\u2009760`);
  assert.equal(formatMm(180), '180');
});
