/**
 * Room types shown in the inspector, and the floor material applied when the
 * type changes. 「卫生间」maps to bath and defaults to 防滑砖 (US-03 AC2).
 */

export const ROOM_TYPES = Object.freeze([
  'bedroom', 'living', 'dining', 'ldk', 'kitchen', 'bath',
  'balcony', 'corridor', 'entry', 'study', 'storage', 'other',
]);

export const MATERIALS = Object.freeze([
  'wood', 'tile', 'nonslip', 'stone', 'carpet', 'concrete',
]);

/** CSS variable for a room fill. Unknown types use the neutral swatch. */
export function roomFillVar(type) {
  if (type === 'bedroom') return 'var(--room-bedroom)';
  if (type === 'living' || type === 'dining' || type === 'ldk') return 'var(--room-living)';
  if (type === 'kitchen') return 'var(--room-kitchen)';
  if (type === 'bath' || type === 'toilet' || type === 'washroom') return 'var(--room-bath)';
  if (type === 'balcony') return 'var(--room-balcony)';
  return 'var(--room-other)';
}

/** Material id stored on `room.floor` when the user picks a type. */
export function defaultFloorForType(type) {
  if (type === 'bath' || type === 'toilet' || type === 'washroom') return 'nonslip';
  if (type === 'kitchen' || type === 'balcony' || type === 'corridor' || type === 'entry') return 'tile';
  return 'wood';
}
