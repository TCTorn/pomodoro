import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createState, durationSeconds } from "./cycle.js";
import { createTimer, start, pause, reset, displayRemaining } from "./timer.js";
import { advance } from "./advance.js";

const T0 = 1_000_000; // fake "now" in ms
const MIN = 60_000;

function running(state) {
  return start(createTimer(durationSeconds(state)), T0);
}

describe("advance", () => {
  test("nothing changes while time is left", () => {
    const state = createState("");
    const timer = running(state);
    const r = advance(state, timer, T0 + MIN);
    assert.equal(r.finished, false);
    assert.equal(r.finishedPhase, null);
    assert.equal(r.state, state);
    assert.equal(r.timer, timer);
  });
  test("finished once: next phase, idle, full length", () => {
    const state = createState("");
    const r = advance(state, running(state), T0 + 25 * MIN);
    assert.equal(r.finished, true);
    assert.equal(r.finishedPhase, "focus");
    assert.equal(r.state.phase, "short");
    assert.equal(r.state.completedFocus, 1);
    assert.equal(r.timer.status, "idle");
    assert.equal(displayRemaining(r.timer, T0), "05:00");
    const again = advance(r.state, r.timer, T0 + 90 * MIN);
    assert.equal(again.finished, false);
    assert.equal(again.state.phase, "short");
  });
  test("Pause pressed after the end time but before a tick counts as finished", () => {
    const state = createState("?focus=0.1"); // 6 s
    const late = T0 + 9000;
    // ui.js advances first, then pauses
    const r = advance(state, running(state), late);
    assert.equal(r.finished, true);
    assert.equal(r.state.phase, "short");
    const paused = pause(r.timer, late); // idle timer: pause is a no-op
    assert.equal(paused.status, "idle");
    assert.equal(paused.remainingMs, 300_000);
  });
  test("Pause before the end time still pauses", () => {
    const state = createState("");
    const r = advance(state, running(state), T0 + MIN);
    const paused = pause(r.timer, T0 + MIN);
    assert.equal(paused.status, "paused");
    assert.equal(displayRemaining(paused, T0 + 5 * MIN), "24:00");
  });
});

// Same step ui.js runs on every tick.
function tick(state, timer, now, events) {
  const r = advance(state, timer, now);
  if (r.finished) events.push(r.finishedPhase);
  return { state: r.state, timer: r.timer };
}

describe("Scenario: focus ends and the app moves on, waiting for Start", () => {
  test("Given 1 completed focus session, when the focus ends: short break of 5 min, idle", () => {
    let state = { ...createState(""), completedFocus: 1 };
    const events = [];
    let timer = start(createTimer(durationSeconds(state)), T0);
    ({ state, timer } = tick(state, timer, T0 + 25 * MIN, events));
    assert.equal(state.phase, "short");
    assert.equal(timer.status, "idle");
    assert.equal(displayRemaining(timer, T0 + 25 * MIN), "05:00");
    assert.deepEqual(events, ["focus"]);
  });
  test("Given 3 completed focus sessions, when the fourth ends: long break of 15 min", () => {
    let state = { ...createState(""), completedFocus: 3 };
    let timer = start(createTimer(durationSeconds(state)), T0);
    ({ state, timer } = tick(state, timer, T0 + 25 * MIN, []));
    assert.equal(state.phase, "long");
    assert.equal(timer.status, "idle");
    assert.equal(displayRemaining(timer, T0), "15:00");
  });
  test("Given a break has just ended: focus session of 25 min, idle", () => {
    for (const phase of ["short", "long"]) {
      let state = { ...createState(""), phase, completedFocus: 4 };
      const events = [];
      let timer = start(createTimer(durationSeconds(state)), T0);
      ({ state, timer } = tick(state, timer, T0 + 15 * MIN, events));
      assert.equal(state.phase, "focus");
      assert.equal(timer.status, "idle");
      assert.equal(displayRemaining(timer, T0), "25:00");
      assert.deepEqual(events, [phase]);
    }
  });
  test("Given focus with 5 min left and 30 min asleep: finished once, one phase only", () => {
    let state = createState("");
    const events = [];
    let timer = start(createTimer(durationSeconds(state)), T0);
    const wake = T0 + 20 * MIN + 30 * MIN; // 5 min left, then 30 min asleep
    ({ state, timer } = tick(state, timer, wake, events));
    assert.equal(state.phase, "short");
    assert.equal(timer.status, "idle");
    assert.equal(displayRemaining(timer, wake), "05:00");
    // further ticks do nothing: no second event, no skipped phase
    ({ state, timer } = tick(state, timer, wake + 250, events));
    ({ state, timer } = tick(state, timer, wake + 10 * MIN, events));
    assert.equal(state.phase, "short");
    assert.deepEqual(events, ["focus"]);
  });
});

describe("Reset", () => {
  test("keeps the phase and the completed count, resets the timer", () => {
    let state = createState("");
    let timer = running(state);
    ({ state, timer } = tick(state, timer, T0 + 25 * MIN, []));
    timer = start(timer, T0 + 26 * MIN); // short break running
    timer = reset(timer, durationSeconds(state));
    assert.equal(state.phase, "short");
    assert.equal(state.completedFocus, 1);
    assert.equal(timer.status, "idle");
    assert.equal(displayRemaining(timer, T0 + 27 * MIN), "05:00");
  });
  test("Reset pressed after the end time but before a tick counts the phase as finished", () => {
    const state = createState("?focus=0.1"); // 6 s
    const late = T0 + 9000;
    // ui.js advances first, then resets
    const r = advance(state, running(state), late);
    assert.equal(r.finished, true);
    assert.equal(r.state.phase, "short");
    assert.equal(r.state.completedFocus, 1);
    const timer = reset(r.timer, durationSeconds(r.state));
    assert.equal(timer.status, "idle");
    assert.equal(displayRemaining(timer, late), "05:00");
  });
});
