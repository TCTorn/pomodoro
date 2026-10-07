// The only file that touches the DOM and the only file that reads the clock.
// All logic lives in cycle.js and timer.js.
import { PHASES, createState, setDuration, displayTime, durationSeconds } from "./cycle.js";
import { createTimer, start, pause, reset, settle, displayRemaining } from "./timer.js";

let state = createState(window.location.search);
let timer = createTimer(durationSeconds(state));

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

function onTick() {
  timer = settle(timer, Date.now());
  if (timer.status !== "running") stopTicking();
  render();
}

function render() {
  const now = Date.now();
  // While idle the timer follows the duration inputs; otherwise it counts down.
  timerEl.textContent = timer.status === "idle" ? displayTime(state) : displayRemaining(timer, now);
  for (const kind of PHASES) {
    inputs[kind].value = String(state.minutes[kind]);
    inputs[kind].disabled = timer.status !== "idle"; // Reset unlocks them
  }
  startBtn.disabled = timer.status === "running" || timer.status === "finished";
  pauseBtn.disabled = timer.status !== "running";
}

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
  timer = pause(timer, Date.now());
  stopTicking();
  render();
});

resetBtn.addEventListener("click", () => {
  timer = reset(timer, durationSeconds(state));
  stopTicking();
  render();
});

const form = document.getElementById("settings");
form.addEventListener("submit", (e) => e.preventDefault());

render();
