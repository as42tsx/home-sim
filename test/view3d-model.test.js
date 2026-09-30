import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { orientedRect } from '../src/geometry/polygon.js';
import {
  TYPE_SHAPE,
  partsForShape,
  shapeForType,
  knownShapes,
} from '../src/view3d/furniture-shapes.js';
import { enterPose, exitPose, furnitureDropMetres, easeInOut } from '../src/view3d/model/easing.js';
import { createDemandClock } from '../src/view3d/model/clock.js';
import { createSlotAllocator } from '../src/view3d/model/slots.js';
import { changedFurnitureIds } from '../src/view3d/model/furniture-diff.js';
import { splitWallPieces, wallRiseSchedule } from '../src/view3d/model/walls.js';
import { buildOpeningLeaves, leafPose } from '../src/view3d/model/openings.js';
import { partMatrix, transformPoint } from '../src/view3d/model/placement.js';
import {
  planBoundsMm,
  buildingTopMm,
  groundFloorId,
  floorStack,
  frameCamera,
  cameraPose,
} from '../src/view3d/model/bounds.js';
import { composeFloor } from '../src/view3d/model/structure.js';
import { circleHits, clipMove, resolveWalkStart, walkBasis } from '../src/view3d/model/walk.js';
import { crc32, encodePNG } from '../src/view3d/model/png.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/two-floor-stair.json'), 'utf8'));

function near(actual, expected, eps = 1e-4) {
  assert.ok(Math.abs(actual - expected) <= eps, `${actual} ≠ ${expected}`);
}

test('wall solids split around a door and a window', () => {
  const wall = {
    id: 'w',
    a: 'a',
    b: 'b',
    thickness: 200,
    height: 2800,
    exterior: true,
    virtual: false,
    demolished: false,
  };
  const nodes = new Map([
    ['a', { x: 0, y: 0 }],
    ['b', { x: 3000, y: 0 }],
  ]);
  const openings = [
    { id: 'win', wall: 'w', t: 0.25, kind: 'window', width: 600, height: 1000, sill: 900 },
    { id: 'door', wall: 'w', t: 0.7, kind: 'door', width: 800, height: 2100, sill: 0 },
  ];
  const pieces = splitWallPieces(wall, openings, nodes);
  assert.equal(pieces.length, 6);
  const roles = pieces.map((p) => p.role);
  assert.deepEqual(roles, ['side', 'sill', 'lintel', 'side', 'lintel', 'side']);
  assert.equal(pieces.filter((p) => p.role === 'sill').length, 1);
  assert.equal(pieces.filter((p) => p.role === 'lintel').length, 2);
  assert.equal(pieces.filter((p) => p.role === 'side').length, 3);
  near(pieces[0].t0, 0);
  near(pieces[0].t1, 450);
  near(pieces[0].z0, 0);
  near(pieces[0].z1, 2800);
  near(pieces[0].length, 450);
  near(pieces[0].cx, 225);
  near(pieces[0].cy, 0);
  near(pieces[0].rotDeg, 0);
  assert.equal(pieces[0].thickness, 200);
  assert.equal(pieces[0].fullHeight, 2800);
  near(pieces[1].t0, 450);
  near(pieces[1].t1, 1050);
  near(pieces[1].z0, 0);
  near(pieces[1].z1, 900);
  near(pieces[2].z0, 1900);
  near(pieces[2].z1, 2800);
  near(pieces[3].t0, 1050);
  near(pieces[3].t1, 1700);
  near(pieces[3].length, 650);
  near(pieces[4].t0, 1700);
  near(pieces[4].t1, 2500);
  near(pieces[4].z0, 2100);
  near(pieces[4].z1, 2800);
  near(pieces[4].height, 700);
  near(pieces[5].t0, 2500);
  near(pieces[5].t1, 3000);
  near(pieces[5].length, 500);
  assert.equal(pieces.some((p) => p.role === 'sill' && p.z0 === 0 && pieces.indexOf(p) === 4), false);

  const alongY = splitWallPieces(
    { ...wall, id: 'wy', a: 'a', b: 'c' },
    [],
    new Map([['a', { x: 0, y: 0 }], ['b', { x: 3000, y: 0 }], ['c', { x: 0, y: 3000 }]]),
  );
  assert.equal(alongY.length, 1);
  near(alongY[0].rotDeg, 90);
  near(alongY[0].cx, 0);
  near(alongY[0].cy, 1500);

  assert.deepEqual(splitWallPieces({ ...wall, virtual: true }, openings, nodes), []);
  assert.deepEqual(splitWallPieces({ ...wall, demolished: true }, openings, nodes), []);
  assert.deepEqual(splitWallPieces({ ...wall, a: 'missing' }, openings, nodes), []);
});

