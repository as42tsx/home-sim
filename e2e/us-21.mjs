import fs from 'node:fs';
import path from 'node:path';
import { launch, newPage, openApp, getPlan, enter3d, report, finish, readDownload, ROOT } from './lib.mjs';

const rep = report();
const browser = await launch();
try {
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/two-floor-stair.json'), 'utf8'));
  const { page } = await newPage(browser);
  await openApp(page);
  await page.locator('input[type="file"]').setInputFiles(path.join(ROOT, 'fixtures/two-floor-stair.json'));
  await page.waitForFunction(() => !document.body.classList.contains('is-picker'));
  const toast = await page.locator('[data-testid="toast"]').innerText();
  const plan = await getPlan(page);
  const lowest = [...plan.floors].sort((a, b) => a.elevation - b.elevation)[0];
  const current = await page.evaluate(() => window.__HOMESIM_DEBUG__.currentFloorId());
  const switcher = await page.locator('[data-testid="floor-switcher"]').evaluate((el) => ({
    count: el.dataset.count,
    current: el.dataset.current,
    text: el.textContent,
    hidden: el.hidden,
  }));
  const svgText = await page.evaluate(() => document.querySelector('.plan-svg')?.textContent || '');
  rep.check(
    'US-21 AC3 2D',
    current === lowest.id && lowest.name === '1F' && switcher.count === '2' && toast.includes('2') && svgText.includes('客厅') && !svgText.includes('主卧'),
    `floor ${lowest.name} toast ${toast.slice(0, 40)} svgHas主卧 ${svgText.includes('主卧')}`,
  );

  await enter3d(page);
  const state = await page.evaluate(() => window.__HOMESIM_DEBUG__.view3d().debugState());
  const elevations = state.floors.map((floor) => floor.elevation).sort((a, b) => a - b);
  const stacked = state.floors.length === 2 && state.floors.every((floor) => floor.visible) && elevations[1] - elevations[0] > 2;
  const hole = await page.evaluate(() => {
    const view = window.__HOMESIM_DEBUG__.view3d();
    const inside = view.debugRay(6, 8, 4.75, 0, -1, 0);
    const outside = view.debugRay(1, 8, 1, 0, -1, 0);
    const slab = (hits) => hits.find((hit) => hit.kind === 'slab' && hit.floorId === 'f2');
    return { inside: slab(inside)?.kind || 'none', outside: slab(outside)?.kind || 'none' };
  });
  rep.check('US-21 AC3 3D', stacked && hole.inside === 'none' && hole.outside === 'slab', `elev ${elevations.join(',')} hole inside ${hole.inside} outside ${hole.outside}`);

  await page.locator('[data-testid="hud-back"]').click();
  await page.waitForFunction(() => !document.querySelector('.plan-svg').hidden, null, { timeout: 8000 });
  await page.locator('.inspector [data-field="room-name"], .inspector .room-row').first().click();
  const nameBox = page.locator('.inspector [data-field="room-name"]');
  if (await nameBox.count()) {
    await nameBox.fill('客厅已改');
    await nameBox.dispatchEvent('change');
  } else {
    await page.evaluate(async () => {
      const { roomPatchCommand } = await import('./src/editor/commands.js');
      const dbg = window.__HOMESIM_DEBUG__;
      const floor = dbg.getPlan().floors.find((item) => item.id === dbg.currentFloorId());
      dbg.store.dispatch(roomPatchCommand(floor.id, floor.rooms[0].id, { name: '客厅已改' }));
    });
  }
  const downloaded = await readDownload(page, async () => {
    await page.locator('.topbar [data-action="file-menu"]').click();
    await page.locator('.topbar [data-action="export-json"]').click();
  });
  const exported = JSON.parse(fs.readFileSync(downloaded.file, 'utf8'));
  const f2 = exported.floors.find((floor) => floor.id === 'f2');
  const fix2 = fixture.floors.find((floor) => floor.id === 'f2');
  const sameFloor = JSON.stringify(f2) === JSON.stringify(fix2);
  const sameStairs = JSON.stringify(exported.stairs) === JSON.stringify(fixture.stairs);
  const edited = exported.floors.find((floor) => floor.id === 'f1').rooms.some((room) => room.name === '客厅已改');
  rep.check('US-21 AC4', sameFloor && sameStairs && edited, `2F ${sameFloor} stairs ${sameStairs} edited ${edited}`);

  await enter3d(page);
  const before = await page.evaluate(() => window.__HOMESIM_DEBUG__.renderInfo());
  await page.evaluate(() => window.__HOMESIM_DEBUG__.view3d().setFloorVisible('f2', false));
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => window.__HOMESIM_DEBUG__.renderInfo());
  const hidden = after.floors.f2;
  rep.check('US-21 AC5', hidden && hidden.visible === false && hidden.calls === 0 && after.calls < before.calls, `calls ${before.calls} → ${after.calls} f2 ${JSON.stringify(hidden)}`);

  process.exit(finish(page, rep));
} catch (err) {
  console.log(`FAIL US-21 SCRIPT — ${err.stack || err}`);
  process.exit(1);
} finally {
  await browser.close();
}
