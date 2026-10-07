// Pure countdown logic. No DOM and it never reads the clock: every function
// that needs the time receives `now` (milliseconds, like Date.now()) from the
// caller. The countdown is measured against an end timestamp, never by
// counting ticks, so it stays correct when a background tab is throttled.
import { formatTime } from "./cycle.js";

/** Create a stopped timer holding the full length (in seconds). */
export function createTimer(totalSeconds) {
  return {
    status: "idle", // idle | running | paused | finished
    totalMs: totalSeconds * 1000,
    remainingMs: totalSeconds * 1000, // used while not running
    endsAt: null, // set only while running
  };
}

/** Start from idle, or resume from paused. Other states are returned as is. */
export function start(timer, now) {
  if (timer.status !== "idle" && timer.status !== "paused") return timer;
  if (timer.remainingMs <= 0) return { ...timer, status: "finished", remainingMs: 0 };
  return { ...timer, status: "running", endsAt: now + timer.remainingMs };
}

/** Stop counting and keep the remaining time. Only a running timer pauses. */
export function pause(timer, now) {
  if (timer.status !== "running") return timer;
  return { ...timer, status: "paused", remainingMs: msLeft(timer, now), endsAt: null };
}

/** Back to a full, stopped timer of the chosen length (in seconds). */
export function reset(timer, totalSeconds) {
  return createTimer(totalSeconds);
}

/**
 * Mark a running timer as finished once its end time has passed.
 * Returns the same object when nothing changes.
 */
export function settle(timer, now) {
  if (timer.status !== "running" || msLeft(timer, now) > 0) return timer;
  return { ...timer, status: "finished", remainingMs: 0, endsAt: null };
}

/**
 * Like settle(), but also reports whether the timer finished in this very
 * call. `finished` is true exactly once per run: once the timer is settled it
 * is no longer running, so later calls return `finished: false`.
 * @returns {{timer: object, finished: boolean}}
 */
export function settleOnce(timer, now) {
  const settled = settle(timer, now);
  return { timer: settled, finished: settled !== timer };
}

/** Milliseconds left, never below 0. */
export function remainingMs(timer, now) {
  return timer.status === "running" ? msLeft(timer, now) : timer.remainingMs;
}

/** Whole seconds left, rounded up so 00:00 shows only when time is really up. */
export function remainingSeconds(timer, now) {
  return Math.ceil(remainingMs(timer, now) / 1000);
}

/** Remaining time as mm:ss. */
export function displayRemaining(timer, now) {
  return formatTime(remainingSeconds(timer, now));
}

function msLeft(timer, now) {
  return Math.max(0, timer.endsAt - now);
}
