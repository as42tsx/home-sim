/**
 * Stair geometry in plan space (x right, y down), millimetres.
 *
 * Placement convention:
 * - `(x, y)` is the midpoint of the bottom (first) riser.
 * - `rot` is the direction of travel going up, in degrees. 0 = +x, 90 = +y.
 * - Direction vector `(cos rot, sin rot)`. Left normal `(sin rot, -cos rot)`
 *   (screen-left of travel, because y increases downward).
 * - The stair is centred on the travel line: half the width each side.
 * - `n = ceil(rise / maxRiser)` with a 1e-9 epsilon so an exact multiple does
 *   not gain an extra step. `riser = rise / n`. Total treads = `n - 1`.
 * - Straight run length = `(n - 1) × tread` (PRD formula). The footprint is
 *   that run by `width`, starting at the first riser.
 * - L and U (and a straight stair that carries a landing) split the risers at
 *   `landing.at`. `n1 = clamp(round(landing.at × n), 1, n - 1)`, `n2 = n - n1`.
 *   `round` is half away from zero, so 0.5 × 15 = 7.5 rounds to 8.
 *   Each flight has `ni` risers and `ni - 1` treads. The landing replaces one
 *   tread, so the two flights' treads sum to `n - 2` while the stair still
 *   reports `treads = n - 1`. `runLength` is the sum of the tread runs and
 *   does not include the landing depth.
 * - L landing: continues along flight 1 by `landing.size`, same width, centred
 *   on flight 1. Turn left → new direction `rot - 90`; turn right → `rot + 90`.
 *   Flight 2 starts at the midpoint of the landing's turn-side edge. When
 *   `landing.size === width` the second flight sits flush with the landing.
 * - U landing: flight 2 returns at `rot + 180`. Its centreline is offset along
 *   the turn normal by `width + well` (default turn `left`, default well `0`),
 *   so the clear gap between the flights is `well`. The landing depth is
 *   `landing.size` and its width spans both flights (`2 × width + well`).
 *   Flight 2 starts on the far edge of that landing and travels back.
 * - `turn` and `well` are optional additions pending PM approval.
 *
 * These figures are geometry, not a code-compliance certificate.
 */

import { getFloor } from '../model/document.js';
import { union, multiPolygonArea } from '../geometry/boolean.js';
import { applyStairRules } from './rules.js';

/**
 * @param {object} stair
 * @param {object} plan
 * @returns {{
 *   rise: number, n: number, riser: number, treads: number, runLength: number,
 *   flights: object[], landing: object|null,
 *   footprint: { outer: {x:number,y:number}[], holes: {x:number,y:number}[][] }[]
 * }}
 */
export function computeStair(stair, plan) {
  const from = getFloor(plan, stair.from);
  const to = getFloor(plan, stair.to);
  const rise = (to?.elevation ?? 0) - (from?.elevation ?? 0);
  const n = riserCount(rise, stair.maxRiser);
  const riser = n > 0 ? rise / n : 0;
  const treads = Math.max(0, n - 1);
  const width = stair.width;
  const tread = stair.tread;
  const turn = stair.turn === 'right' ? 'right' : 'left';
  const well = typeof stair.well === 'number' ? stair.well : 0;
  const hasLanding = stair.landing && typeof stair.landing.size === 'number'
    && (stair.kind === 'L' || stair.kind === 'U' || stair.kind === 'straight');

  /** @type {object[]} */
  const flights = [];
  /** @type {object|null} */
  let landing = null;
  /** @type {{x:number,y:number}[][]} */
  const polys = [];

  if (!hasLanding || n < 2) {
    const runLength = treads * tread;
    const polygon = rectAlong(stair.x, stair.y, stair.rot, runLength, width);
    flights.push(flight(0, n, runLength, stair.rot, stair.x, stair.y, polygon));
    if (polygon) polys.push(polygon);
    return pack(rise, n, riser, treads, runLength, flights, null, polys);
  }

  const { n1, n2 } = splitRisers(n, stair.landing.at);
  const run1 = Math.max(0, n1 - 1) * tread;
  const run2 = Math.max(0, n2 - 1) * tread;
  const depth = stair.landing.size;
  const dir = direction(stair.rot);
  const lat = turn === 'right' ? scale(leftNormal(stair.rot), -1) : leftNormal(stair.rot);

  const flight1Poly = rectAlong(stair.x, stair.y, stair.rot, run1, width);
  flights.push(flight(0, n1, run1, stair.rot, stair.x, stair.y, flight1Poly));
  if (flight1Poly) polys.push(flight1Poly);

  const landOrigin = {
    x: stair.x + dir.x * run1,
    y: stair.y + dir.y * run1,
  };

  if (stair.kind === 'U') {
    const v0 = -width / 2;
    const v1 = width + well + width / 2;
    const polygon = band(landOrigin, dir, lat, 0, depth, v0, v1);
    landing = {
      at: n1 / n,
      size: depth,
      depth,
      width: v1 - v0,
      rot: stair.rot,
      x: landOrigin.x,
      y: landOrigin.y,
      polygon,
    };
    if (polygon) polys.push(polygon);
    const rot2 = normDeg(stair.rot + 180);
    const start = {
      x: landOrigin.x + dir.x * depth + lat.x * (width + well),
      y: landOrigin.y + dir.y * depth + lat.y * (width + well),
    };
    const flight2Poly = rectAlong(start.x, start.y, rot2, run2, width);
    flights.push(flight(1, n2, run2, rot2, start.x, start.y, flight2Poly));
    if (flight2Poly) polys.push(flight2Poly);
  } else if (stair.kind === 'L') {
    const polygon = rectAlong(landOrigin.x, landOrigin.y, stair.rot, depth, width);
    landing = {
      at: n1 / n,
      size: depth,
      depth,
      width,
      rot: stair.rot,
      x: landOrigin.x,
      y: landOrigin.y,
      polygon,
    };
    if (polygon) polys.push(polygon);
    const rot2 = normDeg(stair.rot + (turn === 'right' ? 90 : -90));
    const start = {
      x: landOrigin.x + dir.x * (depth / 2) + lat.x * (width / 2),
      y: landOrigin.y + dir.y * (depth / 2) + lat.y * (width / 2),
    };
    const flight2Poly = rectAlong(start.x, start.y, rot2, run2, width);
    flights.push(flight(1, n2, run2, rot2, start.x, start.y, flight2Poly));
    if (flight2Poly) polys.push(flight2Poly);
  } else {
    const polygon = rectAlong(landOrigin.x, landOrigin.y, stair.rot, depth, width);
    landing = {
      at: n1 / n,
      size: depth,
      depth,
      width,
      rot: stair.rot,
      x: landOrigin.x,
      y: landOrigin.y,
      polygon,
    };
    if (polygon) polys.push(polygon);
    const start = {
      x: landOrigin.x + dir.x * depth,
      y: landOrigin.y + dir.y * depth,
    };
    const flight2Poly = rectAlong(start.x, start.y, stair.rot, run2, width);
    flights.push(flight(1, n2, run2, stair.rot, start.x, start.y, flight2Poly));
    if (flight2Poly) polys.push(flight2Poly);
  }

  return pack(rise, n, riser, treads, run1 + run2, flights, landing, polys);
}

