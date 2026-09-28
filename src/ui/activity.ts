/**
 * Is anybody there? The signal behind the second automatic rule of the
 * status (ADR 0007, D5): Available becomes Away after ten minutes without
 * activity, and back at the first gesture.
 *
 * Activity is a key, a pointer, a touch, a wheel — or the tab coming to
 * the foreground, which is somebody looking. Nothing else: a call ringing
 * or a message arriving says something about the others, not about us.
 *
 * Pointer moves fire dozens of times a second, so a gesture only notes the
 * time; the one timer runs to the deadline and, if something happened in
 * between, re-arms itself for what is left. A hidden tab has its timers
 * throttled to about one wake-up a minute (see `ui/lifecycle.ts`): the
 * idle signal may then come up to a minute late, which ten minutes can
 * afford.
 *
 * This module only reports: whether being idle changes what others see
 * is PresenceMachine's decision.
 */

export const IDLE_MS = 10 * 60_000;

const GESTURES = ["keydown", "pointerdown", "pointermove", "touchstart", "wheel"] as const;

export interface ActivityEvents {
  onIdle: () => void;
  onActive: () => void;
}

export interface ActivityOptions {
  idleMs?: number;
  /** Where gestures are heard; `window` in the app. */
  target?: EventTarget;
  /** Where `visibilitychange` is heard, and what it says; `document` in the app. */
  page?: EventTarget & { visibilityState: string };
  now?: () => number;
}

/** Starts watching; returns what stops it. */
export function watchActivity(events: ActivityEvents, opts: ActivityOptions = {}): () => void {
  const idleMs = opts.idleMs ?? IDLE_MS;
  const target = opts.target ?? window;
  const page = opts.page ?? document;
  const now = opts.now ?? Date.now;

  let last = now();
  let idle = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const arm = (ms: number) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(check, ms);
  };

  function check() {
    timer = null;
    const quiet = now() - last;
    if (quiet < idleMs) {
      arm(idleMs - quiet);
      return;
    }
    idle = true;
    events.onIdle();
  }

  const gesture = () => {
    last = now();
    if (!idle) return;
    idle = false;
    events.onActive();
    arm(idleMs);
  };

  const visibility = () => {
    if (page.visibilityState === "visible") gesture();
  };

  for (const type of GESTURES) target.addEventListener(type, gesture, { passive: true });
  page.addEventListener("visibilitychange", visibility);
  arm(idleMs);

  return () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    for (const type of GESTURES) target.removeEventListener(type, gesture);
    page.removeEventListener("visibilitychange", visibility);
  };
}
