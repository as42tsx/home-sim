/**
 * Generic furniture until the batch-2 library lands.
 * `shape` selects both the 2D symbol and (via the same names) the 3D block.
 */

export const CATALOG = Object.freeze([
  Object.freeze({ type: 'bed-double', name: '双人床', nameEn: 'Double bed', category: '卧室', shape: 'bed', w: 1800, d: 2000, h: 450, color: '#c4a484' }),
  Object.freeze({ type: 'bed-single', name: '单人床', nameEn: 'Single bed', category: '卧室', shape: 'bed', w: 1200, d: 2000, h: 450, color: '#c4a484' }),
  Object.freeze({ type: 'wardrobe', name: '衣柜', nameEn: 'Wardrobe', category: '卧室', shape: 'cabinet', w: 1800, d: 600, h: 2200, color: '#8d6e63' }),
  Object.freeze({ type: 'nightstand', name: '床头柜', nameEn: 'Nightstand', category: '卧室', shape: 'cabinet', w: 450, d: 400, h: 500, color: '#a1887f' }),
  Object.freeze({ type: 'sofa-3', name: '三人沙发', nameEn: '3-seat sofa', category: '客厅', shape: 'sofa', w: 2100, d: 900, h: 800, color: '#8d6e63' }),
  Object.freeze({ type: 'armchair', name: '单人沙发', nameEn: 'Armchair', category: '客厅', shape: 'sofa', w: 850, d: 850, h: 800, color: '#8d6e63' }),
  Object.freeze({ type: 'coffee-table', name: '茶几', nameEn: 'Coffee table', category: '客厅', shape: 'table', w: 1200, d: 600, h: 420, color: '#b08968' }),
  Object.freeze({ type: 'tv-cabinet', name: '电视柜', nameEn: 'TV cabinet', category: '客厅', shape: 'cabinet', w: 1800, d: 400, h: 500, color: '#6d4c41' }),
  Object.freeze({ type: 'rug', name: '地毯', nameEn: 'Rug', category: '客厅', shape: 'flat', w: 2000, d: 1400, h: 10, color: '#d7c4b0' }),
  Object.freeze({ type: 'dining-table', name: '餐桌', nameEn: 'Dining table', category: '餐厅', shape: 'table', w: 1400, d: 800, h: 750, color: '#b08968' }),
  Object.freeze({ type: 'dining-chair', name: '餐椅', nameEn: 'Dining chair', category: '餐厅', shape: 'chair', w: 450, d: 500, h: 900, color: '#a1887f' }),
  Object.freeze({ type: 'desk', name: '书桌', nameEn: 'Desk', category: '书房', shape: 'table', w: 1200, d: 600, h: 750, color: '#b08968' }),
  Object.freeze({ type: 'office-chair', name: '办公椅', nameEn: 'Office chair', category: '书房', shape: 'chair', w: 600, d: 600, h: 1000, color: '#6d7a86' }),
  Object.freeze({ type: 'bookshelf', name: '书架', nameEn: 'Bookshelf', category: '书房', shape: 'cabinet', w: 900, d: 350, h: 2000, color: '#8d6e63' }),
  Object.freeze({ type: 'fridge', name: '冰箱', nameEn: 'Fridge', category: '厨房', shape: 'cabinet', w: 700, d: 700, h: 1800, color: '#cfd8dc' }),
  Object.freeze({ type: 'counter', name: '橱柜', nameEn: 'Counter', category: '厨房', shape: 'counter', w: 2400, d: 600, h: 850, color: '#efe6d6' }),
  Object.freeze({ type: 'toilet', name: '马桶', nameEn: 'Toilet', category: '卫浴', shape: 'round', w: 400, d: 700, h: 750, color: '#eceff1' }),
  Object.freeze({ type: 'washbasin', name: '洗手台', nameEn: 'Washbasin', category: '卫浴', shape: 'cabinet', w: 600, d: 450, h: 850, color: '#eceff1' }),
  Object.freeze({ type: 'shower', name: '淋浴', nameEn: 'Shower', category: '卫浴', shape: 'box', w: 900, d: 900, h: 2000, color: '#d6e6ee' }),
  Object.freeze({ type: 'bathtub', name: '浴缸', nameEn: 'Bathtub', category: '卫浴', shape: 'tub', w: 1700, d: 750, h: 550, color: '#e3f2fd' }),
  Object.freeze({ type: 'washing-machine', name: '洗衣机', nameEn: 'Washer', category: '卫浴', shape: 'cabinet', w: 600, d: 600, h: 850, color: '#cfd8dc' }),
  Object.freeze({ type: 'plant', name: '绿植', nameEn: 'Plant', category: '装饰', shape: 'round', w: 400, d: 400, h: 1200, color: '#7d9a78' }),
  Object.freeze({ type: 'floor-lamp', name: '落地灯', nameEn: 'Floor lamp', category: '装饰', shape: 'round', w: 400, d: 400, h: 1600, color: '#efe6d6' }),
]);

const byType = new Map(CATALOG.map((item) => [item.type, item]));

/** @param {string} type */
export function catalogEntry(type) {
  return byType.get(type) || null;
}

/** @param {string} type */
export function shapeForType(type) {
  return byType.get(type)?.shape || 'box';
}

/** Category labels in catalog order. */
export function catalogCategories() {
  const seen = [];
  for (const item of CATALOG) {
    if (!seen.includes(item.category)) seen.push(item.category);
  }
  return seen;
}
