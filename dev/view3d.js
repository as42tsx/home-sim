/**
 * Standalone harness for the 3D view. Serves templates, the two-floor fixture,
 * and a 100-item stress plan. The HUD refreshes only when a frame was drawn.
 */

import { createView3D } from '../src/view3d/index.js';
import { TYPE_DEFAULTS } from '../src/view3d/furniture-shapes.js';
import { deriveRooms } from '../src/rooms/index.js';
import { centroid, pointInPolygon } from '../src/geometry/polygon.js';

const params = new URLSearchParams(location.search);
const hud = document.querySelector('#hud');
const status = document.querySelector('#status');

function lowestFloor(plan) {
  let best = null;
  for (const floor of plan.floors || []) {
    if (!floor || floor.id == null) continue;
    if (!best) {
      best = floor;
      continue;
    }
    const delta = (floor.elevation ?? 0) - (best.elevation ?? 0);
    if (delta < 0 || (delta === 0 && String(floor.id) < String(best.id))) best = floor;
  }
  return best;
}

function safeName(value, fallback) {
  const name = String(value || fallback);
  return /^[A-Za-z0-9._-]+$/.test(name) ? name : fallback;
}

async function loadJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`无法加载 ${url} (${response.status})`);
  const doc = await response.json();
  return doc.plan || doc;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PALETTE = ['#c4a574', '#8d9a86', '#d8c3a5', '#a98b72', '#6e8b8a', '#b5653a', '#5c5348', '#e39a6c', '#2a6390', '#ecd8bb'];

function addStress(plan, count) {
  const floor = lowestFloor(plan);
  if (!floor) return;
  const derived = deriveRooms(plan, floor.id);
  const spots = [];
  for (const face of derived.derived || []) {
    const ring = face.polygon;
    if (!ring || ring.length < 3) continue;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of ring) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    for (let y = minY + 350; y < maxY - 200; y += 650) {
      for (let x = minX + 350; x < maxX - 200; x += 650) {
        if (pointInPolygon({ x, y }, ring)) spots.push({ x, y });
      }
    }
    if (!spots.length) {
      const c = centroid(ring);
      spots.push({ x: c.x, y: c.y });
    }
  }
  if (!spots.length) spots.push({ x: 1000, y: 1000 });
  const types = Object.keys(TYPE_DEFAULTS);
  const rng = mulberry32(0x3d);
  const items = [];
  for (let i = 0; i < count; i += 1) {
    const type = types[i % types.length];
    const size = TYPE_DEFAULTS[type];
    const spot = spots[i % spots.length];
    const jitterX = (rng() - 0.5) * 180;
    const jitterY = (rng() - 0.5) * 180;
    let x = spot.x + jitterX;
    let y = spot.y + jitterY;
    const ringHit = (derived.derived || []).find((face) => face.polygon && pointInPolygon({ x, y }, face.polygon));
    if (!ringHit) {
      x = spot.x;
      y = spot.y;
    }
    const turns = Math.floor(rng() * 4);
    items.push({
      id: `stress-${i}`,
      type,
      cx: x,
      cy: y,
      z: 0,
      w: size.w,
      d: size.d,
      h: size.h,
      rot: turns * 90,
      color: PALETTE[i % PALETTE.length],
    });
  }
  floor.furniture = items;
}

async function loadPlan() {
  if (params.has('stress')) {
    const plan = await loadJson('../templates/apt-3br.json');
    addStress(plan, Number(params.get('stress')) || 100);
    return plan;
  }
  if (params.has('fixture')) {
    return loadJson(`../fixtures/${safeName(params.get('fixture'), 'two-floor-stair')}.json`);
  }
  return loadJson(`../templates/${safeName(params.get('t'), 'apt-2br')}.json`);
}

const plan = await loadPlan();
const floor = lowestFloor(plan);
window.__plan = plan;
window.__errors = [];

const view = await createView3D({
  container: document.querySelector('#view'),
  getPlan: () => plan,
  floorId: floor ? floor.id : null,
  reducedMotion: params.has('reduced'),
  onSelectFurniture(id) {
    status.textContent = id ? `选中 ${id}` : '未选中';
    view.select(id);
  },
});

window.__v3d = view;
window.__HOMESIM_DEBUG__ = {
  renderInfo: () => view.renderInfo(),
  view,
};

let seenFrames = -1;
function paintHud() {
  const info = view.renderInfo();
  if (info.frames === seenFrames) return;
  seenFrames = info.frames;
  hud.textContent = JSON.stringify(info, null, 2);
}
function hudLoop() {
  paintHud();
  requestAnimationFrame(hudLoop);
}
hudLoop();

document.querySelector('#btn-enter').addEventListener('click', () => {
  view.enter({ animate: !params.has('instant') });
});
document.querySelector('#btn-exit').addEventListener('click', () => {
  view.exit({ animate: true });
});

const cutawayBtn = document.querySelector('#btn-cutaway');
cutawayBtn.addEventListener('click', () => {
  const on = cutawayBtn.getAttribute('aria-pressed') !== 'true';
  cutawayBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  view.setCutaway(on);
});

const walkBtn = document.querySelector('#btn-walk');
walkBtn.addEventListener('click', () => {
  const on = walkBtn.getAttribute('aria-pressed') !== 'true';
  walkBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  if (on) view.enterWalk();
  else view.exitWalk();
});

let recolorCursor = 0;
document.querySelector('#btn-recolor').addEventListener('click', () => {
  let host = null;
  for (const level of plan.floors || []) {
    if (level.furniture && level.furniture.length) {
      host = level;
      break;
    }
  }
  if (!host) {
    status.textContent = '这个方案没有家具';
    return;
  }
  const item = host.furniture[recolorCursor % host.furniture.length];
  recolorCursor += 1;
  const next = PALETTE[recolorCursor % PALETTE.length];
  item.color = next;
  view.update({ kind: 'furniture', floorId: host.id, ids: [item.id] });
  status.textContent = `改色 ${item.id} → ${next}`;
});

document.querySelector('#btn-png').addEventListener('click', async () => {
  const blob = await view.toPNG({ longEdge: 1600 });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'view3d.png';
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  status.textContent = `PNG ${blob.size} 字节`;
});

window.__ready = (async () => {
  try {
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
    await view.enter({ animate: false });
    paintHud();
    status.textContent = `楼层 ${floor ? floor.id : '—'}`;
    window.__readyOk = true;
    return true;
  } catch (err) {
    window.__bootError = String(err && err.stack ? err.stack : err);
    status.textContent = window.__bootError;
    throw err;
  }
})();
