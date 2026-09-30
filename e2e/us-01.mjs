import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { launch, newPage, openApp, chooseBlank, chooseTemplate, getPlan, derive, report, finish, ROOT } from './lib.mjs';

const rep = report();
const browser = await launch();
try {
  const { page } = await newPage(browser);
  await openApp(page);
  const picker = await page.locator('[data-testid="picker"]').isVisible();
  const ids = ['apt-1br', 'apt-2br', 'apt-3br'];
  const cards = [];
  for (const id of ids) cards.push(await page.locator(`[data-testid="template-${id}"]`).count());
  const blank = await page.locator('[data-testid="blank"]').count();
  rep.check('US-01 AC1', picker && blank === 1 && cards.every((n) => n === 1), `picker templates ${ids.join(',')}`);

  await chooseBlank(page);
  const blankPlan = await getPlan(page);
  const wallOn = await page.locator('[data-tool="wall"]').evaluate((el) => el.classList.contains('is-on'));
  const empty = (blankPlan.floors[0].walls || []).length === 0 && (blankPlan.floors[0].nodes || []).length === 0;
  rep.check('US-01 AC2', blankPlan.floors.length === 1 && empty && wallOn, `floors=${blankPlan.floors.length} wallTool=${wallOn}`);

  let maxDelta = 0;
  let areaOk = true;
  const notes = [];
  for (const id of ids) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.dataset.app === 'ready');
    await chooseTemplate(page, id);
    const file = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', `${id}.json`), 'utf8'));
    const live = await derive(page);
    const expected = file.expected;
    if (live.count !== expected.roomCount) {
      areaOk = false;
      notes.push(`${id} count ${live.count}!=${expected.roomCount}`);
      continue;
    }
    for (const row of expected.rooms) {
      const face = live.faces.find((item) => item.name === row.name);
      if (!face) {
        areaOk = false;
        notes.push(`${id} missing ${row.name}`);
        continue;
      }
      const delta = Math.abs(face.centerlineAreaM2 - row.areaM2);
      maxDelta = Math.max(maxDelta, delta);
      if (delta > 0.1) {
        areaOk = false;
        notes.push(`${id} ${row.name} Δ${delta.toFixed(3)}`);
      }
    }
  }
  const withinPrd = maxDelta <= 0.01;
  rep.check(
    'US-01 AC3',
    areaOk,
    `max |centreline−expected| ${maxDelta.toFixed(3)} m²; Luna ±0.1 ${areaOk ? 'ok' : 'miss'}; PRD 0.01 ${withinPrd ? 'met' : 'not the same target (templates unchanged)'}`,
  );

  const clean = spawnSync(process.execPath, ['scripts/cleanroom-check.js'], { cwd: ROOT, encoding: 'utf8' });
  rep.check('US-01 AC4', clean.status === 0, (clean.stdout || clean.stderr || '').trim().split('\n').slice(-2).join(' '));
  process.exit(finish(page, rep));
} catch (err) {
  console.log(`FAIL US-01 SCRIPT — ${err.stack || err}`);
  process.exit(1);
} finally {
  await browser.close();
}
