import { launch, newPage, openApp, chooseTemplate, clickWorld, getPlan, derive, screenOf, report, finish, wallNear } from './lib.mjs';

const rep = report();
const browser = await launch();
try {
  const { page } = await newPage(browser);
  await openApp(page);
  await chooseTemplate(page, 'apt-1br');
  const beforeDrag = await derive(page);
  const bedBefore = beforeDrag.faces.find((face) => face.name === '卧室').areaM2;
  await page.locator('[data-tool="select"]').click();
  const mid = await screenOf(page, 3300, 1050);
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.down();
  const dest = await screenOf(page, 3600, 1050);
  await page.mouse.move(dest.x, dest.y, { steps: 6 });
  await page.mouse.up();
  const dragged = await derive(page);
  const bedDrag = dragged.faces.find((face) => face.name === '卧室')?.areaM2;
  const plan = await getPlan(page);
  const moved = plan.floors[0].nodes.some((node) => Math.abs(node.x - 3600) < 80 && Math.abs(node.y) < 40);
  rep.check('US-05 AC1', moved && bedDrag != null && Math.abs(bedDrag - bedBefore) > 0.01, `n2 moved ${moved} area ${bedBefore} → ${bedDrag}`);
  await page.locator('.topbar [data-action="undo"]').click();

  await clickWorld(page, 3300, 1050);
  await page.locator('.inspector [data-field="wall-bearing"]').check();
  await page.locator('[data-tool="demolish"]').click();
  await clickWorld(page, 3300, 1050);
  const toast = await page.locator('[data-testid="toast"]').innerText();
  let now = await getPlan(page);
  const still = wallNear(now, 3300, 1050);
  rep.check('US-05 AC2', !!still && toast.includes('承重墙'), toast);

  await page.locator('[data-tool="select"]').click();
  await clickWorld(page, 3300, 1050);
  await page.locator('.inspector [data-field="wall-bearing"]').uncheck();
  const snapshot = (await getPlan(page)).floors[0].rooms.map((room) => ({ id: room.id, name: room.name, type: room.type, floor: room.floor }));
  const countBefore = (await derive(page)).count;
  await page.locator('[data-tool="demolish"]').click();
  await clickWorld(page, 3300, 1050);
  await page.locator('[data-action="modal-ok"]').click();
  const merged = await derive(page);
  const bedroom = merged.faces.find((face) => face.name === '卧室');
  rep.check(
    'US-05 AC3 merge',
    merged.count === countBefore - 1 && bedroom && Math.abs(bedroom.areaM2 - 15.6384) < 0.02,
    `rooms ${countBefore} → ${merged.count} 卧室 ${bedroom?.areaM2}`,
  );
  await page.locator('.topbar [data-action="undo"]').click();
  const restored = (await getPlan(page)).floors[0].rooms.map((room) => ({ id: room.id, name: room.name, type: room.type, floor: room.floor }));
  const same = JSON.stringify(restored) === JSON.stringify(snapshot);
  rep.check('US-05 AC3 undo', same && (await derive(page)).count === countBefore, `names/materials restored ${same}`);

  process.exit(finish(page, rep));
} catch (err) {
  console.log(`FAIL US-05 SCRIPT — ${err.stack || err}`);
  process.exit(1);
} finally {
  await browser.close();
}