/**
 * Full plan projection of a stair (union of flights and landing).
 * @param {object} stair
 * @param {object} plan
 */
export function stairFootprint(stair, plan) {
  return computeStair(stair, plan).footprint;
}

/**
 * Hint-only checks against a rules object. See {@link applyStairRules}.
 * @param {object} stair
 * @param {object} plan
 * @param {object|null|undefined} rules
 */
export function checkStair(stair, plan, rules) {
  const computed = computeStair(stair, plan);
  return applyStairRules({
    riser: computed.riser,
    tread: stair.tread,
    width: stair.width,
    kind: stair.kind,
    flights: computed.flights.map((item) => ({
      risers: item.risers,
      rise: item.risers * computed.riser,
    })),
    landing: computed.landing
      ? { depth: computed.landing.depth, width: computed.landing.width }
      : null,
  }, rules);
}

/** Area of a footprint, mm². Useful for tests and the slab union. */
export function footprintArea(footprint) {
  return multiPolygonArea(footprint);
}

function pack(rise, n, riser, treads, runLength, flights, landing, polys) {
  const footprint = polys.length ? union(...polys) : [];
  return { rise, n, riser, treads, runLength, flights, landing, footprint };
}

function flight(index, risers, runLength, rot, x, y, polygon) {
  return {
    index,
    risers,
    treads: Math.max(0, risers - 1),
    runLength,
    rot,
    x,
    y,
    polygon,
  };
}

function riserCount(rise, maxRiser) {
  if (!(rise > 0) || !(maxRiser > 0)) return 0;
  return Math.ceil(rise / maxRiser - 1e-9);
}

function splitRisers(n, at) {
  const fraction = typeof at === 'number' ? at : 0.5;
  let n1 = Math.round(fraction * n);
  if (n1 < 1) n1 = 1;
  if (n1 > n - 1) n1 = n - 1;
  return { n1, n2: n - n1 };
}

function direction(rotDeg) {
  const th = (rotDeg * Math.PI) / 180;
  return { x: Math.cos(th), y: Math.sin(th) };
}

function leftNormal(rotDeg) {
  const dir = direction(rotDeg);
  return { x: dir.y, y: -dir.x };
}

function scale(v, s) {
  return { x: v.x * s, y: v.y * s };
}

function normDeg(deg) {
  let d = deg % 360;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return d;
}

/**
 * Rectangle beginning at the first-riser midpoint, travelling `length` along
 * `rotDeg`, centred on the travel line. Null when the run is zero.
 * @returns {{x:number,y:number}[]|null}
 */
function rectAlong(x, y, rotDeg, length, width) {
  if (!(length > 0) || !(width > 0)) return null;
  const dir = direction(rotDeg);
  const lat = leftNormal(rotDeg);
  return band({ x, y }, dir, lat, 0, length, -width / 2, width / 2);
}

/**
 * Clockwise (y-down) quad. `v` increases along `lat` (the turn / left side).
 */
function band(origin, dir, lat, u0, u1, v0, v1) {
  const p = (u, v) => ({
    x: origin.x + dir.x * u + lat.x * v,
    y: origin.y + dir.y * u + lat.y * v,
  });
  return [p(u0, v1), p(u1, v1), p(u1, v0), p(u0, v0)];
}
