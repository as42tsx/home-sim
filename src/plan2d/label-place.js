/**
 * Room-label placement.
 * World units are millimetres, y down. The label box is in screen pixels.
 * The anchor is the name baseline, centred horizontally. The area baseline
 * sits `areaGap` pixels below that (measured font gap, about 2 px of space).
 *
 * The area line is hidden only when the room's on-screen box is under 60×40 px.
 * Two-line labels (desktop, and phone before the name-only fallback) keep
 * 8 px from solid wall edges and door leaves/arcs, and 4 px from dashed
 * virtual dividers. Phone name-only keeps 4 px from all of those.
 * A desktop room that is still at least 60×40 and cannot hold the 13/12
 * two-line box steps the real font to 12/10 once, and never smaller.
 * If 12/10 still cannot keep the tiers inside the room, the label is hidden.
 * It is never parked outside the polygon, including across an open divider.
 * There is no scale transform and no glyph squeeze. Phone tries two-line,
 * then name-only at 4 px, then hides the label.
 */

import { pointInPolygon } from '../geometry/polygon.js';

export const SOLID_CLEAR = 8;
export const DIVIDER_CLEAR = 4;
export const PHONE_NAME_CLEAR = 4;
export const NAME_FONT = 13;
export const AREA_FONT = 12;
export const NAME_FONT_MIN = 12;
export const AREA_FONT_MIN = 10;

const ROOM_MIN_W = 60;
const ROOM_MIN_H = 40;
const LINE_GAP = 2;
const NAME_SCALE = NAME_FONT_MIN / NAME_FONT;
const AREA_SCALE = AREA_FONT_MIN / AREA_FONT;
const TIER_NEEDS = { solid: SOLID_CLEAR, divider: DIVIDER_CLEAR };
const PHONE_NAME_NEEDS = { solid: PHONE_NAME_CLEAR, divider: PHONE_NAME_CLEAR };

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
 * Name only when the room's on-screen box is under 60×40 px.
 * On phone, also when the two-line label cannot keep the solid/divider tiers.
 * @param {object} opts
 * @returns {boolean}
 */
export function labelNeedsNameOnly(opts) {
  return decide(opts).nameOnly;
}

/**
 * @param {object} opts
 * @param {{x:number,y:number}[]} opts.polygon room net polygon, wall faces
 * @param {{x:number,y:number}} [opts.at]
 * @param {{hinge:{x:number,y:number}, jamb:{x:number,y:number}, leaf:{x:number,y:number}}[]} [opts.swings]
 * @param {{a:{x:number,y:number}, b:{x:number,y:number}}[]} [opts.dividers] virtual-wall lines
 * @param {boolean} [opts.phone]
 * @param {number} opts.boxW full label width, screen px
 * @param {number} [opts.nameW]
 * @param {number} opts.k pixels per millimetre
 * @param {number} [opts.nameAscent]
 * @param {number} [opts.nameDescent]
 * @param {number} [opts.areaGap] pixels from the name baseline to the area baseline
 * @param {number} [opts.areaAscent]
 * @param {number} [opts.areaDescent]
 * @param {number} [opts.stepBoxW] two-line width at name 12 / area 10
 * @param {number} [opts.stepNameW]
 * @param {number} [opts.stepNameAscent]
 * @param {number} [opts.stepNameDescent]
 * @param {number} [opts.stepAreaGap]
 * @param {number} [opts.stepAreaDescent]
 * @returns {{ x: number, y: number, nameOnly: boolean, hidden: boolean, lineDy: number, fontStep: boolean }}
 */
export function placeRoomLabel(opts) {
  return decide(opts);
}

