/**
 * Transition clocks. Wall time, not frame count: a slow GPU still finishes
 * the 900 ms enter and the 600 ms exit.
 */

import { DROP_M } from './constants.js';

export function clamp(t, a, b) {
  if (t < a) return a;
  if (t > b) return b;
  return t;
}

/** Smoothstep, ease in and out. */
export function easeInOut(t) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** Ease out cubic. */
export function easeOutCubic(t) {
  const x = clamp(t, 0, 1);
  return 1 - (1 - x) ** 3;
}

/**
 * CSS cubic-bezier(x1, y1, x2, y2) evaluated at time `t` in 0..1.
 * y may leave 0..1 (the furniture spring does).
 */
export function bezierEase(x1, y1, x2, y2, t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (u) => ((ax * u + bx) * u + cx) * u;
  const sampleY = (u) => ((ay * u + by) * u + cy) * u;
  const sampleDX = (u) => (3 * ax * u + 2 * bx) * u + cx;
  let u = t;
  for (let i = 0; i < 8; i += 1) {
    const x = sampleX(u) - t;
    const dx = sampleDX(u);
    if (Math.abs(dx) < 1e-6) break;
    u -= x / dx;
  }
  if (u < 0) u = 0;
  if (u > 1) u = 1;
  return sampleY(u);
}

/**
 * Height above the rest pose, in metres. 200 mm until 600 ms, then a spring
 * into place by 900 ms. Overshoot is clamped so items do not sink through the floor.
 * @param {number} elapsedMs
 */
export function furnitureDropMetres(elapsedMs) {
  if (elapsedMs < 600) return DROP_M;
  if (elapsedMs >= 900) return 0;
  const s = bezierEase(0.34, 1.56, 0.64, 1, (elapsedMs - 600) / 300);
  const drop = DROP_M * (1 - s);
  if (drop > DROP_M) return DROP_M;
  if (drop < -0.03) return -0.03;
  return drop;
}

/**
 * Pose of a 2D → 3D enter.
 * @param {number} elapsedMs
 * @param {boolean} reduced
 */
export function enterPose(elapsedMs, reduced) {
  if (reduced) {
    return {
      cameraT: 1,
      wallTimeMs: 900,
      furnitureDropM: 0,
      opacity: clamp(elapsedMs / 200, 0, 1),
    };
  }
  const e = Math.max(0, elapsedMs);
  return {
    cameraT: easeInOut(clamp(e / 450, 0, 1)),
    wallTimeMs: Math.min(e, 900),
    furnitureDropM: furnitureDropMetres(e),
    opacity: 1,
  };
}

/**
 * Pose of a 3D → 2D exit. Furniture does not replay its landing; it is
 * already down. Camera and walls run backward over 600 ms.
 * @param {number} elapsedMs
 * @param {boolean} reduced
 */
export function exitPose(elapsedMs, reduced) {
  if (reduced) {
    return {
      cameraT: 1,
      wallTimeMs: 900,
      furnitureDropM: 0,
      opacity: 1 - clamp(elapsedMs / 200, 0, 1),
    };
  }
  const u = clamp(elapsedMs / 600, 0, 1);
  const eased = easeInOut(u);
  return {
    cameraT: 1 - eased,
    wallTimeMs: 900 * (1 - eased),
    furnitureDropM: 0,
    opacity: 1,
  };
}
