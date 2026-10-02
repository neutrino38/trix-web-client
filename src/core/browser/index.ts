/**
 * The browser as a `Platform` (ADR 0011, D7) — the default one.
 *
 * This directory is the only part of the core allowed to listen to the page
 * (`document`, `window`): it hears it, it never changes it.
 * `test/layers.test.ts` holds it to that.
 */

import type { Platform } from "../platform.js";
import { watchActivity } from "./activity.js";
import { watchSystemLifecycle } from "./lifecycle.js";

export function browserPlatform(): Platform {
  const visible = (): boolean => document.visibilityState === "visible";
  return {
    lifecycle: (events) => watchSystemLifecycle(events),
    activity: (events) => watchActivity(events),
    visibility(listener) {
      const onChange = (): void => listener(visible());
      document.addEventListener("visibilitychange", onChange);
      return () => document.removeEventListener("visibilitychange", onChange);
    },
    visible,
    online: () => navigator.onLine,
  };
}
