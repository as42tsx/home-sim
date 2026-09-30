/**
 * Plan and floor constructors.
 * Every lookup takes a floor id. Nothing in this module indexes "the" floor.
 */

import {
  DEFAULT_CEILING_MM,
  DEFAULT_FLOOR_HEIGHT_MM,
  DEFAULT_SLAB_MM,
  SCHEMA_VERSION,
  UNIT,
} from './constants.js';
import { uniqueId } from './ids.js';

/**
 * @param {object} [partial]
 * @returns {object} a floor with the arrays the schema requires
 */
export function createFloor(partial = {}) {
  return {
    id: partial.id ?? uniqueId('f'),
    name: partial.name ?? '1F',
    elevation: partial.elevation ?? 0,
    height: partial.height ?? DEFAULT_FLOOR_HEIGHT_MM,
    slab: partial.slab ?? DEFAULT_SLAB_MM,
    ceiling: partial.ceiling ?? DEFAULT_CEILING_MM,
    nodes: partial.nodes ?? [],
    walls: partial.walls ?? [],
    openings: partial.openings ?? [],
    rooms: partial.rooms ?? [],
    furniture: partial.furniture ?? [],
    voids: partial.voids ?? [],
  };
}

/**
 * Blank v2 plan with a single empty floor.
 * @param {object} [opts]
 * @param {number} [opts.now] epoch milliseconds (injectable)
 * @param {string} [opts.id]
 * @param {string} [opts.name]
 * @param {string} [opts.floorId]
 * @param {string} [opts.floorName]
 */
export function createEmptyPlan(opts = {}) {
  const now = opts.now ?? Date.now();
  const floor = createFloor({
    id: opts.floorId ?? 'f1',
    name: opts.floorName ?? '1F',
    elevation: 0,
  });
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      id: opts.id ?? uniqueId('plan'),
      name: opts.name ?? '未命名方案',
      createdAt: now,
      updatedAt: now,
      unit: UNIT,
      displayUnit: 'metric',
      codeset: 'cn',
      template: null,
    },
    floors: [floor],
    stairs: [],
  };
}

/**
 * @param {object} doc
 * @param {string} floorId
 * @returns {object|null}
 */
export function getFloor(doc, floorId) {
  if (!doc || !Array.isArray(doc.floors)) return null;
  for (const floor of doc.floors) {
    if (floor && floor.id === floorId) return floor;
  }
  return null;
}

/**
 * Floors ordered by ascending elevation, then id. Does not mutate the plan.
 * @param {object} doc
 */
export function floorsByElevation(doc) {
  const list = Array.isArray(doc?.floors) ? doc.floors : [];
  return [...list].sort((a, b) => {
    const de = (a.elevation ?? 0) - (b.elevation ?? 0);
    if (de !== 0) return de;
    const ia = String(a.id);
    const ib = String(b.id);
    if (ia < ib) return -1;
    if (ia > ib) return 1;
    return 0;
  });
}

/** The floor directly below `floorId` in elevation order, or null. */
export function floorBelow(doc, floorId) {
  const ordered = floorsByElevation(doc);
  const idx = ordered.findIndex((floor) => floor.id === floorId);
  if (idx <= 0) return null;
  return ordered[idx - 1];
}

/** The floor directly above `floorId` in elevation order, or null. */
export function floorAbove(doc, floorId) {
  const ordered = floorsByElevation(doc);
  const idx = ordered.findIndex((floor) => floor.id === floorId);
  if (idx < 0 || idx + 1 >= ordered.length) return null;
  return ordered[idx + 1];
}

/**
 * Neighbours of a floor.
 * @returns {{ below: object|null, above: object|null }}
 */
export function adjacentFloors(doc, floorId) {
  return {
    below: floorBelow(doc, floorId),
    above: floorAbove(doc, floorId),
  };
}
