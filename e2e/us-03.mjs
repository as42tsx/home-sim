import { launch, newPage, openApp, chooseBlank, chooseTemplate, setCamera, clickWorld, derive, getPlan, enter3d, report, finish } from './lib.mjs';

const rep = report();
const browser = await launch();
try {
  const { page } = await newPage(browser);
  await openApp(page);
  await chooseTemplate(page, 'apt-1br');
  const before = await derive(page);
  const bed = before.faces.find((face) => face.name === '卧室');
  await page.locator('[data-tool="wall"]').click();
  await clickWorld(page, 1650, 0);
  await clickWorld(page, 1650, 3900);
  const after = await derive(page);
  const parts = after.faces.filter((face) => face.cx > 120 && face.cx < 3240 && face.cy > 120 && face.cy < 3840);
  const sum = parts.reduce((total, face) => total + face.area, 0);
  const span = bed.maxY - bed.minY;
  const plan = await getPlan(page);
  const floor = plan.floors.find((item) => item.id === after.floorId);
  const splitter = floor.walls.filter((wall) => !wall.demolished).find((wall) => {
    const nodes = new Map(floor.nodes.map((node) => [node.id, node]));
    const a = nodes.get(wall.a);
    const b = nodes.get(wall.b);
    return a && b && Math.abs(a.x - 1650) < 2 && Math.abs(b.x - 1650) < 2;
  });
  const footprint = (splitter?.thickness || 0) * span;
  const delta = Math.abs(bed.area - (sum + footprint)) / 1e6;
  const others = before.faces.filter((face) => face.name !== '卧室').every((face) => {
    const next = after.faces.find((item) => item.name === face.name);
    return next && Math.abs(next.areaM2 - face.areaM2) < 0.001;
  });
  rep.check('US-03 AC1', after.count === before.count + 1 && parts.length === 2 && delta <= 0.01 && others, `parts ${parts.length} |Δ| ${delta.toFixed(4)} m² span ${span}`);

  await page.locator('[data-tool="select"]').click();
  const kitchen = before.faces.find((face) => face.name === '厨房');
  await clickWorld(page, kitchen.cx, kitchen.cy);
  await page.locator('.inspector select[data-field="room-type"]').selectOption('bath');
  const typed = await getPlan(page);
  const room = typed.floors.find((item) => item.id === after.floorId).rooms.find((item) => item.name === '厨房' || item.type === 'bath');
  const bath = typed.floors.find((item) => item.id === after.floorId).rooms.find((item) => item.type === 'bath' && item.floor === 'nonslip');
  await enter3d(page);
  const info = await page.evaluate(() => window.__HOMESIM_DEBUG__.renderInfo());
  rep.check('US-03 AC2', !!bath && info.frames > 0, `floor ${bath?.floor || room?.floor}; 3D frames ${info.frames} (colour follows the room-type token)`);

  await page.locator('.topbar [data-action="view3d"]').click();
  await page.waitForFunction(() => document.body.dataset.mode === 'plan' && !document.querySelector('.plan-svg').hidden);

  const { page: open } = await newPage(browser);
  await openApp(open);
  await chooseBlank(open);
  await setCamera(open, { k: 0.08, x: 180, y: 160 });
  await clickWorld(open, 0, 0);
  await clickWorld(open, 3000, 0);
  await clickWorld(open, 3000, 2000);
  const gap = await derive(open);
  const text = await open.evaluate(() => `${document.querySelector('.inspector')?.innerText || ''}\n${document.querySelector('.plan-svg')?.textContent || ''}`);
  rep.check('US-03 AC3', gap.count === 0 && gap.gap > 1 && text.includes('还差'), `rooms ${gap.count} gap ${gap.gap}`);

  open._hs.errors.push(...page._hs.errors);
  open._hs.notes.push(...page._hs.notes);
  process.exit(finish(open, rep));
} catch (err) {
  console.log(`FAIL US-03 SCRIPT — ${err.stack || err}`);
  process.exit(1);
} finally {
  await browser.close();
}
