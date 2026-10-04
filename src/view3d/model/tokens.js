/**
 * Room-type → CSS custom property. Values are read at runtime; these names
 * are the contract with styles/tokens.css.
 */

/** Hex fallbacks copied from styles/tokens.css, used when the page has no tokens. */
export const TOKEN_FALLBACK = {
  '--room-bedroom': '#ecd8bb',
  '--room-living': '#f1e7d6',
  '--room-kitchen': '#e1e5e1',
  '--room-bath': '#d8e4e8',
  '--room-balcony': '#e8e2d0',
  '--room-other': '#ece6dc',
  '--wall': '#3a332c',
  '--wall-bearing': '#1f1b17',
  '--wall-interior': '#8a7d70',
  '--wall-3d-face': '#e9e2d6',
  '--wall-3d-face-shade': '#cfc6b8',
  '--ground-3d': '#ddd4c4',
  '--sky-day-top': '#f3eee6',
  '--sky-day-bottom': '#e4dccd',
  '--sky-night-top': '#121724',
  '--sky-night-bottom': '#232033',
  '--accent': '#a1542c',
  '--night-accent': '#e39a6c',
  '--slab': '#cfc4b4',
  '--stair': '#b7a898',
  '--leaf-wood': '#c4a574',
  '--glass': '#c5d5dc',
};

/**
 * @param {string} type room type
 * @returns {string} custom property name
 */
export function tokenForRoomType(type) {
  switch (type) {
    case 'bedroom':
    case 'washitsu':
      return '--room-bedroom';
    case 'living':
    case 'dining':
    case 'ldk':
      return '--room-living';
    case 'kitchen':
      return '--room-kitchen';
    case 'bath':
    case 'toilet':
    case 'washroom':
      return '--room-bath';
    case 'balcony':
      return '--room-balcony';
    default:
      return '--room-other';
  }
}
