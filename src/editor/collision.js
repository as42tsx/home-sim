/**
 * Furniture warnings. Overlap uses separating-axis tests on rotated
 * rectangles. Edges that only touch are not an overlap. A hit against a wall
 * footprint, or a centre that sits in no room net polygon, is also a warning.
 * Placement is never rejected by these checks.
 */

import { pointInPolygon } from '../geometry/polygon.js';

const TOUCH_MM = 0.05;

/** Corners of a furniture item. Rotation 0 keeps width on +x and depth on +y. */
export function obbCorners(item) {
  const hw = (item.w || 0) / 2;
  const hd = (item.d || 0) / 2;
  const local = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];
  const rad = ((item.rot || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return local.map(([x, y]) => ({
    x: item.cx + x * cos - y * sin,
    y: item.cy + x * sin + y * cos,
  }));
}

/** True when the polygons overlap by more than a touch. */
export function satOverlap(a, b) {
  if (!a || !b || a.length < 2 || b.length < 2) return false;
  const axes = edgeAxes(a).concat(edgeAxes(b));
  for (const axis of axes) {
    const pa = project(a, axis);
    const pb = project(b, axis);
    if (pa.max <= pb.min + TOUCH_MM || pb.max <= pa.min + TOUCH_MM) return false;
  }
  return true;
}

/**
 * @param {object[]} furniture
 * @param {{x:number,y:number}[][]} wallQuads non-virtual, non-demolished footprints
 * @param {object[]} faces derived faces (`polygon`, optional `holePolygons`)
 * @returns {Set<string>}
 */
export function warningIds(furniture, wallQuads, faces) {
  const ids = new Set();
  const list = (furniture || []).map((item) => ({ item, corners: obbCorners(item) }));
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      if (satOverlap(list[i].corners, list[j].corners)) {
        ids.add(list[i].item.id);
        ids.add(list[j].item.id);
      }
    }
    let hitWall = false;
    for (const quad of wallQuads || []) {
      if (satOverlap(list[i].corners, quad)) {
        hitWall = true;
        break;
      }
    }
    const center = { x: list[i].item.cx, y: list[i].item.cy };
    const inside = (faces || []).some((face) => pointInNet(center, face));
    if (hitWall || !inside) ids.add(list[i].item.id);
  }
  return ids;
}

function pointInNet(p, face) {
  if (!face?.polygon || !pointInPolygon(p, face.polygon)) return false;
  for (const hole of face.holePolygons || []) {
    if (pointInPolygon(p, hole)) return false;
  }
  return true;
}

function edgeAxes(corners) {
  const axes = [];
  for (let i = 0; i < corners.length; i += 1) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    axes.push({ x: -dy / len, y: dx / len });
  }
  return axes;
}

function project(corners, axis) {
  let min = Infinity;
  let max = -Infinity;
  for (const p of corners) {
    const v = p.x * axis.x + p.y * axis.y;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}
