import fs from 'node:fs';
import path from 'node:path';
import { launch, newPage, openApp, chooseBlank, report, finish, ROOT, BASE } from './lib.mjs';

const rep = report();
const browser = await launch();
try {
  const { page } = await newPage(browser);
  await openApp(page);
  const early3d = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => /view3d|\/vendor\/three\/|three\.module|OrbitControls|BufferGeometryUtils/.test(name)));
  rep.check('load no 3D before enter', early3d.length === 0, early3d.slice(0, 4).join(' ') || 'none');
  const firstScreen = await page.evaluate(() => {
    const names = new Set();
    for (const entry of performance.getEntriesByType('resource')) {
      const style = entry.initiatorType === 'css' || /\.css(\?|$)/.test(entry.name);
      const script = entry.initiatorType === 'script' || /\.m?js(\?|$)/.test(entry.name);
      if (style || script) names.add(entry.name);
    }
    const src = document.querySelector('script[type="module"]')?.getAttribute('src') || '';
    return { count: names.size, built: src.length > 0 && !src.includes('src/app.js'), src, names: [...names] };
  });
  if (firstScreen.built) {
    rep.check('load first-screen requests', firstScreen.count <= 10, `${firstScreen.count}: ${firstScreen.names.map((name) => name.split('/').pop()).join(' ')}`);
  } else {
    rep.check('load first-screen requests', true, `dev module graph ${firstScreen.count} script/style requests`);
  }
  const srcImport = await page.evaluate(async () => {
    const mod = await import('./src/rooms/index.js');
    return typeof mod.deriveAllFloors;
  });
  rep.check('load src import', srcImport === 'function', srcImport);
  const hosts = [...page._hs.hosts];
  const third = hosts.filter((host) => host !== new URL(BASE).host);
  const license = fs.existsSync(path.join(ROOT, 'vendor/three/LICENSE'));
  rep.manual('US-11 AC1', 'push is not part of this run; Pages deploy is the tracked workflow and was not executed');
  rep.check('US-11 AC2', third.length === 0 && license, `hosts ${hosts.join(',') || 'none'} three LICENSE ${license}`);
  const statuses = await page.evaluate(async () => {
    const paths = [
      'styles/tokens.css',
      'styles/base.css',
      'src/app.js',
      'vendor/three/three.module.js',
      'templates/apt-2br.json',
      'i18n/zh.json',
      'fixtures/two-floor-stair.json',
      'dev/view3d.html',
    ];
    const out = {};
    for (const rel of paths) {
      const res = await fetch(rel);
      out[rel] = res.status;
    }
    return { out, path: location.pathname };
  });
  const all200 = Object.values(statuses.out).every((code) => code === 200);
  rep.check('US-11 AC3', all200 && statuses.path.startsWith('/home-sim/'), `${statuses.path} ${JSON.stringify(statuses.out)}`);
  rep.manual('US-11 AC4', 'Lighthouse and Fast 4G were not run in this environment');
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const noLicenseFile = !fs.existsSync(path.join(ROOT, 'LICENSE'));
  rep.check(
    'US-11 AC5',
    readme.includes('https://as42tsx.github.io/home-sim/') && readme.includes('怎么用') && readme.includes('不放置 LICENSE') && noLicenseFile,
    'online URL, usage, license note; LICENSE file still absent',
  );

  const gated = await newPage(browser);
  let releaseTemplates;
  const holdTemplates = new Promise((resolve) => { releaseTemplates = resolve; });
  let templateHits = 0;
  await gated.page.route(/\/templates\//, async (route) => {
    templateHits += 1;
    await holdTemplates;
    await route.continue();
  });
  await gated.page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await gated.page.waitForFunction(() => document.documentElement.dataset.app === 'ready', null, { timeout: 8000 });
  const shell = await gated.page.evaluate(() => ({
    blank: !!document.querySelector('[data-testid="blank"]') && !document.querySelector('[data-testid="blank"]').disabled,
    apt: [...document.querySelectorAll('button')].some((button) => button.textContent.includes('公寓')),
    house: [...document.querySelectorAll('button')].some((button) => button.textContent.includes('独栋')),
    done: performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/templates/') && entry.responseEnd > 0).length,
  }));
  const gateDeadline = Date.now() + 3000;
  while (templateHits === 0 && Date.now() < gateDeadline) await gated.page.waitForTimeout(40);
  rep.check(
    'load picker before templates',
    shell.blank && shell.apt && shell.house && templateHits > 0 && shell.done === 0,
    `hits ${templateHits} done ${shell.done} blank ${shell.blank} apt ${shell.apt} house ${shell.house}`,
  );
  releaseTemplates();
  await gated.context.close();

  const returning = await newPage(browser);
  await openApp(returning.page);
  await chooseBlank(returning.page);
  await returning.page.evaluate(() => sessionStorage.setItem('homesim-e2e-keep', '1'));
  let releaseReturn;
  const holdReturn = new Promise((resolve) => { releaseReturn = resolve; });
  await returning.page.route(/\/templates\//, async (route) => {
    await holdReturn;
    await route.continue();
  });
  await returning.page.reload({ waitUntil: 'domcontentloaded' });
  await returning.page.waitForFunction(() => document.documentElement.dataset.app === 'ready', null, { timeout: 8000 });
  const back = await returning.page.evaluate(() => ({
    picker: document.body.classList.contains('is-picker'),
    done: performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/templates/') && entry.responseEnd > 0).length,
  }));
  await returning.page.locator('[data-tool="select"]').click();
  const selectOn = await returning.page.locator('[data-tool="select"]').evaluate((el) => el.classList.contains('is-on'));
  rep.check('load returning user', !back.picker && selectOn && back.done === 0, `picker ${back.picker} select ${selectOn} template responses ${back.done}`);
  releaseReturn();
  await returning.context.close();

  process.exit(finish(page, rep));
} catch (err) {
  console.log(`FAIL US-11 SCRIPT — ${err.stack || err}`);
  process.exit(1);
} finally {
  await browser.close();
}
