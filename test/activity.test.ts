/**
 * Idle and back (ADR 0007, D5 rule 2): ten quiet minutes make one
 * `onIdle`, the first gesture after makes one `onActive`, and a stream of
 * pointer moves re-arms nothing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchActivity } from "../src/ui/activity.js";

const MIN = 60_000;

function setup() {
  const target = new EventTarget();
  const page = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const log: string[] = [];
  const stop = watchActivity(
    { onIdle: () => log.push("idle"), onActive: () => log.push("active") },
    { target, page, now: () => Date.now() },
  );
  const fire = (type: string) => target.dispatchEvent(new Event(type));
  const show = (state: string) => {
    page.visibilityState = state;
    page.dispatchEvent(new Event("visibilitychange"));
  };
  return { log, stop, fire, show };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("watchActivity", () => {
  it("idle after ten quiet minutes, once", () => {
    const t = setup();
    vi.advanceTimersByTime(10 * MIN - 1);
    expect(t.log).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(t.log).toEqual(["idle"]);
    vi.advanceTimersByTime(60 * MIN);
    expect(t.log).toEqual(["idle"]);
  });

  it("a gesture pushes the deadline back", () => {
    const t = setup();
    vi.advanceTimersByTime(9 * MIN);
    t.fire("keydown");
    vi.advanceTimersByTime(9 * MIN);
    expect(t.log).toEqual([]);
    vi.advanceTimersByTime(1 * MIN);
    expect(t.log).toEqual(["idle"]);
  });

  it("the first gesture after idle is active, and the clock starts again", () => {
    const t = setup();
    vi.advanceTimersByTime(10 * MIN);
    t.fire("pointerdown");
    t.fire("pointermove");
    expect(t.log).toEqual(["idle", "active"]);
    vi.advanceTimersByTime(10 * MIN);
    expect(t.log).toEqual(["idle", "active", "idle"]);
  });

  it.each(["keydown", "pointerdown", "pointermove", "touchstart", "wheel"])("%s counts", (type) => {
    const t = setup();
    vi.advanceTimersByTime(10 * MIN);
    t.fire(type);
    expect(t.log).toEqual(["idle", "active"]);
  });

  it("coming to the foreground counts; going to the background does not", () => {
    const t = setup();
    vi.advanceTimersByTime(10 * MIN);
    t.show("hidden");
    expect(t.log).toEqual(["idle"]);
    t.show("visible");
    expect(t.log).toEqual(["idle", "active"]);
  });

  it("a thousand moves arm no more than the one timer", () => {
    const t = setup();
    for (let i = 0; i < 1000; i++) t.fire("pointermove");
    expect(vi.getTimerCount()).toBe(1);
  });

  it("stop: nothing more", () => {
    const t = setup();
    t.stop();
    vi.advanceTimersByTime(60 * MIN);
    t.fire("keydown");
    expect(t.log).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
