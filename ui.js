// The only file that touches the DOM and the only file that reads the clock.
// All logic lives in cycle.js, timer.js and advance.js.
import {
  PHASES, PHASE_LABELS, createState, setDuration, displayTime, durationSeconds,
} from "./cycle.js";
import { advance } from "./advance.js";
import { createTimer, start, pause, reset, displayRemaining } from "./timer.js";

let state = createState(window.location.search);
let timer = createTimer(durationSeconds(state));

const phaseEl = document.getElementById("phase");
const timerEl = document.getElementById("timer");
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

/**
 * Single hook for the end of a phase. Called exactly once per finished phase,
 * after the app has moved to the next phase. AF-12 plays the alert here.
 * @param {string} finishedPhase "focus", "short" or "long"
 */
function onPhaseFinished(finishedPhase) {
  // Placeholder: the alert sound/notification is AF-12.
}

/** Settle the timer at `now` and switch phase if it just ended. */
function settleAndAdvance(now) {
  const step = advance(state, timer, now);
  state = step.state;
  timer = step.timer;
  if (step.finished) onPhaseFinished(step.finishedPhase);
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
  timerEl.textContent = timer.status === "idle" ? displayTime(state) : displayRemaining(timer, now);
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
    errorEl.textContent = result.error ?? "";
    inputs[kind].setAttribute("aria-invalid", String(result.error !== null));
    if (timer.status === "idle") timer = createTimer(durationSeconds(state));
    render(); // on error this restores the previous value in the input
  });
}

startBtn.addEventListener("click", () => {
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
  stopTicking();
  render();
});

const form = document.getElementById("settings");
form.addEventListener("submit", (e) => e.preventDefault());

render();
