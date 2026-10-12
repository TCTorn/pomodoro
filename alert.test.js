import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createState, durationSeconds } from "./cycle.js";
import { createTimer, start } from "./timer.js";
import { advance } from "./advance.js";
import { createAlerter, alertTexts, playBeep } from "./alert.js";

const T0 = 1_000_000;
const MIN = 60_000;

function fakeAudio({ state = "suspended" } = {}) {
  const log = { created: 0, resumed: 0, oscillators: 0, started: 0 };
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const ctx = {
    state,
    currentTime: 0,
    destination: {},
    resume() { log.resumed++; ctx.state = "running"; return Promise.resolve(); },
    createOscillator() {
      log.oscillators++;
      return { frequency: param(), connect() {}, start() { log.started++; }, stop() {} };
    },
    createGain() { return { gain: param(), connect() {} }; },
  };
  return { log, create: () => { log.created++; return ctx; } };
}

function fakeNotification(permission) {
  const shown = [];
  const asked = [];
  class FakeNotification {
    constructor(title, options) { this.closed = 0; shown.push({ title, options, instance: this }); }
    close() { this.closed++; }
    static get permission() { return permission; }
    static requestPermission() { asked.push(true); return Promise.resolve("granted"); }
  }
  return { Notification: FakeNotification, shown, asked };
}

/** What ui.js does on each tick: advance, then hand the step to the alerter. */
function tick(alerter, state, timer, now) {
  const step = advance(state, timer, now);
  alerter.onAdvance(step);
  return step;
}

function runningFocus() {
  const state = createState("");
  return { state, timer: start(createTimer(durationSeconds(state)), T0) };
}

describe("Scenario: Sound and notification when a session ends", () => {
  test("permission granted: a sound is played and a notification says the focus session is done", () => {
    const audio = fakeAudio();
    const n = fakeNotification("granted");
    const alerter = createAlerter({ createAudioContext: audio.create, Notification: n.Notification });
    alerter.prepare(); // the Start click
    const { state, timer } = runningFocus();
    tick(alerter, state, timer, T0 + 24 * MIN);
    assert.equal(audio.log.started, 0, "nothing before the end");
    assert.equal(n.shown.length, 0);
    tick(alerter, state, timer, T0 + 25 * MIN);
    assert.ok(audio.log.started > 0, "sound played");
    assert.equal(n.shown.length, 1);
    assert.match(n.shown[0].title, /Focus session done/);
  });
});

describe("Scenario: Notifications are blocked", () => {
  test("permission denied: a sound is played and the page notice and title say the session has ended", () => {
    const audio = fakeAudio();
    const n = fakeNotification("denied");
    const alerter = createAlerter({ createAudioContext: audio.create, Notification: n.Notification });
    alerter.prepare();
    const { state, timer } = runningFocus();
    assert.equal(alerter.current(), null);
    tick(alerter, state, timer, T0 + 25 * MIN);
    assert.ok(audio.log.started > 0, "sound played");
    assert.equal(n.shown.length, 0, "no notification");
    assert.deepEqual(n.asked, [], "not asked again after a denial");
    assert.match(alerter.current().notice, /Focus session done/);
    assert.match(alerter.current().title, /^Done .* Focus .* Pomodoro$/);
  });
  test("no Notification API at all: still sound and in-page notice, nothing throws", () => {
    const audio = fakeAudio();
    const alerter = createAlerter({ createAudioContext: audio.create, Notification: undefined });
    alerter.prepare();
    alerter.fire("short");
    assert.ok(audio.log.started > 0);
    assert.match(alerter.current().notice, /Break done/);
  });
  test("sound blocked or unavailable: the in-page notice is still set", () => {
    const broken = createAlerter({ createAudioContext() { throw new Error("no audio"); } });
    broken.prepare();
    broken.fire("focus");
    assert.match(broken.current().notice, /Focus session done/);
    const none = createAlerter({});
    none.fire("long");
    assert.match(none.current().title, /Done/);
  });
});

