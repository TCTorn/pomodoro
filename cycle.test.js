import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MINUTES, ERROR_MESSAGE, createState, setDuration, nextPhase,
  parseMinutesInput, parseUrlOverrides, durationSeconds, formatTime, displayTime,
} from "./cycle.js";

describe("Scenario: defaults are shown on first open", () => {
  test("25 / 5 / 15 minutes and timer shows 25:00", () => {
    const state = createState("");
    assert.deepEqual(state.minutes, { focus: 25, short: 5, long: 15 });
    assert.deepEqual(DEFAULT_MINUTES, { focus: 25, short: 5, long: 15 });
    assert.equal(displayTime(state), "25:00");
  });
});

describe("Scenario: user changes the focus duration", () => {
  test("setting 40 shows 40:00 immediately", () => {
    const { state, error } = setDuration(createState(""), "focus", "40");
    assert.equal(error, null);
    assert.equal(displayTime(state), "40:00");
  });
  test("each of the three durations can be changed", () => {
    let state = createState("");
    for (const [kind, v] of [["focus", "30"], ["short", "7"], ["long", "20"]]) {
      ({ state } = setDuration(state, kind, v));
    }
    assert.deepEqual(state.minutes, { focus: 30, short: 7, long: 20 });
  });
  test("does not mutate the previous state", () => {
    const before = createState("");
    setDuration(before, "focus", "40");
    assert.equal(before.minutes.focus, 25);
  });
  test("surrounding whitespace is accepted", () => {
    assert.deepEqual(parseMinutesInput("  12 "), { ok: true, minutes: 12 });
  });
});

describe("Scenario: invalid duration is rejected", () => {
  test("0 gives an error and keeps the previous duration", () => {
    const start = createState("");
    const { state, error } = setDuration(start, "focus", "0");
    assert.equal(error, ERROR_MESSAGE);
    assert.equal(state, start);
    assert.equal(displayTime(state), "25:00");
  });
  for (const [name, value] of [
    ["empty", ""], ["whitespace", "   "], ["zero", "0"], ["negative", "-5"],
    ["non-numeric", "abc"], ["non-integer", "2.5"], ["comma decimal", "2,5"],
    ["exponent", "1e2"], ["plus sign", "+5"], ["mixed", "5min"],
    ["undefined", undefined], ["null", null], ["unsafe huge", "9".repeat(30)],
  ]) {
    test(`rejects ${name}`, () => {
      assert.equal(parseMinutesInput(value).ok, false);
      const start = createState("");
      const { state, error } = setDuration(start, "short", value);
      assert.ok(error);
      assert.equal(state.minutes.short, 5);
    });
  }
  test("unknown kind throws", () => {
    assert.throws(() => setDuration(createState(""), "nap", "5"));
  });
});

describe("Scenario: short session for testing", () => {
  test("?focus=0.1 shows 00:06", () => {
    assert.equal(displayTime(createState("?focus=0.1")), "00:06");
  });
  test("works with other params and without leading ?", () => {
    assert.equal(displayTime(createState("a=1&focus=0.1")), "00:06");
  });
  test("invalid URL values fall back to defaults", () => {
    for (const q of ["?focus=0", "?focus=-1", "?focus=abc", "?focus=", "?focus=Infinity"]) {
      assert.equal(displayTime(createState(q)), "25:00", q);
    }
  });
  test("short and long are supported the same way", () => {
    assert.deepEqual(parseUrlOverrides("?short=0.5&long=1"), { short: 0.5, long: 1 });
  });
  test("a valid UI change after a URL override still works", () => {
    const { state } = setDuration(createState("?focus=0.1"), "focus", "3");
    assert.equal(displayTime(state), "03:00");
  });
});

describe("formatTime / durationSeconds", () => {
  test("formats mm:ss", () => {
    assert.equal(formatTime(0), "00:00");
    assert.equal(formatTime(6), "00:06");
    assert.equal(formatTime(1500), "25:00");
    assert.equal(formatTime(6000), "100:00");
  });
  test("rounds floating point noise (0.1 * 60)", () => {
    assert.equal(durationSeconds(createState("?focus=0.1")), 6);
  });
});

describe("nextPhase", () => {
  const at = (phase, completedFocus) => ({ ...createState(""), phase, completedFocus });

  test("starts on focus with no completed sessions", () => {
    const s = createState("");
    assert.equal(s.phase, "focus");
    assert.equal(s.completedFocus, 0);
  });
  test("focus -> short break, with its full length", () => {
    const { state, seconds } = nextPhase(at("focus", 0));
    assert.equal(state.phase, "short");
    assert.equal(state.completedFocus, 1);
    assert.equal(seconds, 300);
  });
  test("4th focus -> long break", () => {
    const { state, seconds } = nextPhase(at("focus", 3));
    assert.equal(state.phase, "long");
    assert.equal(state.completedFocus, 4);
    assert.equal(seconds, 900);
  });
  test("8th focus -> long break again, 5th-7th -> short", () => {
    assert.equal(nextPhase(at("focus", 7)).state.phase, "long");
    for (const n of [4, 5, 6]) assert.equal(nextPhase(at("focus", n)).state.phase, "short");
  });
  test("short and long break -> focus, count unchanged", () => {
    for (const phase of ["short", "long"]) {
      const { state, seconds } = nextPhase(at(phase, 4));
      assert.equal(state.phase, "focus");
      assert.equal(state.completedFocus, 4);
      assert.equal(seconds, 1500);
    }
  });
  test("a full cycle of eight focus sessions", () => {
    let state = createState("");
    const seen = [];
    for (let i = 0; i < 16; i++) {
      state = nextPhase(state).state;
      seen.push(state.phase);
    }
    assert.deepEqual(seen, [
      "short", "focus", "short", "focus", "short", "focus", "long", "focus",
      "short", "focus", "short", "focus", "short", "focus", "long", "focus",
    ]);
  });
  test("uses changed and URL-overridden durations; does not mutate", () => {
    const before = createState("?short=0.5");
    assert.equal(nextPhase(before).seconds, 30);
    assert.equal(before.phase, "focus");
    assert.equal(before.completedFocus, 0);
    const { state } = setDuration(at("focus", 3), "long", "20");
    assert.equal(nextPhase(state).seconds, 1200);
  });
  test("durations changed while idle follow the current phase", () => {
    const { state } = setDuration(nextPhase(at("focus", 0)).state, "short", "7");
    assert.equal(displayTime(state), "07:00");
  });
});
