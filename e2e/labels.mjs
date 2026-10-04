/**
 * Room-label clearance and the phone 2D fit.
 * Desktop 1440×900 and phone 390×844, three templates.
 * Visible labels must sit inside the room polygon. Hidden desktop rooms
 * reveal the pill tooltip after 300 ms. Violations fail. There is no soft flag.
 */
import fs from 'node:fs';
import path from 'node:path';
import { launch, newPage, openApp, chooseTemplate, frames, finish, report } from './lib.mjs';

const TEMPLATES = ['apt-1br', 'apt-2br', 'apt-3br'];
const SHOT_DIR = '/workspace/home-sim-shots/2026-10-04-r4';
const HOVER_SHOT = '/workspace/home-sim-shots/2026-10-04-r5/grok-hover-3br.png';
const SLACK = 0.35;
const AREA_RE = /^\d+\.\d{2} m\u00B2$/;

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
  await page.waitForFunction(() => {
    const drawn = document.querySelectorAll('[data-room-label]').length;
    const hidden = window.__HOMESIM_DEBUG__.hiddenLabels?.().length || 0;
    return drawn + hidden > 0;
  });
  const shot = path.join(SHOT_DIR, `grok-${id}-${kind}.png`);
  await page.screenshot({ path: shot });
  const result = await page.evaluate(measure);
  const problems = judge(result, kind);
  const timings = [];
  if (kind === 'phone') {
    for (const room of result.hiddenRooms) {
      const shown = await tapHidden(page, room);
      if (!shown.ok) problems.push(shown.detail);
    }
  }
  if (kind === 'desktop') {
    if (id === 'apt-3br' && !result.rooms.some((room) => room.name === '过道' && room.hidden)) {
      problems.push('过道 still labeled on apt-3br desktop');
    }
    for (const room of result.hiddenRooms) {
      const hover = await hoverHidden(page, room, id === 'apt-3br' && room.name === '过道');
      if (!hover.ok) problems.push(hover.detail);
      else if (hover.timing) timings.push(hover.timing);
    }
    if (result.probe?.point) {
      const quiet = await hoverVisibleQuiet(page, result.probe);
      if (!quiet.ok) problems.push(quiet.detail);
    }
  }
  const worstSolid = worstRoom(result.rooms, 'solid');
  const worstDivider = worstRoom(result.rooms, 'divider');
  const only = result.rooms.filter((room) => room.nameOnly).map((room) => room.name);
  const hidden = result.rooms.filter((room) => room.hidden).map((room) => room.name);
  const stepped = result.rooms.filter((room) => room.fontStep).map((room) => room.name);
  const ratio = result.ratio == null ? 'n/a' : result.ratio.toFixed(3);
  const note = [
    `minSolid ${worstSolid ? `${worstSolid.solid.toFixed(2)}px (${worstSolid.name})` : 'none'}`,
    `minDivider ${worstDivider ? `${worstDivider.divider.toFixed(2)}px (${worstDivider.name})` : 'none'}`,
    only.length ? `name-only ${only.join(',')}` : 'name-only none',
    hidden.length ? `hidden ${hidden.join(',')}` : 'hidden none',
    stepped.length ? `step ${stepped.join(',')}` : 'step none',
    `ratio ${ratio}`,
    `plan ${result.planPx == null ? 'n/a' : result.planPx.toFixed(1)}/${result.availPx == null ? 'n/a' : result.availPx.toFixed(1)}`,
    timings.length ? `tip ${timings.join(', ')}` : '',
    problems.length ? problems.join(' | ') : '',
  ].filter(Boolean).join(' · ');
  rep.check(`labels ${id} ${kind}`, problems.length === 0, note);
}

function worstRoom(rooms, key) {
  return rooms.reduce((best, room) => {
    const value = room[key];
    if (!Number.isFinite(value)) return best;
    if (!best || value < best[key]) return room;
    return best;
  }, null);
}

