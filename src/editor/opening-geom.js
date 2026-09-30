/**
 * 2D opening geometry along a wall centerline.
 * Hinge `left` sits toward endpoint a. Swing `in` uses the left normal of a→b
 * (the visual-left side). `out` uses the other side.
 */

/** @param {{x:number,y:number}} a @param {{x:number,y:number}} b @param {object} opening */
export function openingGeometry(a, b, opening) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const left = { x: -uy, y: ux };
  const cx = a.x + dx * opening.t;
  const cy = a.y + dy * opening.t;
  const half = (opening.width || 0) / 2;
  const hingeSign = opening.hinge === 'right' ? 1 : -1;
  const hinge = { x: cx + ux * hingeSign * half, y: cy + uy * hingeSign * half };
  const jamb = { x: cx - ux * hingeSign * half, y: cy - uy * hingeSign * half };
  const normal = opening.swing === 'out' ? { x: -left.x, y: -left.y } : left;
  const leaf = {
    x: hinge.x + normal.x * (opening.width || 0),
    y: hinge.y + normal.y * (opening.width || 0),
  };
  return {
    center: { x: cx, y: cy },
    hinge,
    jamb,
    leaf,
    ux,
    uy,
    normal,
    left,
    length: len,
  };
}
