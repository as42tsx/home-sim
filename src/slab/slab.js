/**
 * Per-floor structural slab.
 *
 * Outline = union of derived room centreline faces and the footprint
 * rectangles of non-virtual, non-demolished walls. A wall footprint is the
 * segment length times its thickness, centred on the centreline, and it does
 * not extend past the endpoints (outside corners of the outline are notched).
 *
 * Openings = union of this floor's voids and the footprints of every stair
 * whose `to` is this floor. Overlapping void and stair regions merge into one
 * opening (PRD §8). The slab is outline minus openings.
 *
 * `openingArea` is the area of that union, not clipped to the outline.
 */

import { difference, multiPolygonArea, union } from '../geometry/boolean.js';
import { getFloor } from '../model/document.js';
import { deriveRooms } from '../rooms/derive.js';
import { stairFootprint } from '../stairs/stairs.js';

/**
 * @param {object} plan
 * @param {string} floorId
 * @param {object} [opts] forwarded to room derivation
 * @returns {{
 *   outline: object[], openings: object[], slab: object[],
 *   outlineArea: number, openingArea: number, slabArea: number
 * }}
 */
export function computeSlab(plan, floorId, opts = {}) {
  const floor = getFloor(plan, floorId);
  if (!floor) {
    const error = new Error(`Unknown floor "${floorId}"`);
    error.code = 'UNKNOWN_FLOOR';
    throw error;
  }
  const derived = deriveRooms(plan, floorId, opts);
  /** @type {object[]} */
  const pieces = [];
  for (const face of derived.derived) {
    if (face.centerline && face.centerline.length >= 3) pieces.push(face.centerline);
  }
  const nodes = new Map(derived.normalized.nodes.map((node) => [node.id, node]));
  for (const wall of derived.normalized.walls) {
    if (wall.virtual || wall.demolished) continue;
    const a = nodes.get(wall.a);
    const b = nodes.get(wall.b);
    if (!a || !b) continue;
    const foot = wallFootprint(a, b, wall.thickness);
    if (foot) pieces.push(foot);
  }
  const outline = pieces.length ? union(...pieces) : [];

  /** @type {object[]} */
  const holes = [];
  for (const hole of floor.voids || []) {
    if (Array.isArray(hole.poly) && hole.poly.length >= 3) holes.push(hole.poly);
  }
  for (const stair of plan.stairs || []) {
    if (stair.to !== floorId) continue;
    const foot = stairFootprint(stair, plan);
    if (foot && foot.length) holes.push(foot);
  }
  const openings = holes.length ? union(...holes) : [];
  const slab = openings.length ? difference(outline, openings) : outline;
  return {
    outline,
    openings,
    slab,
    outlineArea: multiPolygonArea(outline),
    openingArea: multiPolygonArea(openings),
    slabArea: multiPolygonArea(slab),
  };
}

/**
 * Axis-aligned-in-wall-space rectangle. Not extended past the endpoints.
 * @returns {{x:number,y:number}[]|null}
 */
export function wallFootprint(a, b, thickness) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 0) || !(thickness > 0)) return null;
  const nx = -dy / length;
  const ny = dx / length;
  const h = thickness / 2;
  return [
    { x: a.x + nx * h, y: a.y + ny * h },
    { x: b.x + nx * h, y: b.y + ny * h },
    { x: b.x - nx * h, y: b.y - ny * h },
    { x: a.x - nx * h, y: a.y - ny * h },
  ];
}