function judge(result, kind) {
  const problems = [];
  const phone = kind === 'phone';
  if (result.badText.length) problems.push(result.badText.join('; '));
  for (const room of result.rooms) {
    if (room.hidden && room.hasLabel) problems.push(`${room.name} hidden label still drawn`);
    if (room.hasLabel && !room.hidden && room.inside === false) {
      problems.push(`${room.name} label outside room by ${fmt(room.outsidePx)}px`);
    }
    if (!room.hidden && !room.hasLabel) problems.push(`${room.name} missing label`);
    if (room.big && !room.hasArea && !room.hidden && !(phone && room.nameOnly)) {
      problems.push(`${room.name} missing area`);
    }
    if (!room.big && room.hasArea) problems.push(`${room.name} area on a ${room.w}×${room.h} room`);
    if (room.hasArea) {
      if (!AREA_RE.test(room.areaText)) problems.push(`${room.name} area text "${room.areaText}"`);
      else if (room.areaText !== room.expectArea) problems.push(`${room.name} area ${room.areaText} != ${room.expectArea}`);
    }
    if (room.hasLabel && !room.hidden) {
      if (room.scaled) problems.push(`${room.name} transform scale`);
      if (room.textLength) problems.push(`${room.name} textLength`);
      const nameNeed = phone ? 12 : (room.fontStep ? 12 : 13);
      const areaNeed = phone ? 10 : (room.fontStep ? 10 : 12);
      if (!(room.nameH >= nameNeed * 0.9 - 0.05)) problems.push(`${room.name} name box ${fmt(room.nameH)} < ${(nameNeed * 0.9).toFixed(2)}`);
      if (room.hasArea && !(room.areaH >= areaNeed * 0.9 - 0.05)) problems.push(`${room.name} area box ${fmt(room.areaH)} < ${(areaNeed * 0.9).toFixed(2)}`);
    }
    if (!room.hasLabel || room.hidden) continue;
    const nameOnlyPhone = phone && room.nameOnly;
    const needSolid = nameOnlyPhone ? 4 : 8;
    const needDivider = 4;
    if (Number.isFinite(room.solid) && room.solid < needSolid - SLACK) {
      problems.push(`${room.name} solid ${room.solid.toFixed(2)} < ${needSolid} (wall ${fmt(room.wall)} door ${fmt(room.door)})`);
    }
    if (Number.isFinite(room.divider) && room.divider < needDivider - SLACK) {
      problems.push(`${room.name} divider ${room.divider.toFixed(2)} < ${needDivider}`);
    }
  }
  if (phone) {
    if (!(result.ratio >= 0.75 && result.ratio <= 0.88)) {
      problems.push(`ratio ${result.ratio == null ? 'null' : result.ratio.toFixed(3)}`);
    }
    if (result.stripHits.length) problems.push(result.stripHits.slice(0, 4).join('; '));
    if (!result.entryInside) problems.push('入户 outside viewport');
    if (!result.planAboveSheet) problems.push('plan under the sheet');
    if (!result.dimsInside) problems.push('dimension rows clipped');
  }
  return problems;
}

function fmt(value) {
  return Number.isFinite(value) ? value.toFixed(2) : 'none';
}

