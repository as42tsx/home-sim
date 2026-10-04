import { launch, newPage, openApp, chooseTemplate, getPlan, screenOf, report, finish } from './lib.mjs';

const rep = report();
const browser = await launch();
try {
  const { page } = await newPage(browser);
  await openApp(page);
  await chooseTemplate(page, 'apt-1br');
  await page.locator('.topbar [data-mode="furnish"]').click();
  const handle = page.locator('.sidepanel [data-furn="bed-double"]');
  const box = await handle.boundingBox();
  const drop = await screenOf(page, 140, 1800);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(drop.x, drop.y, { steps: 8 });
  await page.mouse.up();
  let plan = await getPlan(page);
  const bed = plan.floors[0].furniture.find((item) => item.type === 'bed-double');
  const nearWall = bed && (Math.abs(bed.cx) <= 200 || Math.abs(bed.cx - bed.w / 2) <= 400);
  rep.check('US-06 AC1', !!bed && bed.w === 1800 && bed.d === 2000 && nearWall, bed ? `${bed.w}×${bed.d} at ${Math.round(bed.cx)},${Math.round(bed.cy)} rot ${bed.rot}` : 'missing');

  const id = bed.id;
  const rot0 = bed.rot || 0;
  await page.keyboard.press('r');
  plan = await getPlan(page);
  const rot1 = plan.floors[0].furniture.find((item) => item.id === id).rot;
  await page.locator('.topbar [data-action="undo"]').click();
  plan = await getPlan(page);
  const rotBack = plan.floors[0].furniture.find((item) => item.id === id).rot || 0;
  await page.locator('.inspector [data-field="furn-w"]').fill('1600');
  await page.locator('.inspector [data-field="furn-w"]').dispatchEvent('change');
  plan = await getPlan(page);
  const widened = plan.floors[0].furniture.find((item) => item.id === id).w;
  await page.locator('.topbar [data-action="undo"]').click();
  const count = () => page.evaluate(() => window.__HOMESIM_DEBUG__.getPlan().floors[0].furniture.length);
  const beforeDup = await count();
  await page.locator('.inspector [data-action="duplicate-selection"]').click();
  const afterDup = await count();
  await page.locator('.topbar [data-action="undo"]').click();
  const afterUndoDup = await count();
  const at = await screenOf(page, bed.cx, bed.cy);
  await page.mouse.click(at.x, at.y);
  await page.locator('.inspector [data-action="delete-selection"]').click();
  const afterDel = await count();
  await page.locator('.topbar [data-action="undo"]').click();
  const afterUndoDel = await count();
  const ok = Math.abs(((rot1 - rot0) + 360) % 360 - 15) < 0.1
    && Math.abs(rotBack - rot0) < 0.1
    && widened === 1600
    && afterDup === beforeDup + 1
    && afterUndoDup === beforeDup
    && afterDel === beforeDup - 1
    && afterUndoDel === beforeDup;
  rep.check('US-06 AC3', ok, `rot ${rot0}→${rot1}→${rotBack} w ${widened} dup ${beforeDup}/${afterDup} del ${afterDel}/${afterUndoDel}`);

  const again = await screenOf(page, bed.cx, bed.cy);
  await page.mouse.move(box.x + 8, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(again.x, again.y, { steps: 8 });
  await page.mouse.up();
  const danger = await page.locator('.plan-svg [stroke="var(--danger)"]').count();
  plan = await getPlan(page);
  // One danger frame per overlapping item (legend art is not restroked).
  rep.check('US-06 AC2', plan.floors[0].furniture.length >= 2 && danger >= 1, `pieces ${plan.floors[0].furniture.length} danger strokes ${danger}`);

  process.exit(finish(page, rep));
} catch (err) {
  console.log(`FAIL US-06 SCRIPT — ${err.stack || err}`);
  process.exit(1);
} finally {
  await browser.close();
}
