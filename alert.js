// End-of-session alert (AF-12): a generated beep, a browser notification when
// allowed, and an in-page notice that is always set. No DOM and no clock: every
// browser object is passed in, so node:test can use fakes. ui.js wires it up.

const BEEP_HZ = 880;
const BEEP_SECONDS = 0.25;
const BEEP_COUNT = 3;
const BEEP_GAP_SECONDS = 0.4;

/** Texts for a finished phase ("focus", "short" or "long"). */
export function alertTexts(finishedPhase) {
  const focus = finishedPhase === "focus";
  const headline = focus ? "Focus session done" : "Break done";
  const prompt = focus ? "start your break" : "start your next focus session";
  return {
    headline,
    notice: `${headline} — ${prompt}`,
    title: `Done · ${focus ? "Focus" : "Break"} – Pomodoro`,
  };
}

/** Play a short series of beeps on an AudioContext (or a fake with the same methods). */
export function playBeep(ctx) {
  const t0 = ctx.currentTime;
  for (let i = 0; i < BEEP_COUNT; i++) {
    const at = t0 + i * BEEP_GAP_SECONDS;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = BEEP_HZ;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.3, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + BEEP_SECONDS);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(at);
    osc.stop(at + BEEP_SECONDS + 0.05);
  }
}

/**
 * @param {object} deps
 * @param {() => object} [deps.createAudioContext] returns an AudioContext; may be missing or throw
 * @param {Function | undefined} [deps.Notification] the Notification class, if the browser has one
 */
export function createAlerter({ createAudioContext, Notification: NotificationApi } = {}) {
  let ctx = null;
  let permissionAsked = false;
  let notice = null; // { notice, title } of the last finished phase, until clear()
  let lastNotification = null;

  function ensureAudio() {
    try {
      if (!ctx && createAudioContext) ctx = createAudioContext();
      if (ctx && ctx.state !== "running") { // "suspended", or "interrupted" in Safari
        const p = ctx.resume();
        if (p && typeof p.catch === "function") p.catch(() => {});
      }
    } catch {
      ctx = null; // no sound available; the in-page notice still works
    }
  }

  function closeLast() {
    const old = lastNotification;
    lastNotification = null;
    try {
      if (old && typeof old.close === "function") old.close();
    } catch {
      // Already closed or not closable: ignore.
    }
  }

  return {
    /**
     * Call from the Start click only (a user gesture). Creates and resumes the
     * AudioContext, and asks for notification permission once, and only while
     * the permission is still undecided ("default"). Clears the old notice.
     */
    prepare() {
      notice = null;
      ensureAudio();
      try {
        if (NotificationApi && NotificationApi.permission === "default" && !permissionAsked) {
          permissionAsked = true;
          const p = NotificationApi.requestPermission();
          if (p && typeof p.catch === "function") p.catch(() => {});
        }
      } catch {
        // Permission API unavailable or blocked: carry on without notifications.
      }
    },

    /** Alert for a finished phase: in-page notice, sound, and notification if granted. */
    fire(finishedPhase) {
      const texts = alertTexts(finishedPhase);
      notice = { notice: texts.notice, title: texts.title };
      ensureAudio();
      try {
        if (ctx) playBeep(ctx);
      } catch {
        // Sound blocked or unsupported: the notice is still shown.
      }
      try {
        if (NotificationApi && NotificationApi.permission === "granted") {
          // No tag and no renotify: a reused tag can make Chrome/Edge replace the old
          // notification silently, and renotify without a tag throws in Firefox.
          // Close the previous one explicitly instead; every alert is a new popup.
          closeLast();
          lastNotification = new NotificationApi(texts.headline, { body: texts.notice });
        }
      } catch {
        // Some browsers refuse the constructor (e.g. mobile): ignore.
      }
    },

    /** Take the result of advance(): fires exactly when it reports a finished phase. */
    onAdvance(step) {
      if (step.finished) this.fire(step.finishedPhase);
    },

    /** Hide the in-page notice and title (Reset, new durations). Leaves any system notification alone. */
    clear() {
      notice = null;
    },

    /** The notice to show ({ notice, title }) or null. */
    current() {
      return notice;
    },
  };
}
