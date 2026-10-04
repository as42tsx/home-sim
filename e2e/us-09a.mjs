import { launch, newPage, openApp, chooseTemplate, chooseBlank, getPlan, enter3d, shot, report, finish, BASE } from './lib.mjs';

const rep = report();
const browser = await launch();

async function pageMetrics(page) {
  return page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return { w: rect.width, h: rect.height, display: style.display, hidden: el.hidden || style.display === 'none' };
    };
    const canvas = document.querySelector('.canvas').getBoundingClientRect();
    const banner = document.querySelector('[data-testid="readonly-banner"]');
    const bannerH = banner && !banner.hidden ? banner.getBoundingClientRect().height : 0;
    const sheet = document.querySelector('.sheet');
    const sheetShown = sheet && getComputedStyle(sheet).display !== 'none';
    const sheetH = sheetShown ? sheet.getBoundingClientRect().height : 0;
    const visible = canvas.height - bannerH - (sheetShown ? Math.min(sheetH, canvas.height) : 0);
    const tools = [...document.querySelectorAll('.toolrail [data-tool]')].map((el) => ({
      name: el.dataset.tool,
      shown: getComputedStyle(el).display !== 'none' && !el.hidden,
      w: el.getBoundingClientRect().width,
      h: el.getBoundingClientRect().height,
    }));
    return {
      scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      canvasH: canvas.height,
      visible,
      ratio: visible / window.innerHeight,
      topH: box('.topbar')?.h,
      tabH: box('.tabbar')?.h,
      fileHidden: (() => {
        const el = document.querySelector('.topbar .menu-wrap');
        if (!el) return true;
        return el.hidden || getComputedStyle(el).display === 'none';
      })(),
      shareHidden: getComputedStyle(document.querySelector('.topbar [data-action="share"]')).display === 'none',
      tools,
      sheetH: sheetShown ? sheetH : 0,
      mode: document.body.dataset.mode,
      readonly: document.body.classList.contains('is-readonly'),
    };
  });
}

