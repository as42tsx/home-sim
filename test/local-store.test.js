import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyPlan } from '../src/model/document.js';
import {
  estimateUsage,
  readIndex,
  readLastId,
  readPlan,
  removePlan,
  sortPlans,
  writePlan,
} from '../src/store/local.js';

function memoryStorage() {
  const map = new Map();
  let fail = false;
  return {
    get length() { return map.size; },
    key(i) { return [...map.keys()][i] ?? null; },
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) {
      if (fail) {
        const error = new Error('QuotaExceededError');
        error.name = 'QuotaExceededError';
        throw error;
      }
      map.set(String(key), String(value));
    },
    removeItem(key) { map.delete(key); },
    failWrites(next) { fail = next; },
  };
}

test('index round-trip sorts by updatedAt and remembers the last id', () => {
  const storage = memoryStorage();
  const older = createEmptyPlan({ now: 10, id: 'old', name: '旧', floorId: 'f1' });
  older.meta.updatedAt = 10;
  older.meta.template = null;
  const newer = createEmptyPlan({ now: 50, id: 'new', name: '新', floorId: 'f1' });
  newer.meta.updatedAt = 50;
  newer.meta.template = 'apt-2br';
  assert.equal(writePlan(storage, older).ok, true);
  assert.equal(writePlan(storage, newer).ok, true);
  const list = sortPlans(readIndex(storage));
  assert.deepEqual(list.map((item) => item.id), ['new', 'old']);
  assert.equal(list[0].template, 'apt-2br');
  assert.equal(list[0].name, '新');
  assert.equal(readLastId(storage), 'new');
  assert.equal(readPlan(storage, 'old').meta.name, '旧');
  removePlan(storage, 'new');
  assert.equal(readPlan(storage, 'new'), null);
  assert.equal(readLastId(storage), null);
  assert.equal(readIndex(storage).length, 1);
});

test('usage above 80% warns and a failed write is reported', () => {
  const storage = memoryStorage();
  storage.setItem('pad', 'x'.repeat(50));
  const usage = estimateUsage(storage, 100);
  assert.equal(usage.warn, true);
  assert.ok(usage.ratio > 0.8);

  const plan = createEmptyPlan({ now: 1, id: 'p', name: 't', floorId: 'f1' });
  const tight = writePlan(storage, plan, { quota: 100 });
  assert.equal(tight.ok, true);
  assert.equal(tight.warn, true);

  storage.failWrites(true);
  const failed = writePlan(storage, plan, { quota: 5_000_000 });
  assert.equal(failed.ok, false);
  assert.equal(failed.error.name, 'QuotaExceededError');
});
