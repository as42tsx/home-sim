/**
 * Plan store. `dispatch` applies a command. `begin` / `commit` / `cancel`
 * fold every preview inside a drag into one history step. Subscribers see
 * the same change descriptors during the drag and again on undo/redo.
 */

import { UNDO_LIMIT } from '../model/constants.js';
import { deriveAllFloors, deriveRooms } from '../rooms/index.js';
import { cloneData } from './clone.js';

/**
 * @param {object} initialPlan
 */
export function createEditorStore(initialPlan) {
  let plan = cloneData(initialPlan);
  /** @type {{ before: object, after: object, change: object }[]} */
  let past = [];
  /** @type {{ before: object, after: object, change: object }[]} */
  let future = [];
  /** @type {null|{ base: object, change: object|null, derivedByFloor: Record<string, object[]> }} */
  let txn = null;
  /** @type {Record<string, object[]>} */
  let derivedByFloor = {};
  const listeners = new Set();

  function refreshDerived() {
    const all = deriveAllFloors(plan);
    derivedByFloor = {};
    for (const [id, result] of Object.entries(all)) derivedByFloor[id] = result.derived;
    return all;
  }

  refreshDerived();

  function emit(change) {
    for (const fn of listeners) fn(plan, change);
  }

  function pushHistory(before, after, change) {
    if (JSON.stringify(before) === JSON.stringify(after)) return false;
    past.push({ before, after: cloneData(after), change });
    if (past.length > UNDO_LIMIT) past.splice(0, past.length - UNDO_LIMIT);
    future = [];
    return true;
  }

  function previousFor(floorId) {
    const src = txn ? txn.derivedByFloor : derivedByFloor;
    return src[floorId];
  }

  return {
    getPlan() {
      return plan;
    },

    /** Faces from the last committed refresh. During a drag, call {@link derivation}. */
    derived(floorId) {
      return derivedByFloor[floorId] || [];
    },

    /** Live derivation of the current plan (does not write rooms). */
    derivation(floorId) {
      return deriveRooms(plan, floorId);
    },

    previousDerived(floorId) {
      return previousFor(floorId);
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    canUndo() {
      return past.length > 0;
    },

    canRedo() {
      return future.length > 0;
    },

    isTransacting() {
      return !!txn;
    },

    historySize() {
      return past.length;
    },

    /**
     * @param {{ change: object, apply: Function }} cmd
     */
    dispatch(cmd) {
      const before = cloneData(plan);
      const next = cmd.apply(cloneData(plan), previousFor);
      plan = next;
      const change = cmd.change || { kind: 'full' };
      if (txn) {
        txn.change = change;
        emit(change);
        return;
      }
      pushHistory(before, plan, change);
      refreshDerived();
      emit(change);
    },

    begin() {
      if (txn) return;
      txn = {
        base: cloneData(plan),
        change: null,
        derivedByFloor: cloneData(derivedByFloor),
      };
    },

    commit() {
      if (!txn) return;
      const change = txn.change || { kind: 'full' };
      const changed = pushHistory(txn.base, plan, change);
      txn = null;
      refreshDerived();
      if (changed) emit(change);
    },

    cancel() {
      if (!txn) return;
      plan = txn.base;
      txn = null;
      refreshDerived();
      emit({ kind: 'full' });
    },

    undo() {
      if (txn) {
        plan = txn.base;
        txn = null;
        refreshDerived();
        emit({ kind: 'full' });
        return;
      }
      const step = past.pop();
      if (!step) return;
      plan = cloneData(step.before);
      future.push(step);
      refreshDerived();
      emit(step.change);
    },

    redo() {
      if (txn) return;
      const step = future.pop();
      if (!step) return;
      plan = cloneData(step.after);
      past.push(step);
      refreshDerived();
      emit(step.change);
    },

    /** Load or import. Drops undo history. */
    replace(nextPlan, change = { kind: 'full' }) {
      txn = null;
      plan = cloneData(nextPlan);
      past = [];
      future = [];
      refreshDerived();
      emit(change);
    },

    /** Bump the save timestamp without an undo step. */
    touch(now) {
      plan.meta.updatedAt = now;
    },
  };
}
