// The only file that touches the DOM. All logic lives in cycle.js.
import { PHASES, createState, setDuration, displayTime } from "./cycle.js";

let state = createState(window.location.search);

const timerEl = document.getElementById("timer");
const errorEl = document.getElementById("error");
const inputs = Object.fromEntries(
  PHASES.map((kind) => [kind, document.getElementById(`${kind}-minutes`)])
);

function render() {
  timerEl.textContent = displayTime(state);
  for (const kind of PHASES) inputs[kind].value = String(state.minutes[kind]);
}

for (const kind of PHASES) {
  inputs[kind].addEventListener("change", () => {
    const result = setDuration(state, kind, inputs[kind].value);
    state = result.state;
    errorEl.textContent = result.error ?? "";
    inputs[kind].setAttribute("aria-invalid", String(result.error !== null));
    render(); // on error this restores the previous value in the input
  });
}

const form = document.getElementById("settings");
form.addEventListener("submit", (e) => e.preventDefault());

render();
