// Pure glue between cycle.js and timer.js: one step that settles the timer and,
// when the phase has just finished, moves to the next phase. Lives in its own
// file because timer.js imports cycle.js, so cycle.js cannot import timer.js
// without a circular import. Never reads the clock: `now` comes from the caller.
import { nextPhase } from "./cycle.js";
import { createTimer, settleOnce } from "./timer.js";

/**
 * Settle the timer at `now`. If the running phase has ended, return the next
 * phase with an idle timer of its full length (the user presses Start).
 * `finished` is true exactly once per finished phase; `finishedPhase` names it.
 * @returns {{state: object, timer: object, finished: boolean, finishedPhase: string | null}}
 */
export function advance(state, timer, now) {
  const result = settleOnce(timer, now);
  if (!result.finished) {
    return { state, timer: result.timer, finished: false, finishedPhase: null };
  }
  const next = nextPhase(state);
  return {
    state: next.state,
    timer: createTimer(next.seconds),
    finished: true,
    finishedPhase: state.phase,
  };
}
