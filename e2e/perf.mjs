import { launch, newPage, report, BASE } from './lib.mjs';

const rep = report();
const browser = await launch();
try {
  const { page } = await newPage(browser, { width: 1440, height: 900 });
  const url = new URL('dev/view3d.html?stress=100', BASE).href;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__readyOk === true, null, { timeout: 60000 });
  const boot = await page.evaluate(() => window.__v3d.renderInfo());
  console.log(`PERF boot calls=${boot.calls} triangles=${boot.triangles} frames=${boot.frames}`);

  const canvas = await page.locator('#view canvas').boundingBox();
  const f0 = boot.frames;
  const t0 = Date.now();
  await page.mouse.move(canvas.x + canvas.width * 0.5, canvas.y + canvas.height * 0.5);
  await page.mouse.down();
  while (Date.now() - t0 < 3000) {
    const t = (Date.now() - t0) / 3000;
    await page.mouse.move(
      canvas.x + canvas.width * (0.35 + 0.3 * t),
      canvas.y + canvas.height * (0.4 + 0.12 * Math.sin(t * 12)),
    );
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  const orbit = await page.evaluate(() => window.__v3d.renderInfo());
  const fps = (orbit.frames - f0) / 3;
  console.log(`PERF orbit fps=${fps.toFixed(2)} calls=${orbit.calls} triangles=${orbit.triangles} frames=${orbit.frames}`);
  rep.check('US-07 AC2 fps', fps >= 50, `${fps.toFixed(1)} fps / 3s orbit under swiftshader (CPU renderer, lower bound, not a mid-range laptop)`);
  rep.check('US-07 AC2 calls', orbit.calls <= 400, `draw calls ${orbit.calls}, triangles ${orbit.triangles}`);

  await page.waitForTimeout(1100);
  const idle0 = await page.evaluate(() => window.__v3d.renderInfo().frames);
  await page.waitForTimeout(1000);
  const idle1 = await page.evaluate(() => window.__v3d.renderInfo().frames);
  console.log(`PERF idle frames after 1s settle: ${idle1 - idle0} (from ${idle0} to ${idle1})`);
  rep.check('US-07 AC4', idle1 === idle0, `frames during the second idle second: ${idle1 - idle0}`);

  const before = await page.evaluate(() => window.__v3d.renderInfo());
  await page.locator('#btn-recolor').click();
  await page.waitForTimeout(50);
  const after = await page.evaluate(() => window.__v3d.renderInfo());
  const builds = after.furnitureBuilds - before.furnitureBuilds;
  console.log(`PERF recolor builds=${builds} lastBuildMs=${after.lastBuildMs}`);
  rep.check('US-07 AC3', builds === 1 && after.lastBuildMs <= 16, `rebuilds ${builds}, lastBuildMs ${after.lastBuildMs}`);

  if (page._hs.notes.length) console.log(`NOTE console noise ×${page._hs.notes.length}: ${page._hs.notes[0].slice(0, 180)}`);
  if (page._hs.errors.length) rep.check('CONSOLE', false, page._hs.errors.slice(0, 3).join(' | ').slice(0, 400));
  else rep.check('CONSOLE', true, 'no page errors');
  process.exit(rep.fails.length ? 1 : 0);
} catch (err) {
  console.log(`FAIL PERF SCRIPT — ${err.stack || err}`);
  process.exit(1);
} finally {
  await browser.close();
}