async function hoverHidden(page, room, shot) {
  if (!room.tap) return { ok: false, detail: `${room.name} no hover point` };
  const pt = room.tap;
  const t0 = Date.now();
  await page.mouse.move(pt.x, pt.y);
  await page.waitForTimeout(150);
  const early = await readTip(page);
  const earlyAt = Date.now() - t0;
  if (early.visible) return { ok: false, detail: `${room.name} tip visible at ${earlyAt}ms` };
  let shownAt = 0;
  while (Date.now() - t0 < 480) {
    const now = await readTip(page);
    if (now.visible) {
      shownAt = Date.now() - t0;
      break;
    }
    await page.waitForTimeout(20);
  }
  if (!shownAt) return { ok: false, detail: `${room.name} tip still hidden at ${Date.now() - t0}ms` };
  if (shownAt < 250) return { ok: false, detail: `${room.name} tip early at ${shownAt}ms` };
  const info = await page.evaluate(() => {
    const tip = document.querySelector('[data-testid="room-hover-tip"]');
    const fill = document.querySelector('[data-testid="room-hover-fill"]');
    const name = tip?.querySelector('.room-hover-name')?.textContent || '';
    const area = tip?.querySelector('.room-hover-area')?.textContent || '';
    const pe = tip ? getComputedStyle(tip).pointerEvents : '';
    let fillValue = '';
    let fillRgb = '';
    let fillBox = null;
    if (fill) {
      fillValue = fill.getAttribute('fill') || '';
      fillRgb = getComputedStyle(fill).fill || '';
      const box = fill.getBoundingClientRect();
      fillBox = { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
    }
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent-tint').trim();
    return { name, area, pe, fillValue, fillRgb, fillBox, accent };
  });
  if (info.name !== room.name) return { ok: false, detail: `${room.name} tip name "${info.name}"` };
  if (!AREA_RE.test(info.area)) return { ok: false, detail: `${room.name} tip area "${info.area}"` };
  if (info.area !== room.expectArea) return { ok: false, detail: `${room.name} tip ${info.area} != ${room.expectArea}` };
  if (info.pe !== 'none') return { ok: false, detail: `${room.name} tip pointer-events ${info.pe}` };
  const fillOk = info.fillValue === 'var(--accent-tint)' || colorsMatch(info.fillRgb, info.accent);
  if (!fillOk) return { ok: false, detail: `${room.name} fill "${info.fillValue}" / "${info.fillRgb}"` };
  if (!info.fillBox || !boxClose(info.fillBox, room.screen, 2.5)) {
    return { ok: false, detail: `${room.name} fill not over room` };
  }
  if (pt.x < info.fillBox.left - 1 || pt.x > info.fillBox.right + 1 || pt.y < info.fillBox.top - 1 || pt.y > info.fillBox.bottom + 1) {
    return { ok: false, detail: `${room.name} hover point outside fill` };
  }
  if (shot) {
    fs.mkdirSync(path.dirname(HOVER_SHOT), { recursive: true });
    await page.screenshot({ path: HOVER_SHOT });
  }
  await page.mouse.move(12, 12);
  await frames(page);
  const gone = await readTip(page);
  if (gone.visible || gone.fill) return { ok: false, detail: `${room.name} hover stayed after leave` };
  await page.mouse.click(pt.x, pt.y);
  await frames(page);
  const shown = await page.evaluate((name) => {
    const inspector = document.querySelector('.inspector');
    const input = inspector?.querySelector('[data-field="room-name"]');
    const total = inspector?.querySelector('.total')?.textContent || '';
    const box = inspector ? inspector.getBoundingClientRect() : null;
    return {
      name: input?.value || '',
      total,
      onRight: !!(box && box.left > window.innerWidth * 0.55 && box.width > 200),
    };
  }, room.name);
  const expect = `使用面积 ${room.expectArea.replace(/ m\u00B2$/, '')} m\u00B2`;
  if (shown.name !== room.name) return { ok: false, detail: `${room.name} inspector name "${shown.name}"` };
  if (!shown.total.includes(expect)) return { ok: false, detail: `${room.name} inspector "${shown.total}"` };
  if (!shown.onRight) return { ok: false, detail: `${room.name} inspector not in the right column` };
  return { ok: true, timing: `${room.name} ${shownAt}ms` };
}

async function hoverVisibleQuiet(page, probe) {
  await page.mouse.move(probe.point.x, probe.point.y);
  await page.waitForTimeout(450);
  const on = await readTip(page);
  await page.mouse.move(12, 12);
  if (on.visible) return { ok: false, detail: `${probe.name} visible label showed a tip` };
  if (on.fill) return { ok: false, detail: `${probe.name} visible label showed a fill` };
  return { ok: true };
}

async function readTip(page) {
  return page.evaluate(() => {
    const tip = document.querySelector('[data-testid="room-hover-tip"]');
    const fill = document.querySelector('[data-testid="room-hover-fill"]');
    const style = tip ? getComputedStyle(tip) : null;
    const visible = !!(tip && !tip.hidden && style && style.display !== 'none' && style.visibility !== 'hidden' && tip.getClientRects().length > 0);
    return { visible, fill: !!fill };
  });
}

function colorsMatch(paint, accent) {
  const parse = (value) => {
    const text = String(value || '').trim().toLowerCase();
    const hex = /^#([0-9a-f]{6})$/.exec(text);
    if (hex) {
      const n = Number.parseInt(hex[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    const rgb = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(text);
    if (!rgb) return null;
    return [Math.round(Number(rgb[1])), Math.round(Number(rgb[2])), Math.round(Number(rgb[3]))];
  };
  const a = parse(paint);
  const b = parse(accent);
  if (!a || !b) return false;
  return Math.abs(a[0] - b[0]) <= 1 && Math.abs(a[1] - b[1]) <= 1 && Math.abs(a[2] - b[2]) <= 1;
}

function boxClose(a, b, tol) {
  if (!a || !b) return false;
  return Math.abs(a.left - b.left) <= tol
    && Math.abs(a.top - b.top) <= tol
    && Math.abs(a.right - b.right) <= tol
    && Math.abs(a.bottom - b.bottom) <= tol;
}

async function tapHidden(page, room) {
  if (!room.tap) return { ok: false, detail: `${room.name} no tap point` };
  await collapseSheet(page);
  const svgBox = await page.locator('.plan-svg').boundingBox();
  if (!svgBox) return { ok: false, detail: `${room.name} no plan` };
  await page.tap('.plan-svg', {
    position: { x: room.tap.x - svgBox.x, y: room.tap.y - svgBox.y },
  });
  await frames(page);
  const tab = await page.locator('[data-sheet-page="props"]').boundingBox();
  if (tab && tab.width >= 44 && tab.height >= 44) await page.tap('[data-sheet-page="props"]');
  else await page.tap('[data-sheet-handle]');
  await frames(page);
  const shown = await page.evaluate(() => {
    const props = document.querySelector('[data-page="props"]');
    const tabBtn = document.querySelector('[data-sheet-page="props"]');
    const input = props?.querySelector('[data-field="room-name"]');
    const total = props?.querySelector('.total')?.textContent || '';
    const open = !!(props && !props.hidden && tabBtn?.classList.contains('is-on') && document.body.dataset.sheet !== '0');
    return { name: input?.value || '', total, open };
  });
  const expect = `使用面积 ${room.expectArea.replace(/ m\u00B2$/, '')} m\u00B2`;
  if (!shown.open) return { ok: false, detail: `${room.name} drawer closed` };
  if (shown.name !== room.name) return { ok: false, detail: `${room.name} inspector name "${shown.name}"` };
  if (!shown.total.includes(expect)) return { ok: false, detail: `${room.name} inspector "${shown.total}"` };
  return { ok: true };
}

async function collapseSheet(page) {
  for (let i = 0; i < 3; i += 1) {
    const snap = await page.evaluate(() => document.body.dataset.sheet || '0');
    if (snap === '0') return;
    await page.tap('[data-sheet-handle]');
    await frames(page);
  }
}

function measure() {
  const debug = window.__HOMESIM_DEBUG__;
  const plan = debug.getPlan();
  const floorId = debug.currentFloorId();
  const floor = (plan.floors || []).find((item) => item.id === floorId) || plan.floors[0];
  const fit = typeof debug.phoneFitInfo === 'function' ? debug.phoneFitInfo() : null;
  const vp = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  const phone = window.innerWidth < 600;
  const origin = debug.worldToScreen(0, 0);
  const unit = debug.worldToScreen(1000, 0);
  const k = Math.abs(unit.x - origin.x) / 1000;

  const labels = [...document.querySelectorAll('[data-room-label]')].map((group) => {
    const name = group.querySelector('.label-name');
    const area = group.querySelector('.label-area');
    const nameBox = name ? name.getBoundingClientRect() : null;
    const areaShown = !!(area && area.getAttribute('visibility') !== 'hidden' && (area.textContent || '').trim());
    const areaBox = areaShown ? area.getBoundingClientRect() : null;
    const box = unionRect(nameBox, areaBox);
    const raw = `${name?.textContent || ''}\n${area?.textContent || ''}`;
    const transform = group.getAttribute('transform') || '';
    return {
      id: group.getAttribute('data-room-label'),
      name: name ? name.textContent : '',
      hasArea: areaShown,
      areaText: areaShown ? (area.textContent || '').trim() : '',
      raw,
      box,
      nameH: nameBox ? nameBox.height : 0,
      areaH: areaBox ? areaBox.height : 0,
      fontStep: group.getAttribute('data-font-step') === '1',
      scaled: /scale\s*\(/i.test(transform),
      textLength: !!((name && name.hasAttribute('textLength')) || (area && area.hasAttribute('textLength'))),
    };
  });

  return import('./src/rooms/index.js').then(async (roomsMod) => {
    const geomMod = await import('./src/editor/opening-geom.js');
    const polyMod = await import('./src/geometry/polygon.js');
    const hitMod = await import('./src/editor/hit.js');
    const all = roomsMod.deriveAllFloors(plan);
    const derived = all[floor.id];
    const nodes = new Map((floor.nodes || []).map((node) => [node.id, node]));
    const faces = derived?.derived || [];
    const byId = new Map(labels.map((label) => [String(label.id), label]));
    const hiddenSet = new Set((debug.hiddenLabels?.() || []).map((item) => String(item)));
    const virtualEdges = [];
    for (const wall of floor.walls || []) {
      if (!wall.virtual || !wall.a || !wall.b) continue;
      const a = nodes.get(wall.a);
      const b = nodes.get(wall.b);
      if (!a || !b) continue;
      virtualEdges.push([debug.worldToScreen(a.x, a.y), debug.worldToScreen(b.x, b.y)]);
    }
    const badText = [];
    for (const label of labels) {
      if (label.raw.includes('使用面积') || label.raw.includes('m2')) badText.push(`${label.name} text "${label.raw.replace(/\s+/g, ' ').trim()}"`);
    }
    const rooms = [];
    const hiddenRooms = [];
    let probe = null;
    for (const face of faces) {
      const id = String(face.roomId);
      const label = byId.get(id);
      const ring = face.polygon?.length >= 3 ? face.polygon : (face.centerline || []);
      const poly = ring.map((point) => debug.worldToScreen(point.x, point.y));
      const holes = (face.holePolygons || []).map((hole) => hole.map((point) => debug.worldToScreen(point.x, point.y)));
      const bounds = bboxOf(poly);
      const big = bounds.w >= 60 && bounds.h >= 40;
      const hidden = hiddenSet.has(id);
      const expectArea = areaShort(face.areaM2);
      const name = label?.name || face.name || id;
      let inside = null;
      let outsidePx = null;
      if (label?.box && (label.box.width > 0 || label.box.height > 0)) {
        const fit = labelInside(label.box, poly, holes, polyMod.pointInPolygon);
        inside = fit.ok;
        outsidePx = fit.outside;
      }
      let solid = null;
      let wall = null;
      let divider = null;
      let door = null;
      if (label?.box && (label.box.width > 0 || label.box.height > 0)) {
        const edges = poly.map((point, index) => [point, poly[(index + 1) % poly.length]]);
        const solidEdges = edges.filter(([a, b]) => !edgeOnDivider(a, b, virtualEdges));
        const sectors = swingsInto(face.polygon, floor, nodes, geomMod.openingGeometry, polyMod.pointInPolygon, debug);
        wall = solidEdges.length ? clearanceOf(label.box, solidEdges, []) : Infinity;
        door = sectors.length ? clearanceOf(label.box, [], sectors, true) : Infinity;
        divider = virtualEdges.length ? clearanceOf(label.box, virtualEdges, []) : Infinity;
        solid = Math.min(wall, door);
      }
      const room = {
        id,
        name,
        w: Math.round(bounds.w),
        h: Math.round(bounds.h),
        big,
        hidden,
        hasLabel: !!label,
        hasArea: !!label?.hasArea,
        nameOnly: !!label && !label.hasArea && !hidden,
        areaText: label?.areaText || '',
        expectArea,
        fontStep: !!label?.fontStep,
        scaled: !!label?.scaled,
        textLength: !!label?.textLength,
        nameH: label?.nameH || 0,
        areaH: label?.areaH || 0,
        solid: solid == null || !Number.isFinite(solid) ? null : Number(solid.toFixed(2)),
        divider: divider == null || !Number.isFinite(divider) ? null : Number(divider.toFixed(2)),
        wall: wall == null ? null : wall,
        door: door == null ? null : door,
        inside,
        outsidePx,
        screen: { left: bounds.minX, top: bounds.minY, right: bounds.maxX, bottom: bounds.maxY },
      };
      rooms.push(room);
      if (hidden) {
        hiddenRooms.push({
          ...room,
          tap: findTap(face, floor, derived, hitMod.hitTest, polyMod.pointInPolygon, debug, k),
        });
      } else if (!phone && !probe) {
        const point = findTap(face, floor, derived, hitMod.hitTest, polyMod.pointInPolygon, debug, k);
        if (point) probe = { name, point };
      }
    }
    const strip = stripRect();
    const stripHits = [];
    let entryInside = true;
    let planAboveSheet = true;
    let dimsInside = true;
    if (phone) {
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
    return {
      rooms,
      hiddenRooms,
      probe,
      badText,
      ratio: fit ? fit.ratio : null,
      planPx: fit ? fit.planPx : null,
      availPx: fit ? fit.availPx : null,
      stripHits: [...new Set(stripHits)],
      entryInside,
      planAboveSheet,
      dimsInside,
    };
  });

  function labelInside(box, poly, holes, pointInPolygon) {
    const slack = 1;
    const rect = { minX: box.left, maxX: box.right, minY: box.top, maxY: box.bottom };
    const midX = (rect.minX + rect.maxX) / 2;
    const midY = (rect.minY + rect.maxY) / 2;
    const samples = [
      { x: rect.minX, y: rect.minY },
      { x: rect.maxX, y: rect.minY },
      { x: rect.maxX, y: rect.maxY },
      { x: rect.minX, y: rect.maxY },
      { x: midX, y: rect.minY },
      { x: midX, y: rect.maxY },
      { x: rect.minX, y: midY },
      { x: rect.maxX, y: midY },
    ];
    let outside = 0;
    for (const point of samples) outside = Math.max(outside, outsideGap(point, poly, holes, pointInPolygon));
    const inner = {
      minX: rect.minX + slack,
      maxX: rect.maxX - slack,
      minY: rect.minY + slack,
      maxY: rect.maxY - slack,
    };
    if (inner.maxX > inner.minX && inner.maxY > inner.minY) {
      const rings = [poly, ...(holes || [])];
      for (const ring of rings) {
        for (let i = 0; i < ring.length; i += 1) {
          if (segmentHitsRect(ring[i], ring[(i + 1) % ring.length], inner)) outside = Math.max(outside, slack + 0.01);
        }
      }
    }
    return { ok: outside <= slack, outside };
  }

  function outsideGap(point, poly, holes, pointInPolygon) {
    if (!pointInPolygon(point, poly)) return distToRing(point, poly);
    for (const hole of holes || []) {
      if (pointInPolygon(point, hole)) return distToRing(point, hole);
    }
    return 0;
  }

  function distToRing(point, ring) {
    let best = Infinity;
    for (let i = 0; i < ring.length; i += 1) {
      best = Math.min(best, distToSeg(point, ring[i], ring[(i + 1) % ring.length]));
    }
    return best;
  }

  function distToSeg(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-6) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
  }

  function edgeOnDivider(a, b, dividers) {
    for (const [c, d] of dividers) {
      if (segmentsCollinearOverlap(a, b, c, d, 0.8)) return true;
    }
    return false;
  }

  function segmentsCollinearOverlap(a, b, c, d, tol) {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len = Math.hypot(abx, aby);
    if (!(len > 1e-6)) return false;
    const off = (px, py) => Math.abs((px - a.x) * aby - (py - a.y) * abx) / len;
    if (off(c.x, c.y) > tol || off(d.x, d.y) > tol) return false;
    const along = (px, py) => ((px - a.x) * abx + (py - a.y) * aby) / (len * len);
    const t0 = Math.min(along(c.x, c.y), along(d.x, d.y));
    const t1 = Math.max(along(c.x, c.y), along(d.x, d.y));
    return t1 > 0.02 && t0 < 0.98;
  }

  function areaShort(m2) {
    const n = Math.round((Number(m2) || 0) * 100) / 100;
    return `${n.toFixed(2)} m\u00B2`;
  }

  function findTap(face, liveFloor, derived, hitTest, pointInPolygon, debugApi, pxPerMm) {
    const poly = face.polygon || [];
    if (poly.length < 3) return null;
    const bounds = bboxOf(poly);
    const samples = [];
    if (face.centroid) samples.push(face.centroid);
    for (let gy = 0; gy < 9; gy += 1) {
      for (let gx = 0; gx < 9; gx += 1) {
        samples.push({
          x: bounds.minX + (bounds.maxX - bounds.minX) * ((gx + 0.5) / 9),
          y: bounds.minY + (bounds.maxY - bounds.minY) * ((gy + 0.5) / 9),
        });
      }
    }
    const sheet = document.querySelector('[data-testid="sheet"]');
    const sheetTop = sheet && getComputedStyle(sheet).display !== 'none'
      ? sheet.getBoundingClientRect().top
      : window.innerHeight;
    for (const world of samples) {
      if (!pointInPolygon(world, poly)) continue;
      let inHole = false;
      for (const hole of face.holePolygons || []) {
        if (pointInPolygon(world, hole)) inHole = true;
      }
      if (inHole) continue;
      const hit = hitTest({
        floor: liveFloor,
        derived,
        world,
        pxPerMm,
        selection: null,
        mode: 'plan',
      });
      if (!hit || hit.kind !== 'room' || String(hit.id) !== String(face.roomId)) continue;
      const screen = debugApi.worldToScreen(world.x, world.y);
      if (screen.x < 2 || screen.y < 2 || screen.x > window.innerWidth - 2) continue;
      if (screen.y >= sheetTop - 2) continue;
      const svg = document.querySelector('.plan-svg');
      const top = document.elementFromPoint(screen.x, screen.y);
      if (!svg || top !== svg) continue;
      return { x: screen.x, y: screen.y };
    }
    return null;
  }

  function swingsInto(polygon, live, nodes, openingGeometry, pointInPolygon, debugApi) {
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
      sectors.push(sectorOf(geom, debugApi));
    }
    return sectors;
  }

  function sectorOf(geom, debugApi) {
    const hinge = debugApi.worldToScreen(geom.hinge.x, geom.hinge.y);
    const jamb = debugApi.worldToScreen(geom.jamb.x, geom.jamb.y);
    const leaf = debugApi.worldToScreen(geom.leaf.x, geom.leaf.y);
    const r = Math.hypot(leaf.x - hinge.x, leaf.y - hinge.y);
    const a0 = Math.atan2(jamb.y - hinge.y, jamb.x - hinge.x);
    const a1 = Math.atan2(leaf.y - hinge.y, leaf.x - hinge.x);
    let delta = a1 - a0;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return { hinge, jamb, leaf, r, a0, delta };
  }

  function clearanceOf(box, edges, sectors, leafArc) {
    const rect = { minX: box.left, maxX: box.right, minY: box.top, maxY: box.bottom };
    const hit = (grown) => (leafArc ? hitsLeafArc(grown, sectors) : hits(grown, edges, sectors));
    if (hit(rect)) {
      let lo = -Math.min(box.width, box.height) / 2;
      let hi = 0;
      for (let i = 0; i < 14; i += 1) {
        const mid = (lo + hi) / 2;
        if (hit(expand(rect, mid))) hi = mid;
        else lo = mid;
      }
      return lo;
    }
    let lo = 0;
    let hi = 4;
    while (hi < 240 && !hit(expand(rect, hi))) hi *= 2;
    for (let i = 0; i < 14; i += 1) {
      const mid = (lo + hi) / 2;
      if (hit(expand(rect, mid))) hi = mid;
      else lo = mid;
    }
    return lo;
  }

  function hitsLeafArc(rect, sectors) {
    for (const sector of sectors) {
      if (segmentHitsRect(sector.hinge, sector.leaf, rect)) return true;
      if (pointInRect(sector.leaf, rect)) return true;
      if (arcHitsRect(sector, rect)) return true;
      for (let i = 0; i <= 8; i += 1) {
        const ang = sector.a0 + sector.delta * (i / 8);
        const point = {
          x: sector.hinge.x + Math.cos(ang) * sector.r,
          y: sector.hinge.y + Math.sin(ang) * sector.r,
        };
        if (pointInRect(point, rect)) return true;
      }
    }
    return false;
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
    return { w: maxX - minX, h: maxY - minY, minX, minY, maxX, maxY };
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
    if (!a || !(a.width > 0 || a.height > 0)) return b && (b.width > 0 || b.height > 0) ? b : null;
    if (!b || !(b.width > 0 || b.height > 0)) return a;
    const left = Math.min(a.left, b.left);
    const top = Math.min(a.top, b.top);
    const right = Math.max(a.right, b.right);
    const bottom = Math.max(a.bottom, b.bottom);
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }
}