test('exterior walls are scheduled before interior walls', () => {
  const schedule = wallRiseSchedule([
    { id: 'b', exterior: false },
    { id: 'a', exterior: true },
    { id: 'c', exterior: true },
  ]);
  assert.deepEqual(schedule.map((s) => s.wallId), ['a', 'c', 'b']);
  near(schedule[0].startSec, 0.3);
  near(schedule[1].startSec, 0.32);
  near(schedule[2].startSec, 0.34);
  assert.ok(schedule[0].startSec < schedule[2].startSec);
  assert.ok(schedule.every((s) => s.riseSec > 0));
  const many = wallRiseSchedule(Array.from({ length: 40 }, (_, i) => ({ id: `w${i}`, exterior: i < 10 })));
  const last = many[many.length - 1];
  assert.ok(last.startSec + last.riseSec <= 0.75 + 1e-6);
  assert.ok(many[0].exterior);
  assert.equal(many[many.length - 1].exterior, false);
});

test('door hinge and window glass', () => {
  const wall = { id: 'w', a: 'a', b: 'b', thickness: 200, height: 2800, exterior: true };
  const nodes = new Map([['a', { x: 0, y: 0 }], ['b', { x: 3000, y: 0 }]]);
  const schedule = new Map([['w', { startSec: 0.3, riseSec: 0.16 }]]);
  const leaves = buildOpeningLeaves(wall && [wall], [
    { id: 'd', wall: 'w', t: 0.5, kind: 'door', width: 900, height: 2100, sill: 0, hinge: 'left', swing: 'in' },
    { id: 'g', wall: 'w', t: 0.2, kind: 'window', width: 600, height: 1000, sill: 900, hinge: 'left', swing: 'in' },
  ], nodes, schedule, 2800);
  assert.equal(leaves.length, 2);
  const door = leaves.find((l) => l.id === 'd');
  const glass = leaves.find((l) => l.id === 'g');
  assert.equal(door.mode, 'swing');
  assert.equal(glass.mode, 'glass');
  near(door.cx, 1500);
  near(door.hingeX, 1050);
  near(door.cy, 0);
  near(door.z0, 0);
  near(door.z1, 2100);
  near(glass.z0, 900);
  near(glass.z1, 1900);
  assert.equal(glass.thickness, 16);
  const closed = leafPose(door, false);
  near(closed.cx, door.cx);
  near(closed.cy, door.cy);
  const open = leafPose(door, true);
  assert.ok(Math.hypot(open.cx - door.cx, open.cy - door.cy) > 100);
  const virt = buildOpeningLeaves(
    [{ ...wall, virtual: true }],
    [{ id: 'd', wall: 'w', t: 0.5, kind: 'door', width: 900, height: 2100, sill: 0, hinge: 'left', swing: 'in' }],
    nodes,
    schedule,
    2800,
  );
  assert.equal(virt.length, 0);
});

