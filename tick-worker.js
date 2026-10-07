// Background helper: posts a "tick" several times per second so the page gets
// woken up on time even in a background tab. It carries no time information;
// ui.js reads the clock on every tick. Plain script, no imports.
const TICK_MS = 250;
let id = null;

self.onmessage = (event) => {
  if (event.data === "start" && id === null) {
    id = setInterval(() => self.postMessage("tick"), TICK_MS);
  } else if (event.data === "stop" && id !== null) {
    clearInterval(id);
    id = null;
  }
};
