/**
 * Wall-drawing snap in plan space.
 * Screen threshold is `SNAP_PX / pxPerMm` millimetres.
 * Shift disables endpoint, centerline and orthogonal snap. A typed length
 * still places the point along the (possibly unsnapped) direction.
 */

import { ORTHO_SNAP_DEG, SNAP_PX } from '../model/constants.js';
import { pointOnSegment } from '../geometry/segment.js';
import { dist, unit } from '../geometry/vec.js';
import { angleDeg } from './format.js';

/**
 * @param {object} opts
 * @param {{x:number,y:number}|null} opts.origin
 * @param {{x:number,y:number}} opts.cursor
 * @param {{id?:string,x:number,y:number}[]} [opts.nodes]
 * @param {{id?:string,a:{x:number,y:number},b:{x:number,y:number}}[]} [opts.walls]
 * @param {number} opts.pxPerMm
 * @param {boolean} [opts.shift]
 * @param {number|null} [opts.lengthMm]
 */
export function resolveSnap(opts) {
  const origin = opts.origin || null;
  const cursor = opts.cursor;
  const nodes = opts.nodes || [];
  const walls = opts.walls || [];
  const pxPerMm = opts.pxPerMm;
  const shift = !!opts.shift;
  const lengthMm = opts.lengthMm == null ? null : Number(opts.lengthMm);
  /** @type {{x1:number,y1:number,x2:number,y2:number}[]} */
  const guides = [];
  const snapMm = pxPerMm > 0 ? SNAP_PX / pxPerMm : 0;

  if (!shift && snapMm > 0) {
    let endpoint = null;
    for (const node of nodes) {
      const d = dist(cursor, node);
      if (d <= snapMm + 1e-6 && (!endpoint || d < endpoint.d)) endpoint = { d, node };
    }
    if (endpoint) {
      return finish(origin, { x: endpoint.node.x, y: endpoint.node.y }, {
        kind: 'endpoint',
        nodeId: endpoint.node.id || null,
        guides,
        lengthMm,
      });
    }

    let lineHit = null;
    for (const wall of walls) {
      if (!wall?.a || !wall?.b) continue;
      const proj = pointOnSegment(cursor, wall.a, wall.b);
      if (proj.distance <= snapMm + 1e-6 && (!lineHit || proj.distance < lineHit.proj.distance)) {
        lineHit = { wall, proj };
      }
    }
    if (lineHit) {
      guides.push({
        x1: lineHit.wall.a.x,
        y1: lineHit.wall.a.y,
        x2: lineHit.wall.b.x,
        y2: lineHit.wall.b.y,
      });
      return finish(origin, { x: lineHit.proj.point.x, y: lineHit.proj.point.y }, {
        kind: 'centerline',
        wallId: lineHit.wall.id || null,
        guides,
        lengthMm,
      });
    }

    if (origin) {
      const ortho = orthogonalPoint(origin, cursor);
      if (ortho) {
        guides.push(ortho.guide);
        return finish(origin, ortho.point, { kind: 'ortho', guides, lengthMm });
      }
    }
  }

  return finish(origin, { x: cursor.x, y: cursor.y }, { kind: 'free', guides, lengthMm });
}

/**
 * @param {{x:number,y:number}} origin
 * @param {{x:number,y:number}} cursor
 * @returns {{ point: {x:number,y:number}, guide: object }|null}
 */
export function orthogonalPoint(origin, cursor) {
  const dx = cursor.x - origin.x;
  const dy = cursor.y - origin.y;
  const mag = Math.hypot(dx, dy);
  if (mag < 1e-6) return null;
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  const snapped = Math.round(deg / 90) * 90;
  let delta = Math.abs(deg - snapped);
  if (delta > 180) delta = 360 - delta;
  if (delta > ORTHO_SNAP_DEG + 1e-9) return null;
  const rad = (snapped * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const reach = 1e6;
  return {
    point: { x: origin.x + cos * mag, y: origin.y + sin * mag },
    guide: {
      x1: origin.x - cos * reach,
      y1: origin.y - sin * reach,
      x2: origin.x + cos * reach,
      y2: origin.y + sin * reach,
    },
  };
}

function finish(origin, point, meta) {
  let next = { x: point.x, y: point.y };
  let kind = meta.kind;
  let nodeId = meta.nodeId || null;
  if (origin && meta.lengthMm != null && Number.isFinite(meta.lengthMm) && meta.lengthMm >= 0) {
    const dir = unit({ x: next.x - origin.x, y: next.y - origin.y });
    if (dir.x !== 0 || dir.y !== 0) {
      next = { x: origin.x + dir.x * meta.lengthMm, y: origin.y + dir.y * meta.lengthMm };
      kind = 'length';
      if (!nodeId || dist(next, point) > 1) nodeId = null;
    }
  }
  const length = origin ? dist(origin, next) : null;
  const angle = origin ? angleDeg(next.x - origin.x, next.y - origin.y) : null;
  return {
    point: next,
    kind,
    nodeId,
    wallId: meta.wallId || null,
    length,
    angle,
    guides: meta.guides || [],
  };
}
