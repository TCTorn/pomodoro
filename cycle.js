// Pure logic for the cycle: phases, phase lengths, validation, URL overrides
// and mm:ss formatting. No DOM access, so it runs in the browser and in node:test.
// formatTime lives here (not in timer.js) because AF-8 owns timer.js and the
// only use now is showing a phase length.

export const PHASES = ["focus", "short", "long"];

export const DEFAULT_MINUTES = Object.freeze({ focus: 25, short: 5, long: 15 });

export const ERROR_MESSAGE = "Enter a whole number of minutes, 1 or more.";

/**
 * Validate text typed by the user. Only whole minutes >= 1 are accepted.
 * @returns {{ok: true, minutes: number} | {ok: false, error: string}}
 */
export function parseMinutesInput(text) {
  const trimmed = String(text ?? "").trim();
  if (/^\d+$/.test(trimmed)) {
    const minutes = Number(trimmed);
    if (Number.isSafeInteger(minutes) && minutes >= 1) {
      return { ok: true, minutes };
    }
  }
  return { ok: false, error: ERROR_MESSAGE };
}

/**
 * Read duration overrides (in minutes) from a query string such as
 * "?focus=0.1". Fractions are allowed here (testing aid only); invalid or
 * non-positive values are ignored.
 */
export function parseUrlOverrides(search) {
  const params = new URLSearchParams(search);
  const overrides = {};
  for (const kind of PHASES) {
    const raw = params.get(kind);
    if (raw === null || raw.trim() === "") continue;
    const minutes = Number(raw);
    if (Number.isFinite(minutes) && minutes > 0) overrides[kind] = minutes;
  }
  return overrides;
}

/**
 * App state. AF-8 can add running state (e.g. `status`, `endsAt`) here.
 * @param {string} [search] query string, e.g. window.location.search
 */
export function createState(search = "") {
  return {
    minutes: { ...DEFAULT_MINUTES, ...parseUrlOverrides(search) },
    phase: "focus", // current phase; later stories switch it
  };
}

/**
 * Try to set one duration from user text. Returns a new state when valid,
 * otherwise the same state unchanged plus an error message.
 * @returns {{state: object, error: string | null}}
 */
export function setDuration(state, kind, text) {
  if (!PHASES.includes(kind)) throw new Error(`Unknown duration: ${kind}`);
  const result = parseMinutesInput(text);
  if (!result.ok) return { state, error: result.error };
  return {
    state: { ...state, minutes: { ...state.minutes, [kind]: result.minutes } },
    error: null,
  };
}

/** Seconds of the given (default: current) session. Rounded: 0.1 min = 6 s. */
export function durationSeconds(state, kind = state.phase) {
  return Math.round(state.minutes[kind] * 60);
}

/** Format whole seconds as mm:ss (minutes may exceed 99). */
export function formatTime(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

/** Text to show on the timer. While stopped, the full session length. */
export function displayTime(state) {
  return formatTime(durationSeconds(state));
}
