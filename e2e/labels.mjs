/**
 * Room-label clearance and the phone 2D fit.
 * Desktop 1440×900 and phone 390×844, three templates.
 */
import fs from 'node:fs';
import path from 'node:path';
import { launch, newPage, openApp, chooseTemplate, frames, finish, report } from './lib.mjs';

const TEMPLATES = ['apt-1br', 'apt-2br', 'apt-3br'];
const SHOT_DIR = '/workspace/home-sim-shots/2026-10-04-r3';
const CLEAR = 8;
const SLACK = 0.35;

const rep = report();
const browser = await launch();

try {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const desktop = await newPage(browser, { width: 1440, height: 900 });
  const phone = await newPage(browser, { mobile: true, width: 390, height: 844 });
  for (const id of TEMPLATES) {
    await runCase(desktop.page, id, 'desktop');
    await runCase(phone.page, id, 'phone');
  }
  const phoneCode = finish(phone.page, rep);
  const deskCode = finish(desktop.page, rep);
  process.exit(phoneCode || deskCode ? 1 : 0);
} catch (err) {
  console.log(`FAIL labels SCRIPT — ${err.stack || err}`);
  process.exit(1);
} finally {
  await browser.close();
}

async function runCase(page, id, kind) {
  await openApp(page);
  await chooseTemplate(page, id);
  await page.evaluate(() => window.__HOMESIM_DEBUG__.fit());
  await frames(page);
  const shot = path.join(SHOT_DIR, `grok-${id}-${kind}.png`);
  await page.screenshot({ path: shot });
  const result = await page.evaluate(measure);
  const problems = [];
  const flags = [];
  for (const room of result.rooms) {
    if (room.clear >= CLEAR - SLACK) continue;
    const detail = `${room.name} ${room.clear.toFixed(2)} (wall ${room.wall.toFixed(2)}${room.door == null ? '' : ` door ${room.door.toFixed(2)}`})`;
    // A shortfall is a placement bug only when the room box can hold the
    // label plus 8 px and nothing is stopping it. Otherwise the max-clearance
    // spot is the specified fallback and the line is flagged.
    const held = room.w >= 60 && room.h >= 40 && room.expectArea;
    if (kind === 'desktop' && held) problems.push(detail);
    else flags.push(detail);
  }
  if (kind === 'desktop') {
    for (const room of result.rooms) {
      if (room.expectArea && !room.hasArea) problems.push(`${room.name} missing area`);
    }
  } else {
    if (!(result.ratio >= 0.75 && result.ratio <= 0.88)) {
      problems.push(`ratio ${result.ratio == null ? 'null' : result.ratio.toFixed(3)}`);
    }
    if (!(result.nameFont >= 12)) problems.push(`name font ${result.nameFont}`);
    if (!(result.areaFont >= 10)) problems.push(`area font ${result.areaFont}`);
    if (result.stripHits.length) problems.push(result.stripHits.slice(0, 4).join('; '));
    if (!result.entryInside) problems.push('入户 outside viewport');
    if (!result.planAboveSheet) problems.push('plan under the sheet');
    if (!result.dimsInside) problems.push('dimension rows clipped');
  }
  const worst = result.rooms.reduce((best, room) => (room.clear < best.clear ? room : best), result.rooms[0] || { name: '', clear: 0 });
  const only = result.rooms.filter((room) => !room.hasArea).map((room) => room.name);
  const ratio = result.ratio == null ? 'n/a' : result.ratio.toFixed(3);
  const note = [
    `minClear ${Number.isFinite(result.minClear) ? result.minClear.toFixed(2) : 'none'}px${worst?.name ? ` (${worst.name})` : ''}`,
    `ratio ${ratio}`,
    `plan ${result.planPx == null ? 'n/a' : result.planPx.toFixed(1)}/${result.availPx == null ? 'n/a' : result.availPx.toFixed(1)}`,
    only.length ? `name-only ${only.join(',')}` : 'areas all',
    flags.length ? `FLAG ${flags.join('; ')}` : '',
    problems.length ? problems.join(' | ') : '',
  ].filter(Boolean).join(' · ');
  rep.check(`labels ${id} ${kind}`, problems.length === 0, note);
}

