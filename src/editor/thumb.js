/**
 * Small plan figures for template cards and the demolish dialog.
 * Coordinates stay in millimetres; the caller scales them into a viewBox.
 */

import { floorsByElevation } from '../model/document.js';
import { deriveRooms } from '../rooms/index.js';
import { roomFillVar } from './materials.js';

/**
 * @param {object} plan
 * @returns {{ minX:number, minY:number, maxX:number, maxY:number, polys: { points:{x:number,y:number}[], fill:string, type:string }[], roomCount:number }|null}
 */
export function roomThumbModel(plan) {
  const floor = floorsByElevation(plan)[0];
  if (!floor) return null;
  let result;
  try {
    result = deriveRooms(plan, floor.id);
  } catch {
    return null;
  }
  const nodes = floor.nodes || [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const consider = (p) => {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  };
  for (const node of nodes) consider(node);
  const typeOf = new Map(result.rooms.map((room) => [room.id, room.type]));
  const polys = [];
  for (const face of result.derived) {
    const points = face.polygon?.length >= 3 ? face.polygon : face.centerline;
    if (!points || points.length < 3) continue;
    for (const p of points) consider(p);
    const type = typeOf.get(face.roomId) || 'other';
    polys.push({ points, fill: roomFillVar(type), type });
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 1;
    maxY = 1;
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    polys,
    roomCount: result.derived.length,
  };
}

/**
 * @param {{ points:{x:number,y:number}[], fill?:string }[]} polys
 * @param {{ minX:number, minY:number, maxX:number, maxY:number }} bounds
 * @param {{ width?: number, height?: number, pad?: number }} [box]
 */
export function thumbView(polys, bounds, box = {}) {
  const width = box.width ?? 150;
  const height = box.height ?? 110;
  const pad = box.pad ?? 8;
  const bw = Math.max(1, bounds.maxX - bounds.minX);
  const bh = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min((width - pad * 2) / bw, (height - pad * 2) / bh);
  const ox = (width - bw * scale) / 2;
  const oy = (height - bh * scale) / 2;
  const map = (p) => ({
    x: ox + (p.x - bounds.minX) * scale,
    y: oy + (p.y - bounds.minY) * scale,
  });
  return {
    width,
    height,
    polys: (polys || []).map((poly) => ({
      fill: poly.fill || 'var(--room-other)',
      points: (poly.points || []).map(map),
    })),
  };
}
