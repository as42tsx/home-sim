import fs from 'node:fs';
import { launch, newPage, openApp, chooseBlank, getPlan, report, finish, readDownload, structural } from './lib.mjs';

const rep = report();
const browser = await launch();
try {
  const { page } = await newPage(browser);
  await openApp(page);
  await chooseBlank(page);
  await page.locator('[data-testid="plan-name"]').fill('持久方案');
  await page.locator('[data-testid="plan-name"]').blur();
  await page.waitForTimeout(900);
  const id = (await getPlan(page)).meta.id;
  await page.evaluate(() => sessionStorage.setItem('homesim-e2e-keep', '1'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.app === 'ready');
  const restored = await getPlan(page);
  rep.check('US-08 AC1', restored?.meta?.name === '持久方案' && restored.meta.id === id, restored?.meta?.name || 'missing');

  await page.locator('[data-action="plan-menu"]').click();
  await page.locator('[data-action="copy-plan"]').click();
  const copied = await getPlan(page);
  await page.locator('[data-testid="plan-name"]').fill('副本新名');
  await page.locator('[data-testid="plan-name"]').blur();
  await page.waitForTimeout(400);
  await page.locator('[data-action="plan-menu"]').click();
  const menuText = await page.locator('[data-menu="plan"]').innerText();
  const hasStamp = /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(menuText);
  const original = page.locator(`[data-action="delete-plan"][data-id="${id}"]`);
  await original.click();
  await page.locator('[data-action="modal-ok"]').click();
  await page.locator('[data-action="plan-menu"]').click();
  const afterDelete = await page.locator('[data-menu="plan"]').innerText();
  const gone = !afterDelete.includes('持久方案');
  const renamed = (await getPlan(page)).meta.name === '副本新名';
  rep.check('US-08 AC2', copied.meta.id !== id && copied.meta.name.includes('副本') && renamed && hasStamp && gone, `stamp ${hasStamp} gone ${gone} name ${renamed}`);

  await page.keyboard.press('Escape');
  const beforeExport = await getPlan(page);
  const downloaded = await readDownload(page, async () => {
    await page.locator('.topbar [data-action="file-menu"]').click();
    await page.locator('.topbar [data-action="export-json"]').click();
  });
  const exported = JSON.parse(fs.readFileSync(downloaded.file, 'utf8'));
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.removeItem('homesim-e2e-keep');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.app === 'ready');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'plan.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  await page.waitForFunction(() => !document.body.classList.contains('is-picker'));
  const imported = await getPlan(page);
  const same = JSON.stringify(structural(exported)) === JSON.stringify(structural(imported));
  rep.check('US-08 AC3', exported.schemaVersion === 2 && same, `schema ${exported.schemaVersion} equal ${same} file ${downloaded.name}`);

  await page.evaluate(() => {
    localStorage.setItem('homesim-junk', 'x'.repeat(2200000));
  });
  await page.locator('[data-testid="plan-name"]').fill('配额预警');
  await page.locator('[data-testid="plan-name"]').blur();
  await page.waitForTimeout(900);
  const quota = await page.locator('[data-testid="toast"]').innerText();
  const quotaBtn = await page.locator('[data-testid="toast"] button').innerText().catch(() => '');
  await page.evaluate(() => localStorage.removeItem('homesim-junk'));
  await page.evaluate(() => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem() { throw new Error('full'); };
    window.__restoreSet = orig;
  });
  await page.locator('[data-testid="plan-name"]').fill('写入失败');
  await page.locator('[data-testid="plan-name"]').blur();
  await page.waitForTimeout(900);
  const fail = await page.locator('[data-testid="toast"]').innerText();
  await page.evaluate(() => { Storage.prototype.setItem = window.__restoreSet; });
  rep.check('US-08 AC4', quota.includes('80%') && quotaBtn.includes('导出') && (fail.includes('没能写入') || fail.includes('保存失败')) && fail.includes('导出备份'), `quota "${quota.slice(0, 48)}" fail "${fail.slice(0, 48)}"`);

  process.exit(finish(page, rep));
} catch (err) {
  console.log(`FAIL US-08 SCRIPT — ${err.stack || err}`);
  process.exit(1);
} finally {
  await browser.close();
}
