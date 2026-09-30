/**
 * 2D vectors. Plan space is x → right, y → down, unit millimetre.
 * @typedef {{x:number, y:number}} Pt
 */

/** @param {Pt} a @param {Pt} b */
export function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

/** @param {Pt} a @param {Pt} b */
export function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

/** @param {Pt} a @param {number} s */
export function scale(a, s) {
  return { x: a.x * s, y: a.y * s };
}

/** @param {Pt} a @param {Pt} b */
export function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

/** z-component of the 3D cross product. Positive when b is clockwise from a in y-down space. */
export function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

/** @param {Pt} a */
export function len(a) {
  return Math.hypot(a.x, a.y);
}

/** @param {Pt} a @param {Pt} b */
export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** @param {Pt} a @param {Pt} b @param {number} t */
export function lerp(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** @param {Pt} a */
export function unit(a) {
  const l = len(a);
  if (l < 1e-12) return { x: 0, y: 0 };
  return { x: a.x / l, y: a.y / l };
}

/** @param {Pt} a @param {Pt} b @param {number} [tol] */
export function eq(a, b, tol = 1e-6) {
  return Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;
}
