import { launch, newPage, openApp, chooseBlank, chooseTemplate, getPlan, enter3d, shot, report, finish } from './lib.mjs';

const rep = report();
const browser = await launch();

async function check3dLoading(browser, rep) {
  const { context, page } = await newPage(browser, { width: 1440, height: 900 });
  try {
    await openApp(page);
    await chooseBlank(page);
    await page.route(/view3d-boot/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.continue();
    });
    await page.locator('.topbar button[data-mode="view3d"]').click();
    const indicator = page.locator('[data-testid="view3d-loading"]');
    await indicator.waitFor({ state: 'visible', timeout: 5000 });
    const text = (await indicator.innerText()).replace(/\s+/g, ' ').trim();
    const modeBtn = page.locator('.topbar button[data-mode="view3d"]');
    const actionBtn = page.locator('.topbar [data-action="view3d"]');
    const modePressed = await modeBtn.getAttribute('aria-pressed');
    const actionPressed = await actionBtn.getAttribute('aria-pressed');
    const modeDisabled = await modeBtn.isDisabled();
    const actionDisabled = await actionBtn.isDisabled();
    const ok = text.includes('正在加载 3D') && modePressed === 'true' && actionPressed === 'true' && modeDisabled && actionDisabled;
    rep.check('US-07 3D loading', ok, `text ${text} pressed ${modePressed}/${actionPressed} disabled ${modeDisabled}/${actionDisabled}`);
    await page.waitForFunction(() => {
      const node = document.querySelector('[data-testid="view3d-loading"]');
      return document.body.dataset.mode === 'view3d' && node && node.hidden;
    }, null, { timeout: 40000 });
    rep.check('US-07 3D loading done', true, 'indicator hidden when 3D is ready');
  } finally {
    await context.close();
  }
}

async function check3dRetry(browser, rep) {
  const { context, page } = await newPage(browser, { width: 1440, height: 900 });
  try {
    await openApp(page);
    await chooseBlank(page);
    let aborted = false;
    await page.route(/view3d-boot/, async (route) => {
      if (!aborted) {
        aborted = true;
        await route.abort('failed');
        return;
      }
      await route.continue();
    });
    await page.locator('.topbar button[data-mode="view3d"]').click();
    const retry = page.locator('[data-action="view3d-retry"]');
    await retry.waitFor({ state: 'visible', timeout: 15000 });
    const text = (await page.locator('[data-testid="view3d-loading"]').innerText()).replace(/\s+/g, ' ').trim();
    rep.check('US-07 3D fail', text.includes('3D 加载失败，点此重试'), text);
    await retry.click();
    await page.waitForFunction(() => document.body.dataset.mode === 'view3d' && !document.querySelector('.topbar [data-action="view3d"]')?.disabled, null, { timeout: 40000 });
    const gone = await page.locator('[data-testid="view3d-loading"]').isHidden();
    rep.check('US-07 3D retry', gone, '3D loaded after retry');
  } finally {
    await context.close();
  }
}

