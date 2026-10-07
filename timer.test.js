import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createState, durationSeconds } from "./cycle.js";
import {
  createTimer, start, pause, reset, settle,
  remainingMs, remainingSeconds, displayRemaining,
} from "./timer.js";

const T0 = 1_000_000; // fake "now" in ms; the tests never read the real clock
const MIN = 60_000;

describe("Scenario: start", () => {
  test("timer set to 25 min and stopped, Start begins the countdown from 25:00", () => {
    const idle = createTimer(durationSeconds(createState("")));
    assert.equal(idle.status, "idle");
    assert.equal(displayRemaining(idle, T0), "25:00");
    const running = start(idle, T0);
    assert.equal(running.status, "running");
    assert.equal(displayRemaining(running, T0), "25:00");
    assert.equal(displayRemaining(running, T0 + 1000), "24:59");
  });
  test("uses the six-second ?focus=0.1 duration", () => {
    const timer = start(createTimer(durationSeconds(createState("?focus=0.1"))), T0);
    assert.equal(displayRemaining(timer, T0), "00:06");
  });
  test("does not mutate the previous timer", () => {
    const idle = createTimer(60);
    start(idle, T0);
    assert.equal(idle.status, "idle");
    assert.equal(idle.endsAt, null);
  });
  test("start on a running timer changes nothing", () => {
    const running = start(createTimer(60), T0);
    assert.equal(start(running, T0 + 5000), running);
  });
});

describe("Scenario: pause", () => {
  test("running with 12:30 left, Pause stops the countdown at 12:30", () => {
    const running = start(createTimer(25 * 60), T0);
    const paused = pause(running, T0 + 12 * MIN + 30_000);
    assert.equal(paused.status, "paused");
    assert.equal(displayRemaining(paused, T0 + 12 * MIN + 30_000), "12:30");
    assert.equal(displayRemaining(paused, T0 + 60 * MIN), "12:30");
  });
  test("Start after Pause resumes from the remaining time", () => {
    const paused = pause(start(createTimer(25 * 60), T0), T0 + 12 * MIN + 30_000);
    const later = T0 + 20 * MIN; // paused for a while
    const resumed = start(paused, later);
    assert.equal(resumed.status, "running");
    assert.equal(displayRemaining(resumed, later), "12:30");
    assert.equal(displayRemaining(resumed, later + 30_000), "12:00");
  });
  test("pause on a timer that is not running changes nothing", () => {
    const idle = createTimer(60);
    assert.equal(pause(idle, T0), idle);
  });
});

describe("Scenario: reset", () => {
  test("returns to the full chosen duration and stops", () => {
    const running = start(createTimer(25 * 60), T0);
    const done = reset(running, 25 * 60);
    assert.equal(done.status, "idle");
    assert.equal(displayRemaining(done, T0 + 5 * MIN), "25:00");
  });
  test("works from paused and takes a new length", () => {
    const paused = pause(start(createTimer(25 * 60), T0), T0 + MIN);
    const done = reset(paused, 40 * 60);
    assert.equal(done.status, "idle");
    assert.equal(displayRemaining(done, T0), "40:00");
  });
});

describe("Scenario: background tab", () => {
  test("running with 10:00 left, 2 minutes pass, shows about 08:00", () => {
    const running = start(createTimer(10 * 60), T0);
    assert.equal(displayRemaining(running, T0), "10:00");
    assert.equal(displayRemaining(running, T0 + 2 * MIN), "08:00");
  });
  test("a jump with no ticks in between gives the same result as many ticks", () => {
    const running = start(createTimer(10 * 60), T0);
    let ticked = running;
    for (let t = 250; t <= 2 * MIN; t += 250) ticked = settle(ticked, T0 + t);
    assert.equal(
      remainingSeconds(ticked, T0 + 2 * MIN),
      remainingSeconds(running, T0 + 2 * MIN)
    );
  });
});

describe("Scenario: reaching zero", () => {
  test("stops at 00:00 and never goes negative", () => {
    const running = start(createTimer(6), T0);
    assert.equal(displayRemaining(running, T0 + 6000), "00:00");
    assert.equal(displayRemaining(running, T0 + 3_600_000), "00:00");
    assert.equal(remainingMs(running, T0 + 3_600_000), 0);
  });
  test("settle marks it finished and it stays at 00:00", () => {
    const running = start(createTimer(6), T0);
    assert.equal(settle(running, T0 + 5999), running);
    const done = settle(running, T0 + 7000);
    assert.equal(done.status, "finished");
    assert.equal(displayRemaining(done, T0 + 9999999), "00:00");
  });
  test("a finished timer cannot be started or paused, Reset restores it", () => {
    const done = settle(start(createTimer(6), T0), T0 + 7000);
    assert.equal(start(done, T0 + 8000), done);
    assert.equal(pause(done, T0 + 8000), done);
    assert.equal(displayRemaining(reset(done, 6), T0), "00:06");
  });
  test("starting a zero-length timer finishes at once", () => {
    assert.equal(start(createTimer(0), T0).status, "finished");
  });
});

describe("display formatting of remaining time", () => {
  test("rounds partial seconds up", () => {
    const running = start(createTimer(60), T0);
    assert.equal(displayRemaining(running, T0 + 400), "01:00");
    assert.equal(displayRemaining(running, T0 + 1400), "00:59");
    assert.equal(displayRemaining(running, T0 + 59_001), "00:01");
  });
  test("minutes may exceed 99", () => {
    assert.equal(displayRemaining(createTimer(100 * 60), T0), "100:00");
  });
});
