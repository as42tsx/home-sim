import assert from 'node:assert/strict';
import test from 'node:test';
import { placeRoomLabel, swingSectorBBox } from '../src/plan2d/label-place.js';

test('swing sector box covers the leaf and the hinge', () => {
  const box = swingSectorBBox(
    { x: 0, y: 0 },
    { x: 900, y: 0 },
    { x: 0, y: 900 },
  );
  assert.ok(box.minX <= 0 && box.maxX >= 900);
  assert.ok(box.minY <= 0 && box.maxY >= 900);
});

test('a room label steps off a door swing, then drops the area line', () => {
  const polygon = [
    { x: 0, y: 0 },
    { x: 4000, y: 0 },
    { x: 4000, y: 1400 },
    { x: 0, y: 1400 },
  ];
  const at = { x: 2000, y: 700 };
  const still = placeRoomLabel({
    polygon,
    at,
    swings: [],
    boxW: 80,
    boxH: 32,
    k: 0.1,
  });
  assert.deepEqual(still, { x: 2000, y: 700, nameOnly: false });
  const swing = { minX: 1500, minY: 200, maxX: 2500, maxY: 1200 };
  const placed = placeRoomLabel({
    polygon,
    at,
    swings: [swing],
    boxW: 80,
    boxH: 32,
    nameH: 16,
    k: 0.1,
  });
  assert.notEqual(placed.x, at.x);
  assert.ok(placed.x > 400 && placed.x < 3600);
  const half = (placed.nameOnly ? 16 : 32);
  const box = {
    minX: placed.x - 40 / 0.1,
    maxX: placed.x + 40 / 0.1,
    minY: placed.y - 12 / 0.1,
    maxY: placed.y + Math.max(0, half - 12) / 0.1,
  };
  const overlapW = Math.min(box.maxX, swing.maxX) - Math.max(box.minX, swing.minX);
  const overlapH = Math.min(box.maxY, swing.maxY) - Math.max(box.minY, swing.minY);
  const clear = !(overlapW > 0 && overlapH > 0);
  assert.equal(clear || placed.nameOnly, true);
});
