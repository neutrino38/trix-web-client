/**
 * A real-time text channel for tests: the far end is driven by hand
 * (`receive`, `link`), and what the near end sends is recorded.
 *
 * Like the real one (`sip/rtt.ts`), a listener hears the current state at
 * once, then what arrived before it.
 */
import type { RttChannel, RttEvents, RttState } from "../../src/sip/rtt.js";

export interface FakeChannel extends RttChannel {
  /** A fragment from the far end, commands included. */
  receive(chunk: string): void;
  /** The link changes state. */
  link(state: RttState): void;
  /** What went out, in order: text, `⌫n` for backspaces, `⏎` for a flush. */
  readonly wire: string[];
  /** How many listeners are attached right now. */
  listeners(): number;
}

export function fakeChannel(): FakeChannel {
  let state: RttState = "connecting";
  let backlog = "";
  const listeners = new Set<RttEvents>();
  const wire: string[] = [];
  return {
    transport: "datachannel",
    wire,
    state: () => state,
    listeners: () => listeners.size,
    listen(events) {
      listeners.add(events);
      events.state(state);
      if (backlog !== "") {
        const late = backlog;
        backlog = "";
        events.text(late);
      }
      return () => listeners.delete(events);
    },
    receive(chunk) {
      if (listeners.size === 0) backlog += chunk;
      for (const l of listeners) l.text(chunk);
    },
    link(next) {
      state = next;
      for (const l of listeners) l.state(next);
    },
    send: (text) => void wire.push(text),
    backspace: (count = 1) => void wire.push(`⌫${count}`),
    flush: () => void wire.push("⏎"),
    close: () => {},
    setSending: () => {},
    missingText: () => 0,
  } as FakeChannel;
}