function decide(opts) {
  const at = opts.at || { x: 0, y: 0 };
  const poly = opts.polygon || [];
  const metrics = metricsOf(opts);
  if (poly.length < 3) {
    return { x: at.x, y: at.y, nameOnly: false, hidden: false, lineDy: metrics.areaGap, fontStep: false };
  }
  const k = opts.k > 0 ? opts.k : 0.05;
  const screenPoly = scalePoly(poly, k);
  const sectors = (opts.swings || []).map((swing) => sectorScreen(swing, k)).filter(Boolean);
  const dividers = scaleDividers(opts.dividers, k);
  const solidEdges = solidEdgesOf(screenPoly, dividers);
  const small = roomIsSmall(poly, k);
  const full = fullBox(metrics);
  const name = nameBox(metrics);
  if (!opts.phone) {
    if (small) {
      const found = search(screenPoly, sectors, solidEdges, dividers, name, TIER_NEEDS);
      return placed(found, k, true, false, metrics.areaGap, false);
    }
    const found = search(screenPoly, sectors, solidEdges, dividers, full, TIER_NEEDS);
    if (meets(found)) return placed(found, k, false, false, metrics.areaGap, false);
    const step = steppedMetrics(opts, metrics);
    const stepBox = fullBox(step);
    const foundStep = search(screenPoly, sectors, solidEdges, dividers, stepBox, TIER_NEEDS);
    if (meets(foundStep)) return placed(foundStep, k, false, false, step.areaGap, true);
    return placed(hideAt(foundStep, screenPoly), k, false, true, step.areaGap, false);
  }
  if (!small) {
    const found = search(screenPoly, sectors, solidEdges, dividers, full, TIER_NEEDS);
    if (meets(found)) return placed(found, k, false, false, metrics.areaGap, false);
  }
  const foundName = search(screenPoly, sectors, solidEdges, dividers, name, PHONE_NAME_NEEDS);
  const hidden = !meets(foundName);
  return placed(hidden ? hideAt(foundName, screenPoly) : foundName, k, true, hidden, metrics.areaGap, false);
}

/** A hidden label still reports a point inside the room, never across a divider. */
function hideAt(found, poly) {
  if (!found || pointInPolygon({ x: found.x, y: found.y }, poly)) return found;
  const bounds = bboxOf(poly);
  const mid = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  if (pointInPolygon(mid, poly)) return { ...found, x: mid.x, y: mid.y };
  for (let gy = 1; gy <= 7; gy += 1) {
    for (let gx = 1; gx <= 7; gx += 1) {
      const point = {
        x: bounds.minX + (bounds.maxX - bounds.minX) * (gx / 8),
        y: bounds.minY + (bounds.maxY - bounds.minY) * (gy / 8),
      };
      if (pointInPolygon(point, poly)) return { ...found, x: point.x, y: point.y };
    }
  }
  return found;
}

function meets(found) {
  return found.slack >= -1e-3;
}

function placed(found, k, nameOnly, hidden, lineDy, fontStep) {
  return {
    x: found.x / k,
    y: found.y / k,
    nameOnly,
    hidden,
    lineDy,
    fontStep: !!fontStep,
  };
}

/** Metrics for the one allowed desktop step, name 12 / area 10. */
function steppedMetrics(opts, metrics) {
  const nameAscent = num(opts.stepNameAscent, metrics.nameAscent * NAME_SCALE);
  const nameDescent = num(opts.stepNameDescent, metrics.nameDescent * NAME_SCALE);
  const areaDescent = num(opts.stepAreaDescent, metrics.areaDescent * AREA_SCALE);
  let areaGap = opts.stepAreaGap;
  if (!Number.isFinite(areaGap)) {
    const areaAscent = Math.max(0, metrics.areaGap - metrics.nameDescent - LINE_GAP);
    areaGap = nameDescent + LINE_GAP + areaAscent * AREA_SCALE;
  }
  const stepNameW = metrics.nameW * NAME_SCALE;
  const stepAreaW = Math.max(metrics.boxW, metrics.nameW) * AREA_SCALE;
  return {
    boxW: opts.stepBoxW > 0 ? opts.stepBoxW : Math.max(stepNameW, stepAreaW),
    nameW: opts.stepNameW > 0 ? opts.stepNameW : stepNameW,
    nameAscent,
    nameDescent,
    areaGap,
    areaDescent,
  };
}

function roomIsSmall(poly, k) {
  const bounds = bboxOf(poly);
  return (bounds.maxX - bounds.minX) * k < ROOM_MIN_W || (bounds.maxY - bounds.minY) * k < ROOM_MIN_H;
}

