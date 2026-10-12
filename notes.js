// Note area logic (AF-14). No DOM, no clock, no timer: storage, the debounce
// timer functions and the date are passed in, so it is testable in node.
// Notes are stored only in the browser (localStorage), never sent anywhere.

export const STORAGE_KEY = "pomodoro.notes";
export const SAVE_DELAY_MS = 800;
export const UNSAVED_MESSAGE = "Notes can't be saved in this browser. They are only kept while this page is open.";

/**
 * @param {object} options
 * @param {{getItem: Function, setItem: Function}|null} options.storage
 *   localStorage-like object, or null when the browser does not offer one.
 * @param {Function} [options.setTimer]   like setTimeout
 * @param {Function} [options.clearTimer] like clearTimeout
 * @param {number} [options.delayMs]      quiet time before saving
 * @param {Function} [options.onSaveStateChange] called with true/false when
 *   saving starts or stops working
 */
export function createNotes({
  storage,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  delayMs = SAVE_DELAY_MS,
  onSaveStateChange = () => {},
}) {
  let text = "";
  let dirty = false;
  let pending = null;
  let canSave = true;

  function setCanSave(value) {
    if (canSave === value) return;
    canSave = value;
    onSaveStateChange(value);
  }

  function writeNow() {
    pending = null;
    if (!dirty) return;
    try {
      if (!storage) throw new Error("no storage");
      storage.setItem(STORAGE_KEY, text);
      dirty = false;
      setCanSave(true);
    } catch {
      // Keep the text in memory; the user is told it is not saved.
      setCanSave(false);
    }
  }

  return {
    /** Read saved notes. Returns the text (empty if none or unreadable). */
    load() {
      try {
        if (!storage) throw new Error("no storage");
        const saved = storage.getItem(STORAGE_KEY);
        if (typeof saved === "string") text = saved;
      } catch {
        setCanSave(false);
      }
      return text;
    },
    /** Call on every edit. Saves after `delayMs` without further edits. */
    set(value) {
      text = String(value);
      dirty = true;
      if (pending !== null) clearTimer(pending);
      pending = setTimer(writeNow, delayMs);
    },
    /** Save now if there are unsaved edits (page close). */
    flush() {
      if (pending !== null) clearTimer(pending);
      writeNow();
    },
    get text() { return text; },
    /** False once saving has failed (until a later save works). */
    get canSave() { return canSave; },
  };
}

/** Local date as YYYY-MM-DD. `now` is ms since epoch, passed in by the caller. */
export function localDate(now) {
  const d = new Date(now);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** File name for the download. */
export function downloadFilename(now) {
  return `pomodoro-notes-${localDate(now)}.txt`;
}