test('two-floor fixture stacks by elevation and parents the stair to its start floor', () => {
  const stack = floorStack(fixture);
  assert.deepEqual(stack.map((f) => f.id), ['f1', 'f2']);
  assert.deepEqual(stack.map((f) => f.elevationM), [0, 2.9]);
  assert.equal(groundFloorId(fixture), 'f1');
  const flipped = { ...fixture, floors: [...fixture.floors].reverse() };
  assert.equal(groundFloorId(flipped), 'f1');
  const lower = composeFloor(flipped, 'f1');
  const upper = composeFloor(flipped, 'f2');
  assert.equal(lower.isGround, true);
  assert.equal(upper.isGround, false);
  assert.equal(lower.elevationM, 0);
  assert.equal(upper.elevationM, 2.9);
  assert.equal(lower.slabPolys.length, 0);
  assert.ok(upper.slabPolys.length >= 1);
  assert.equal(lower.stairs.length, 1);
  assert.equal(upper.stairs.length, 0);
  assert.equal(lower.stairs[0].id, 'st1');
  assert.equal(lower.stairs[0].boxes.length, 15);
  const top = Math.max(...lower.stairs[0].boxes.map((b) => b.z1));
  near(top, 2900, 1e-2);
  assert.ok(lower.wallPieces.length > 0);
  assert.ok(lower.wallPieces.every((p) => p.fullHeight > 0));
  assert.equal(lower.wallPieces.some((p) => p.wallId && String(p.wallId).length === 0), false);
  assert.ok(lower.rooms.length >= 1);
  assert.ok(upper.rooms.length >= 1);
  const leaves = lower.leaves.filter((l) => l.mode !== 'glass');
  assert.ok(leaves.length >= 1);
});

test('furniture diff counts one colour change as one rebuild', () => {
  const base = { id: 'a', type: 'sofa-3', cx: 1, cy: 2, w: 2100, d: 900, color: '#ABCDEF' };
  const same = { id: 'a', type: 'sofa-3', cx: 1, cy: 2, w: 2100, d: 900, h: 750, z: 0, rot: 0, color: '#abcdef' };
  assert.deepEqual(changedFurnitureIds([base], [same]), []);
  const tinted = { ...same, color: '#000000' };
  assert.deepEqual(changedFurnitureIds([base], [tinted]), ['a']);
  const moved = { ...same, cx: 5 };
  assert.deepEqual(changedFurnitureIds([base, { ...base, id: 'b' }], [moved, { ...base, id: 'b' }]), ['a']);
  const removed = changedFurnitureIds([base, { ...base, id: 'b' }], [same]);
  assert.deepEqual(removed, ['b']);
  const hosted = changedFurnitureIds([{ ...same, host: 'r1' }], [{ ...same, host: 'r2' }]);
  assert.deepEqual(hosted, ['a']);
  const added = changedFurnitureIds([same], [same, { ...same, id: 'c' }]);
  assert.deepEqual(added, ['c']);
});

test('shape table maps catalog types and caps parts', () => {
  assert.equal(shapeForType('bed-double'), 'bed');
  assert.equal(shapeForType('floor-lamp'), 'round');
  assert.equal(shapeForType('not-a-type'), 'box');
  assert.equal(shapeForType('sofa'), 'box');
  for (const [type, shape] of Object.entries(TYPE_SHAPE)) {
    assert.equal(shapeForType(type), shape);
    const parts = partsForShape(shape);
    assert.ok(parts.length >= 1 && parts.length <= 4, shape);
    assert.ok(new Set(parts.map((p) => p.material)).size <= 3, shape);
  }
  for (const shape of knownShapes()) {
    const parts = partsForShape(shape);
    assert.ok(parts.length <= 4);
    const copy = partsForShape(shape);
    copy[0].sx = -1;
    assert.notEqual(partsForShape(shape)[0].sx, -1);
  }
  assert.equal(partsForShape('nope').length, 1);
  assert.equal(partsForShape('nope')[0].geo, 'box');
  const bed = partsForShape('bed');
  assert.equal(bed.length, 4);
  assert.equal(bed[2].cz, -0.46);
});

test('instance slots reuse a free list', () => {
  const alloc = createSlotAllocator();
  assert.equal(alloc.acquire(), 0);
  assert.equal(alloc.acquire(), 1);
  assert.equal(alloc.acquire(), 2);
  alloc.release(1);
  assert.equal(alloc.freeCount, 1);
  assert.equal(alloc.acquire(), 1);
  assert.equal(alloc.acquire(), 3);
  assert.equal(alloc.highWater, 4);
  assert.equal(alloc.freeCount, 0);
});

