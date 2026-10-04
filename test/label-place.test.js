import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AREA_FONT,
  AREA_FONT_MIN,
  DIVIDER_CLEAR,
  labelNeedsNameOnly,
  NAME_FONT,
  NAME_FONT_MIN,
  PHONE_NAME_CLEAR,
  placeRoomLabel,
  SOLID_CLEAR,
  swingSectorBBox,
} from '../src/plan2d/label-place.js';

const METRICS = {
  nameAscent: 15,
  nameDescent: 4,
  areaGap: 16,
  areaDescent: 3,
};

test('clearance tiers and the font floor are the Luna numbers', () => {
  assert.equal(SOLID_CLEAR, 8);
  assert.equal(DIVIDER_CLEAR, 4);
  assert.equal(PHONE_NAME_CLEAR, 4);
  assert.equal(NAME_FONT, 13);
  assert.equal(AREA_FONT, 12);
  assert.equal(NAME_FONT_MIN, 12);
  assert.equal(AREA_FONT_MIN, 10);
});

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
  assert.equal(open.fontStep, false);
  assert.equal(placed.nameOnly, false);
  assert.equal(placed.fontStep, false);
  assert.equal(placed.fitScale, undefined);
  assert.equal(labelNeedsNameOnly(base), false);
  assert.equal(labelNeedsNameOnly({ ...base, swings: [swing] }), placed.nameOnly);
  assert.ok(Math.hypot(placed.x - 2500, placed.y - 2000) > 50);
  const rect = anchorBox(placed, k, false, 80, 40);
  const pad = SOLID_CLEAR / k;
  const grown = {
    minX: rect.minX - pad,
    maxX: rect.maxX + pad,
    minY: rect.minY - pad,
    maxY: rect.maxY + pad,
  };
  for (const point of leafArcSamples(swing, 16)) {
    assert.equal(pointInRect(point, grown), false, `leaf/arc ${point.x},${point.y}`);
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
    boxW: 45,
    nameW: 30,
    k: 0.1,
    ...METRICS,
  };
  const open = placeRoomLabel({ ...base, swings: [] });
  const blocked = placeRoomLabel({ ...base, swings: [swing] });
  assert.equal(open.nameOnly, false);
  assert.equal(blocked.nameOnly, false);
  assert.equal(open.hidden, false);
  assert.equal(labelNeedsNameOnly(base), false);
  assert.equal(labelNeedsNameOnly({ ...base, swings: [swing] }), blocked.nameOnly);
});

test('a short area line stays once the room is at least 60 by 40', () => {
  const wide = rectPoly(700, 450);
  const short = {
    polygon: wide,
    at: { x: 350, y: 225 },
    boxW: 45,
    nameW: 36,
    k: 0.1,
    ...METRICS,
  };
  const kept = placeRoomLabel(short);
  assert.equal(kept.nameOnly, false);
  assert.equal(kept.hidden, false);
  assert.equal(labelNeedsNameOnly(short), false);
  const narrow = placeRoomLabel({ ...short, polygon: rectPoly(590, 450), at: { x: 295, y: 225 } });
  const flat = placeRoomLabel({ ...short, polygon: rectPoly(700, 390), at: { x: 350, y: 195 } });
  assert.equal(narrow.nameOnly, true);
  assert.equal(flat.nameOnly, true);
  assert.equal(labelNeedsNameOnly({ ...short, polygon: rectPoly(590, 400) }), true);
});

test('a virtual divider is an obstacle', () => {
  const polygon = rectPoly(4000, 3000);
  const divider = { a: { x: 2000, y: 200 }, b: { x: 2000, y: 2800 } };
  const base = {
    polygon,
    at: { x: 2000, y: 1500 },
    boxW: 40,
    nameW: 28,
    k: 0.1,
    ...METRICS,
  };
  const open = placeRoomLabel({ ...base, dividers: [] });
  const blocked = placeRoomLabel({ ...base, dividers: [divider] });
  assert.equal(open.nameOnly, false);
  assert.equal(blocked.nameOnly, false);
  assert.ok(Math.abs(open.x - 2000) < 80);
  assert.ok(Math.abs(blocked.x - 2000) > Math.abs(open.x - 2000) + 50);
  const rect = anchorBox(blocked, 0.1, false, 40, 28);
  const pad = DIVIDER_CLEAR / 0.1;
  const gap = rect.maxX <= 2000 ? 2000 - rect.maxX : rect.minX - 2000;
  assert.ok(rect.maxX <= 2000 || rect.minX >= 2000);
  assert.ok(gap >= pad - 1e-3, `divider gap ${gap}`);
  assert.equal(blocked.fontStep, false);
  assert.equal(blocked.fitScale, undefined);
});

