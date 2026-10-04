import fs from 'node:fs';
import path from 'node:path';
import { launch, newPage, openApp, report, finish, ROOT, BASE } from './lib.mjs';

const rep = report();
const browser = await launch();
try {
  const { page } = await newPage(browser);
  await openApp(page);
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
  process.exit(finish(page, rep));
} catch (err) {
  console.log(`FAIL US-11 SCRIPT — ${err.stack || err}`);
  process.exit(1);
} finally {
  await browser.close();
}
