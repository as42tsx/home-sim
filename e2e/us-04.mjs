import { launch, newPage, openApp, chooseTemplate, clickWorld, getPlan, enter3d, report, finish, wallNear } from './lib.mjs';

const rep = report();
const browser = await launch();
try {
  const { page } = await newPage(browser);
  await openApp(page);
  await chooseTemplate(page, 'apt-1br');
  await page.locator('[data-tool="door"]').click();
  await clickWorld(page, 3300, 1050);
  let plan = await getPlan(page);
  const floor = () => plan.floors[0];
  const host = wallNear(plan, 3300, 1050);
  const door = floor().openings.find((item) => item.kind === 'door' && item.wall === host?.id);
  rep.check('US-04 AC1', !!door && door.width === 900, door ? `door ${door.width} on ${host?.id}` : 'no door near (3300,1050)');

  await page.locator('.inspector [data-action="opening-swing"][data-value="out"]').click();
  await page.locator('.inspector [data-action="opening-hinge"][data-value="right"]').click();
  plan = await getPlan(page);
  const swung = floor().openings.find((item) => item.id === door.id);
  const beforeLeaf = await (async () => {
    await enter3d(page);
    return page.evaluate(() => {
      const view = window.__HOMESIM_DEBUG__.view3d();
      return view.debugRay(2.7, 1.0, 1.05, 1, 0, 0).filter((hit) => hit.kind === 'leaf' || hit.kind === 'walls').slice(0, 3);
    });
  })();
  await page.locator('[data-testid="hud-back"]').click();
  await page.waitForFunction(() => !document.querySelector('.plan-svg').hidden, null, { timeout: 8000 });
  rep.check('US-04 AC2', swung?.swing === 'out' && swung?.hinge === 'right' && beforeLeaf.some((hit) => hit.kind === 'leaf'), `swing ${swung?.swing}/${swung?.hinge} leafHits ${beforeLeaf.length}`);

  await page.locator('.sidepanel [data-pref="doorWidth"]').fill('2000');
  await page.locator('.sidepanel [data-pref="doorWidth"]').dispatchEvent('change');
  await page.locator('[data-tool="door"]').click();
  const before = floor().openings.length;
  await clickWorld(page, 5400, 1050);
  plan = await getPlan(page);
  const hint = await page.evaluate(() => document.querySelector('.plan-svg')?.textContent || '');
  const added = floor().openings.length - before;
  rep.check('US-04 AC3', added === 0 && (hint.includes('超过') || hint.includes('mm')), `added ${added}`);

  await page.locator('[data-tool="select"]').click();
  await clickWorld(page, 1650, 0);
  plan = await getPlan(page);
  const winHost = wallNear(plan, 1650, 0);
  const win = floor().openings.find((item) => item.kind === 'window' && item.wall === winHost?.id);
  await page.locator('.inspector [data-field="opening-height"]').fill('1200');
  await page.locator('.inspector [data-field="opening-height"]').dispatchEvent('change');
  await page.locator('.inspector [data-field="opening-sill"]').fill('1100');
  await page.locator('.inspector [data-field="opening-sill"]').dispatchEvent('change');
  plan = await getPlan(page);
  const edited = floor().openings.find((item) => item.id === win?.id);
  await enter3d(page);
  const probe = await page.evaluate(() => {
    const view = window.__HOMESIM_DEBUG__.view3d();
    const at = (y) => view.debugRay(1.65, y, -0.6, 0, 0, 1)[0]?.kind || 'none';
    return { below: at(1.08), above: at(1.12) };
  });
  rep.check('US-04 AC4', edited?.sill === 1100 && edited?.height === 1200 && probe.below === 'walls' && probe.above === 'glass', `sill ${edited?.sill} h ${edited?.height} below ${probe.below} above ${probe.above}`);

  process.exit(finish(page, rep));
} catch (err) {
  console.log(`FAIL US-04 SCRIPT — ${err.stack || err}`);
  process.exit(1);
} finally {
  await browser.close();
}
