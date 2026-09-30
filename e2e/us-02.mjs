import { launch, newPage, openApp, chooseBlank, getPlan, derive, setCamera, clickWorld, moveWorld, screenOf, wallEnds, report, finish } from './lib.mjs';

const rep = report();
const browser = await launch();
try {
  const { page } = await newPage(browser);
  await openApp(page);
  await chooseBlank(page);
  await setCamera(page, { k: 0.08, x: 160, y: 220 });

  await clickWorld(page, 1000, 1000);
  await moveWorld(page, 4000, 1000);
  await page.keyboard.type('3600');
  await page.keyboard.press('Enter');
  let plan = await getPlan(page);
  let walls = wallEnds(plan, plan.floors[0].id);
  const typed = walls.find((wall) => Math.abs(wall.len - 3600) < 1);
  rep.check('US-02 AC2', !!typed && Math.abs(typed.ay - typed.by) < 1, typed ? `len ${typed.len.toFixed(1)}` : `walls ${walls.length}`);

  await page.keyboard.press('Escape');
  const origin = await screenOf(page, 1000, 1000);
  await page.mouse.click(origin.x + 8, origin.y);
  await clickWorld(page, 1000, 3200);
  await page.keyboard.press('Escape');
  plan = await getPlan(page);
  walls = wallEnds(plan, plan.floors[0].id);
  const vertical = walls.find((wall) => Math.abs(wall.ax - 1000) < 1 && Math.abs(wall.bx - 1000) < 1 && Math.abs(wall.len - 2200) < 2);
  const orthoStart = walls.find((wall) => Math.abs(wall.len - 3600) < 1);
  await clickWorld(page, orthoStart.bx, orthoStart.by);
  const ang = (4 * Math.PI) / 180;
  await clickWorld(page, orthoStart.bx + Math.cos(ang) * 2000, orthoStart.by + Math.sin(ang) * 2000);
  await page.keyboard.press('Escape');
  plan = await getPlan(page);
  walls = wallEnds(plan, plan.floors[0].id);
  const ortho = walls.find((wall) => Math.abs(wall.ay - orthoStart.by) < 1 && Math.abs(wall.by - orthoStart.by) < 1 && wall.len > 1500 && wall.len < 2500);

  await clickWorld(page, 1000, 3200);
  await clickWorld(page, 1000 + Math.cos(ang) * 1800, 3200 + Math.sin(ang) * 1800, { shift: true });
  await page.keyboard.press('Escape');
  plan = await getPlan(page);
  walls = wallEnds(plan, plan.floors[0].id);
  const shifted = walls.find((wall) => Math.abs(wall.ax - 1000) < 2 && Math.abs(wall.ay - 3200) < 2 && Math.abs((wall.by - wall.ay) - Math.sin(ang) * 1800) < 30);
  rep.check('US-02 AC3', !!vertical && !!ortho && !!shifted, `endpoint=${!!vertical} ortho=${!!ortho} shift=${!!shifted}`);

  const beforeEsc = walls.length;
  await page.keyboard.press('Escape');
  await clickWorld(page, 7000, 5000);
  await page.keyboard.press('Escape');
  plan = await getPlan(page);
  walls = wallEnds(plan, plan.floors[0].id);
  rep.check('US-02 AC4', walls.length === beforeEsc, `walls ${beforeEsc} → ${walls.length}`);

  const oldThickness = walls.map((wall) => wall.thickness);
  await page.locator('.sidepanel [data-action="pref-thickness"][data-value="120"]').click();
  await clickWorld(page, 5000, 4000);
  await clickWorld(page, 5000, 5600);
  await page.keyboard.press('Escape');
  plan = await getPlan(page);
  walls = wallEnds(plan, plan.floors[0].id);
  const newest = walls[walls.length - 1];
  const previous = walls.slice(0, -1).every((wall, index) => wall.thickness === oldThickness[index]);
  rep.check('US-02 AC5', newest && newest.thickness === 120 && previous, `new ${newest?.thickness} previous kept ${previous}`);

  const { page: rect } = await newPage(browser);
  await openApp(rect);
  await chooseBlank(rect);
  await setCamera(rect, { k: 0.08, x: 180, y: 140 });
  for (const point of [[0, 0], [4000, 0], [4000, 3000], [0, 3000], [0, 0]]) {
    await clickWorld(rect, point[0], point[1]);
  }
  const closed = await derive(rect);
  const area = closed.faces[0]?.areaM2 ?? -1;
  rep.check('US-02 AC1', closed.count === 1 && Math.abs(area - 10.3776) <= 0.01, `rooms ${closed.count} net ${area}`);

  page._hs.errors.push(...rect._hs.errors);
  page._hs.notes.push(...rect._hs.notes);
  process.exit(finish(page, rep));
} catch (err) {
  console.log(`FAIL US-02 SCRIPT — ${err.stack || err}`);
  process.exit(1);
} finally {
  await browser.close();
}
