/**
 * Room-label placement.
 * World units are millimetres, y down. The label box is in screen pixels.
 * The anchor is the name baseline, centred horizontally. The area baseline
 * sits `areaGap` pixels below that (16 at the desktop 13/12 sizes).
 *
 * Whether the area line is shown depends only on the room's on-screen size,
 * never on door swings. Swings only move the label.
 */

import { pointInPolygon } from '../geometry/polygon.js';

const CLEARANCE = 8;

/**
 * Axis-aligned bounds of a door leaf and its swing arc.
 * @param {{x:number,y:number}} hinge
 * @param {{x:number,y:number}} jamb
 * @param {{x:number,y:number}} leaf
 */
export function swingSectorBBox(hinge, jamb, leaf) {
  const r = Math.hypot(jamb.x - hinge.x, jamb.y - hinge.y)
    || Math.hypot(leaf.x - hinge.x, leaf.y - hinge.y);
  const a0 = Math.atan2(jamb.y - hinge.y, jamb.x - hinge.x);
  const a1 = Math.atan2(leaf.y - hinge.y, leaf.x - hinge.x);
  let delta = a1 - a0;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const points = [hinge, jamb, leaf];
  for (const card of [0, Math.PI / 2, Math.PI, -Math.PI / 2, Math.PI * 2]) {
    let along = card - a0;
    while (along > Math.PI) along -= Math.PI * 2;
    while (along < -Math.PI) along += Math.PI * 2;
    const onArc = delta >= 0
      ? along >= -1e-6 && along <= delta + 1e-6
      : along <= 1e-6 && along >= delta - 1e-6;
    if (!onArc) continue;
    points.push({
      x: hinge.x + Math.cos(card) * r,
      y: hinge.y + Math.sin(card) * r,
    });
  }
  for (let step = 1; step < 4; step += 1) {
    const ang = a0 + delta * (step / 4);
    points.push({
      x: hinge.x + Math.cos(ang) * r,
      y: hinge.y + Math.sin(ang) * r,
    });
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Name only when the room's on-screen box is under ~60×40 px, or when the
 * two-line label cannot keep 8 px from the walls anywhere inside it.
 * Door swings are not an input: they move the label, they do not hide the area.
 * @param {object} opts
 * @returns {boolean}
 */
export function labelNeedsNameOnly(opts) {
  const poly = opts.polygon || [];
  if (poly.length < 3) return false;
  const k = opts.k > 0 ? opts.k : 0.05;
  const bounds = bboxOf(poly);
  const width = (bounds.maxX - bounds.minX) * k;
  const height = (bounds.maxY - bounds.minY) * k;
  if (width < 60 || height < 40) return true;
  const metrics = metricsOf(opts);
  const box = fullBox(metrics);
  if (width < box.w + CLEARANCE * 2 || height < box.above + box.below + CLEARANCE * 2) return true;
  const found = search(scalePoly(poly, k), [], box);
  return found.clearance < CLEARANCE - 1e-3;
}

/**
 * @param {object} opts
 * @param {{x:number,y:number}[]} opts.polygon room net polygon, wall faces
 * @param {{x:number,y:number}} [opts.at]
 * @param {{hinge:{x:number,y:number}, jamb:{x:number,y:number}, leaf:{x:number,y:number}}[]} [opts.swings]
 * @param {number} opts.boxW full label width, screen px
 * @param {number} [opts.nameW]
 * @param {number} opts.k pixels per millimetre
 * @param {number} [opts.nameAscent]
 * @param {number} [opts.nameDescent]
 * @param {number} [opts.areaGap] pixels from the name baseline to the area baseline
 * @param {number} [opts.areaAscent]
 * @param {number} [opts.areaDescent]
 * @returns {{ x: number, y: number, nameOnly: boolean, lineDy: number }}
 */
export function placeRoomLabel(opts) {
  const at = opts.at || { x: 0, y: 0 };
  const poly = opts.polygon || [];
  const metrics = metricsOf(opts);
  if (poly.length < 3) {
    return { x: at.x, y: at.y, nameOnly: false, lineDy: metrics.areaGap };
  }
  const nameOnly = labelNeedsNameOnly(opts);
  const k = opts.k > 0 ? opts.k : 0.05;
  const sectors = (opts.swings || []).map((swing) => sectorScreen(swing, k)).filter(Boolean);
  const box = nameOnly ? nameBox(metrics) : fullBox(metrics);
  const found = search(scalePoly(poly, k), sectors, box);
  return {
    x: found.x / k,
    y: found.y / k,
    nameOnly,
    lineDy: metrics.areaGap,
  };
}

function metricsOf(opts) {
  const boxW = opts.boxW > 0 ? opts.boxW : 48;
  return {
    boxW,
    nameW: opts.nameW > 0 ? opts.nameW : Math.min(boxW, 36),
    nameAscent: num(opts.nameAscent, 15),
    nameDescent: num(opts.nameDescent, 4),
    areaGap: num(opts.areaGap, 16),
    areaDescent: num(opts.areaDescent, 3),
  };
}

function num(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function fullBox(metrics) {
  return {
    w: metrics.boxW,
    above: metrics.nameAscent,
    below: metrics.areaGap + metrics.areaDescent,
  };
}

function nameBox(metrics) {
  return {
    w: metrics.nameW,
    above: metrics.nameAscent,
    below: metrics.nameDescent,
  };
}

function scalePoly(poly, k) {
  return poly.map((point) => ({ x: point.x * k, y: point.y * k }));
}

function sectorScreen(swing, k) {
  if (!swing?.hinge || !swing?.jamb || !swing?.leaf) return null;
  const hinge = { x: swing.hinge.x * k, y: swing.hinge.y * k };
  const jamb = { x: swing.jamb.x * k, y: swing.jamb.y * k };
  const leaf = { x: swing.leaf.x * k, y: swing.leaf.y * k };
  const r = Math.hypot(leaf.x - hinge.x, leaf.y - hinge.y)
    || Math.hypot(jamb.x - hinge.x, jamb.y - hinge.y);
  if (!(r > 0)) return null;
  const a0 = Math.atan2(jamb.y - hinge.y, jamb.x - hinge.x);
  const a1 = Math.atan2(leaf.y - hinge.y, leaf.x - hinge.x);
  let delta = a1 - a0;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return { hinge, jamb, leaf, r, a0, delta };
}

function bboxOf(poly) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of poly) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Grid search in screen pixels. Score is the L∞ clearance of the label box
 * (how far it can grow before it hits a wall edge or a door sector).
 * @returns {{ x: number, y: number, clearance: number }}
 */
function search(poly, sectors, box) {
  const bounds = bboxOf(poly);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  let step = 6;
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY - bounds.minY);
  if (spanX / step > 56) step = spanX / 56;
  if (spanY / step > 56) step = Math.max(step, spanY / 56);
  let best = null;
  const consider = (x, y) => {
    const clearance = scoreAt(x, y, box, poly, sectors);
    if (clearance == null) return;
    const dist = Math.hypot(x - cx, y - cy);
    if (!best || clearance > best.clearance + 0.05 || (Math.abs(clearance - best.clearance) <= 0.05 && dist < best.dist)) {
      best = { x, y, clearance, dist };
    }
  };
  for (let y = bounds.minY + step * 0.5; y < bounds.maxY; y += step) {
    for (let x = bounds.minX + step * 0.5; x < bounds.maxX; x += step) consider(x, y);
  }
  consider(cx, cy);
  if (!best) return { x: cx, y: cy, clearance: -Infinity };
  refine(best, box, poly, sectors, Math.max(1, step / 2), consider);
  refine(best, box, poly, sectors, 1, consider);
  for (let y = best.y - 1; y <= best.y + 1.01; y += 0.5) {
    for (let x = best.x - 1; x <= best.x + 1.01; x += 0.5) consider(x, y);
  }
  return best;
}

function refine(best, box, poly, sectors, step, consider) {
  const reach = Math.max(step * 2, 4);
  for (let y = best.y - reach; y <= best.y + reach + 1e-6; y += step) {
    for (let x = best.x - reach; x <= best.x + reach + 1e-6; x += step) consider(x, y);
  }
}

function rectAt(x, y, box) {
  return {
    minX: x - box.w / 2,
    maxX: x + box.w / 2,
    minY: y - box.above,
    maxY: y + box.below,
  };
}

function scoreAt(x, y, box, poly, sectors) {
  const rect = rectAt(x, y, box);
  const centre = { x: (rect.minX + rect.maxX) / 2, y: (rect.minY + rect.maxY) / 2 };
  if (!pointInPolygon(centre, poly)) return null;
  return expansionClearance(rect, (grown) => hits(grown, poly, sectors));
}

function hits(rect, poly, sectors) {
  if (rectHitsPoly(rect, poly)) return true;
  for (const sector of sectors) {
    if (rectHitsSector(rect, sector)) return true;
  }
  return false;
}

function expansionClearance(rect, hitTest) {
  if (!hitTest(rect)) {
    let lo = 0;
    let hi = 4;
    while (hi < 280 && !hitTest(expand(rect, hi))) hi *= 2;
    for (let i = 0; i < 12; i += 1) {
      const mid = (lo + hi) / 2;
      if (hitTest(expand(rect, mid))) hi = mid;
      else lo = mid;
    }
    return lo;
  }
  const shrink = Math.min(rect.maxX - rect.minX, rect.maxY - rect.minY) / 2;
  let lo = -shrink;
  let hi = 0;
  for (let i = 0; i < 12; i += 1) {
    const mid = (lo + hi) / 2;
    if (hitTest(expand(rect, mid))) hi = mid;
    else lo = mid;
  }
  return lo;
}

function expand(rect, pad) {
  return {
    minX: rect.minX - pad,
    maxX: rect.maxX + pad,
    minY: rect.minY - pad,
    maxY: rect.maxY + pad,
  };
}

function rectHitsPoly(rect, poly) {
  const corners = rectCorners(rect);
  for (const corner of corners) {
    if (!pointInPolygon(corner, poly)) return true;
  }
  const n = poly.length;
  for (let i = 0; i < n; i += 1) {
    if (segmentHitsRect(poly[i], poly[(i + 1) % n], rect)) return true;
  }
  return false;
}

function rectHitsSector(rect, sector) {
  const corners = rectCorners(rect);
  for (const corner of corners) {
    if (pointInSector(corner, sector)) return true;
  }
  if (pointInRect(sector.hinge, rect) || pointInRect(sector.jamb, rect) || pointInRect(sector.leaf, rect)) return true;
  if (segmentHitsRect(sector.hinge, sector.jamb, rect)) return true;
  if (segmentHitsRect(sector.hinge, sector.leaf, rect)) return true;
  if (arcHitsRect(sector, rect)) return true;
  const centre = { x: (rect.minX + rect.maxX) / 2, y: (rect.minY + rect.maxY) / 2 };
  return pointInSector(centre, sector);
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

function pointInSector(point, sector) {
  const dx = point.x - sector.hinge.x;
  const dy = point.y - sector.hinge.y;
  if (dx * dx + dy * dy > (sector.r + 1e-3) * (sector.r + 1e-3)) return false;
  if (dx * dx + dy * dy <= 1e-8) return true;
  return angleOnSweep(Math.atan2(dy, dx), sector.a0, sector.delta);
}

function angleOnSweep(angle, a0, delta) {
  let along = angle - a0;
  while (along > Math.PI) along -= Math.PI * 2;
  while (along < -Math.PI) along += Math.PI * 2;
  if (delta >= 0) return along >= -1e-4 && along <= delta + 1e-4;
  return along <= 1e-4 && along >= delta - 1e-4;
}

function arcHitsRect(sector, rect) {
  const edges = [
    [{ x: rect.minX, y: rect.minY }, { x: rect.maxX, y: rect.minY }],
    [{ x: rect.maxX, y: rect.minY }, { x: rect.maxX, y: rect.maxY }],
    [{ x: rect.maxX, y: rect.maxY }, { x: rect.minX, y: rect.maxY }],
    [{ x: rect.minX, y: rect.maxY }, { x: rect.minX, y: rect.minY }],
  ];
  for (const [a, b] of edges) {
    for (const hit of circleSegmentHits(sector.hinge, sector.r, a, b)) {
      if (angleOnSweep(Math.atan2(hit.y - sector.hinge.y, hit.x - sector.hinge.x), sector.a0, sector.delta)) {
        return true;
      }
    }
  }
  return false;
}

function circleSegmentHits(origin, radius, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const fx = a.x - origin.x;
  const fy = a.y - origin.y;
  const A = dx * dx + dy * dy;
  if (A < 1e-12) return [];
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - radius * radius;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return [];
  const root = Math.sqrt(disc);
  const hits = [];
  for (const t of [(-B - root) / (2 * A), (-B + root) / (2 * A)]) {
    if (t >= -1e-6 && t <= 1 + 1e-6) hits.push({ x: a.x + dx * t, y: a.y + dy * t });
  }
  return hits;
}

function segmentHitsRect(a, b, rect) {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - rect.minX, rect.maxX - a.x, a.y - rect.minY, rect.maxY - a.y];
  for (let i = 0; i < 4; i += 1) {
    if (Math.abs(p[i]) < 1e-12) {
      if (q[i] < -1e-6) return false;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else if (t < t0) return false;
      else if (t < t1) t1 = t;
    }
  }
  return t0 <= t1;
}
