/**
 * Local plan store (later milestone). No network and no accounts.
 *
 * localStorage keys:
 * - `homesim:index` — saved-plan list (id, name, updatedAt)
 * - `homesim:plan:<id>` — one plan document
 *
 * When stored bytes pass 80% of the quota the editor shows a warning.
 * Undo history is capped at 200 steps (UNDO_LIMIT) and is not written here.
 */
export {};
