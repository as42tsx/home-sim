/**
 * Wall footprint quads. Each quad is the centerline extruded by half the
 * thickness. `extend` lengthens the quad by half the thickness so corners
 * of two walls meet without a gap.
 */

/** @param {{x:number,y:number}} a @param {{x:number,y:number}} b @param {number} thickness @param {boolean} [extend] */
export function wallQuad(a, b, thickness, extend = false) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const half = (thickness || 0) / 2;
  const nx = -uy * half;
  const ny = ux * half;
  const extra = extend ? half : 0;
  const a2 = { x: a.x - ux * extra, y: a.y - uy * extra };
  const b2 = { x: b.x + ux * extra, y: b.y + uy * extra };
  return [
    { x: a2.x + nx, y: a2.y + ny },
    { x: b2.x + nx, y: b2.y + ny },
    { x: b2.x - nx, y: b2.y - ny },
    { x: a2.x - nx, y: a2.y - ny },
  ];
}

/** @param {{x:number,y:number}[]} points */
export function pointsAttr(points) {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}
