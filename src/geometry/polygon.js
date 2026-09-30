/**
 * Polygon helpers in plan space (x right, y down).
 * A ring does not repeat its first point.
 * Positive signed area means the ring is clockwise on screen, which is the
 * orientation room faces use (interior on the right of each edge).
 */

import { dist } from './vec.js';

/** @param {{x:number,y:number}[]} ring */
export function signedArea(ring) {
  const n = ring.length;
  if (n < 3) return 0;
  let a = 0;
  for (let i = 0; i < n; i += 1) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Absolute area in mm². */
export function ringArea(ring) {
  return Math.abs(signedArea(ring));
}

/**
 * Area centroid. Falls back to the vertex average for a degenerate ring.
 * @param {{x:number,y:number}[]} ring
 */
export function centroid(ring) {
  const n = ring.length;
  if (n === 0) return { x: 0, y: 0 };
  let acc = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i += 1) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    const cross = p.x * q.y - q.x * p.y;
    acc += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  const area = acc / 2;
  if (Math.abs(area) < 1e-6) {
    let sx = 0;
    let sy = 0;
    for (const p of ring) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / n, y: sy / n };
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

/**
 * Even-odd point-in-polygon. Boundary points return false so a seed sitting
 * on a shared wall is not claimed by both faces; callers that need a
 * guaranteed interior point use {@link interiorPointOfRing}.
 * @param {{x:number,y:number}} p
 * @param {{x:number,y:number}[]} ring
 */
export function pointInPolygon(p, ring) {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    const crosses = (a.y > p.y) !== (b.y > p.y);
    if (!crosses) continue;
    const xHit = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (p.x < xHit) inside = !inside;
  }
  return inside;
}

/**
 * @param {{x:number,y:number}} p
 * @param {{ centerline: {x:number,y:number}[], holes?: {x:number,y:number}[][] }} face
 */
export function pointInFace(p, face) {
  if (!pointInPolygon(p, face.centerline)) return false;
  const holes = face.holes || [];
  for (const hole of holes) {
    if (pointInPolygon(p, hole)) return false;
  }
  return true;
}

/** @param {{x:number,y:number}[]} ring */
export function bboxOf(ring) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Axis-aligned rectangle, clockwise in y-down space.
 * @returns {{x:number,y:number}[]}
 */
export function rectPolygon(x, y, w, h) {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

/**
 * Rectangle centred on (cx, cy). `w` runs along `rotDeg` (0 = +x, 90 = +y).
 * `d` runs to the left of that direction.
 */
export function orientedRect(cx, cy, w, d, rotDeg) {
  const th = (rotDeg * Math.PI) / 180;
  const dx = Math.cos(th);
  const dy = Math.sin(th);
  const lx = Math.sin(th);
  const ly = -Math.cos(th);
  const hw = w / 2;
  const hd = d / 2;
  const corner = (su, sv) => ({
    x: cx + dx * su * hw + lx * sv * hd,
    y: cy + dy * su * hw + ly * sv * hd,
  });
  return [corner(-1, 1), corner(1, 1), corner(1, -1), corner(-1, -1)];
}

function intersectOffsetLines(a, b) {
  const denom = a.dx * b.dy - a.dy * b.dx;
  const al = Math.hypot(a.dx, a.dy) || 1;
  const bl = Math.hypot(b.dx, b.dy) || 1;
  if (Math.abs(denom) <= 1e-10 * al * bl) return null;
  const ox = b.px - a.px;
  const oy = b.py - a.py;
  const s = (ox * b.dy - oy * b.dx) / denom;
  return { x: a.px + s * a.dx, y: a.py + s * a.dy };
}

/**
 * Drop consecutive duplicates and vertices that sit on the straight line
 * between their neighbours. A perpendicular thickness step is kept.
 * @param {{x:number,y:number}[]} pts
 */
export function stripCollinear(pts) {
  if (pts.length <= 3) return pts.map((p) => ({ x: p.x, y: p.y }));
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i += 1) {
    const a = pts[(i + n - 1) % n];
    const b = pts[i];
    const c = pts[(i + 1) % n];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const bcx = c.x - b.x;
    const bcy = c.y - b.y;
    const ab = Math.hypot(abx, aby);
    const bc = Math.hypot(bcx, bcy);
    if (ab < 1e-6) continue;
    const cross = abx * bcy - aby * bcx;
    if (Math.abs(cross) <= 1e-4 * (ab + bc + 1)) continue;
    out.push({ x: b.x, y: b.y });
  }
  return out.length >= 3 ? out : pts.map((p) => ({ x: p.x, y: p.y }));
}

/**
 * Offset each edge of a clockwise (y-down) ring toward its right by `distances[i]`.
 * That is inward for a room face. Pass a negative distance to move an edge outward
 * (used to grow a hole by half a wall thickness).
 *
 * Collinear joints with the same distance collapse to one vertex.
 * Collinear joints with different distances become a perpendicular step.
 * Miters longer than 8× the local offset are replaced by a bevel.
 *
 * @param {{x:number,y:number}[]} ring
 * @param {number[]} distances per-edge, same order as the ring
 * @returns {{x:number,y:number}[]}
 */
export function offsetInward(ring, distances) {
  const n = ring.length;
  if (n < 3) return ring.map((p) => ({ x: p.x, y: p.y }));
  const lines = [];
  for (let i = 0; i < n; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const edgeLen = Math.hypot(dx, dy) || 1;
    // Right-hand normal of travel. For a clockwise y-down ring this points
    // into the room: direction (1, 0) → normal (0, 1).
    const nx = -dy / edgeLen;
    const ny = dx / edgeLen;
    const d = distances[i] || 0;
    lines.push({
      px: a.x + nx * d,
      py: a.y + ny * d,
      dx,
      dy,
      nx,
      ny,
      d,
    });
  }
  const raw = [];
  for (let i = 0; i < n; i += 1) {
    const prev = lines[(i + n - 1) % n];
    const cur = lines[i];
    const vertex = ring[i];
    const hit = intersectOffsetLines(prev, cur);
    const bevel = () => {
      raw.push({ x: vertex.x + prev.nx * prev.d, y: vertex.y + prev.ny * prev.d });
      const q = { x: vertex.x + cur.nx * cur.d, y: vertex.y + cur.ny * cur.d };
      if (dist(q, raw[raw.length - 1]) > 1e-6) raw.push(q);
    };
    if (!hit) {
      bevel();
      continue;
    }
    const limit = 8 * Math.max(Math.abs(prev.d), Math.abs(cur.d), 1);
    if (Math.hypot(hit.x - vertex.x, hit.y - vertex.y) > limit) {
      bevel();
    } else {
      raw.push(hit);
    }
  }
  return stripCollinear(raw);
}

/**
 * A point that is strictly inside `ring` when the ring is a simple room.
 * Prefers the centroid, then a point nudged in from the middle of an edge.
 * @param {{x:number,y:number}[]} ring clockwise y-down
 * @param {{x:number,y:number}[][]} [holes]
 */
export function interiorPointOfRing(ring, holes = []) {
  const face = { centerline: ring, holes };
  const c = centroid(ring);
  if (pointInFace(c, face)) return { x: c.x, y: c.y };
  const n = ring.length;
  for (let i = 0; i < n; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const edgeLen = Math.hypot(dx, dy) || 1;
    const nx = -dy / edgeLen;
    const ny = dx / edgeLen;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    for (const step of [50, 20, 100, 200, 5]) {
      const p = { x: mid.x + nx * step, y: mid.y + ny * step };
      if (pointInFace(p, face)) return p;
    }
  }
  return { x: c.x, y: c.y };
}