try {
  await check3dLoading(browser, rep);
  await check3dRetry(browser, rep);
  const { page } = await newPage(browser, { width: 1440, height: 900 });
  await openApp(page);
  await chooseTemplate(page, 'apt-1br');
  await shot(page, 'desktop-2d.png');
  await page.evaluate(async () => {
    const { furnitureAddCommand } = await import('./src/editor/commands.js');
    const dbg = window.__HOMESIM_DEBUG__;
    dbg.store.dispatch(furnitureAddCommand(dbg.currentFloorId(), {
      id: 'bedsync',
      type: 'bed-double',
      name: '双人床',
      cx: 1600,
      cy: 2000,
      z: 0,
      w: 1800,
      d: 2000,
      h: 450,
      rot: 0,
      color: '#c4a484',
    }));
  });
  await page.locator('[data-tool="select"]').click();
  const at = await page.evaluate(() => window.__HOMESIM_DEBUG__.worldToScreen(1600, 2000));
  await page.mouse.click(at.x, at.y);
  const ms = await enter3d(page);
  const home = await page.evaluate(() => window.__HOMESIM_DEBUG__.view3d().debugState().camera.slice());
  await shot(page, 'desktop-3d.png');
  const spots = await page.evaluate(() => {
    const view = window.__HOMESIM_DEBUG__.view3d();
    const plan = window.__HOMESIM_DEBUG__.getPlan();
    const floor = plan.floors[0];
    const nodes = new Map(floor.nodes.map((node) => [node.id, node]));
    const rows = [];
    for (const wall of floor.walls) {
      if (wall.demolished || wall.virtual || rows.length >= 10) continue;
      if ((floor.openings || []).some((op) => op.wall === wall.id)) continue;
      const a = nodes.get(wall.a);
      const b = nodes.get(wall.b);
      if (!a || !b) continue;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 400) continue;
      const t = 0.22;
      const mx = a.x + (b.x - a.x) * t;
      const my = a.y + (b.y - a.y) * t;
      const nx = -(b.y - a.y) / len;
      const ny = (b.x - a.x) / len;
      const ox = (mx + nx * 500) / 1000;
      const oz = (my + ny * 500) / 1000;
      const hits = view.debugRay(ox, 1.3, oz, -nx, 0, -ny);
      const hit = hits.find((item) => item.kind === 'walls');
      if (!hit) {
        rows.push({ id: wall.id, miss: true });
        continue;
      }
      const faceX = (mx + nx * wall.thickness / 2) / 1000;
      const faceZ = (my + ny * wall.thickness / 2) / 1000;
      const err = Math.hypot(hit.point[0] - faceX, hit.point[2] - faceZ) * 1000;
      rows.push({ id: wall.id, err });
    }
    return rows;
  });
  const worst = spots.reduce((max, row) => Math.max(max, row.miss ? 999 : row.err), 0);
  const aligned = spots.length >= 8 && spots.every((row) => !row.miss && row.err <= 10);
  rep.check('US-07 AC1', ms <= 3000 && aligned, `first frame ${ms.toFixed(0)} ms; samples ${spots.length}; worst ${worst.toFixed(1)} mm`);
  rep.manual('US-07 AC2', 'draw calls and fps are measured in perf.mjs on dev/view3d.html?stress=100');
  rep.manual('US-07 AC3', 'single-furniture rebuild count is measured in perf.mjs');
  rep.manual('US-07 AC4', 'idle frame count is measured in perf.mjs');

  const selected = await page.evaluate(() => window.__HOMESIM_DEBUG__.view3d().debugState().selectedId);
  const projected = await page.evaluate(() => window.__HOMESIM_DEBUG__.view3d().debugProject(1600, 2000, 0.3));
  await page.mouse.click(projected.x, projected.y);
  await page.waitForTimeout(100);
  const picked = await page.evaluate(() => window.__HOMESIM_DEBUG__.view3d().debugState().selectedId);
  const name = await page.locator('.inspector [data-field="furn-name"]').inputValue().catch(() => '');

  await page.locator('[data-testid="hud-cutaway"]').click();
  const cut = await page.evaluate(() => window.__HOMESIM_DEBUG__.view3d().debugState().cutaway);
  await page.locator('[data-testid="hud-walk"]').click();
  await page.waitForFunction(() => !document.querySelector('.plan-svg').hidden, null, { timeout: 8000 });
  const start = await page.evaluate(() => window.__HOMESIM_DEBUG__.worldToScreen(1500, 2000));
  await page.mouse.click(start.x, start.y);
  await page.waitForFunction(() => window.__HOMESIM_DEBUG__.view3d()?.debugState?.().walking === true, null, { timeout: 20000 });
  const cam = await page.evaluate(() => window.__HOMESIM_DEBUG__.view3d().debugState().camera);
  const eyeOk = Math.abs(cam[1] - 1.6) < 0.05 && Math.abs(cam[0] - 1.5) < 0.05 && Math.abs(cam[2] - 2.0) < 0.05;
  await page.keyboard.down('w');
  await page.waitForTimeout(1600);
  await page.keyboard.up('w');
  const blocked = await page.evaluate(() => window.__HOMESIM_DEBUG__.view3d().debugState().camera);
  const stopped = blocked[0] > 2.0 && blocked[0] < 3.2;
  rep.check('US-07 AC5', eyeOk && stopped, `eye ${cam.map((n) => n.toFixed(2)).join(',')} after walk x ${blocked[0].toFixed(2)}`);
  await page.keyboard.press('Escape');
  const left = await page.evaluate(() => window.__HOMESIM_DEBUG__.view3d().debugState().walking);
  const canvas = await page.locator('#view3d-host canvas').boundingBox();
  await page.mouse.move(canvas.x + canvas.width * 0.5, canvas.y + canvas.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width * 0.72, canvas.y + canvas.height * 0.62, { steps: 8 });
  await page.mouse.up();
  await page.locator('[data-testid="hud-reset"]').click();
  await page.waitForTimeout(200);
  const reset = await page.evaluate(() => window.__HOMESIM_DEBUG__.view3d().debugState().camera);
  const resetBack = Math.hypot(reset[0] - home[0], reset[1] - home[1], reset[2] - home[2]) < 0.15;
  await page.locator('.topbar [data-action="view3d"]').click();
  await page.waitForFunction(() => document.body.dataset.mode === 'plan');
  const still = await page.evaluate(() => {
    const plan = window.__HOMESIM_DEBUG__.getPlan();
    return plan.floors[0].furniture.some((item) => item.id === 'bedsync');
  });
  const inspector = await page.locator('.inspector [data-field="furn-name"]').inputValue().catch(() => '');
  rep.check('US-07 selection', (selected === 'bedsync' || picked === 'bedsync') && (name === '双人床' || inspector === '双人床') && still && !left && cut && resetBack, `selected ${selected}/${picked} cut ${cut} reset ${resetBack} 2d name ${inspector}`);

  process.exit(finish(page, rep));
} catch (err) {
  console.log(`FAIL US-07 SCRIPT — ${err.stack || err}`);
  process.exit(1);
} finally {
  await browser.close();
}
