/**
 * Opening placement along a normalized wall segment.
 *
 * The free span is the segment length minus, at each end node, the largest
 * half-thickness of other non-virtual walls that meet there and are not
 * collinear with the segment (within 10°). A collinear continuation, however
 * thick, does not intrude into this segment. Virtual separators contribute 0.
 *
 * `startGap` / `endGap` are the distances from the opening edges to those
 * free-span ends. A negative gap means the opening overlaps the intruding
 * wall thickness (or runs past the node).
 */

import { OPENING_END_CLEARANCE_MM } from '../model/constants.js';
import { getFloor } from '../model/document.js';
import { normalizeFloor } from '../rooms/normalize.js';

const COLLINEAR_SIN = Math.sin((10 * Math.PI) / 180);

/**
 * @param {object} plan
 * @param {string} floorId
 * @param {string} openingId
 * @param {{ tolerance?: number }} [opts]
 * @returns {{
 *   openingId: string,
 *   wallId: string,
 *   t: number,
 *   width: number,
 *   segmentLength: number,
 *   freeSpan: number,
 *   startGap: number,
 *   endGap: number,
 *   startIntrusion: number,
 *   endIntrusion: number,
 *   crossesNode: boolean
 * }|null}
 */
export function openingClearance(plan, floorId, openingId, opts = {}) {
  const floor = getFloor(plan, floorId);
  if (!floor) return null;
  const norm = normalizeFloor(floor, opts);
  const opening = norm.openings.find((item) => item.id === openingId);
  if (!opening) return null;
  const wall = norm.walls.find((item) => item.id === opening.wall);
  if (!wall) return null;
  const nodes = new Map(norm.nodes.map((node) => [node.id, node]));
  const a = nodes.get(wall.a);
  const b = nodes.get(wall.b);
  if (!a || !b) return null;
  const segmentLength = Math.hypot(b.x - a.x, b.y - a.y);
  const startIntrusion = intrusionAt(wall.a, wall, norm.walls, nodes);
  const endIntrusion = intrusionAt(wall.b, wall, norm.walls, nodes);
  const freeSpan = segmentLength - startIntrusion - endIntrusion;
  const centre = opening.t * segmentLength;
  const half = opening.width / 2;
  const edge0 = centre - half;
  const edge1 = centre + half;
  return {
    openingId,
    wallId: wall.id,
    t: opening.t,
    width: opening.width,
    segmentLength,
    freeSpan,
    startGap: edge0 - startIntrusion,
    endGap: (segmentLength - endIntrusion) - edge1,
    startIntrusion,
    endIntrusion,
    crossesNode: edge0 < -1e-4 || edge1 > segmentLength + 1e-4,
  };
}

/**
 * Placement errors for one opening.
 * Codes: `OPENING_TOO_WIDE`, `OPENING_CROSSES_NODE`, `OPENING_CLEARANCE`.
 * @param {object} plan
 * @param {string} floorId
 * @param {string} openingId
 * @param {{ tolerance?: number, clearance?: number }} [opts]
 * @returns {{ path: string, code: string, message: string, severity: 'error', openingId: string }[]}
 */
export function checkOpeningPlacement(plan, floorId, openingId, opts = {}) {
  const floor = getFloor(plan, floorId);
  const info = openingClearance(plan, floorId, openingId, opts);
  const fi = Array.isArray(plan?.floors) ? plan.floors.findIndex((item) => item.id === floorId) : -1;
  const oi = floor && Array.isArray(floor.openings) ? floor.openings.findIndex((item) => item.id === openingId) : -1;
  const path = fi >= 0 && oi >= 0 ? `/floors/${fi}/openings/${oi}` : '';
  if (!info) {
    return [{
      path,
      code: 'OPENING_WALL_MISSING',
      message: `Opening "${openingId}" is not on a wall of floor "${floorId}"`,
      severity: 'error',
      openingId,
    }];
  }
  const minGap = opts.clearance ?? OPENING_END_CLEARANCE_MM;
  /** @type {object[]} */
  const errors = [];
  if (info.width > info.segmentLength + 1e-6) {
    errors.push(err(path, 'OPENING_TOO_WIDE', `Opening width ${info.width} mm exceeds wall length ${info.segmentLength} mm`, openingId));
  }
  if (info.crossesNode) {
    errors.push(err(path, 'OPENING_CROSSES_NODE', 'Opening extends past a wall node', openingId));
  }
  if (info.startGap < minGap - 1e-6 || info.endGap < minGap - 1e-6) {
    errors.push(err(
      path,
      'OPENING_CLEARANCE',
      `Opening leaves ${round(info.startGap)} mm / ${round(info.endGap)} mm at the free-span ends (minimum ${minGap} mm)`,
      openingId,
    ));
  }
  return errors;
}

function err(path, code, message, openingId) {
  return { path, code, message, severity: 'error', openingId };
}

function round(n) {
  return Math.round(n * 100) / 100;
}

function intrusionAt(nodeId, host, walls, nodes) {
  const hostA = nodes.get(host.a);
  const hostB = nodes.get(host.b);
  let maxHalf = 0;
  for (const wall of walls) {
    if (wall.id === host.id || wall.virtual) continue;
    if (wall.a !== nodeId && wall.b !== nodeId) continue;
    const a = nodes.get(wall.a);
    const b = nodes.get(wall.b);
    if (!a || !b) continue;
    if (nearlyCollinear(hostA, hostB, a, b)) continue;
    maxHalf = Math.max(maxHalf, (wall.thickness || 0) / 2);
  }
  return maxHalf;
}

function nearlyCollinear(a, b, c, d) {
  const hx = b.x - a.x;
  const hy = b.y - a.y;
  const ox = d.x - c.x;
  const oy = d.y - c.y;
  const hl = Math.hypot(hx, hy) || 1;
  const ol = Math.hypot(ox, oy) || 1;
  const cross = (hx / hl) * (oy / ol) - (hy / hl) * (ox / ol);
  return Math.abs(cross) <= COLLINEAR_SIN + 1e-9;
}
