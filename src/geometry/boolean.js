/**
 * Polygon booleans over the vendored polygon-clipping build.
 * Public rings use `{x, y}` points and do not repeat the first vertex.
 * A polygon is `{ outer, holes }` and a multi-polygon is an array of those.
 * Bare rings are accepted as single-polygon input.
 */

import polygonClipping from '../../vendor/polygon-clipping/polygon-clipping.esm.js';

function isXy(p) {
  return p && typeof p === 'object' && !Array.isArray(p) && typeof p.x === 'number';
}

function toXy(p) {
  if (Array.isArray(p)) return { x: Number(p[0]), y: Number(p[1]) };
  return { x: Number(p.x), y: Number(p.y) };
}

function samePoint(a, b) {
  return a.x === b.x && a.y === b.y;
}

function openRing(pts) {
  const ring = pts.map(toXy);
  if (ring.length > 1 && samePoint(ring[0], ring[ring.length - 1])) ring.pop();
  return ring;
}

function ringToClipping(ring) {
  return openRing(ring).map((p) => [p.x, p.y]);
}

function clippingRingToXy(ring) {
  if (!ring) return [];
  return openRing(ring);
}

/**
 * Coerce a ring, polygon, multi-polygon, or raw clipping result into
 * `{ outer, holes }[]`.
 * @param {*} geom
 */
export function asPolygons(geom) {
  if (!geom) return [];
  if (Array.isArray(geom) && geom.length === 0) return [];
  if (Array.isArray(geom) && geom[0] && geom[0].outer) {
    return geom.map((p) => ({
      outer: openRing(p.outer),
      holes: (p.holes || []).map((h) => openRing(h)),
    }));
  }
  if (!Array.isArray(geom) && geom.outer) {
    return [{
      outer: openRing(geom.outer),
      holes: (geom.holes || []).map((h) => openRing(h)),
    }];
  }
  if (Array.isArray(geom) && geom.length && (isXy(geom[0]) || (Array.isArray(geom[0]) && typeof geom[0][0] === 'number'))) {
    return [{ outer: openRing(geom), holes: [] }];
  }
  // Clipping MultiPolygon: [[[[x,y], ...]], ...]
  if (
    Array.isArray(geom)
    && Array.isArray(geom[0])
    && Array.isArray(geom[0][0])
    && Array.isArray(geom[0][0][0])
    && typeof geom[0][0][0][0] === 'number'
  ) {
    return geom.map((poly) => ({
      outer: clippingRingToXy(poly[0]),
      holes: poly.slice(1).map((ring) => clippingRingToXy(ring)),
    })).filter((p) => p.outer.length >= 3);
  }
  // Clipping Polygon: [[[x,y], ...], hole, ...]
  if (
    Array.isArray(geom)
    && Array.isArray(geom[0])
    && Array.isArray(geom[0][0])
    && typeof geom[0][0][0] === 'number'
  ) {
    return [{
      outer: clippingRingToXy(geom[0]),
      holes: geom.slice(1).map((ring) => clippingRingToXy(ring)),
    }].filter((p) => p.outer.length >= 3);
  }
  return [];
}

function toClippingPolygon(poly) {
  const rings = [ringToClipping(poly.outer)];
  for (const hole of poly.holes || []) rings.push(ringToClipping(hole));
  return rings;
}

function fromClippingMulti(multi) {
  if (!multi || !multi.length) return [];
  return multi.map((poly) => ({
    outer: clippingRingToXy(poly[0]),
    holes: poly.slice(1).map((ring) => clippingRingToXy(ring)),
  })).filter((p) => p.outer.length >= 3);
}

function polysOf(geom) {
  return asPolygons(geom).filter((p) => p.outer.length >= 3);
}

/**
 * @param {...*} geoms rings, polygons, or multi-polygons
 * @returns {{outer:{x:number,y:number}[], holes:{x:number,y:number}[][]}[]}
 */
export function union(...geoms) {
  const polys = geoms.flatMap((g) => polysOf(g));
  if (polys.length === 0) return [];
  if (polys.length === 1) return polys;
  return fromClippingMulti(polygonClipping.union(...polys.map(toClippingPolygon)));
}

/**
 * @param {...*} geoms
 * @returns {{outer:{x:number,y:number}[], holes:{x:number,y:number}[][]}[]}
 */
export function intersection(...geoms) {
  const groups = geoms.map((g) => polysOf(g));
  if (groups.some((g) => g.length === 0)) return [];
  const args = groups.map((polys) => (
    polys.length === 1
      ? toClippingPolygon(polys[0])
      : polygonClipping.union(...polys.map(toClippingPolygon))
  ));
  // intersection() wants polygons. A union result is a multi-polygon; flatten
  // by intersecting the subject with each piece when needed.
  const [first, ...rest] = args;
  const firstPolys = Array.isArray(first[0]) && Array.isArray(first[0][0]) && Array.isArray(first[0][0][0])
    ? first
    : [first];
  let acc = firstPolys;
  for (const clip of rest) {
    const clipPolys = Array.isArray(clip[0]) && Array.isArray(clip[0][0]) && Array.isArray(clip[0][0][0])
      ? clip
      : [clip];
    const next = [];
    for (const sub of acc) {
      for (const c of clipPolys) {
        const hit = polygonClipping.intersection(sub, c);
        for (const poly of hit) next.push(poly);
      }
    }
    acc = next;
    if (!acc.length) return [];
  }
  return fromClippingMulti(acc);
}

/**
 * Subtract every clip geometry from `subject`.
 * @param {*} subject
 * @param {...*} clips
 */
export function difference(subject, ...clips) {
  const subPolys = polysOf(subject);
  if (!subPolys.length) return [];
  const clipPolys = clips.flatMap((g) => polysOf(g));
  if (!clipPolys.length) return subPolys;
  const subj = subPolys.length === 1
    ? toClippingPolygon(subPolys[0])
    : polygonClipping.union(...subPolys.map(toClippingPolygon));
  const clipArgs = clipPolys.map(toClippingPolygon);
  return fromClippingMulti(polygonClipping.difference(subj, ...clipArgs));
}

/** Signed area of a `{x,y}` ring. Positive is clockwise in y-down space. */
export function ringSignedArea(ring) {
  const pts = openRing(ring);
  let a = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/**
 * Absolute area of a ring, polygon, or multi-polygon, holes subtracted.
 * @param {*} geom
 * @returns {number} mm²
 */
export function multiPolygonArea(geom) {
  let area = 0;
  for (const poly of asPolygons(geom)) {
    area += Math.abs(ringSignedArea(poly.outer));
    for (const hole of poly.holes) area -= Math.abs(ringSignedArea(hole));
  }
  return area;
}
