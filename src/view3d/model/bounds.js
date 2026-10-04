/**
 * Building bounds and the bird's-eye camera, both taken from the plan.
 * Nothing here assumes a particular apartment size.
 */

import { floorsByElevation } from '../../model/document.js';
import { orientedRect } from '../../geometry/polygon.js';
import { wallFootprint } from '../../slab/slab.js';
import { stairFootprint } from '../../stairs/stairs.js';
import { clamp } from './easing.js';

/**
 * Axis-aligned plan bounds in millimetres, padded by 200 mm.
 * The centre is the centre of the data; padding is applied on both sides.
 * @param {object} plan
 */
export function planBoundsMm(plan) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const floor of plan?.floors || []) {
    const nodes = new Map((floor.nodes || []).map((n) => [n.id, n]));
    for (const node of floor.nodes || []) add(node.x, node.y);
    for (const wall of floor.walls || []) {
      if (wall.virtual || wall.demolished) continue;
      const a = nodes.get(wall.a);
      const b = nodes.get(wall.b);
      if (!a || !b) continue;
      const foot = wallFootprint(a, b, wall.thickness || 0);
      if (!foot) continue;
      for (const p of foot) add(p.x, p.y);
    }
    for (const item of floor.furniture || []) {
      const rect = orientedRect(item.cx || 0, item.cy || 0, item.w || 0, item.d || 0, item.rot || 0);
      for (const p of rect) add(p.x, p.y);
    }
  }
  for (const stair of plan?.stairs || []) {
    const fp = stairFootprint(stair, plan);
    for (const poly of fp) {
      for (const p of poly.outer || []) add(p.x, p.y);
    }
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 1000;
    maxY = 1000;
  }
  const pad = 200;
  return {
    minX: minX - pad,
    minY: minY - pad,
    maxX: maxX + pad,
    maxY: maxY + pad,
  };
}

/**
 * Top of the tallest floor, millimetres above world y = 0.
 * @param {object} plan
 */
export function buildingTopMm(plan) {
  let top = 0;
  let any = false;
  for (const floor of plan?.floors || []) {
    any = true;
    const elev = floor.elevation ?? 0;
    const h = floor.ceiling ?? floor.height ?? 2800;
    const t = elev + (h > 0 ? h : 2800);
    if (t > top) top = t;
  }
  return any ? top : 2800;
}

/**
 * Lowest floor by elevation, then id. This is the floor that receives the
 * ground plane. It is not "the first array slot".
 * @param {object} plan
 * @returns {string|null}
 */
export function groundFloorId(plan) {
  let best = null;
  for (const floor of plan?.floors || []) {
    if (!floor) continue;
    if (!best) {
      best = floor;
      continue;
    }
    const de = (floor.elevation ?? 0) - (best.elevation ?? 0);
    if (de < 0 || (de === 0 && String(floor.id) < String(best.id))) best = floor;
  }
  return best ? best.id : null;
}

/**
 * Floors from low to high. Used by tests and the scene graph order.
 * @param {object} plan
 */
export function floorStack(plan) {
  return floorsByElevation(plan).map((floor) => ({
    id: floor.id,
    elevationM: (floor.elevation ?? 0) / 1000,
  }));
}

/**
 * Distance and target that frame `boundsMm` at `pitchDeg` (default 55° from
 * horizontal). Width and depth are at least half a metre so an empty plan
 * still produces a finite camera.
 */
export function frameCamera(boundsMm, topMm, opts = {}) {
  const fovDeg = opts.fovDeg ?? 45;
  const aspect = opts.aspect && opts.aspect > 0 ? opts.aspect : 1;
  const pitchDeg = opts.pitchDeg ?? 55;
  const fill = opts.fill > 0 && opts.fill < 1 ? opts.fill : 0.8;
  const cx = (boundsMm.minX + boundsMm.maxX) / 2 / 1000;
  const cz = (boundsMm.minY + boundsMm.maxY) / 2 / 1000;
  const width = Math.max(0.5, (boundsMm.maxX - boundsMm.minX) / 1000);
  const depth = Math.max(0.5, (boundsMm.maxY - boundsMm.minY) / 1000);
  const height = Math.max(0.5, (topMm || 0) / 1000);
  const target = { x: cx, y: Math.min(height * 0.35, 1.6), z: cz };
  const radius = 0.5 * Math.hypot(width, depth, height);
  const fov = (fovDeg * Math.PI) / 180;
  const halfV = Math.tan(fov / 2);
  const halfH = halfV * Math.max(0.25, aspect);
  const dist = fitBirdDist({ width, depth, height, targetY: target.y, pitchDeg, halfV, halfH, fill });
  const distTop = Math.max(
    (width / 2) / Math.max(0.05, fill * halfH),
    (depth / 2) / Math.max(0.05, fill * halfV),
  );
  return { target, dist, distTop, pitchDeg, radius, width, depth, height };
}

