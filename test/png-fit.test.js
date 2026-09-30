import assert from 'node:assert/strict';
import test from 'node:test';
import { PNG_LONG_EDGE, fitLongEdge, niceScaleMm, planExportLayout } from '../src/io/png-fit.js';

test('plan export long edge is 3200 px', () => {
  assert.equal(PNG_LONG_EDGE, 3200);
  assert.deepEqual(fitLongEdge(2000, 1000), { width: 3200, height: 1600 });
  assert.deepEqual(fitLongEdge(1000, 4000), { width: 800, height: 3200 });
  const square = fitLongEdge(500, 500);
  assert.equal(Math.max(square.width, square.height), 3200);
  assert.equal(square.width, square.height);

  const wide = planExportLayout(12000, 3000);
  assert.equal(wide.width, 3200);
  assert.ok(wide.height < wide.width);
  assert.ok(wide.pxPerMm > 0);
  assert.ok(wide.originY >= wide.titlePx - 1);

  const tall = planExportLayout(3000, 12000);
  assert.equal(tall.height, 3200);
  assert.ok(tall.width <= tall.height);

  const bar = niceScaleMm(wide.pxPerMm, 180);
  assert.ok(bar.mm >= 48);
  assert.ok(bar.px > 0);
});
