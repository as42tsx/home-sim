/**
 * Playwright helpers for Home Sim P0 checks.
 * playwright-core is resolved from PW_CORE and is not a repo dependency.
 */

import fs from 'node:fs';
import path from 'node:path';

export const BASE = process.env.BASE_URL || 'http://127.0.0.1:8766/home-sim/';
export const SHOTS = '/workspace/home-sim-shots';
export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const PW = process.env.PW_CORE || '/workspace/tools/pw/node_modules/playwright-core/index.mjs';
const CHROME = '/usr/bin/google-chrome';
const ARGS = ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const NOISE = /favicon|slow network|swiftshader|SwiftShader|WebGL|WEBGL|GL_|GPU process|GroupMarker|Automatic fallback|ANGLE|crbug|deprecated_endpoint/i;

export function report() {
  const fails = [];
  return {
    fails,
    check(id, ok, note = '') {
      const line = `${ok ? 'PASS' : 'FAIL'} ${id}${note ? ` — ${note}` : ''}`;
      console.log(line);
      if (!ok) fails.push(id);
      return ok;
    },
    manual(id, note) {
      console.log(`MANUAL ${id} — ${note}`);
    },
  };
}

export async function launch() {
  const pw = await import(PW);
  const browser = await pw.chromium.launch({
    executablePath: CHROME,
    args: ARGS,
    headless: true,
  });
  return browser;
}

