/**
 * Stick a furniture item's back edge to the nearest wall face.
 * Back edge is the local edge at y = -d/2 (rotation 0 faces the back toward -y).
 * Within ~150 mm the item rotates so that edge lies on the face and the body
 * sits on the same side of the wall as the cursor.
 */

import { pointOnSegment } from '../geometry/segment.js';
import { dist } from '../geometry/vec.js';

export const FURNITURE_WALL_SNAP_MM = 150;

/**
 * @param {{cx:number,cy:number,w:number,d:number,rot?:number}} item
 * @param {{id:string,a:string,b:string,thickness?:number,virtual?:boolean,demolished?:boolean}[]} walls
 * @param {Map<string, {x:number,y:number}>|Record<string, {x:number,y:number}>} nodeMap
 * @param {number} [maxGap]
 * @returns {{ cx:number, cy:number, rot:number, wallId:string, side:'left'|'right' }|null}
 */
export function snapFurnitureToWall(item, walls, nodeMap, maxGap = FURNITURE_WALL_SNAP_MM) {
  const nodes = nodeMap instanceof Map ? nodeMap : new Map(Object.entries(nodeMap || {}));
  let best = null;
  for (const wall of walls || []) {
    if (!wall || wall.virtual || wall.demolished) continue;
    const a = nodes.get(wall.a);
    const b = nodes.get(wall.b);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;
    const ux = dx / len;
    const uy = dy / len;
    const left = { x: -uy, y: ux };
    const right = { x: uy, y: -ux };
    const half = (wall.thickness || 0) / 2;
    const proj = pointOnSegment({ x: item.cx, y: item.cy }, a, b);
    const side = (item.cx - proj.point.x) * left.x + (item.cy - proj.point.y) * left.y;
    const normal = side >= 0 ? left : right;
    const sideName = side >= 0 ? 'left' : 'right';
    const face = {
      x: proj.point.x + normal.x * half,
      y: proj.point.y + normal.y * half,
    };
    const gap = Math.abs((item.cx - face.x) * normal.x + (item.cy - face.y) * normal.y);
    const reach = (item.d || 0) / 2 + maxGap;
    if (gap > reach) continue;
    if (proj.t <= 0 || proj.t >= 1) {
      const end = proj.t <= 0 ? a : b;
      if (dist(item, { x: end.x, y: end.y }) > reach + half) continue;
    }
    if (!best || gap < best.gap) {
      best = { gap, wall, normal, sideName, face, ux, uy, a, b, half, proj };
    }
  }
  if (!best) return null;

  const hd = (item.d || 0) / 2;
  const cx = best.face.x + best.normal.x * hd;
  const cy = best.face.y + best.normal.y * hd;
  // Center-to-back should point at the wall, i.e. opposite the face normal.
  // World direction of local (0, -1) is (sin rot, -cos rot).
  const rot = (Math.atan2(-best.normal.x, best.normal.y) * 180) / Math.PI;
  return {
    cx,
    cy,
    rot,
    wallId: best.wall.id,
    side: best.sideName,
  };
}
