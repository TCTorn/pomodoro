import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createNotes, downloadFilename, localDate, STORAGE_KEY, UNSAVED_MESSAGE } from "./notes.js";
import { createState, durationSeconds } from "./cycle.js";
import { createTimer, start, displayRemaining } from "./timer.js";
import { advance } from "./advance.js";

const T0 = 1_000_000;
const MIN = 60_000;

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
  };
}
const brokenStorage = {
  getItem() { throw new Error("SecurityError"); },
  setItem() { throw new Error("QuotaExceededError"); },
};
// Manual stand-in for setTimeout/clearTimeout.
function fakeTimers() {
  let next = 1;
  const jobs = new Map();
  return {
    setTimer: (fn) => { jobs.set(next, fn); return next++; },
    clearTimer: (id) => { jobs.delete(id); },
    runAll() { const fns = [...jobs.values()]; jobs.clear(); fns.forEach((f) => f()); },
    get count() { return jobs.size; },
  };
}
const make = (storage, timers = fakeTimers(), extra = {}) =>
  ({ timers, notes: createNotes({ storage, ...timers, ...extra }) });

describe("Scenario: Typing a note during a session", () => {
  test("the typed text is kept and the running timer is unaffected", () => {
    const state = createState("");
    const timer = start(createTimer(durationSeconds(state)), T0);
    const before = displayRemaining(timer, T0 + MIN);
    const { notes } = make(fakeStorage());
    notes.set("call the dentist");
    assert.equal(notes.text, "call the dentist");
    assert.equal(displayRemaining(timer, T0 + MIN), before);
    assert.equal(timer.status, "running");
  });
  test("notes.js has no imports, so it cannot reach the timer or the DOM", () => {
    const src = readFileSync(new URL("./notes.js", import.meta.url), "utf8");
    assert.doesNotMatch(src, /^\s*import\b/m);
    assert.doesNotMatch(src, /\b(document|window|Date\.now)\b/);
  });
  // Left for manual check in a browser: the textarea is focusable while the
  // timer runs and no key handler on the page reacts to typing (ui.js has none).
});

describe("Scenario: Notes remain between phases", () => {
  test("the note text is unchanged when the focus session ends and a break starts", () => {
    const state = createState("");
    const timer = start(createTimer(durationSeconds(state)), T0);
    const { notes } = make(fakeStorage());
    notes.set("idea one");
    const step = advance(state, timer, T0 + 25 * MIN);
    assert.equal(step.finished, true);
    assert.equal(step.state.phase, "short");
    assert.equal(notes.text, "idea one");
  });
  test("ui.js render() does not read or write the note area", () => {
    const src = readFileSync(new URL("./ui.js", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("function render()"), src.indexOf("// Handlers that must not"));
    assert.doesNotMatch(body, /notes/i);
  });
});

describe("Scenario: Notes survive a reload", () => {
  test("text is saved after the user stops typing and loaded again after a reload", () => {
    const storage = fakeStorage();
    const first = make(storage);
    first.notes.set("remember milk");
    assert.equal(storage.data[STORAGE_KEY], undefined, "not saved while still typing");
    first.timers.runAll();
    assert.equal(storage.data[STORAGE_KEY], "remember milk");

    const second = make(storage); // new page load, same browser storage
    assert.equal(second.notes.load(), "remember milk");
    assert.equal(second.notes.text, "remember milk");
  });
  test("typing again restarts the wait and only the last text is saved", () => {
    const storage = fakeStorage();
    const { notes, timers } = make(storage);
    notes.set("a");
    notes.set("ab");
    assert.equal(timers.count, 1);
    timers.runAll();
    assert.equal(storage.data[STORAGE_KEY], "ab");
  });
  test("flush saves unsaved text at once (page closed before the wait is over)", () => {
    const storage = fakeStorage();
    const { notes, timers } = make(storage);
    notes.set("quick");
    notes.flush();
    assert.equal(storage.data[STORAGE_KEY], "quick");
    assert.equal(timers.count, 0);
  });
  test("with nothing saved, load gives an empty note", () => {
    assert.equal(make(fakeStorage()).notes.load(), "");
  });
});

describe("Scenario: Notes are downloaded as a text file", () => {
  test("the file is named pomodoro-notes-<local date>.txt", () => {
    const now = new Date(2026, 9, 5, 23, 59).getTime(); // 5 Oct 2026, local time
    assert.equal(localDate(now), "2026-10-05");
    assert.equal(downloadFilename(now), "pomodoro-notes-2026-10-05.txt");
  });
  test("the file content is the note text", () => {
    const { notes } = make(fakeStorage());
    notes.set("line 1\nline 2");
    assert.equal(notes.text, "line 1\nline 2");
  });
  test("ui.js builds the file from the notes text and the dated name via Blob and a download link", () => {
    const src = readFileSync(new URL("./ui.js", import.meta.url), "utf8");
    assert.match(src, /new Blob\(\[notes\.text\]/);
    assert.match(src, /link\.download = downloadFilename\(Date\.now\(\)\)/);
    assert.match(src, /URL\.createObjectURL/);
  });
  // Left for manual check: clicking the button really saves the file in a browser.
});

describe("Scenario: The browser cannot save notes", () => {
  test("typing still shows the text and the user is told notes are only kept while the page is open", () => {
    const states = [];
    const { notes, timers } = make(brokenStorage, fakeTimers(), { onSaveStateChange: (ok) => states.push(ok) });
    notes.set("still here");
    timers.runAll();
    assert.equal(notes.text, "still here");
    assert.equal(notes.canSave, false);
    assert.deepEqual(states, [false]);
    assert.match(UNSAVED_MESSAGE, /only kept while this page is open/);
  });
  test("flush does not throw when saving fails", () => {
    const { notes } = make(brokenStorage);
    notes.set("x");
    assert.doesNotThrow(() => notes.flush());
  });
  test("reading fails: load gives empty text, no throw, and the warning is raised", () => {
    const states = [];
    const { notes } = make(brokenStorage, fakeTimers(), { onSaveStateChange: (ok) => states.push(ok) });
    assert.equal(notes.load(), "");
    assert.deepEqual(states, [false]);
  });
  test("no storage object at all (blocked by the browser) is handled the same way", () => {
    const { notes, timers } = make(null);
    assert.equal(notes.load(), "");
    notes.set("kept in memory");
    timers.runAll();
    assert.equal(notes.text, "kept in memory");
    assert.equal(notes.canSave, false);
  });
  test("the warning clears if saving works again", () => {
    let fail = true;
    const storage = { getItem: () => null, setItem() { if (fail) throw new Error("x"); } };
    const states = [];
    const { notes, timers } = make(storage, fakeTimers(), { onSaveStateChange: (ok) => states.push(ok) });
    notes.set("a"); timers.runAll();
    fail = false;
    notes.set("ab"); timers.runAll();
    assert.deepEqual(states, [false, true]);
  });
});
