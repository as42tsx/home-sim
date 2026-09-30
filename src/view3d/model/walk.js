/**
 * Walk collision and the start marker.
 * The circle is tested against wall centre lines. Passable openings (doors
 * and sliding leaves, not windows) are gaps even while the leaf is shut.
 * Units are millimetres, matching the plan.
 */

import { getFloor } from '../../model/document.js';
import { deriveRooms } from '../../rooms/index.js';

const PASSABLE = new Set(['door', 'slide', 'shoji', 'fusuma', 'garage']);

/**
 * @param {object} floor
 * @returns {{x1:number,y1:number,x2:number,y2:number,gaps:{t0:number,t1:number}[]}[]}
 */
export function collisionSegments(floor) {
  const nodes = new Map((floor?.nodes || []).map((n) => [n.id, n]));
  /** @type {object[]} */
  const segs = [];
  for (const wall of floor?.walls || []) {
    if (!wall || wall.virtual || wall.demolished) continue;
    const a = nodes.get(wall.a);
    const b = nodes.get(wall.b);
    if (!a || !b) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(len > 0)) continue;
    /** @type {{t0:number,t1:number}[]} */
    const gaps = [];
    for (const op of floor.openings || []) {
      if (!op || op.wall !== wall.id || !PASSABLE.has(op.kind)) continue;
      const c = (op.t ?? 0.5) * len;
      const w = op.width || 0;
      gaps.push({ t0: c - w / 2, t1: c + w / 2 });
    }
    segs.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, gaps });
  }
  return segs;
}

function solidParts(seg) {
  const dx = seg.x2 - seg.x1;
  const dy = seg.y2 - seg.y1;
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) return [];
  const ux = dx / len;
  const uy = dy / len;
  const gaps = (seg.gaps || [])
    .map((g) => ({ t0: Math.max(0, g.t0), t1: Math.min(len, g.t1) }))
    .filter((g) => g.t1 > g.t0)
    .sort((p, q) => p.t0 - q.t0);
  /** @type {[number, number][]} */
  const spans = [];
  let cursor = 0;
  for (const g of gaps) {
    if (g.t0 > cursor) spans.push([cursor, g.t0]);
    cursor = Math.max(cursor, g.t1);
  }
  if (cursor < len) spans.push([cursor, len]);
  return spans.map(([t0, t1]) => ({
    x1: seg.x1 + ux * t0,
    y1: seg.y1 + uy * t0,
    x2: seg.x1 + ux * t1,
    y2: seg.y1 + uy * t1,
  }));
}

function dist2ToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = 0;
  if (l2 > 0) t = ((px - x1) * dx + (py - y1) * dy) / l2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const ex = px - (x1 + t * dx);
  const ey = py - (y1 + t * dy);
  return ex * ex + ey * ey;
}

/**
 * True when the circle overlaps a solid part of a wall. Touching at exactly
 * `radius` is not a hit (the limit is r² − 1e-6).
 */
export function circleHits(x, y, radius, segments) {
  const limit = radius * radius - 1e-6;
  for (const seg of segments || []) {
    for (const part of solidParts(seg)) {
      if (dist2ToSegment(x, y, part.x1, part.y1, part.x2, part.y2) < limit) return true;
    }
  }
  return false;
}

/**
 * Move `(dx, dy)` in substeps. A blocked step slides along whichever axis
 * is still free, so a glancing hit follows the wall instead of sticking.
 * @returns {{x:number, y:number}}
 */
export function clipMove(x, y, dx, dy, radius, segments) {
  const dist = Math.hypot(dx, dy);
  if (!(dist > 0)) return { x, y };
  const stepLen = Math.max(radius * 0.25, 1);
  const steps = Math.ceil(dist / stepLen);
  const sx = dx / steps;
  const sy = dy / steps;
  let cx = x;
  let cy = y;
  for (let i = 0; i < steps; i += 1) {
    const nx = cx + sx;
    const ny = cy + sy;
    if (!circleHits(nx, ny, radius, segments)) {
      cx = nx;
      cy = ny;
      continue;
    }
    if (!circleHits(nx, cy, radius, segments)) cx = nx;
    else if (!circleHits(cx, ny, radius, segments)) cy = ny;
  }
  return { x: cx, y: cy };
}

/**
 * Camera-space basis flattened onto the floor.
 * right = forward × up. forward (0, 0, −1) gives right (1, 0, 0).
 * @param {{x:number,y:number,z:number}} forward world direction
 */
export function walkBasis(forward) {
  const fx = forward.x;
  const fz = forward.z;
  const len = Math.hypot(fx, fz) || 1;
  const f = { x: fx / len, y: 0, z: fz / len };
  return {
    forward: f,
    right: { x: -f.z, y: 0, z: f.x },
  };
}

/**
 * `markers.walkStart` when that floor exists, otherwise the centroid of the
 * largest room on `floorId`.
 * @param {object} plan
 * @param {string} floorId
 */
export function resolveWalkStart(plan, floorId) {
  const marker = plan?.markers?.walkStart;
  if (marker && marker.floor && getFloor(plan, marker.floor)) {
    const floor = getFloor(plan, marker.floor);
    return {
      floorId: marker.floor,
      x: marker.x ?? 0,
      y: marker.y ?? 0,
      yaw: marker.yaw ?? 0,
      elevation: floor.elevation ?? 0,
    };
  }
  const floor = getFloor(plan, floorId);
  let best = null;
  if (floor) {
    const derived = deriveRooms(plan, floorId);
    for (const face of derived.derived || []) {
      const area = face.area || 0;
      if (!best || area > best.area) best = face;
    }
  }
  const c = best?.centroid || { x: 0, y: 0 };
  return {
    floorId,
    x: c.x,
    y: c.y,
    yaw: 0,
    elevation: floor?.elevation ?? 0,
  };
}