/**
 * Distance for the settled bird view so the model covers `fill` of the
 * viewport width and still fits the vertical field.
 */
function fitBirdDist({ width, depth, height, targetY, pitchDeg, halfV, halfH, fill }) {
  const pitch = (pitchDeg * Math.PI) / 180;
  const corners = [];
  for (const x of [-width / 2, width / 2]) {
    for (const z of [-depth / 2, depth / 2]) {
      for (const y of [0, height]) corners.push({ x, y, z });
    }
  }
  const spanAt = (dist) => projectSpan(corners, dist, pitch, targetY, halfV, halfH);
  let lo = 0.3;
  let hi = 800;
  for (let i = 0; i < 28; i += 1) {
    const mid = (lo + hi) / 2;
    if (spanAt(mid).maxX > fill) lo = mid;
    else hi = mid;
  }
  let dist = hi;
  if (spanAt(dist).maxY > 0.92) {
    lo = dist;
    hi = Math.max(dist * 4, dist + 1);
    for (let i = 0; i < 28; i += 1) {
      const mid = (lo + hi) / 2;
      if (spanAt(mid).maxY > 0.92) lo = mid;
      else hi = mid;
    }
    dist = hi;
  }
  return dist;
}

function projectSpan(corners, dist, pitch, targetY, halfV, halfH) {
  const eye = {
    x: 0,
    y: targetY + dist * Math.sin(pitch),
    z: dist * Math.cos(pitch),
  };
  const target = { x: 0, y: targetY, z: 0 };
  const back = norm(sub(eye, target));
  const up = Math.abs(back.y) > 0.98 ? { x: 0, y: 0, z: -1 } : { x: 0, y: 1, z: 0 };
  let right = norm(cross(up, back));
  if (!Number.isFinite(right.x)) right = { x: 1, y: 0, z: 0 };
  const camUp = cross(back, right);
  let maxX = 0;
  let maxY = 0;
  for (const corner of corners) {
    const rel = sub(corner, eye);
    const xCam = dot(rel, right);
    const yCam = dot(rel, camUp);
    const zCam = dot(rel, back);
    const ahead = -zCam;
    if (ahead < 0.05) continue;
    maxX = Math.max(maxX, Math.abs(xCam / ahead) / halfH);
    maxY = Math.max(maxY, Math.abs(yCam / ahead) / halfV);
  }
  return { maxX, maxY };
}

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function norm(v) {
  const len = Math.hypot(v.x, v.y, v.z);
  if (!(len > 1e-8)) return { x: NaN, y: NaN, z: NaN };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/**
 * Camera along the enter. t = 0 is a top-down view (up points to plan −y,
 * which is world −z, so the screen matches the 2D plan). t = 1 is 55° from
 * horizontal, sitting on the +z side of the target, with up = +y.
 * @param {ReturnType<typeof frameCamera>} frame
 * @param {number} t
 */
export function cameraPose(frame, t) {
  const u = clamp(t, 0, 1);
  const pitchDeg = 89.2 * (1 - u) + frame.pitchDeg * u;
  const dist = frame.distTop * (1 - u) + frame.dist * u;
  const pitch = (pitchDeg * Math.PI) / 180;
  const horiz = dist * Math.cos(pitch);
  const vert = dist * Math.sin(pitch);
  return {
    position: {
      x: frame.target.x,
      y: frame.target.y + vert,
      z: frame.target.z + horiz,
    },
    target: { x: frame.target.x, y: frame.target.y, z: frame.target.z },
    up: { x: 0, y: u, z: -(1 - u) },
    pitchDeg,
    dist,
  };
}