test('a divider may be 4 px away while solid walls stay at 8', () => {
  const k = 0.1;
  const polygon = rectPoly(1120, 800);
  const divider = { a: { x: 560, y: 0 }, b: { x: 560, y: 800 } };
  const placed = placeRoomLabel({
    polygon,
    at: { x: 560, y: 400 },
    dividers: [divider],
    boxW: 40,
    nameW: 24,
    k,
    ...METRICS,
  });
  assert.equal(placed.nameOnly, false);
  assert.equal(placed.hidden, false);
  assert.equal(placed.fontStep, false);
  const rect = anchorBox(placed, k, false, 40, 24);
  const gap = rect.maxX <= 560 ? 560 - rect.maxX : rect.minX - 560;
  assert.ok(rect.maxX <= 560 || rect.minX >= 560, 'label crosses the divider');
  assert.ok(gap >= DIVIDER_CLEAR / k - 0.5, `divider gap ${gap}`);
  assert.ok(gap < SOLID_CLEAR / k - 1, `divider treated as solid, gap ${gap}`);
  const solidPad = SOLID_CLEAR / k;
  for (const corner of rectCorners(grow(rect, solidPad - 0.5))) {
    assert.equal(pointInPoly(corner, polygon), true);
  }
});

test('a desktop label that cannot clear the tiers steps to 12/10 and no further', () => {
  const k = 0.1;
  const polygon = rectPoly(900, 800);
  const full = {
    polygon,
    at: { x: 450, y: 400 },
    boxW: 80,
    nameW: 30,
    k,
    ...METRICS,
  };
  const placed = placeRoomLabel(full);
  assert.equal(placed.nameOnly, false);
  assert.equal(placed.hidden, false);
  assert.equal(placed.fontStep, true);
  assert.equal(placed.fitScale, undefined);
  assert.equal(labelNeedsNameOnly(full), false);
  const stepW = 80 * (AREA_FONT_MIN / AREA_FONT);
  const nameAscent = METRICS.nameAscent * (NAME_FONT_MIN / NAME_FONT);
  const nameDescent = METRICS.nameDescent * (NAME_FONT_MIN / NAME_FONT);
  const areaAscent = METRICS.areaGap - METRICS.nameDescent - 2;
  const areaGap = nameDescent + 2 + areaAscent * (AREA_FONT_MIN / AREA_FONT);
  const areaDescent = METRICS.areaDescent * (AREA_FONT_MIN / AREA_FONT);
  const rect = {
    minX: placed.x - (stepW / k) / 2,
    maxX: placed.x + (stepW / k) / 2,
    minY: placed.y - nameAscent / k,
    maxY: placed.y + (areaGap + areaDescent) / k,
  };
  for (const corner of rectCorners(grow(rect, (SOLID_CLEAR - 0.4) / k))) {
    assert.equal(pointInPoly(corner, polygon), true, `stepped corner ${corner.x},${corner.y}`);
  }
  const fullRect = anchorBox(placed, k, false, 80, 30);
  const fullClear = Math.min(
    fullRect.minX - 0,
    900 - fullRect.maxX,
    fullRect.minY - 0,
    800 - fullRect.maxY,
  );
  assert.ok(fullClear < (SOLID_CLEAR - 0.5) / k, `full box still clears, gap ${fullClear}`);

  const stillTight = placeRoomLabel({
    ...full,
    polygon: rectPoly(680, 500),
    at: { x: 340, y: 250 },
  });
  assert.equal(stillTight.fontStep, true);
  assert.equal(stillTight.nameOnly, false);
  assert.equal(stillTight.hidden, false);
  assert.equal(stillTight.fitScale, undefined);
});

