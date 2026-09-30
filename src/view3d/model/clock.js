/**
 * Pure on-demand render clock. A frame is allowed until `idleMs` after the
 * last request, and the scheduler stops once that window has elapsed.
 * The view itself stops the animation frame as soon as nothing is moving;
 * this clock is the rule those timestamps have to satisfy.
 */

export function createDemandClock({ idleMs = 1000 } = {}) {
  let lastInput = null;
  return {
    request(t) {
      lastInput = t;
    },
    /** True while the idle window has not yet closed. */
    allowsFrame(t) {
      if (lastInput == null) return false;
      return t - lastInput <= idleMs;
    },
    /** True when another frame should be queued after a frame at time t. */
    shouldScheduleNext(t) {
      if (lastInput == null) return false;
      return t - lastInput < idleMs;
    },
  };
}
