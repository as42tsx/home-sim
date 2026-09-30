import { launch, newPage, openApp, chooseBlank, setCamera, clickWorld, getPlan, screenOf, report, finish } from './lib.mjs';

const rep = report();
const browser = await launch();
try {
  const { page } = await newPage(browser);
  await openApp(page);
  await chooseBlank(page);
  await setCamera(page, { k: 0.08, x: 200, y: 200 });
  await clickWorld(page, 0, 0);
  await clickWorld(page, 2000, 0);
  await clickWorld(page, 2000, 2000);
  const sizeBefore = await page.evaluate(() => window.__HOMESIM_DEBUG__.store.historySize());
  await page.locator('.topbar [data-action="undo"]').click();
  const afterUndo = await getPlan(page);
  const walls = afterUndo.floors[0].walls.filter((wall) => !wall.demolished).length;
  await page.locator('.topbar [data-action="redo"]').click();
  const afterRedo = (await getPlan(page)).floors[0].walls.filter((wall) => !wall.demolished).length;

  await page.locator('[data-tool="select"]').click();
  const dragBefore = await page.evaluate(() => window.__HOMESIM_DEBUG__.store.historySize());
  const mid = await screenOf(page, 1000, 0);
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.down();
  await page.mouse.move(mid.x, mid.y + 40, { steps: 8 });
  await page.mouse.up();
  const dragAfter = await page.evaluate(() => window.__HOMESIM_DEBUG__.store.historySize());

  await page.evaluate(async () => {
    const { renameCommand } = await import('./src/editor/commands.js');
    const store = window.__HOMESIM_DEBUG__.store;
    for (let i = 0; i < 100; i += 1) store.dispatch(renameCommand(`步骤${i}`));
  });
  const depth = await page.evaluate(() => window.__HOMESIM_DEBUG__.store.historySize());
  await page.locator('.topbar [data-action="undo"]').click();
  const name = (await getPlan(page)).meta.name;
  rep.check('US-10 AC1', walls === 1 && afterRedo === 2 && depth >= 100 && name === '步骤98', `undo walls ${walls} redo ${afterRedo} depth ${depth} name ${name} (start ${sizeBefore})`);
  rep.check('US-10 AC2', dragAfter === dragBefore + 1, `drag steps ${dragBefore} → ${dragAfter}`);

  process.exit(finish(page, rep));
} catch (err) {
  console.log(`FAIL US-10 SCRIPT — ${err.stack || err}`);
  process.exit(1);
} finally {
  await browser.close();
}
