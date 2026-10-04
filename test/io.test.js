import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { clonePlanFresh } from '../src/editor/clone.js';
import { CATALOG } from '../src/furniture/catalog.js';
import { createEmptyPlan, floorsByElevation } from '../src/model/document.js';
import { SHARE_MAX_BYTES, SHARE_TARGET_2BR_BYTES } from '../src/model/constants.js';
import { exportPlanJSON, importPlanJSON } from '../src/io/json.js';
import { SHARE_WARN_CHARS, decodeShareLink, encodeShareLink, formatThousands, shareUrlStats } from '../src/io/share.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/two-floor-stair.json'), 'utf8'));

test('two-floor JSON round-trips', () => {
  const text = exportPlanJSON(fixture);
  const back = importPlanJSON(text);
  assert.equal(back.ok, true);
  assert.deepEqual(back.plan, fixture);
  assert.equal(back.plan.floors.length, 2);
  assert.equal(importPlanJSON('{').ok, false);
  assert.equal(importPlanJSON('{').errors[0].code, 'INVALID_JSON');
  const newer = importPlanJSON(JSON.stringify({ ...fixture, schemaVersion: 3 }));
  assert.equal(newer.ok, false);
  assert.equal(newer.errors[0].code, 'NEWER_VERSION');
  assert.equal(newer.errors[0].message, '请使用新版本');
});

test('share urls longer than 8000 characters ask for a file', () => {
  assert.equal(SHARE_WARN_CHARS, 8000);
  assert.deepEqual(shareUrlStats('x'.repeat(8000)), { chars: 8000, warn: false });
  assert.equal(shareUrlStats(`https://example.test/${'a'.repeat(8000)}`).warn, true);
  assert.equal(shareUrlStats('').warn, false);
  assert.equal(formatThousands(12345), '12\u2009345');
  assert.equal(formatThousands(8000), '8\u2009000');
});

test('share link round-trips with deflate and lz-string', async () => {
  const deflate = await encodeShareLink(fixture, { baseUrl: 'https://as42tsx.github.io/home-sim/' });
  assert.equal(deflate.ok, true);
  assert.ok(deflate.hash.startsWith('#p=d'));
  assert.ok(deflate.url.endsWith(deflate.hash));
  const back = await decodeShareLink(deflate.url);
  assert.equal(back.ok, true);
  assert.deepEqual(back.plan, fixture);

  const lz = await encodeShareLink(fixture, { codec: 'lz' });
  assert.equal(lz.ok, true);
  assert.ok(lz.hash.startsWith('#p=z'));
  const backLz = await decodeShareLink(lz.hash);
  assert.equal(backLz.ok, true);
  assert.deepEqual(backLz.plan, fixture);

  const truncated = await decodeShareLink(deflate.hash.slice(0, Math.floor(deflate.hash.length / 2)));
  assert.deepEqual(truncated, { ok: false, code: 'LINK_INCOMPLETE' });
  const garbage = await decodeShareLink('#p=d!!!!');
  assert.equal(garbage.ok, false);
  assert.equal(garbage.code, 'LINK_INCOMPLETE');
  const badLz = await decodeShareLink('#p=znot-a-link');
  assert.equal(badLz.code, 'LINK_INCOMPLETE');
});

test('links over 48 KB are refused and the two-bedroom plan fits in 8 KB', async () => {
  const bulky = createEmptyPlan({ now: 1, id: 'bulky', name: 'bulky' });
  let blob = '';
  let seed = 0xC0FFEE;
  for (let i = 0; i < 70000; i += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    blob += String.fromCharCode(32 + (seed % 95));
  }
  bulky.ext = { blob };
  const tooLong = await encodeShareLink(bulky);
  assert.equal(tooLong.ok, false);
  assert.equal(tooLong.code, 'TOO_LONG');
  assert.ok(tooLong.bytes > SHARE_MAX_BYTES);

  const template = JSON.parse(fs.readFileSync(path.join(root, 'templates/apt-2br.json'), 'utf8'));
  const encoded = await encodeShareLink(template.plan);
  assert.equal(encoded.ok, true);
  assert.ok(encoded.bytes <= SHARE_TARGET_2BR_BYTES, `apt-2br hash is ${encoded.bytes} bytes`);
});

test('furnished two-bedroom link stays within 8 KB and round-trips walls, rooms and furniture', async () => {
  const template = JSON.parse(fs.readFileSync(path.join(root, 'templates/apt-2br.json'), 'utf8'));
  const plan = clonePlanFresh(template.plan, { now: 1, planId: 'share2br', name: '两居带家具' });
  const floor = floorsByElevation(plan)[0];
  floor.furniture = CATALOG.slice(0, 15).map((entry, index) => ({
    id: `furn-share-${index}`,
    type: entry.type,
    name: entry.name,
    cx: 1800 + (index % 5) * 700,
    cy: 1800 + Math.floor(index / 5) * 700,
    z: 0,
    w: entry.w,
    d: entry.d,
    h: entry.h,
    rot: (index % 4) * 90,
    color: entry.color,
  }));
  const encoded = await encodeShareLink(plan, { baseUrl: 'https://as42tsx.github.io/home-sim/' });
  assert.equal(encoded.ok, true, encoded.code || '');
  assert.ok(encoded.bytes <= SHARE_TARGET_2BR_BYTES, `furnished apt-2br hash is ${encoded.bytes} bytes`);
  const back = await decodeShareLink(encoded.url);
  assert.equal(back.ok, true);
  const again = floorsByElevation(back.plan)[0];
  assert.deepEqual(again.walls, floor.walls);
  assert.deepEqual(again.rooms, floor.rooms);
  assert.deepEqual(again.furniture, floor.furniture);
});
