/**
 * Segment queries with an explicit tolerance (millimetres).
 */

import { cross, dist, dot, len, sub } from './vec.js';

/**
 * Unclamped projection parameter of `p` onto the infinite line through ab.
 * 0 at a, 1 at b.
 * @param {{x:number,y:number}} p
 * @param {{x:number,y:number}} a
 * @param {{x:number,y:number}} b
 */
export function projectParam(p, a, b) {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < 1e-18) return 0;
  return dot(sub(p, a), ab) / l2;
}

/**
 * Closest point on the closed segment ab.
 * @returns {{ t: number, point: {x:number,y:number}, distance: number }}
 * `t` is clamped to [0, 1].
 */
export function pointOnSegment(p, a, b) {
  const t = Math.max(0, Math.min(1, projectParam(p, a, b)));
  const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  return { t, point, distance: dist(p, point) };
}

/**
 * Intersection of segments ab and cd.
 * A hit is returned when the segments come within `tol` of a common point
 * (proper crossing, or an endpoint lying on the other segment).
 * Parallel overlaps return null; the collinear-merge pass owns those.
 * @returns {{t:number, u:number, point:{x:number,y:number}}|null}
 */
export function segmentIntersection(a, b, c, d, tol) {
  const r = sub(b, a);
  const s = sub(d, c);
  const rlen = len(r);
  const slen = len(s);
  if (rlen < 1e-9 || slen < 1e-9) return null;
  const denom = cross(r, s);
  if (Math.abs(denom) <= 1e-12 * rlen * slen) return null;
  const qp = sub(c, a);
  const t = cross(qp, s) / denom;
  const u = cross(qp, r) / denom;
  const tt = tol / rlen;
  const uu = tol / slen;
  if (t < -tt || t > 1 + tt || u < -uu || u > 1 + uu) return null;
  const tc = Math.max(0, Math.min(1, t));
  const uc = Math.max(0, Math.min(1, u));
  const point = { x: a.x + r.x * tc, y: a.y + r.y * tc };
  if (pointOnSegment(point, a, b).distance > tol + 1e-6) return null;
  if (pointOnSegment(point, c, d).distance > tol + 1e-6) return null;
  return { t: tc, u: uc, point };
}

/**
 * Perpendicular distance from p to the infinite line through a along unit `dir`.
 * `dir` must be a unit vector.
 */
export function lineDistance(p, origin, dirUnit) {
  const vx = p.x - origin.x;
  const vy = p.y - origin.y;
  return Math.abs(vx * dirUnit.y - vy * dirUnit.x);
}

/**
 * Scalar projection of p onto the line (origin, dirUnit).
 */
export function lineParam(p, origin, dirUnit) {
  return (p.x - origin.x) * dirUnit.x + (p.y - origin.y) * dirUnit.y;
}
