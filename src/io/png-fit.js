/**
 * Pixel sizing for plan and view screenshots.
 * The bitmap's longer side is 3200 px (US-15 AC5).
 */

export const PNG_LONG_EDGE = 3200;

/**
 * Fit a content box into a bitmap whose longer side is `longEdge`.
 * @param {number} contentWidth
 * @param {number} contentHeight
 * @param {number} [longEdge]
 * @returns {{ width: number, height: number }}
 */
export function fitLongEdge(contentWidth, contentHeight, longEdge = PNG_LONG_EDGE) {
  const w = Math.max(Number(contentWidth) || 0, 1);
  const h = Math.max(Number(contentHeight) || 0, 1);
  const edge = Math.max(2, Math.round(Number(longEdge) || PNG_LONG_EDGE));
  if (w >= h) {
    return { width: edge, height: Math.max(1, Math.round((edge * h) / w)) };
  }
  return { width: Math.max(1, Math.round((edge * w) / h)), height: edge };
}

/**
 * Frame a plan drawing: title band, plan, scale band. The bitmap's long
 * edge is `longEdge`. `pxPerMm` maps plan millimetres into the plan band.
 * @param {number} worldW
 * @param {number} worldH
 * @param {number} [longEdge]
 */
export function planExportLayout(worldW, worldH, longEdge = PNG_LONG_EDGE) {
  const w = Math.max(Number(worldW) || 0, 1);
  const h = Math.max(Number(worldH) || 0, 1);
  const band = 0.16;
  const size = fitLongEdge(w, h * (1 + band), longEdge);
  const titlePx = Math.max(24, Math.round(size.height * 0.07));
  const scalePx = Math.max(24, Math.round(size.height * 0.06));
  const padX = Math.max(8, Math.round(size.width * 0.04));
  const planW = Math.max(1, size.width - padX * 2);
  const planH = Math.max(1, size.height - titlePx - scalePx);
  const pxPerMm = Math.min(planW / w, planH / h);
  const drawnW = w * pxPerMm;
  const drawnH = h * pxPerMm;
  return {
    width: size.width,
    height: size.height,
    titlePx,
    scalePx,
    padX,
    planW,
    planH,
    originX: padX + (planW - drawnW) / 2,
    originY: titlePx + (planH - drawnH) / 2,
    pxPerMm,
  };
}

/**
 * A round millimetre length whose on-screen bar is near `targetPx`.
 * @param {number} pxPerMm
 * @param {number} [targetPx]
 * @returns {{ mm: number, px: number }}
 */
export function niceScaleMm(pxPerMm, targetPx = 180) {
  const safe = pxPerMm > 0 ? pxPerMm : 1e-6;
  const mm = targetPx / safe;
  const pow = 10 ** Math.floor(Math.log10(Math.max(mm, 1)));
  let chosen = pow;
  let best = Infinity;
  for (const n of [1, 2, 5]) {
    const cand = n * pow;
    const px = cand * safe;
    if (px < 48) continue;
    const delta = Math.abs(px - targetPx);
    if (delta < best) {
      best = delta;
      chosen = cand;
    }
  }
  return { mm: chosen, px: chosen * safe };
}
