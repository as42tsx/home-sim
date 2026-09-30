/**
 * Wall-chain decisions. The drawing tool keeps one vertex per click.
 * A rectangle is four segments: the closing click is the fifth pointer event
 * and is accepted only once three vertices already exist.
 */

/** @param {number} vertexCount vertices already committed, including the start */
export function shouldCloseChain(vertexCount, point, start) {
  if (!start || !point || vertexCount < 3) return false;
  if (point.nodeId && start.nodeId && point.nodeId === start.nodeId) return true;
  return Math.hypot(point.x - start.x, point.y - start.y) <= 1;
}

/** @param {{x:number,y:number}} a @param {{x:number,y:number}} b @param {number} [min] */
export function segmentTooShort(a, b, min = 50) {
  if (!a || !b) return true;
  return Math.hypot(b.x - a.x, b.y - a.y) < min;
}
