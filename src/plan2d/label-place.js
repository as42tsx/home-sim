/**
 * Room-label placement that stays off door-swing sectors.
 * World units are millimetres, y down. The label box is given in screen pixels.
 */

import { pointInPolygon } from '../geometry/polygon.js';

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
 * @param {object} opts
 * @param {{x:number,y:number}[]} opts.polygon
 * @param {{x:number,y:number}} opts.at
 * @param {{minX:number,minY:number,maxX:number,maxY:number}[]} [opts.swings]
 * @param {number} opts.boxW screen pixels
 * @param {number} opts.boxH screen pixels, name plus area
 * @param {number} [opts.nameH] screen pixels when the area line is dropped
 * @param {number} opts.k pixels per millimetre
 * @returns {{ x: number, y: number, nameOnly: boolean }}
 */
export function placeRoomLabel(opts) {
  const at = opts.at || { x: 0, y: 0 };
  const swings = opts.swings || [];
  const polygon = opts.polygon || [];
  if (!swings.length || polygon.length < 3) return { x: at.x, y: at.y, nameOnly: false };
  const k = opts.k > 0 ? opts.k : 0.05;
  const boxW = opts.boxW > 0 ? opts.boxW : 48;
  const boxH = opts.boxH > 0 ? opts.boxH : 32;
  const nameH = opts.nameH > 0 ? opts.nameH : 16;
  const candidates = candidatePoints(polygon, at, swings);
  let least = null;
  let leastOverlap = Infinity;
  for (const nameOnly of [false, true]) {
    const height = nameOnly ? nameH : boxH;
    for (const point of candidates) {
      if (!pointInPolygon(point, polygon)) continue;
      const overlap = boxOverlap(point, boxW, height, k, swings);
      if (overlap <= 0) return { x: point.x, y: point.y, nameOnly };
      if (overlap < leastOverlap) {
        leastOverlap = overlap;
        least = { x: point.x, y: point.y, nameOnly: true };
      }
    }
  }
  return least || { x: at.x, y: at.y, nameOnly: true };
}

function candidatePoints(polygon, at, swings) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of polygon) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  const longX = (maxX - minX) >= (maxY - minY);
  const span = longX ? maxX - minX : maxY - minY;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const box of swings) {
    sx += (box.minX + box.maxX) / 2;
    sy += (box.minY + box.maxY) / 2;
    n += 1;
  }
  const door = n ? { x: sx / n, y: sy / n } : at;
  const away = longX ? (at.x >= door.x ? 1 : -1) : (at.y >= door.y ? 1 : -1);
  const points = [at];
  for (const fraction of [0.15, 0.28, 0.42, 0.55]) {
    const delta = span * fraction;
    points.push(shift(at, longX, away * delta));
    points.push(shift(at, longX, -away * delta));
  }
  const pole = poleOfInaccessibility(polygon, minX, minY, maxX, maxY);
  if (pole) points.push(pole);
  return points;
}

function shift(at, longX, delta) {
  return longX ? { x: at.x + delta, y: at.y } : { x: at.x, y: at.y + delta };
}

function poleOfInaccessibility(polygon, minX, minY, maxX, maxY) {
  const steps = 7;
  let best = null;
  let bestD = -1;
  for (let i = 0; i < steps; i += 1) {
    for (let j = 0; j < steps; j += 1) {
      const point = {
        x: minX + ((maxX - minX) * (i + 0.5)) / steps,
        y: minY + ((maxY - minY) * (j + 0.5)) / steps,
      };
      if (!pointInPolygon(point, polygon)) continue;
      const clearance = distanceToEdges(point, polygon);
      if (clearance > bestD) {
        bestD = clearance;
        best = point;
      }
    }
  }
  return best;
}

function distanceToEdges(point, polygon) {
  let best = Infinity;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    const dist = Math.hypot(point.x - px, point.y - py);
    if (dist < best) best = dist;
  }
  return best;
}

function boxOverlap(at, boxW, boxH, k, swings) {
  const halfW = (boxW / 2) / k;
  const above = 12 / k;
  const below = Math.max(0, boxH - 12) / k;
  const box = {
    minX: at.x - halfW,
    maxX: at.x + halfW,
    minY: at.y - above,
    maxY: at.y + below,
  };
  let area = 0;
  for (const swing of swings) {
    const w = Math.min(box.maxX, swing.maxX) - Math.max(box.minX, swing.minX);
    const h = Math.min(box.maxY, swing.maxY) - Math.max(box.minY, swing.minY);
    if (w > 0 && h > 0) area += w * h;
  }
  return area;
}