try {
  const desk = await newPage(browser);
  await openApp(desk.page);
  await chooseTemplate(desk.page, 'apt-2br');
  await desk.page.locator('.topbar [data-action="share"]').click();
  await desk.page.locator('[data-testid="share-link"]').waitFor();
  const url = await desk.page.locator('[data-testid="share-link"]').inputValue();
  await desk.page.locator('[data-action="share-close"]').click();

  const phone = await newPage(browser, { mobile: true, width: 390, height: 844 });
  const t0 = Date.now();
  await openApp(phone.page, url);
  const loadMs = Date.now() - t0;
  const metrics = await pageMetrics(phone.page);
  const banner = await phone.page.locator('[data-testid="readonly-banner"]').innerText();
  await shot(phone.page, 'share-readonly-mobile.png');
  rep.check(
    'US-09a AC1',
    loadMs <= 4000 && metrics.scroll <= 1 && metrics.ratio >= 0.75 && banner.includes('只读查看') && metrics.readonly,
    `load ${loadMs} ms scroll ${metrics.scroll}px visible ${(metrics.ratio * 100).toFixed(1)}% top ${metrics.topH} tab ${metrics.tabH}`,
  );

  const tabs = await phone.page.locator('.tabbar > button:visible').allInnerTexts();
  rep.check('US-09a tabs', tabs.join(' ').includes('2D') && tabs.some((text) => text.includes('3D')) && tabs.some((text) => text.includes('保存')), tabs.join(' | '));

  await phone.page.locator('.tabbar [data-mode="view3d"]').click();
  await phone.page.waitForFunction(() => document.body.dataset.mode === 'view3d' && !document.querySelector('.topbar [data-action="view3d"]')?.disabled, null, { timeout: 40000 });
  await shot(phone.page, 'mobile-3d.png');
  const before = await phone.page.evaluate(() => window.__HOMESIM_DEBUG__.view3d().debugState().camera.slice());
  const canvas = await phone.page.locator('#view3d-host canvas').boundingBox();
  await phone.page.mouse.move(canvas.x + canvas.width * 0.5, canvas.y + canvas.height * 0.5);
  await phone.page.mouse.down();
  await phone.page.mouse.move(canvas.x + canvas.width * 0.75, canvas.y + canvas.height * 0.35, { steps: 10 });
  await phone.page.mouse.up();
  const after = await phone.page.evaluate(() => window.__HOMESIM_DEBUG__.view3d().debugState().camera.slice());
  const orbit = Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]) > 0.05;
  const pinch = await phone.page.evaluate((box) => {
    const el = document.querySelector('#view3d-host canvas');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const dist = () => {
      const cam = window.__HOMESIM_DEBUG__.view3d().debugState();
      const dx = cam.camera[0] - cam.target[0];
      const dy = cam.camera[1] - cam.target[1];
      const dz = cam.camera[2] - cam.target[2];
      return Math.hypot(dx, dy, dz);
    };
    const beforeD = dist();
    const proto = Element.prototype;
    const prevSet = proto.setPointerCapture;
    const prevRel = proto.releasePointerCapture;
    proto.setPointerCapture = function () {};
    proto.releasePointerCapture = function () {};
    const fire = (type, id, x, y) => el.dispatchEvent(new PointerEvent(type, {
      pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: id === 1, buttons: 1,
    }));
    fire('pointerdown', 1, cx - 20, cy);
    fire('pointerdown', 2, cx + 20, cy);
    fire('pointermove', 1, cx - 90, cy);
    fire('pointermove', 2, cx + 90, cy);
    fire('pointerup', 1, cx - 90, cy);
    fire('pointerup', 2, cx + 90, cy);
    proto.setPointerCapture = prevSet;
    proto.releasePointerCapture = prevRel;
    return Math.abs(dist() - beforeD);
  }, canvas);
  const f0 = await phone.page.evaluate(() => window.__HOMESIM_DEBUG__.renderInfo().frames);
  const moveT = Date.now();
  await phone.page.mouse.move(canvas.x + canvas.width * 0.4, canvas.y + canvas.height * 0.4);
  await phone.page.mouse.down();
  while (Date.now() - moveT < 3000) {
    const t = (Date.now() - moveT) / 3000;
    await phone.page.mouse.move(
      canvas.x + canvas.width * (0.35 + 0.3 * t),
      canvas.y + canvas.height * (0.35 + 0.15 * Math.sin(t * 10)),
    );
    await phone.page.waitForTimeout(40);
  }
  await phone.page.mouse.up();
  const f1 = await phone.page.evaluate(() => window.__HOMESIM_DEBUG__.renderInfo().frames);
  const fps = (f1 - f0) / 3;
  const interact = orbit && pinch > 0.05;
  rep.check('US-09a AC2 interact', interact, `orbit ${orbit} pinch Δ ${pinch.toFixed(3)} m`);
  rep.check('US-09a AC2 fps', fps >= 30, `${fps.toFixed(1)} fps over 3s orbit (swiftshader is a CPU renderer; this is a lower bound, not a laptop figure)`);

  const edit = await newPage(browser, { mobile: true, width: 390, height: 844 });
  await openApp(edit.page);
  await chooseBlank(edit.page);
  const phoneEdit = await pageMetrics(edit.page);
  const shown = phoneEdit.tools.filter((tool) => tool.shown).map((tool) => tool.name);
  const fabLater = shown.includes('select') && shown.includes('wall') && shown.includes('door') && shown.includes('window') && shown.includes('demolish')
    && !shown.includes('measure') && !shown.includes('room') && !shown.includes('pan');
  rep.check('LAYOUT phone chrome', phoneEdit.topH >= 50 && phoneEdit.topH <= 56 && phoneEdit.tabH >= 64 && phoneEdit.tabH <= 72 && phoneEdit.fileHidden && fabLater && phoneEdit.scroll <= 1 && phoneEdit.ratio >= 0.75, `top ${phoneEdit.topH} tab ${phoneEdit.tabH} tools ${shown.join(',')} visible ${(phoneEdit.ratio * 100).toFixed(1)}%`);
  const hits = await edit.page.evaluate(() => {
    const height = (sel) => {
      const el = document.querySelector(sel);
      return el ? el.getBoundingClientRect().height : 0;
    };
    return { handle: height('.sheet-handle'), tab: height('.sheet-tabs button'), furn: height('.furn-item') };
  });
  rep.check('LAYOUT hit targets', hits.handle >= 44 && hits.tab >= 44 && hits.furn >= 44, JSON.stringify(hits));

  await edit.page.evaluate(async () => {
    const { furnitureAddCommand } = await import('./src/editor/commands.js');
    const dbg = window.__HOMESIM_DEBUG__;
    dbg.store.dispatch(furnitureAddCommand(dbg.currentFloorId(), {
      id: 'fabbed', type: 'bed-double', name: '双人床', cx: 0, cy: 0, z: 0, w: 1800, d: 2000, h: 450, rot: 0, color: '#c4a484',
    }));
  });
  await edit.page.locator('[data-tool="select"]').click();
  const pt = await edit.page.evaluate(() => window.__HOMESIM_DEBUG__.worldToScreen(0, 0));
  await edit.page.mouse.click(pt.x, pt.y);
  const fab = await edit.page.locator('.fab button').evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    return { w: rect.width, h: rect.height, text: node.textContent };
  }));
  rep.check('LAYOUT fab', fab.length === 4 && fab.every((button) => button.w >= 44 && button.h >= 44), JSON.stringify(fab));
  await shot(edit.page, 'mobile-2d.png');

  await edit.page.locator('[data-sheet-handle]').click();
  const half = await edit.page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--sheet-h').trim());
  rep.check('LAYOUT sheet', /330/.test(half), `snap style ${half}`);

  const tablet = await newPage(browser, { width: 768, height: 1024 });
  await openApp(tablet.page);
  await chooseTemplate(tablet.page, 'apt-1br');
  const tabMetrics = await pageMetrics(tablet.page);
  const rail = await tablet.page.locator('.toolrail').evaluate((el) => getComputedStyle(el).display);
  const side = await tablet.page.locator('.sidepanel').evaluate((el) => getComputedStyle(el).display);
  rep.check('LAYOUT tablet', rail !== 'none' && side === 'none' && tabMetrics.sheetH >= 60, `rail ${rail} side ${side} sheet ${tabMetrics.sheetH}`);

  for (const extra of [desk.page, phone.page, edit.page, tablet.page]) {
    if (extra === desk.page) continue;
    desk.page._hs.errors.push(...extra._hs.errors);
    desk.page._hs.notes.push(...extra._hs.notes);
  }
  process.exit(finish(desk.page, rep));
} catch (err) {
  console.log(`FAIL US-09a SCRIPT — ${err.stack || err}`);
  process.exit(1);
} finally {
  await browser.close();
}
