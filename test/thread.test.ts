/**
 * The "Échanges" thread as data (ADR 0007, D10): one line per
 * correspondent, whatever form the address took in the history.
 */

import { describe, expect, it } from "vitest";
import {
  buildThreads,
  contactFor,
  groupOf,
  initials,
  lastStranger,
  threadSections,
} from "../src/ui/thread.js";
import type { CallLogEntry, Contact } from "../src/storage/store.js";

const NOW = new Date(2026, 8, 27, 15, 0).getTime();
const H = 3600_000;
const BOB: Contact = { id: "c1", name: "Bob Martin", uri: "sip:bob@example.fr", addedAt: 1 };
const ZOE: Contact = { id: "c2", name: "Zoé Durand", uri: "sip:zoe@example.fr", addedAt: 1 };

const call = (target: string, startedAt: number): CallLogEntry => ({
  target, direction: "outgoing", outcome: "answered", media: { audio: true, video: false, text: false },
  startedAt, connectedAt: startedAt, endedAt: startedAt + 60_000, endedBy: "local", reason: null,
});

describe("buildThreads", () => {
  it("a contact's calls join its line, whatever the address form", () => {
    const [bob] = buildThreads([BOB], [call("bob@EXAMPLE.fr", NOW - H), call("bob@example.fr", NOW - 2 * H)], {});
    expect(bob!.calls.map((c) => c.index)).toEqual([0, 1]);
    expect(bob!.last).toBe(NOW - H);
  });

  it("a number outside the book gets its own line", () => {
    const threads = buildThreads([BOB], [call("+33612345678@example.fr", NOW)], {});
    expect(threads.map((t) => [t.name, t.contact?.id ?? null])).toEqual([
      ["Bob Martin", "c1"],
      ["+33612345678@example.fr", null],
    ]);
  });
});

describe("threadSections", () => {
  it("grouped by the last exchange; no exchange last, by name", () => {
    const threads = buildThreads([ZOE, BOB], [call("bob@example.fr", NOW - 26 * H)], {});
    expect(threadSections(threads, "", NOW).map((s) => [s.group, s.threads.map((t) => t.name)])).toEqual([
      ["yesterday", ["Bob Martin"]],
      ["none", ["Zoé Durand"]],
    ]);
  });

  it("search on name or address, accents aside", () => {
    const threads = buildThreads([ZOE, BOB], [], {});
    expect(threadSections(threads, "zoe", NOW)[0]!.threads.map((t) => t.name)).toEqual(["Zoé Durand"]);
    expect(threadSections(threads, "bob@", NOW)[0]!.threads.map((t) => t.name)).toEqual(["Bob Martin"]);
    expect(threadSections(threads, "nobody", NOW)).toEqual([]);
  });
});

describe("helpers", () => {
  it("groupOf", () => {
    expect(groupOf(NOW - H, NOW)).toBe("today");
    expect(groupOf(NOW - 3 * 24 * H, NOW)).toBe("week");
    expect(groupOf(NOW - 30 * 24 * H, NOW)).toBe("older");
    expect(groupOf(null, NOW)).toBe("none");
  });

  it("contactFor names what the dialer holds, short numbers included", () => {
    expect(contactFor([BOB], "bob", "example.fr")?.id).toBe("c1");
    expect(contactFor([BOB], "sip:bob@example.fr", "example.fr")?.id).toBe("c1");
    expect(contactFor([BOB], "carol", "example.fr")).toBeNull();
  });

  it("lastStranger: the most recent line outside the book", () => {
    const threads = buildThreads(
      [BOB],
      [call("bob@example.fr", NOW), call("carol@example.fr", NOW - 2 * H), call("dan@example.fr", NOW - H)],
      {},
    );
    expect(lastStranger(threads)?.key).toBe("dan@example.fr");
    expect(lastStranger(buildThreads([BOB], [call("bob@example.fr", NOW)], {}))).toBeNull();
  });

  it("initials", () => {
    expect(initials("Bob Martin")).toBe("BM");
    expect(initials("zoe@example.fr")).toBe("Z");
  });
});