test('demand clock stops scheduling after one second idle', () => {
  const clock = createDemandClock({ idleMs: 1000 });
  assert.equal(clock.allowsFrame(0), false);
  clock.request(0);
  assert.equal(clock.allowsFrame(0), true);
  assert.equal(clock.allowsFrame(1000), true);
  assert.equal(clock.allowsFrame(1001), false);
  assert.equal(clock.shouldScheduleNext(999), true);
  assert.equal(clock.shouldScheduleNext(1000), false);
  clock.request(5000);
  assert.equal(clock.allowsFrame(6000), true);
  assert.equal(clock.allowsFrame(6001), false);
  assert.equal(clock.shouldScheduleNext(5000), true);
});

test('camera frame follows the plan bounds', () => {
  const mini = (shift) => ({
    floors: [{
      id: 'a',
      elevation: 0,
      ceiling: 2800,
      nodes: [
        { id: 'n1', x: shift, y: 0 },
        { id: 'n2', x: shift + 4000, y: 3000 },
      ],
      walls: [],
      furniture: [],
    }],
    stairs: [],
  });
  const f0 = frameCamera(planBoundsMm(mini(0)), buildingTopMm(mini(0)));
  const f1 = frameCamera(planBoundsMm(mini(5000)), buildingTopMm(mini(5000)));
  near(f1.target.x - f0.target.x, 5, 1e-6);
  assert.ok(f0.dist > 0);
  assert.ok(f0.distTop > 0);
  const top = cameraPose(f0, 0);
  assert.ok(top.up.z < 0);
  near(top.up.y, 0);
  near(top.position.x, top.target.x);
  const end = cameraPose(f0, 1);
  near(end.up.y, 1);
  near(end.up.z, 0);
  assert.ok(end.position.z > end.target.z);
  near(end.position.x, end.target.x);
  near(end.pitchDeg, 55);
  const mid = enterPose(225, false);
  near(mid.cameraT, easeInOut(0.5));
  near(easeInOut(0.5), 0.5);
});

test('enter and exit poses', () => {
  const start = enterPose(0, false);
  near(start.cameraT, 0);
  near(start.wallTimeMs, 0);
  near(start.furnitureDropM, 0.2);
  near(start.opacity, 1);
  const mid = enterPose(450, false);
  near(mid.cameraT, 1);
  near(mid.wallTimeMs, 450);
  near(mid.furnitureDropM, 0.2);
  const done = enterPose(900, false);
  near(done.cameraT, 1);
  near(done.wallTimeMs, 900);
  near(done.furnitureDropM, 0);
  const reduced = enterPose(100, true);
  near(reduced.cameraT, 1);
  near(reduced.wallTimeMs, 900);
  near(reduced.opacity, 0.5);
  near(reduced.furnitureDropM, 0);
  const out0 = exitPose(0, false);
  near(out0.cameraT, 1);
  near(out0.wallTimeMs, 900);
  near(out0.furnitureDropM, 0);
  const out1 = exitPose(600, false);
  near(out1.cameraT, 0);
  near(out1.wallTimeMs, 0);
  let low = 1;
  for (let t = 600; t <= 900; t += 5) {
    const drop = furnitureDropMetres(t);
    assert.ok(drop <= 0.2 + 1e-9);
    assert.ok(drop >= -0.03 - 1e-9);
    if (drop < low) low = drop;
  }
  assert.ok(low < 0, 'spring overshoots');
});

test('part matrix matches the oriented rectangle', () => {
  const item = { cx: 1000, cy: 2000, w: 2000, d: 1000, h: 1000, rot: 0, z: 0 };
  const part = { geo: 'box', material: 'wood', cx: 0, cz: 0, cy: 0.5, sx: 1, sy: 1, sz: 1 };
  const m = partMatrix(item, part, 0);
  near(m[0], 2);
  near(m[5], 1);
  near(m[10], -1);
  near(m[12], 1);
  near(m[13], 0.5);
  near(m[14], 2);
  const corner = transformPoint(m, 0.5, 0.5, 0.5);
  const rect = orientedRect(1000, 2000, 2000, 1000, 0);
  const match = rect.find((p) => Math.abs(p.x - 2000) < 1e-6 && Math.abs(p.y - 1500) < 1e-6);
  assert.ok(match);
  near(corner.x, match.x / 1000);
  near(corner.z, match.y / 1000);
});

