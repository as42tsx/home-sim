/**
 * Slot allocator for one instanced mesh. Released slots are reused before
 * the high-water mark grows, so a removed item does not force a new draw.
 */

export function createSlotAllocator() {
  let next = 0;
  /** @type {number[]} */
  const free = [];
  return {
    acquire() {
      if (free.length) return free.pop();
      const slot = next;
      next += 1;
      return slot;
    },
    release(slot) {
      free.push(slot);
    },
    get highWater() {
      return next;
    },
    get freeCount() {
      return free.length;
    },
  };
}