test('a door-blocked corridor steps to 12/10 and clears the tiers on the open side', () => {
  const k = 0.056842105263157916;
  const polygon = [
    { x: 3660, y: 2760 },
    { x: 5040, y: 2760 },
    { x: 5040, y: 4200 },
    { x: 3660, y: 4200 },
  ];
  const swing = {
    hinge: { x: 5100, y: 3000 },
    jamb: { x: 5100, y: 3900 },
    leaf: { x: 4200, y: 3000 },
  };
  const placed = placeRoomLabel({
    polygon,
    at: { x: 4350, y: 3480 },
    swings: [swing],
    dividers: [{ a: { x: 3600, y: 4200 }, b: { x: 5100, y: 4200 } }],
    boxW: 50.58,
    nameW: 26.02,
    nameAscent: 15,
    nameDescent: 4,
    areaGap: 17,
    areaDescent: 3,
    stepBoxW: 42.16,
    stepNameW: 24.02,
    stepNameAscent: 14,
    stepNameDescent: 3,
    stepAreaGap: 14,
    stepAreaDescent: 2,
    k,
  });
  assert.equal(placed.fontStep, true);
  assert.equal(placed.nameOnly, false);
  assert.equal(placed.hidden, false);
  assert.equal(placed.fitScale, undefined);
  const rect = {
    minX: placed.x - (42.16 / k) / 2,
    maxX: placed.x + (42.16 / k) / 2,
    minY: placed.y - 14 / k,
    maxY: placed.y + 16 / k,
  };
  assert.ok(rect.minY >= 4200 + (DIVIDER_CLEAR - 0.35) / k, `divider side ${rect.minY}`);
  assert.ok(rect.maxY < 4200 + 900, `label wandered to ${rect.maxY}`);
  assert.ok(rect.minX > 3660 - 80 && rect.maxX < 5040 + 80, 'left the corridor opening');
  const grown = grow(rect, (SOLID_CLEAR - 0.35) / k);
  for (const point of leafArcSamples(swing, 16)) {
    assert.equal(pointInRect(point, grown), false, `leaf/arc ${point.x},${point.y}`);
  }
});

test('phone falls back from two-line at 8 px to name-only at 4 px to hidden', () => {
  const metrics = { boxW: 45, nameW: 24, k: 0.1, ...METRICS };
  const open = placeRoomLabel({
    ...metrics,
    polygon: rectPoly(3000, 2000),
    at: { x: 1500, y: 1000 },
    phone: true,
  });
  assert.equal(open.nameOnly, false);
  assert.equal(open.hidden, false);
  assert.equal(open.fontStep, false);

  const tight = {
    ...metrics,
    boxW: 70,
    nameW: 20,
    polygon: rectPoly(800, 500),
    at: { x: 400, y: 250 },
    phone: true,
  };
  const desk = placeRoomLabel({ ...tight, phone: false });
  const phone = placeRoomLabel(tight);
  assert.equal(desk.nameOnly, false);
  assert.equal(desk.hidden, false);
  assert.equal(desk.fontStep, true);
  assert.equal(desk.fitScale, undefined);
  assert.equal(phone.nameOnly, true);
  assert.equal(phone.hidden, false);
  assert.equal(phone.fontStep, false);
  const nameRect = anchorBox(phone, 0.1, true, 70, 20);
  const namePad = 4 / 0.1;
  for (const corner of rectCorners(grow(nameRect, namePad))) {
    assert.equal(pointInPoly(corner, tight.polygon), true);
  }

  const tiny = placeRoomLabel({
    ...metrics,
    boxW: 40,
    nameW: 36,
    polygon: rectPoly(200, 150),
    at: { x: 100, y: 75 },
    phone: true,
  });
  const tinyDesk = placeRoomLabel({
    ...metrics,
    boxW: 40,
    nameW: 36,
    polygon: rectPoly(200, 150),
    at: { x: 100, y: 75 },
  });
  assert.equal(tiny.nameOnly, true);
  assert.equal(tiny.hidden, true);
  assert.equal(tiny.fontStep, false);
  assert.equal(tinyDesk.nameOnly, true);
  assert.equal(tinyDesk.hidden, false);
  assert.equal(tinyDesk.fontStep, false);
});

function rectPoly(w, h) {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
}

function grow(rect, pad) {
  return {
    minX: rect.minX - pad,
    maxX: rect.maxX + pad,
    minY: rect.minY - pad,
    maxY: rect.maxY + pad,
  };
}

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

function leafArcSamples(swing, steps) {
  const a0 = Math.atan2(swing.jamb.y - swing.hinge.y, swing.jamb.x - swing.hinge.x);
  const a1 = Math.atan2(swing.leaf.y - swing.hinge.y, swing.leaf.x - swing.hinge.x);
  let delta = a1 - a0;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const r = Math.hypot(swing.leaf.x - swing.hinge.x, swing.leaf.y - swing.hinge.y);
  const points = [swing.hinge, swing.leaf];
  const stepsAlong = 8;
  for (let i = 0; i <= stepsAlong; i += 1) {
    const t = i / stepsAlong;
    points.push({
      x: swing.hinge.x + (swing.leaf.x - swing.hinge.x) * t,
      y: swing.hinge.y + (swing.leaf.y - swing.hinge.y) * t,
    });
  }
  for (let i = 0; i <= steps; i += 1) {
    const ang = a0 + delta * (i / steps);
    points.push({
      x: swing.hinge.x + Math.cos(ang) * r,
      y: swing.hinge.y + Math.sin(ang) * r,
    });
  }
  return points;
}