export async function newPage(browser, opts = {}) {
  const mobile = !!opts.mobile;
  const context = await browser.newContext({
    viewport: { width: opts.width || (mobile ? 390 : 1440), height: opts.height || (mobile ? 844 : 900) },
    isMobile: mobile,
    hasTouch: mobile,
    deviceScaleFactor: mobile ? 2 : 1,
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:8766' });
  await context.addInitScript(() => {
    try {
      if (sessionStorage.getItem('homesim-e2e-keep') === '1') return;
      localStorage.clear();
    } catch { /* storage may be blocked */ }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  const notes = [];
  const hosts = new Set();
  page.on('pageerror', (err) => errors.push(`pageerror: ${err && err.message ? err.message : err}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (NOISE.test(text)) notes.push(text);
    else errors.push(text);
  });
  page.on('request', (req) => {
    try { hosts.add(new URL(req.url()).host); } catch { /* data urls */ }
  });
  page._hs = { errors, notes, hosts };
  return { context, page };
}

export async function openApp(page, url = BASE) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => document.documentElement.dataset.app === 'ready', null, { timeout: 25000 });
}

export async function frames(page) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

export async function chooseBlank(page) {
  await page.locator('[data-testid="blank"]').click();
  await page.waitForFunction(() => !document.body.classList.contains('is-picker'));
  await frames(page);
}

export async function chooseTemplate(page, id) {
  await page.locator(`[data-testid="template-${id}"]`).click();
  await page.waitForFunction(() => !document.body.classList.contains('is-picker'));
  await frames(page);
}

export async function getPlan(page) {
  return page.evaluate(() => window.__HOMESIM_DEBUG__.getPlan());
}

export async function screenOf(page, x, y) {
  return page.evaluate(({ x, y }) => window.__HOMESIM_DEBUG__.worldToScreen(x, y), { x, y });
}

export async function clickWorld(page, x, y, opts = {}) {
  const p = await screenOf(page, x, y);
  if (opts.shift) await page.keyboard.down('Shift');
  await page.mouse.click(p.x, p.y);
  if (opts.shift) await page.keyboard.up('Shift');
  return p;
}

export async function moveWorld(page, x, y) {
  const p = await screenOf(page, x, y);
  await page.mouse.move(p.x, p.y);
  return p;
}

export async function setCamera(page, cam) {
  await page.evaluate((cam) => window.__HOMESIM_DEBUG__.setCamera(cam), cam);
}

export async function derive(page) {
  return page.evaluate(async () => {
    const { deriveAllFloors } = await import('./src/rooms/index.js');
    const plan = window.__HOMESIM_DEBUG__.getPlan();
    const floorId = window.__HOMESIM_DEBUG__.currentFloorId();
    const all = deriveAllFloors(plan);
    const live = all[floorId];
    return {
      floorId,
      count: live.derived.length,
      gap: live.unclosed?.gap ?? null,
      faces: live.derived.map((face) => ({
        name: face.name,
        roomId: face.roomId,
        areaM2: face.areaM2,
        centerlineAreaM2: face.centerlineAreaM2,
        area: face.area,
        cx: face.centroid.x,
        cy: face.centroid.y,
        minX: Math.min(...face.polygon.map((p) => p.x)),
        maxX: Math.max(...face.polygon.map((p) => p.x)),
        minY: Math.min(...face.polygon.map((p) => p.y)),
        maxY: Math.max(...face.polygon.map((p) => p.y)),
      })),
    };
  });
}

/** Wall whose midpoint is nearest (x, y), within `tol` mm. Template loads remap ids. */
export function wallNear(plan, x, y, tol = 180) {
  const floor = plan.floors[0];
  if (!floor) return null;
  const nodes = new Map((floor.nodes || []).map((node) => [node.id, node]));
  let best = null;
  let bestD = tol;
  for (const wall of floor.walls || []) {
    if (wall.demolished) continue;
    const a = nodes.get(wall.a);
    const b = nodes.get(wall.b);
    if (!a || !b) continue;
    const d = Math.hypot((a.x + b.x) / 2 - x, (a.y + b.y) / 2 - y);
    if (d <= bestD) {
      bestD = d;
      best = wall;
    }
  }
  return best;
}

export function wallEnds(plan, floorId) {
  const floor = plan.floors.find((item) => item.id === floorId) || plan.floors[0];
  const nodes = new Map(floor.nodes.map((node) => [node.id, node]));
  return floor.walls.filter((wall) => !wall.demolished).map((wall) => {
    const a = nodes.get(wall.a);
    const b = nodes.get(wall.b);
    return {
      id: wall.id,
      thickness: wall.thickness,
      bearing: !!wall.bearing,
      ax: a?.x, ay: a?.y, bx: b?.x, by: b?.y,
      len: a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0,
    };
  });
}

export async function enter3d(page) {
  await page.evaluate(() => {
    window.__t3d = performance.now();
    const active = document.activeElement;
    if (active && active !== document.body) active.blur();
  });
  await page.keyboard.press('t');
  await page.waitForFunction(() => {
    const button = document.querySelector('.topbar [data-action="view3d"]');
    return document.body.dataset.mode === 'view3d' && button && !button.disabled;
  }, null, { timeout: 40000 });
  return page.evaluate(() => performance.now() - window.__t3d);
}

export async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const file = path.join(SHOTS, name);
  await page.screenshot({ path: file });
  return file;
}

export function pngSize(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 1, 4) !== 'PNG') throw new Error('not a png');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), bytes: buf.length };
}

export async function readDownload(page, trigger, timeout = 120000) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout }),
    trigger(),
  ]);
  const file = await download.path();
  return { file, name: download.suggestedFilename() };
}

export function structural(plan) {
  return {
    schemaVersion: plan.schemaVersion,
    floors: plan.floors,
    stairs: plan.stairs || [],
    markers: plan.markers || null,
  };
}

export function finish(page, rep) {
  const bag = page._hs || { errors: [], notes: [] };
  if (bag.notes.length) console.log(`NOTE console noise ×${bag.notes.length}: ${bag.notes[0].slice(0, 180)}`);
  if (bag.errors.length) rep.check('CONSOLE', false, bag.errors.slice(0, 4).join(' | ').slice(0, 500));
  else rep.check('CONSOLE', true, 'no page errors');
  return rep.fails.length ? 1 : 0;
}
