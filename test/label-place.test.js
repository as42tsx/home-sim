import assert from 'node:assert/strict';
import test from 'node:test';
import { labelNeedsNameOnly, placeRoomLabel, swingSectorBBox } from '../src/plan2d/label-place.js';

const METRICS = {
  nameAscent: 15,
  nameDescent: 4,
  areaGap: 16,
  areaDescent: 3,
};

test('swing sector box covers the leaf and the hinge', () => {
  const box = swingSectorBBox(
    { x: 0, y: 0 },
    { x: 900, y: 0 },
    { x: 0, y: 900 },
  );
  assert.ok(box.minX <= 0 && box.maxX >= 900);
  assert.ok(box.minY <= 0 && box.maxY >= 900);
});

test('a centred door sector moves the label, keeps the area, and stays 8 px clear', () => {
  const polygon = [
    { x: 0, y: 0 },
    { x: 5000, y: 0 },
    { x: 5000, y: 4000 },
    { x: 0, y: 4000 },
  ];
  const k = 0.1;
  const swing = {
    hinge: { x: 2500, y: 2000 },
    jamb: { x: 3400, y: 2000 },
    leaf: { x: 2500, y: 2900 },
  };
  const base = {
    polygon,
    at: { x: 2500, y: 2000 },
    boxW: 80,
    nameW: 40,
    k,
    ...METRICS,
  };
  const open = placeRoomLabel({ ...base, swings: [] });
  const placed = placeRoomLabel({ ...base, swings: [swing] });
  assert.equal(open.nameOnly, false);
  assert.equal(placed.nameOnly, false);
  assert.equal(labelNeedsNameOnly(base), false);
  assert.equal(labelNeedsNameOnly({ ...base, swings: [swing] }), placed.nameOnly);
  assert.ok(Math.hypot(placed.x - 2500, placed.y - 2000) > 50);
  const rect = anchorBox(placed, k, false, 80, 40);
  const pad = 8 / k;
  const grown = {
    minX: rect.minX - pad,
    maxX: rect.maxX + pad,
    minY: rect.minY - pad,
    maxY: rect.maxY + pad,
  };
  for (const point of sectorSamples(swing, 16)) {
    assert.equal(pointInRect(point, grown), false, `sector point ${point.x},${point.y}`);
  }
  for (const corner of rectCorners(grown)) {
    assert.equal(pointInPoly(corner, polygon), true);
  }
});

test('a tiny room is name-only with or without a door sector', () => {
  const polygon = [
    { x: 0, y: 0 },
    { x: 500, y: 0 },
    { x: 500, y: 300 },
    { x: 0, y: 300 },
  ];
  const swing = {
    hinge: { x: 250, y: 0 },
    jamb: { x: 400, y: 0 },
    leaf: { x: 250, y: 150 },
  };
  const base = {
    polygon,
    at: { x: 250, y: 150 },
    boxW: 40,
    nameW: 24,
    k: 0.1,
    ...METRICS,
  };
  const open = placeRoomLabel({ ...base, swings: [] });
  const blocked = placeRoomLabel({ ...base, swings: [swing] });
  assert.equal(open.nameOnly, true);
  assert.equal(blocked.nameOnly, true);
  assert.equal(labelNeedsNameOnly(base), true);
});

test('the area decision follows room size, not door arcs', () => {
  const polygon = [
    { x: 0, y: 0 },
    { x: 900, y: 0 },
    { x: 900, y: 700 },
    { x: 0, y: 700 },
  ];
  const swing = {
    hinge: { x: 450, y: 0 },
    jamb: { x: 800, y: 0 },
    leaf: { x: 450, y: 350 },
  };
  const base = {
    polygon,
    at: { x: 450, y: 350 },
    boxW: 120,
    nameW: 30,
    k: 0.1,
    ...METRICS,
  };
  const open = placeRoomLabel({ ...base, swings: [] });
  const blocked = placeRoomLabel({ ...base, swings: [swing] });
  assert.equal(open.nameOnly, true);
  assert.equal(blocked.nameOnly, true);
  assert.equal(open.nameOnly, blocked.nameOnly);
});

function anchorBox(placed, k, nameOnly, boxW, nameW) {
  const w = (nameOnly ? nameW : boxW) / k;
  const above = METRICS.nameAscent / k;
  const below = (nameOnly ? METRICS.nameDescent : METRICS.areaGap + METRICS.areaDescent) / k;
  return {
    minX: placed.x - w / 2,
    maxX: placed.x + w / 2,
    minY: placed.y - above,
    maxY: placed.y + below,
  };
}

function rectCorners(rect) {
  return [
    { x: rect.minX, y: rect.minY },
    { x: rect.maxX, y: rect.minY },
    { x: rect.maxX, y: rect.maxY },
    { x: rect.minX, y: rect.maxY },
  ];
}

function pointInRect(point, rect) {
  return point.x >= rect.minX && point.x <= rect.maxX && point.y >= rect.minY && point.y <= rect.maxY;
}

function pointInPoly(point, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i];
    const b = poly[j];
    const crosses = (a.y > point.y) !== (b.y > point.y);
    if (!crosses) continue;
    const xHit = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (point.x < xHit) inside = !inside;
  }
  return inside;
}

function sectorSamples(swing, steps) {
  const a0 = Math.atan2(swing.jamb.y - swing.hinge.y, swing.jamb.x - swing.hinge.x);
  const a1 = Math.atan2(swing.leaf.y - swing.hinge.y, swing.leaf.x - swing.hinge.x);
  let delta = a1 - a0;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const r = Math.hypot(swing.leaf.x - swing.hinge.x, swing.leaf.y - swing.hinge.y);
  const points = [swing.hinge, swing.jamb, swing.leaf];
  for (let i = 0; i <= steps; i += 1) {
    const ang = a0 + delta * (i / steps);
    points.push({
      x: swing.hinge.x + Math.cos(ang) * r,
      y: swing.hinge.y + Math.sin(ang) * r,
    });
    points.push({
      x: swing.hinge.x + Math.cos(ang) * r * 0.45,
      y: swing.hinge.y + Math.sin(ang) * r * 0.45,
    });
  }
  return points;
}
