/**
 * Hover preview for a door or window. The cursor is projected onto the
 * nearest wall centerline, then pushed back so each end keeps
 * {@link OPENING_END_CLEARANCE_MM}. Virtual walls are rejected.
 * The returned plan is never the caller's plan.
 */

import { OPENING_END_CLEARANCE_MM } from '../model/constants.js';
import { getFloor } from '../model/document.js';
import { pointOnSegment } from '../geometry/segment.js';
import { dist } from '../geometry/vec.js';
import { checkOpeningPlacement, openingClearance } from '../openings/clearance.js';
import { cloneData } from './clone.js';

const PREVIEW_ID = 'previewop';

/**
 * @param {object} plan
 * @param {string} floorId
 * @param {{x:number,y:number}} worldPoint
 * @param {{ kind: string, width: number, height: number, sill: number, hinge?: string, swing?: string }} spec
 * @param {number} [pxPerMm]
 */
export function previewOpening(plan, floorId, worldPoint, spec, pxPerMm = 0.05) {
  const floor = getFloor(plan, floorId);
  if (!floor) return null;
  const nodes = new Map((floor.nodes || []).map((node) => [node.id, node]));
  let best = null;
  for (const wall of floor.walls || []) {
    if (wall.demolished) continue;
    const a = nodes.get(wall.a);
    const b = nodes.get(wall.b);
    if (!a || !b) continue;
    const proj = pointOnSegment(worldPoint, a, b);
    const tol = Math.max((wall.thickness || 240) / 2 + 40, pxPerMm > 0 ? 16 / pxPerMm : 80);
    if (proj.distance > tol) continue;
    if (!best || proj.distance < best.distance) best = { wall, a, b, proj, distance: proj.distance };
  }
  if (!best) return null;

  const base = {
    wallId: best.wall.id,
    kind: spec.kind,
    width: spec.width,
    height: spec.height,
    sill: spec.sill,
    hinge: spec.hinge || 'left',
    swing: spec.swing || 'in',
    ax: best.a.x,
    ay: best.a.y,
    bx: best.b.x,
    by: best.b.y,
  };

  if (best.wall.virtual) {
    return {
      ...base,
      ok: false,
      code: 'OPENING_ON_VIRTUAL',
      t: best.proj.t,
      segmentLength: dist(best.a, best.b),
    };
  }

  const rough = probe(plan, floorId, best.wall.id, best.proj.t, spec);
  let t = best.proj.t;
  if (rough.info && rough.info.segmentLength > 0) {
    const len = rough.info.segmentLength;
    const half = spec.width / 2;
    const clearance = OPENING_END_CLEARANCE_MM;
    const minCentre = rough.info.startIntrusion + clearance + half;
    const maxCentre = len - rough.info.endIntrusion - clearance - half;
    let centre = Math.max(0, Math.min(1, t)) * len;
    if (minCentre <= maxCentre) {
      if (centre < minCentre) centre = minCentre;
      if (centre > maxCentre) centre = maxCentre;
      t = centre / len;
    }
  }

  const verdict = probe(plan, floorId, best.wall.id, t, spec);
  const code = verdict.code;
  return {
    ...base,
    ok: verdict.ok,
    code,
    t: verdict.t,
    segmentLength: verdict.info?.segmentLength ?? dist(best.a, best.b),
    startGap: verdict.info?.startGap,
    endGap: verdict.info?.endGap,
    errors: verdict.errors,
  };
}

function probe(plan, floorId, wallId, t, spec) {
  const trial = cloneData(plan);
  const floor = getFloor(trial, floorId);
  floor.openings = (floor.openings || []).filter((opening) => opening.id !== PREVIEW_ID);
  const opening = {
    id: PREVIEW_ID,
    wall: wallId,
    t: Math.max(0, Math.min(1, t)),
    kind: spec.kind,
    width: spec.width,
    height: spec.height,
    sill: spec.sill ?? 0,
    hinge: spec.hinge || 'left',
    swing: spec.swing || 'in',
  };
  floor.openings.push(opening);
  const info = openingClearance(trial, floorId, PREVIEW_ID);
  const errors = checkOpeningPlacement(trial, floorId, PREVIEW_ID);
  let code = null;
  if (!info) code = 'OPENING_WALL_MISSING';
  else if (errors.some((error) => error.code === 'OPENING_TOO_WIDE')) code = 'OPENING_TOO_WIDE';
  else if (errors.some((error) => error.code === 'OPENING_CROSSES_NODE')) code = 'OPENING_CROSSES_NODE';
  else if (errors.some((error) => error.code === 'OPENING_CLEARANCE')) code = 'OPENING_CLEARANCE';
  else if (errors.length) code = errors[0].code;
  return {
    ok: errors.length === 0 && !!info,
    code,
    t: info?.t ?? opening.t,
    info,
    errors,
  };
}

/**
 * Sentence parameters for the hover bubble. The UI fills the i18n template.
 * @param {object} preview
 * @param {'door'|'window'|string} noun
 */
export function openingReasonParams(preview, noun) {
  return {
    noun,
    width: Math.round(preview.width || 0),
    length: Math.round(preview.segmentLength || 0),
    gap: Math.round(Math.min(
      Number.isFinite(preview.startGap) ? preview.startGap : 0,
      Number.isFinite(preview.endGap) ? preview.endGap : 0,
    )),
  };
}