function scaleDividers(list, k) {
  const out = [];
  for (const seg of list || []) {
    const a = seg?.a;
    const b = seg?.b;
    if (!a || !b) continue;
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;
    out.push({ a: { x: a.x * k, y: a.y * k }, b: { x: b.x * k, y: b.y * k } });
  }
  return out;
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
 * Grid search in screen pixels. Score is the spare px beyond the tier
 * (solid walls and door leaves/arcs versus virtual dividers).
 * The anchor stays inside the room polygon. Nothing is placed outside.
 * @returns {{ x: number, y: number, slack: number, solid: number, divider: number }}
 */
function search(poly, sectors, solidEdges, dividers, box, needs) {
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
    const scored = scoreAt(x, y, box, poly, sectors, solidEdges, dividers, needs);
    if (!scored) return;
    const dist = Math.hypot(x - cx, y - cy);
    const better = !best
      || scored.slack > best.slack + 0.05
      || (Math.abs(scored.slack - best.slack) <= 0.05 && dist < best.dist);
    if (better) {
      best = { x, y, dist, slack: scored.slack, solid: scored.solid, divider: scored.divider };
    }
  };
  for (let y = bounds.minY + step * 0.5; y < bounds.maxY; y += step) {
    for (let x = bounds.minX + step * 0.5; x < bounds.maxX; x += step) consider(x, y);
  }
  consider(cx, cy);
  if (!best) return { x: cx, y: cy, slack: -Infinity, solid: -Infinity, divider: Infinity };
  refine(best, Math.max(1, step / 2), consider);
  refine(best, 1, consider);
  for (let y = best.y - 1; y <= best.y + 1.01; y += 0.5) {
    for (let x = best.x - 1; x <= best.x + 1.01; x += 0.5) consider(x, y);
  }
  return best;
}

function refine(best, step, consider) {
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

function scoreAt(x, y, box, poly, sectors, solidEdges, dividers, needs) {
  const rect = rectAt(x, y, box);
  const centre = { x: (rect.minX + rect.maxX) / 2, y: (rect.minY + rect.maxY) / 2 };
  if (!pointInPolygon(centre, poly)) return null;
  const solid = expansionClearance(rect, (grown) => hitsSolid(grown, solidEdges, sectors));
  const divider = dividers.length
    ? expansionClearance(rect, (grown) => hitsDivider(grown, dividers))
    : Infinity;
  const dividerSlack = Number.isFinite(divider) ? divider - needs.divider : Infinity;
  return { solid, divider, slack: Math.min(solid - needs.solid, dividerSlack) };
}

function hitsSolid(rect, edges, sectors) {
  for (const edge of edges) {
    if (segmentHitsRect(edge.a, edge.b, rect)) return true;
  }
  for (const sector of sectors) {
    if (rectHitsLeafArc(rect, sector)) return true;
  }
  return false;
}

/** The drawn leaf and its swing arc. The open wedge is not an obstacle. */
function rectHitsLeafArc(rect, sector) {
  if (segmentHitsRect(sector.hinge, sector.leaf, rect)) return true;
  if (pointInRect(sector.leaf, rect)) return true;
  if (arcHitsRect(sector, rect)) return true;
  const steps = 8;
  for (let i = 0; i <= steps; i += 1) {
    const ang = sector.a0 + sector.delta * (i / steps);
    const point = {
      x: sector.hinge.x + Math.cos(ang) * sector.r,
      y: sector.hinge.y + Math.sin(ang) * sector.r,
    };
    if (pointInRect(point, rect)) return true;
  }
  return false;
}

function hitsDivider(rect, dividers) {
  for (const seg of dividers) {
    if (segmentHitsRect(seg.a, seg.b, rect)) return true;
  }
  return false;
}

/** Polygon edges that are not the dashed virtual divider itself. */
function solidEdgesOf(poly, dividers) {
  const edges = [];
  const n = poly.length;
  for (let i = 0; i < n; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    if (onDivider(a, b, dividers)) continue;
    edges.push({ a, b });
  }
  return edges;
}

function onDivider(a, b, dividers) {
  for (const seg of dividers) {
    if (segmentsCollinearOverlap(a, b, seg.a, seg.b, 0.8)) return true;
  }
  return false;
}

function segmentsCollinearOverlap(a, b, c, d, tol) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len = Math.hypot(abx, aby);
  if (!(len > 1e-6)) return false;
  const off = (px, py) => Math.abs((px - a.x) * aby - (py - a.y) * abx) / len;
  if (off(c.x, c.y) > tol || off(d.x, d.y) > tol) return false;
  const along = (px, py) => ((px - a.x) * abx + (py - a.y) * aby) / (len * len);
  const t0 = Math.min(along(c.x, c.y), along(d.x, d.y));
  const t1 = Math.max(along(c.x, c.y), along(d.x, d.y));
  return t1 > 0.02 && t0 < 0.98;
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
