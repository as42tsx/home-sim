import fs from 'node:fs';
import { launch, newPage, openApp, chooseTemplate, getPlan, enter3d, report, finish, readDownload, pngSize, structural, BASE } from './lib.mjs';

const rep = report();
const browser = await launch();
try {
  const { page } = await newPage(browser);
  await openApp(page);
  await chooseTemplate(page, 'apt-2br');
  await page.evaluate(async () => {
    const { furnitureAddCommand } = await import('./src/editor/commands.js');
    const dbg = window.__HOMESIM_DEBUG__;
    const floorId = dbg.currentFloorId();
    for (let i = 0; i < 15; i += 1) {
      dbg.store.dispatch(furnitureAddCommand(floorId, {
        id: `furn${i}`,
        type: 'bed-double',
        name: '双人床',
        cx: 400 + (i % 5) * 30,
        cy: 400 + Math.floor(i / 5) * 30,
        z: 0,
        w: 1800,
        d: 2000,
        h: 450,
        rot: 0,
        color: '#c4a484',
      }));
    }
  });
  const source = await getPlan(page);
  await page.locator('.topbar [data-action="share"]').click();
  await page.locator('[data-testid="share-link"]').waitFor();
  const url = await page.locator('[data-testid="share-link"]').inputValue();
  const sizeText = await page.locator('[data-testid="share-size"]').innerText();
  const bytes = new TextEncoder().encode(url.slice(url.indexOf('#'))).length;
  await page.locator('[data-action="copy-share"]').click();
  let clip = '';
  try { clip = await page.evaluate(() => navigator.clipboard.readText()); } catch { clip = ''; }
  rep.check('US-15 AC1', url.includes('#p=') && bytes <= 8192 && clip === url, `${sizeText}; hash ${bytes} bytes; clipboard ${clip === url ? 'match' : 'mismatch'}`);

  const fresh = await newPage(browser);
  await openApp(fresh.page, url);
  const viewed = await getPlan(fresh.page);
  const same = JSON.stringify(structural(source)) === JSON.stringify(structural(viewed));
  const keysDuring = await fresh.page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('homesim:plan') || key === 'homesim:index' || key === 'homesim:last'));
  const banner = await fresh.page.locator('[data-testid="readonly-banner"]').innerText();
  await fresh.page.locator('[data-action="undo"]').click({ force: true }).catch(() => {});
  const still = (await getPlan(fresh.page)).meta.name;
  rep.check('US-15 AC2 view', same && keysDuring.length === 0 && banner.includes('只读查看') && still === source.meta.name, `equal ${same} stored ${keysDuring.length} name ${still}`);
  await fresh.page.locator('[data-testid="save-copy"]').click();
  await fresh.page.waitForFunction(() => !document.body.classList.contains('is-readonly') && !location.hash);
  const saved = await getPlan(fresh.page);
  const stored = await fresh.page.evaluate((id) => localStorage.getItem(`homesim:plan:${id}`), saved.meta.id);
  const hashGone = await fresh.page.evaluate(() => location.hash === '');
  rep.check('US-15 AC2 save', saved.meta.id !== source.meta.id && !!stored && hashGone, `new id ${saved.meta.id !== source.meta.id} hashCleared ${hashGone}`);

  await page.locator('[data-action="share-close"]').click();
  await page.evaluate(async () => {
    const { metaCommand } = await import('./src/editor/commands.js');
    const arr = new Uint8Array(120000);
    for (let i = 0; i < arr.length; i += 65536) crypto.getRandomValues(arr.subarray(i, Math.min(arr.length, i + 65536)));
    let bin = '';
    for (let i = 0; i < arr.length; i += 4096) bin += String.fromCharCode(...arr.subarray(i, i + 4096));
    window.__HOMESIM_DEBUG__.store.dispatch(metaCommand((plan) => { plan.ext = { noise: btoa(bin) }; }));
  });
  await page.locator('.topbar [data-action="share"]').click();
  const tooBig = await page.locator('.modal').innerText();
  const noLink = await page.locator('[data-testid="share-link"]').count();
  rep.check('US-15 AC3', noLink === 0 && tooBig.includes('导出 JSON'), tooBig.slice(0, 80));
  await page.locator('[data-action="modal-cancel"]').click();

  await page.evaluate(() => sessionStorage.setItem('homesim-e2e-keep', '1'));
  const keepId = (await getPlan(page)).meta.id;
  await page.evaluate(() => { location.hash = '#p=dzzzz'; });
  await page.waitForFunction(() => (document.querySelector('[data-testid="toast"]')?.textContent || '').includes('链接不完整'));
  const afterHash = await getPlan(page);
  const stillStored = await page.evaluate((id) => !!localStorage.getItem(`homesim:plan:${id}`), keepId);
  rep.check('US-15 AC4', afterHash.meta.id === keepId && stillStored, `id ${afterHash.meta.id === keepId} stored ${stillStored}`);

  await page.evaluate(() => { history.replaceState(null, '', location.pathname + location.search); });
  await page.locator('.topbar [data-action="file-menu"]').click();
  const png2 = await readDownload(page, () => page.locator('.topbar [data-action="export-png"]').click());
  const size2 = pngSize(png2.file);
  const long2 = Math.max(size2.w, size2.h);
  await enter3d(page);
  await page.locator('[data-testid="hud-bird"]').waitFor();
  const png3 = await readDownload(page, async () => {
    await page.locator('.topbar [data-action="file-menu"]').click();
    await page.locator('.topbar [data-action="export-png"]').click();
  });
  const size3 = pngSize(png3.file);
  const long3 = Math.max(size3.w, size3.h);
  rep.check('US-15 AC5', long2 === 3200 && long3 === 3200 && png2.name.endsWith('-2D.png') && png3.name.endsWith('-3D.png'), `2D ${size2.w}×${size2.h} ${png2.name}; 3D ${size3.w}×${size3.h} ${png3.name}`);

  fresh.page._hs.errors.push(...page._hs.errors);
  fresh.page._hs.notes.push(...page._hs.notes);
  process.exit(finish(fresh.page, rep));
} catch (err) {
  console.log(`FAIL US-15 SCRIPT — ${err.stack || err}`);
  process.exit(1);
} finally {
  await browser.close();
}
