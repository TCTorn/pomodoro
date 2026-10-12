// The only file that touches the DOM and the only file that reads the clock.
// All logic lives in cycle.js, timer.js and advance.js.
import {
  PHASES, PHASE_LABELS, createState, setDuration, displayTime, durationSeconds,
} from "./cycle.js";
import { advance } from "./advance.js";
import { createAlerter } from "./alert.js";
import { createNotes, downloadFilename, UNSAVED_MESSAGE } from "./notes.js";
import { createTimer, start, pause, reset, displayRemaining,
  elapsedFraction, pageTitle } from "./timer.js";

const alerter = createAlerter({
  createAudioContext: () => new (window.AudioContext || window.webkitAudioContext)(),
  Notification: typeof Notification === "undefined" ? undefined : Notification,
});

let state = createState(window.location.search);
let timer = createTimer(durationSeconds(state));

const phaseEl = document.getElementById("phase");
const timerEl = document.getElementById("timer");
const ringEl = document.getElementById("ring");
const noticeEl = document.getElementById("notice");
const errorEl = document.getElementById("error");
const startBtn = document.getElementById("start");
const pauseBtn = document.getElementById("pause");
const resetBtn = document.getElementById("reset");
const inputs = Object.fromEntries(
  PHASES.map((kind) => [kind, document.getElementById(`${kind}-minutes`)])
);

// Ticks come from a Web Worker so they keep coming in background tabs.
// If the worker cannot load, fall back to a plain interval.
let worker = null;
let fallbackId = null;

function startTicking() {
  if (worker || fallbackId !== null) return;
  try {
    worker = new Worker("./tick-worker.js");
    worker.onmessage = onTick;
    worker.onerror = () => {
      stopTicking();
      fallbackId = setInterval(onTick, 250);
    };
    worker.postMessage("start");
  } catch {
    worker = null;
    fallbackId = setInterval(onTick, 250);
  }
}

function stopTicking() {
  if (worker) {
    worker.postMessage("stop");
    worker.terminate();
    worker = null;
  }
  if (fallbackId !== null) {
    clearInterval(fallbackId);
    fallbackId = null;
  }
}

/** Settle the timer at `now` and switch phase if it just ended. */
function settleAndAdvance(now) {
  const step = advance(state, timer, now);
  state = step.state;
  timer = step.timer;
  alerter.onAdvance(step); // exactly once per finished phase
}

function onTick() {
  settleAndAdvance(Date.now());
  if (timer.status !== "running") stopTicking();
  render();
}

function render() {
  const now = Date.now();
  // Write only on change: this is an aria-live region.
  if (phaseEl.textContent !== PHASE_LABELS[state.phase]) {
    phaseEl.textContent = PHASE_LABELS[state.phase];
  }
  // While idle the timer follows the duration inputs; otherwise it counts down.
  const timeText = timer.status === "idle" ? displayTime(state) : displayRemaining(timer, now);
  timerEl.textContent = timeText;
  // A finished phase is announced in the page itself until Start is pressed.
  const done = alerter.current();
  const noticeText = done ? done.notice : "";
  if (noticeEl.textContent !== noticeText) noticeEl.textContent = noticeText; // aria-live
  noticeEl.hidden = !done;
  document.title = done ? done.title : pageTitle(timeText, PHASE_LABELS[state.phase]);
  // The ring has pathLength 100, so the dash offset is the percent not yet elapsed.
  const fraction = elapsedFraction(timer, now);
  ringEl.setAttribute("stroke-dashoffset", String(100 * (1 - fraction)));
  // A round cap is drawn even for a zero-length dash, so hide the arc at 0 %.
  ringEl.setAttribute("visibility", fraction > 0 ? "visible" : "hidden");
  timerEl.classList.toggle("long", timeText.length > 5); // e.g. "100:00"
  for (const kind of PHASES) {
    inputs[kind].value = String(state.minutes[kind]);
    inputs[kind].disabled = timer.status !== "idle"; // Reset unlocks them
  }
  startBtn.disabled = timer.status === "running" || timer.status === "finished";
  pauseBtn.disabled = timer.status !== "running";
}

// Handlers that must not discard a phase whose end time has passed call
// settleAndAdvance first (tick, Pause, Reset). Start only acts on an idle or
// paused timer (never past its end) and the inputs are editable only while idle.
for (const kind of PHASES) {
  inputs[kind].addEventListener("change", () => {
    const result = setDuration(state, kind, inputs[kind].value);
    state = result.state;
    alerter.clear();
    errorEl.textContent = result.error ?? "";
    inputs[kind].setAttribute("aria-invalid", String(result.error !== null));
    if (timer.status === "idle") timer = createTimer(durationSeconds(state));
    render(); // on error this restores the previous value in the input
  });
}

startBtn.addEventListener("click", () => {
  alerter.prepare(); // user gesture: unlock sound, ask for notification permission
  timer = start(timer, Date.now());
  if (timer.status === "running") startTicking();
  render();
});

pauseBtn.addEventListener("click", () => {
  const now = Date.now();
  settleAndAdvance(now); // the phase may have ended since the last tick
  timer = pause(timer, now); // only a running timer pauses
  stopTicking();
  render();
});

resetBtn.addEventListener("click", () => {
  settleAndAdvance(Date.now()); // do not discard a phase that has already ended
  timer = reset(timer, durationSeconds(state));
  alerter.clear();
  stopTicking();
  render();
});

const form = document.getElementById("settings");
form.addEventListener("submit", (e) => e.preventDefault());

// Notes live outside the timer and are never touched by render().
const notesEl = document.getElementById("notes-text");
const notesWarningEl = document.getElementById("notes-warning");
const notesDownloadBtn = document.getElementById("notes-download");

function browserStorage() {
  try {
    return window.localStorage; // reading it can throw when storage is blocked
  } catch {
    return null;
  }
}

function showSaveState(canSave) {
  notesWarningEl.textContent = canSave ? "" : UNSAVED_MESSAGE;
  notesWarningEl.hidden = canSave;
}

const notes = createNotes({ storage: browserStorage(), onSaveStateChange: showSaveState });
notesEl.value = notes.load();

notesEl.addEventListener("input", () => notes.set(notesEl.value));
window.addEventListener("pagehide", () => notes.flush());
window.addEventListener("beforeunload", () => notes.flush());

notesDownloadBtn.addEventListener("click", () => {
  const blob = new Blob([notes.text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = downloadFilename(Date.now());
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});

render();