describe("Scenario: Alert is on time in a hidden tab", () => {
  // The real hidden-tab timing needs a browser (manual check, story AF-16).
  // Here: the alert hangs on the tick path (advance's finished event).
  test("a tick long after the end time alerts exactly once, then never again", () => {
    const audio = fakeAudio();
    const n = fakeNotification("granted");
    const alerter = createAlerter({ createAudioContext: audio.create, Notification: n.Notification });
    alerter.prepare();
    let { state, timer } = runningFocus();
    const sleepy = T0 + 25 * MIN + 7 * MIN; // woke up 7 minutes late
    let step = tick(alerter, state, timer, sleepy);
    ({ state, timer } = step);
    const sounds = audio.log.started;
    assert.equal(sounds, 3, "one series of beeps");
    assert.equal(n.shown.length, 1);
    for (const later of [sleepy + 250, sleepy + 500, sleepy + 10 * MIN]) {
      ({ state, timer } = tick(alerter, state, timer, later));
    }
    assert.equal(audio.log.started, sounds);
    assert.equal(n.shown.length, 1);
  });
  test("the alert is fired from ui.js's tick handler through the alerter, which reads no clock", () => {
    const ui = readFileSync(new URL("./ui.js", import.meta.url), "utf8");
    const body = ui.match(/function settleAndAdvance\([^)]*\)\s*{([\s\S]*?)\n}/)[1];
    assert.match(body, /alerter\.onAdvance\(step\)/);
    assert.match(ui, /function onTick\(\)\s*{\s*settleAndAdvance\(/);
    assert.doesNotMatch(readFileSync(new URL("./alert.js", import.meta.url), "utf8"), /Date\.now|performance\.now/);
  });
});

describe("Permission request and audio start", () => {
  test("Start asks for notification permission only when it is undecided, and only once", () => {
    const n = fakeNotification("default");
    const alerter = createAlerter({ createAudioContext: fakeAudio().create, Notification: n.Notification });
    assert.equal(n.asked.length, 0, "not asked on creation");
    alerter.prepare();
    alerter.prepare();
    assert.equal(n.asked.length, 1);
    for (const p of ["granted", "denied"]) {
      const other = fakeNotification(p);
      createAlerter({ Notification: other.Notification }).prepare();
      assert.equal(other.asked.length, 0, p);
    }
  });
  test("a throwing Notification API does not break Start", () => {
    const N = { get permission() { throw new Error("blocked"); } };
    assert.doesNotThrow(() => createAlerter({ Notification: N }).prepare());
  });
  test("the AudioContext is created and resumed at Start and reused afterwards", () => {
    const audio = fakeAudio();
    const alerter = createAlerter({ createAudioContext: audio.create });
    assert.equal(audio.log.created, 0);
    alerter.prepare();
    assert.equal(audio.log.created, 1);
    assert.equal(audio.log.resumed, 1);
    alerter.prepare();
    alerter.fire("focus");
    assert.equal(audio.log.created, 1);
    assert.equal(audio.log.resumed, 1);
  });
  test("pressing Start clears the notice", () => {
    const alerter = createAlerter({});
    alerter.fire("focus");
    assert.ok(alerter.current());
    alerter.prepare();
    assert.equal(alerter.current(), null);
  });
});

describe("Repeated alerts and clearing", () => {
  test("a second alert closes the first notification and uses no tag, so it pops up again", () => {
    const n = fakeNotification("granted");
    const alerter = createAlerter({ Notification: n.Notification });
    alerter.fire("focus");
    assert.equal(n.shown[0].instance.closed, 0);
    alerter.fire("short");
    assert.equal(n.shown.length, 2);
    assert.equal(n.shown[0].instance.closed, 1, "previous closed");
    assert.equal(n.shown[1].instance.closed, 0);
    for (const s of n.shown) {
      assert.ok(!("tag" in s.options), "no tag");
      assert.ok(!("renotify" in s.options), "no renotify");
    }
    assert.match(n.shown[1].title, /Break done/);
  });
  test("a notification that cannot be closed does not stop the next alert", () => {
    const shown = [];
    class N {
      constructor(t) { shown.push(t); this.close = () => { throw new Error("x"); }; }
      static get permission() { return "granted"; }
    }
    const alerter = createAlerter({ Notification: N });
    alerter.fire("focus");
    alerter.fire("short");
    assert.equal(shown.length, 2);
  });
  test("clear() removes the in-page notice and title", () => {
    const alerter = createAlerter({});
    alerter.fire("focus");
    alerter.clear();
    assert.equal(alerter.current(), null);
  });
  test("ui.js clears on Reset and on duration change, and render() shows alerter.current()", () => {
    const ui = readFileSync(new URL("./ui.js", import.meta.url), "utf8");
    assert.match(ui, /resetBtn\.addEventListener\("click",\s*\(\)\s*=>\s*{[\s\S]*?alerter\.clear\(\)[\s\S]*?\n}\);/);
    assert.match(ui, /addEventListener\("change",[\s\S]*?alerter\.clear\(\)/);
    const render = ui.match(/function render\(\)\s*{([\s\S]*?)\n}/)[1];
    assert.match(render, /alerter\.current\(\)/);
    assert.match(render, /noticeEl\.textContent\s*=\s*noticeText/);
    assert.match(render, /document\.title\s*=\s*done\s*\?\s*done\.title/);
  });
  test("a context reporting 'interrupted' is resumed", () => {
    const audio = fakeAudio({ state: "interrupted" });
    createAlerter({ createAudioContext: audio.create }).prepare();
    assert.equal(audio.log.resumed, 1);
  });
});

describe("Texts and beep", () => {
  test("texts name the phase that ended", () => {
    assert.equal(alertTexts("focus").headline, "Focus session done");
    assert.equal(alertTexts("short").headline, "Break done");
    assert.equal(alertTexts("long").headline, "Break done");
    assert.match(alertTexts("focus").title, /^Done · Focus – Pomodoro$/);
  });
  test("playBeep schedules three short oscillator beeps", () => {
    const audio = fakeAudio();
    playBeep(audio.create());
    assert.equal(audio.log.oscillators, 3);
    assert.equal(audio.log.started, 3);
  });
  test("the page has a notice element and ui.js asks for permission only in the Start handler", () => {
    const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
    assert.match(html, /id="notice"[^>]*aria-live="polite"/);
    const ui = readFileSync(new URL("./ui.js", import.meta.url), "utf8");
    assert.equal(ui.match(/alerter\.prepare\(\)/g).length, 1);
    assert.match(ui, /startBtn\.addEventListener\("click",\s*\(\)\s*=>\s*{\s*alerter\.prepare\(\)/);
    assert.doesNotMatch(ui, /requestPermission/);
  });
});
