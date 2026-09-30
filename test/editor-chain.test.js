import assert from 'node:assert/strict';
import test from 'node:test';
import { segmentTooShort, shouldCloseChain } from '../src/editor/chain.js';

test('chain closes on the start once three vertices exist', () => {
  const start = { x: 0, y: 0, nodeId: 'n1' };
  assert.equal(shouldCloseChain(2, { x: 0, y: 0, nodeId: 'n1' }, start), false);
  assert.equal(shouldCloseChain(3, { x: 0, y: 0, nodeId: 'n1' }, start), true);
  assert.equal(shouldCloseChain(4, { x: 0.4, y: 0.2, nodeId: null }, start), true);
  assert.equal(shouldCloseChain(4, { x: 30, y: 0, nodeId: 'other' }, start), false);
});

test('segments under 50 mm are ignored', () => {
  assert.equal(segmentTooShort({ x: 0, y: 0 }, { x: 49, y: 0 }), true);
  assert.equal(segmentTooShort({ x: 0, y: 0 }, { x: 50, y: 0 }), false);
});