test('walk collision stops at a wall and passes a doorway', () => {
  const segments = [{
    x1: 4000, y1: 0, x2: 4000, y2: 3000, gaps: [],
  }];
  const blocked = clipMove(1000, 1500, 5000, 0, 250, segments);
  assert.ok(blocked.x <= 3750 + 0.01);
  assert.ok(blocked.x >= 3750 - 62.5 - 1);
  assert.ok(blocked.x > 3000);
  near(blocked.y, 1500);
  assert.equal(circleHits(3750, 1500, 250, segments), false);
  assert.equal(circleHits(3750.1, 1500, 250, segments), true);

  const door = [{
    x1: 0, y1: 0, x2: 4000, y2: 0,
    gaps: [{ t0: 1550, t1: 2450 }],
  }];
  assert.equal(circleHits(2000, 0, 250, door), false);
  assert.equal(circleHits(1000, 0, 250, door), true);
  assert.equal(circleHits(1700, 0, 250, door), true);
  const through = clipMove(2000, -500, 0, 1000, 250, door);
  near(through.x, 2000, 1);
  near(through.y, 500, 1);

  const basis = walkBasis({ x: 0, y: 0, z: -1 });
  near(basis.right.x, 1);
  near(basis.right.y, 0);
  near(basis.right.z, 0);
  const ahead = walkBasis({ x: 1, y: 0.2, z: 0 });
  near(ahead.forward.x, 1);
  near(ahead.forward.z, 0);
  near(ahead.right.z, 1);

  const start = resolveWalkStart(fixture, 'f2');
  assert.equal(start.floorId, 'f1');
  near(start.x, 1000);
  near(start.y, 1500);
  near(start.yaw, 0);
  near(start.elevation, 0);
  const noMarker = { ...fixture, markers: {} };
  const fallback = resolveWalkStart(noMarker, 'f1');
  assert.equal(fallback.floorId, 'f1');
  assert.ok(Number.isFinite(fallback.x) && Number.isFinite(fallback.y));
});

test('png round-trip', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const rgba = new Uint8Array([
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 255, 255,
    255, 255, 255, 255,
  ]);
  const png = encodePNG(rgba, 2, 2);
  assert.equal(png[0], 137);
  assert.equal(png[1], 80);
  assert.equal(png[2], 78);
  assert.equal(png[3], 71);
  const text = Buffer.from(png).toString('latin1');
  const idatAt = text.indexOf('IDAT');
  assert.ok(idatAt > 0);
  const len = png.readUInt32BE ? null : null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  // length sits 4 bytes before the type
  const idat = png.indexOf(0x49); // not reliable
  let offset = 8;
  let raw = null;
  while (offset + 8 <= png.length) {
    const size = view.getUint32(offset);
    const type = String.fromCharCode(png[offset + 4], png[offset + 5], png[offset + 6], png[offset + 7]);
    const data = png.subarray(offset + 8, offset + 8 + size);
    if (type === 'IDAT') raw = zlib.inflateSync(data);
    offset += 12 + size;
    if (type === 'IEND') break;
  }
  assert.ok(raw);
  assert.equal(raw[0], 0);
  assert.equal(raw[1], 255);
  assert.equal(raw[2], 0);
  assert.equal(raw[3], 0);
  assert.equal(raw[4], 255);
});

test('view3d browser modules are marked and do not statically import three', () => {
  const dir = path.join(root, 'src/view3d');
  const files = [];
  const walk = (d) => {
    for (const name of fs.readdirSync(d)) {
      const abs = path.join(d, name);
      if (fs.statSync(abs).isDirectory()) walk(abs);
      else if (name.endsWith('.js')) files.push(abs);
    }
  };
  walk(dir);
  assert.ok(files.length > 5);
  const marker = '// @browser-only';
  for (const abs of files) {
    const text = fs.readFileSync(abs, 'utf8');
    const first = text.split('\n')[0];
    assert.equal(/from\s+['"]three/.test(text), false, path.relative(root, abs));
    const browser = first === marker;
    const rel = path.relative(root, abs).replaceAll('\\', '/');
    if (rel === 'src/view3d/index.js' || rel === 'src/view3d/gl.js') {
      assert.equal(browser, true, rel);
    } else {
      assert.equal(text.includes('@browser-only'), false, rel);
    }
  }
});
