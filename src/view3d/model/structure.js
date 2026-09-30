/**
 * One floor of scene data, in plan millimetres. No WebGL.
 * The ground floor (lowest elevation) has no structural slab. Upper floors
 * use `computeSlab`, holes included. Room polygons are the net faces with
 * those same holes cut out. Stairs are parented to the floor they start on.
 */

import { getFloor } from '../../model/document.js';
import { deriveRooms } from '../../rooms/index.js';
import { computeSlab } from '../../slab/slab.js';
import { computeStair } from '../../stairs/stairs.js';
import { difference } from '../../geometry/boolean.js';
import { pointInPolygon } from '../../geometry/polygon.js';
import { groundFloorId } from './bounds.js';
import { splitWallPieces, wallRiseSchedule } from './walls.js';
import { buildOpeningLeaves } from './openings.js';
import { tokenForRoomType } from './tokens.js';

/**
 * @param {object} stair
 * @param {object} plan
 */
export function stairSolids(stair, plan) {
  const computed = computeStair(stair, plan);
  /** @type {object[]} */
  const boxes = [];
  /** @type {object[]} */
  const landings = [];
  if (!(computed.n > 0) || !(computed.riser > 0)) {
    return { id: stair.id, from: stair.from, to: stair.to, boxes, landings };
  }
  const flights = computed.flights || [];
  let base = 0;
  for (let fi = 0; fi < flights.length; fi += 1) {
    const fl = flights[fi];
    const th = ((fl.rot || 0) * Math.PI) / 180;
    const dx = Math.cos(th);
    const dy = Math.sin(th);
    const tread = stair.tread || 0;
    const width = stair.width || 0;
    for (let i = 0; i < fl.treads; i += 1) {
      const u = (i + 0.5) * tread;
      boxes.push({
        cx: fl.x + dx * u,
        cy: fl.y + dy * u,
        z0: (base + i) * computed.riser,
        z1: (base + i + 1) * computed.riser,
        length: tread,
        width,
        rotDeg: fl.rot || 0,
      });
    }
    const last = fi === flights.length - 1;
    if (last) {
      const u = fl.treads * tread + 20;
      boxes.push({
        cx: fl.x + dx * u,
        cy: fl.y + dy * u,
        z0: (base + Math.max(0, fl.risers - 1)) * computed.riser,
        z1: (base + fl.risers) * computed.riser,
        length: 40,
        width,
        rotDeg: fl.rot || 0,
      });
    }
    base += fl.risers;
  }
  if (computed.landing && computed.landing.polygon && flights.length) {
    const y1 = flights[0].risers * computed.riser;
    const y0 = y1 - Math.min(computed.riser, 80);
    const ring = computed.landing.polygon;
    landings.push({
      outer: ring.outer || ring,
      holes: ring.holes || [],
      y0,
      y1,
    });
  }
  return { id: stair.id, from: stair.from, to: stair.to, boxes, landings };
}

/**
 * Finish height under a plan point, in metres. Boundary points return 0.
 * @param {object[]} surfaces
 * @param {number} x
 * @param {number} y
 */
export function floorOffsetM(surfaces, x, y) {
  const p = { x, y };
  for (const surface of surfaces || []) {
    if (!surface.outer || !pointInPolygon(p, surface.outer)) continue;
    let inHole = false;
    for (const hole of surface.holes || []) {
      if (pointInPolygon(p, hole)) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return (surface.floorOffsetMm || 0) / 1000;
  }
  return 0;
}

/**
 * @param {object} plan
 * @param {string} floorId
 */
export function composeFloor(plan, floorId) {
  const floor = getFloor(plan, floorId);
  if (!floor) {
    const error = new Error(`Unknown floor "${floorId}"`);
    error.code = 'UNKNOWN_FLOOR';
    throw error;
  }
  const derived = deriveRooms(plan, floorId);
  const slab = computeSlab(plan, floorId);
  const ceiling = floor.ceiling ?? floor.height ?? 2800;
  const nodes = new Map(derived.normalized.nodes.map((n) => [n.id, n]));
  const walls = derived.normalized.walls || [];
  const openings = derived.normalized.openings || [];

  /** @type {object[]} */
  const wallPieces = [];
  for (const wall of walls) {
    if (wall.virtual || wall.demolished) continue;
    const height = wall.height > 0 ? wall.height : ceiling;
    wallPieces.push(...splitWallPieces({ ...wall, height }, openings, nodes));
  }
  const used = new Set(wallPieces.map((p) => p.wallId));
  for (const op of openings) used.add(op.wall);
  const schedule = wallRiseSchedule(
    walls
      .filter((w) => !w.virtual && !w.demolished && used.has(w.id))
      .map((w) => ({ id: w.id, exterior: !!w.exterior })),
  );
  const timed = new Map(schedule.map((s) => [s.wallId, s]));
  for (const piece of wallPieces) {
    const slot = timed.get(piece.wallId);
    piece.startSec = slot ? slot.startSec : 0.3;
    piece.riseSec = slot ? slot.riseSec : 0.16;
  }

  const roomById = new Map((derived.rooms || []).map((r) => [r.id, r]));
  /** @type {object[]} */
  const rooms = [];
  for (const face of derived.derived || []) {
    if (!face.polygon || face.polygon.length < 3) continue;
    const room = roomById.get(face.roomId);
    const type = room?.type || 'other';
    const subject = { outer: face.polygon, holes: face.holePolygons || [] };
    let parts = [subject];
    if (slab.openings && slab.openings.length) {
      const cut = difference(subject, slab.openings);
      if (cut.length) parts = cut;
    }
    for (const poly of parts) {
      if (!poly.outer || poly.outer.length < 3) continue;
      rooms.push({
        outer: poly.outer,
        holes: poly.holes || [],
        type,
        token: tokenForRoomType(type),
        floorOffsetMm: room?.floorOffset ?? 0,
        roomId: face.roomId ?? null,
      });
    }
  }

  const isGround = groundFloorId(plan) === floorId;
  /** @type {object[]} */
  const stairs = [];
  for (const stair of plan.stairs || []) {
    if (stair.from !== floorId) continue;
    stairs.push(stairSolids(stair, plan));
  }

  return {
    floorId,
    elevationM: (floor.elevation ?? 0) / 1000,
    isGround,
    ceilingM: ceiling / 1000,
    slabThicknessM: ((floor.slab ?? 200) > 0 ? (floor.slab ?? 200) : 200) / 1000,
    wallPieces,
    schedule,
    rooms,
    slabPolys: isGround ? [] : (slab.slab || []),
    leaves: buildOpeningLeaves(walls, openings, nodes, timed, ceiling),
    stairs,
  };
}
