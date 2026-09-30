/**
 * Shared numeric constants for Home Sim.
 * Lengths are millimetres. Screen-pixel snaps stay at the UI layer; algorithms
 * take a model-space tolerance instead.
 */

/** Storage unit for every coordinate and length in a plan. */
export const UNIT = 'mm';

/** Current on-disk plan schema. */
export const SCHEMA_VERSION = 2;

/**
 * Endpoint snap radius in screen pixels (Luna batch 1 §3, US-02 AC3).
 * Applied by the editor, not by the geometry kernel.
 */
export const SNAP_PX = 10;

/**
 * Orthographic snap half-angle in degrees (Luna batch 1 §3, US-02 AC3).
 * Holding Shift in the editor disables it. Screen-space, UI only.
 */
export const ORTHO_SNAP_DEG = 5;

/** Walls shorter than this are ignored and never stored (Luna §3, PRD §8). */
export const MIN_WALL_LEN_MM = 50;

/**
 * Default model-space tolerance for node welding, point-on-wall tests and
 * collinear overlap. Equals Luna's 10 px snap at a drawing scale of 1 px = 1 mm.
 * The editor should pass `opts.tolerance = SNAP_PX * mmPerPx` when the scale differs.
 */
export const GEOM_TOLERANCE_MM = 10;

/**
 * An opening must keep at least this much clear wall beyond each end of its
 * free span (Luna §3: openings are pushed back when closer than 100 mm to a
 * wall end).
 */
export const OPENING_END_CLEARANCE_MM = 100;

/** Wall thickness limits and the three editor presets. */
export const WALL_THICKNESS = Object.freeze({
  default: 240,
  min: 60,
  max: 500,
  presets: Object.freeze([120, 180, 240]),
});

/** Furniture footprint limits (w and d). */
export const FURNITURE_SIZE = Object.freeze({
  min: 50,
  max: 6000,
});

/** Default floor-to-floor height (PRD §12.2 worked example, US-22). */
export const DEFAULT_FLOOR_HEIGHT_MM = 2900;

/** Default clear ceiling height under the slab. */
export const DEFAULT_CEILING_MM = 2800;

/** Default structural slab thickness. */
export const DEFAULT_SLAB_MM = 200;

/**
 * Product default guard height where an opening has no wall on that side
 * (PRD §12.4). A hint for later UI, not a code-compliance certificate.
 */
export const GUARD_HEIGHT_MM = 1100;

/** Share-link hash must fit in this many UTF-8 bytes (US-15 AC3). */
export const SHARE_MAX_BYTES = 48 * 1024;

/**
 * Target encoded size for a furnished two-bedroom plan (US-15 AC1).
 * M1 templates have no furniture yet; the unfurnished plan must still fit.
 */
export const SHARE_TARGET_2BR_BYTES = 8 * 1024;

/** Undo stack cap (PRD §12.6). The editor lands in a later milestone. */
export const UNDO_LIMIT = 200;