function measure() {
  const widthCache = new Map();
  const debug = window.__HOMESIM_DEBUG__;
  const plan = debug.getPlan();
  const floor = plan.floors[0];
  const fit = typeof debug.phoneFitInfo === 'function' ? debug.phoneFitInfo() : null;
  const vp = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };

  const labels = [...document.querySelectorAll('[data-room-label]')].map((group) => {
    const name = group.querySelector('.label-name');
    const area = group.querySelector('.label-area');
    const nameBox = name ? name.getBoundingClientRect() : null;
    const areaShown = !!(area && area.getAttribute('visibility') !== 'hidden' && (area.textContent || '').trim());
    const areaBox = areaShown ? area.getBoundingClientRect() : null;
    const box = unionRect(nameBox, areaBox);
    return {
      id: group.getAttribute('data-room-label'),
      name: name ? name.textContent : '',
      hasArea: areaShown,
      box,
      nameFont: name ? parseFloat(getComputedStyle(name).fontSize) : 0,
      areaFont: area ? parseFloat(getComputedStyle(area).fontSize) : 0,
    };
  });

  return import('./src/rooms/index.js').then(async (roomsMod) => {
    const geomMod = await import('./src/editor/opening-geom.js');
    const polyMod = await import('./src/geometry/polygon.js');
    const derived = roomsMod.deriveRooms(plan, floor.id);
    const nodes = new Map((floor.nodes || []).map((node) => [node.id, node]));
    const faces = new Map(derived.derived.map((face) => [String(face.roomId), face]));
    const probe = probeMetrics();
    let minClear = Infinity;
    const hits = [];
    const rooms = [];
    for (const label of labels) {
      const face = faces.get(label.id);
      if (!face || !label.box || !(label.box.width > 0)) {
        hits.push(`${label.name || label.id} has no box`);
        continue;
      }
      const poly = (face.polygon || []).map((point) => debug.worldToScreen(point.x, point.y));
      const edges = poly.map((point, index) => [point, poly[(index + 1) % poly.length]]);
      const sectors = swingsInto(face.polygon, floor, nodes, geomMod.openingGeometry, polyMod.pointInPolygon, debug);
      const wallClear = clearanceOf(label.box, edges, []);
      const doorClear = sectors.length ? clearanceOf(label.box, [], sectors) : Infinity;
      const clear = Math.min(wallClear, doorClear);
      minClear = Math.min(minClear, clear);
      if (clear < 8 - 0.35) {
        hits.push(`${label.name} wall ${wallClear.toFixed(2)} door ${Number.isFinite(doorClear) ? doorClear.toFixed(2) : 'none'}`);
      }
      const bounds = bboxOf(poly);
      const areaW = textWidth('label-area', areaLine(face.areaM2));
      const inkH = probe.nameH + probe.areaH;
      const expectArea = bounds.w >= 60 && bounds.h >= 40
        && bounds.w >= areaW + 16
        && bounds.h >= inkH + 16;
      rooms.push({
        name: label.name,
        hasArea: label.hasArea,
        expectArea,
        w: Math.round(bounds.w),
        h: Math.round(bounds.h),
        clear: Number(clear.toFixed(2)),
        wall: Number(wallClear.toFixed(2)),
        door: Number.isFinite(doorClear) ? Number(doorClear.toFixed(2)) : null,
      });
    }
    const strip = stripRect();
    const stripHits = [];
    let entryInside = true;
    let planAboveSheet = true;
    let dimsInside = true;
    if (window.innerWidth < 600) {
      const sheet = document.querySelector('[data-testid="sheet"]');
      const sheetTop = sheet ? sheet.getBoundingClientRect().top : window.innerHeight;
      let wallBottom = 0;
      for (const node of document.querySelectorAll('[data-layer="walls"] polygon, [data-layer="walls"] line')) {
        const box = node.getBoundingClientRect();
        if (box.width < 0.5 && box.height < 0.5) continue;
        wallBottom = Math.max(wallBottom, box.bottom);
        if (strip && intersects(box, strip)) stripHits.push('plan');
      }
      planAboveSheet = wallBottom <= sheetTop + 0.5;
      const dims = document.querySelector('[data-layer="screen"] [data-id="dims"]');
      if (dims) {
        const box = dims.getBoundingClientRect();
        dimsInside = contains(vp, box, 1);
        if (strip) {
          for (const node of dims.querySelectorAll('line, text')) {
            const part = node.getBoundingClientRect();
            if (part.width < 0.5 && part.height < 0.5) continue;
            if (intersects(part, strip)) stripHits.push('dims');
          }
        }
      } else dimsInside = false;
      const entry = document.querySelector('[data-layer="screen"] [data-id="entry"]');
      entryInside = !!(entry && contains(vp, entry.getBoundingClientRect(), 1));
    }
    const nameFont = Math.min(...labels.map((item) => item.nameFont || 0));
    const areaFont = Math.min(...labels.map((item) => item.areaFont || 0));
    return {
      minClear: Number.isFinite(minClear) ? minClear : -1,
      hits,
      rooms,
      ratio: fit ? fit.ratio : null,
      planPx: fit ? fit.planPx : null,
      availPx: fit ? fit.availPx : null,
      nameFont,
      areaFont,
      stripHits: [...new Set(stripHits)],
      entryInside,
      planAboveSheet,
      dimsInside,
    };
  });

  function areaLine(m2) {
    const n = Math.round((Number(m2) || 0) * 100) / 100;
    return `使用面积 ${n.toFixed(2)} m²`;
  }

  function textWidth(className, text) {
    const key = `${className}\n${text}`;
    if (widthCache.has(key)) return widthCache.get(key);
    const svg = document.querySelector('.plan-svg');
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    node.setAttribute('class', className);
    node.setAttribute('y', '0');
    node.textContent = text;
    svg.appendChild(node);
    const width = node.getBBox().width;
    node.remove();
    widthCache.set(key, width);
    return width;
  }

  function probeMetrics() {
    const svg = document.querySelector('.plan-svg');
    const name = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    name.setAttribute('class', 'label-name');
    name.setAttribute('y', '0');
    name.textContent = '卫生间';
    const area = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    area.setAttribute('class', 'label-area');
    area.setAttribute('y', '0');
    area.textContent = areaLine(11.61);
    svg.append(name, area);
    const nb = name.getBBox();
    const ab = area.getBBox();
    name.remove();
    area.remove();
    return { nameH: nb.height, areaH: ab.height };
  }

  function swingsInto(polygon, live, nodes, openingGeometry, pointInPolygon, debug) {
    const sectors = [];
    for (const opening of live.openings || []) {
      if (!opening || opening.kind === 'window' || opening.kind === 'slide') continue;
      const wall = (live.walls || []).find((item) => item.id === opening.wall);
      if (!wall) continue;
      const a = nodes.get(wall.a);
      const b = nodes.get(wall.b);
      if (!a || !b) continue;
      const geom = openingGeometry(a, b, opening);
      const mid = {
        x: geom.hinge.x + geom.normal.x * (opening.width || 0) * 0.55,
        y: geom.hinge.y + geom.normal.y * (opening.width || 0) * 0.55,
      };
      if (!pointInPolygon(mid, polygon)) continue;
      sectors.push(sectorOf(geom, debug));
    }
    return sectors;
  }

  function sectorOf(geom, debug) {
    const hinge = debug.worldToScreen(geom.hinge.x, geom.hinge.y);
    const jamb = debug.worldToScreen(geom.jamb.x, geom.jamb.y);
    const leaf = debug.worldToScreen(geom.leaf.x, geom.leaf.y);
    const r = Math.hypot(leaf.x - hinge.x, leaf.y - hinge.y);
    const a0 = Math.atan2(jamb.y - hinge.y, jamb.x - hinge.x);
    const a1 = Math.atan2(leaf.y - hinge.y, leaf.x - hinge.x);
    let delta = a1 - a0;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return { hinge, jamb, leaf, r, a0, delta };
  }

  function clearanceOf(box, edges, sectors) {
    const rect = { minX: box.left, maxX: box.right, minY: box.top, maxY: box.bottom };
    if (hits(rect, edges, sectors)) {
      let lo = -Math.min(box.width, box.height) / 2;
      let hi = 0;
      for (let i = 0; i < 12; i += 1) {
        const mid = (lo + hi) / 2;
        if (hits(expand(rect, mid), edges, sectors)) hi = mid;
        else lo = mid;
      }
      return lo;
    }
    let lo = 0;
    let hi = 4;
    while (hi < 80 && !hits(expand(rect, hi), edges, sectors)) hi *= 2;
    for (let i = 0; i < 12; i += 1) {
      const mid = (lo + hi) / 2;
      if (hits(expand(rect, mid), edges, sectors)) hi = mid;
      else lo = mid;
    }
    return lo;
  }

  function hits(rect, edges, sectors) {
    for (const [a, b] of edges) {
      if (segmentHitsRect(a, b, rect)) return true;
    }
    for (const sector of sectors) {
      if (rectHitsSector(rect, sector)) return true;
    }
    return false;
  }

  function expand(rect, pad) {
    return {
      minX: rect.minX - pad,
      maxX: rect.maxX + pad,
      minY: rect.minY - pad,
      maxY: rect.maxY + pad,
    };
  }

  function rectHitsSector(rect, sector) {
    const corners = [
      { x: rect.minX, y: rect.minY },
      { x: rect.maxX, y: rect.minY },
      { x: rect.maxX, y: rect.maxY },
      { x: rect.minX, y: rect.maxY },
    ];
    for (const corner of corners) {
      if (pointInSector(corner, sector)) return true;
    }
    if (pointInRect(sector.hinge, rect) || pointInRect(sector.jamb, rect) || pointInRect(sector.leaf, rect)) return true;
    if (segmentHitsRect(sector.hinge, sector.jamb, rect)) return true;
    if (segmentHitsRect(sector.hinge, sector.leaf, rect)) return true;
    if (arcHitsRect(sector, rect)) return true;
    const centre = { x: (rect.minX + rect.maxX) / 2, y: (rect.minY + rect.maxY) / 2 };
    return pointInSector(centre, sector);
  }

  function pointInSector(point, sector) {
    const dx = point.x - sector.hinge.x;
    const dy = point.y - sector.hinge.y;
    if (dx * dx + dy * dy > (sector.r + 1e-3) * (sector.r + 1e-3)) return false;
    if (dx * dx + dy * dy <= 1e-6) return true;
    return angleOnSweep(Math.atan2(dy, dx), sector.a0, sector.delta);
  }

  function angleOnSweep(angle, a0, delta) {
    let along = angle - a0;
    while (along > Math.PI) along -= Math.PI * 2;
    while (along < -Math.PI) along += Math.PI * 2;
    if (delta >= 0) return along >= -1e-3 && along <= delta + 1e-3;
    return along <= 1e-3 && along >= delta - 1e-3;
  }

  function arcHitsRect(sector, rect) {
    const edges = [
      [{ x: rect.minX, y: rect.minY }, { x: rect.maxX, y: rect.minY }],
      [{ x: rect.maxX, y: rect.minY }, { x: rect.maxX, y: rect.maxY }],
      [{ x: rect.maxX, y: rect.maxY }, { x: rect.minX, y: rect.maxY }],
      [{ x: rect.minX, y: rect.maxY }, { x: rect.minX, y: rect.minY }],
    ];
    for (const [a, b] of edges) {
      for (const hit of circleSegmentHits(sector.hinge, sector.r, a, b)) {
        if (angleOnSweep(Math.atan2(hit.y - sector.hinge.y, hit.x - sector.hinge.x), sector.a0, sector.delta)) {
          return true;
        }
      }
    }
    return false;
  }

  function circleSegmentHits(origin, radius, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const fx = a.x - origin.x;
    const fy = a.y - origin.y;
    const A = dx * dx + dy * dy;
    if (A < 1e-9) return [];
    const B = 2 * (fx * dx + fy * dy);
    const C = fx * fx + fy * fy - radius * radius;
    const disc = B * B - 4 * A * C;
    if (disc < 0) return [];
    const root = Math.sqrt(disc);
    const hits = [];
    for (const t of [(-B - root) / (2 * A), (-B + root) / (2 * A)]) {
      if (t >= -1e-4 && t <= 1 + 1e-4) hits.push({ x: a.x + dx * t, y: a.y + dy * t });
    }
    return hits;
  }

  function segmentHitsRect(a, b, rect) {
    let t0 = 0;
    let t1 = 1;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const p = [-dx, dx, -dy, dy];
    const q = [a.x - rect.minX, rect.maxX - a.x, a.y - rect.minY, rect.maxY - a.y];
    for (let i = 0; i < 4; i += 1) {
      if (Math.abs(p[i]) < 1e-9) {
        if (q[i] < -1e-4) return false;
      } else {
        const t = q[i] / p[i];
        if (p[i] < 0) {
          if (t > t1) return false;
          if (t > t0) t0 = t;
        } else if (t < t0) return false;
        else if (t < t1) t1 = t;
      }
    }
    return t0 <= t1;
  }

  function pointInRect(point, rect) {
    return point.x >= rect.minX && point.x <= rect.maxX && point.y >= rect.minY && point.y <= rect.maxY;
  }

  function bboxOf(points) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
    return { w: maxX - minX, h: maxY - minY };
  }

  function stripRect() {
    const rail = document.querySelector('.toolrail');
    if (!rail || getComputedStyle(rail).display === 'none') return null;
    const box = rail.getBoundingClientRect();
    if (box.width < 8) return null;
    return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
  }

  function intersects(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  function contains(outer, inner, slack) {
    return inner.left >= outer.left - slack
      && inner.top >= outer.top - slack
      && inner.right <= outer.right + slack
      && inner.bottom <= outer.bottom + slack;
  }

  function unionRect(a, b) {
    if (!a || !(a.width > 0 || a.height > 0)) return b && b.width > 0 ? b : null;
    if (!b || !(b.width > 0 || b.height > 0)) return a;
    const left = Math.min(a.left, b.left);
    const top = Math.min(a.top, b.top);
    const right = Math.max(a.right, b.right);
    const bottom = Math.max(a.bottom, b.bottom);
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }
}
