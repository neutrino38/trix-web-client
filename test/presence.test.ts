/**
 * The presence link (ADR 0007, D1, D3, D8): subscriptions, how each one
 * ends, the discovery of what the server takes, and the order of things
 * when the link closes.
 */

import { DOMParser } from "@xmldom/xmldom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UNKNOWN, type XmlParser } from "../src/sip/pidf.js";
import type { Publisher } from "../src/sip/publish.js";
import {
  openPresence,
  type PresenceSipEvent,
  type WatchEnd,
  type WatchHandlers,
} from "../src/sip/presence.js";

const parser = new DOMParser({ onError: () => {} }) as unknown as XmlParser;

const BOB = "sip:bob@example.com";
const CAROL = "sip:carol@example.com";

const AVAILABLE = `<?xml version="1.0"?>
<presence xmlns="urn:ietf:params:xml:ns:pidf" entity="${BOB}">
  <tuple id="t"><status><basic>open</basic></status></tuple>
</presence>`;

interface FakeSub {
  uri: string;
  on: WatchHandlers;
  terminated: boolean;
}

function setup(opts: { maxWatched?: number; watcherThrows?: boolean } = {}) {
  const subs: FakeSub[] = [];
  const events: PresenceSipEvent[] = [];
  const log: string[] = [];
  let publishSupport: ((s: boolean) => void) | null = null;
  const publisher: Publisher & { bodies: string[] } = {
    bodies: [],
    publish(body) {
      this.bodies.push(body);
    },
    withdraw: () => log.push("withdraw"),
    stop: () => log.push("stop"),
  };
  const link = openPresence({
    watcher: (uri, on) => {
      if (opts.watcherThrows) throw new TypeError("invalid");
      const sub: FakeSub = { uri, on, terminated: false };
      subs.push(sub);
      return {
        terminate() {
          sub.terminated = true;
          log.push(`unsubscribe ${uri}`);
        },
      };
    },
    publisher: (onSupport) => {
      publishSupport = onSupport;
      return publisher;
    },
    parser,
    entity: "sip:alice@example.com",
    tupleId: "dev1",
    send: (ev) => events.push(ev),
    retryMs: 1000,
    ...(opts.maxWatched !== undefined ? { maxWatched: opts.maxWatched } : {}),
  });
  return {
    link,
    subs,
    events,
    log,
    publisher,
    publishSupport: (s: boolean) => publishSupport!(s),
    presenceOf: (uri: string) =>
      events.filter((e) => e.type === "sip:presence" && e.uri === uri).at(-1),
    support: () => events.filter((e) => e.type === "sip:presenceSupport"),
  };
}

const end = (sub: FakeSub | undefined, e: WatchEnd) => sub!.on.ended(e);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("subscriptions", () => {
  it("one per contact, and watching twice is watching once", () => {
    const t = setup();
    t.link.watch(BOB);
    t.link.watch(BOB);
    t.link.watch(CAROL);
    expect(t.subs.map((s) => s.uri)).toEqual([BOB, CAROL]);
  });

  it("a NOTIFY becomes the contact's presence", () => {
    const t = setup();
    t.link.watch(BOB);
    t.subs[0]!.on.notify(AVAILABLE, "application/pidf+xml");
    expect(t.presenceOf(BOB)).toEqual({
      type: "sip:presence",
      uri: BOB,
      info: { state: "available", note: null, since: null },
      pending: false,
    });
  });

  it("a body that is not PIDF reads as unknown", () => {
    const t = setup();
    t.link.watch(BOB);
    t.subs[0]!.on.notify(AVAILABLE, "application/xpidf+xml");
    expect(t.presenceOf(BOB)).toMatchObject({ info: UNKNOWN });
  });

  it("pending: unknown, waiting for the contact's consent", () => {
    const t = setup();
    t.link.watch(BOB);
    t.subs[0]!.on.pending();
    expect(t.presenceOf(BOB)).toMatchObject({ info: UNKNOWN, pending: true });
  });

  it("the cap of D3: beyond it, contacts stay unknown and nothing is sent", () => {
    const t = setup({ maxWatched: 2 });
    t.link.watch(BOB);
    t.link.watch(CAROL);
    t.link.watch("sip:dave@example.com");
    expect(t.subs).toHaveLength(2);
    // a slot freed is a slot taken
    t.link.unwatch(BOB);
    t.link.watch("sip:dave@example.com");
    expect(t.subs).toHaveLength(3);
  });

  it("unwatch ends the subscription, and its late events are ignored", () => {
    const t = setup();
    t.link.watch(BOB);
    const sub = t.subs[0]!;
    t.link.unwatch(BOB);
    expect(sub.terminated).toBe(true);
    sub.on.notify(AVAILABLE, "application/pidf+xml");
    end(sub, { kind: "noAnswer" });
    vi.advanceTimersByTime(3_600_000);
    expect(t.events).toEqual([]);
    expect(t.subs).toHaveLength(1);
  });

  it("an address JsSIP refuses reads as unknown, and is not retried", () => {
    const t = setup({ watcherThrows: true });
    t.link.watch("sip:not valid");
    expect(t.presenceOf("sip:not valid")).toMatchObject({ info: UNKNOWN });
    vi.advanceTimersByTime(3_600_000);
    expect(t.events).toHaveLength(1);
  });
});

describe("how a subscription ends (RFC 6665 §4.1.3)", () => {
  it.each(["rejected", "noresource", "invariant"])("%s: unknown, and no retry", (reason) => {
    const t = setup();
    t.link.watch(BOB);
    end(t.subs[0], { kind: "terminated", reason, retryAfter: null });
    expect(t.presenceOf(BOB)).toMatchObject({ info: UNKNOWN, pending: false });
    vi.advanceTimersByTime(3_600_000);
    expect(t.subs).toHaveLength(1);
  });

  it.each([403, 404, 480])("a %i is about the contact: unknown, no retry", (status) => {
    const t = setup();
    t.link.watch(BOB);
    end(t.subs[0], { kind: "refused", status });
    expect(t.presenceOf(BOB)).toMatchObject({ info: UNKNOWN });
    vi.advanceTimersByTime(3_600_000);
    expect(t.subs).toHaveLength(1);
    expect(t.support()).toEqual([]);
  });

  it.each(["deactivated", "timeout", null])("%s: subscribe again at once", (reason) => {
    const t = setup();
    t.link.watch(BOB);
    end(t.subs[0], { kind: "terminated", reason, retryAfter: null });
    expect(t.subs.map((sub) => sub.uri)).toEqual([BOB, BOB]);
  });

  it("retry-after is honoured", () => {
    const t = setup();
    t.link.watch(BOB);
    end(t.subs[0], { kind: "terminated", reason: "probation", retryAfter: 120 });
    vi.advanceTimersByTime(119_999);
    expect(t.subs).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(t.subs).toHaveLength(2);
  });

  it("no answer, or a 5xx: later, and later still each time", () => {
    const t = setup();
    t.link.watch(BOB);
    end(t.subs[0], { kind: "noAnswer" });
    vi.advanceTimersByTime(1000);
    expect(t.subs).toHaveLength(2);
    end(t.subs[1], { kind: "refused", status: 503 });
    vi.advanceTimersByTime(1999);
    expect(t.subs).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(t.subs).toHaveLength(3);
  });

  it("a server that keeps deactivating is not flooded", () => {
    const t = setup();
    t.link.watch(BOB);
    end(t.subs[0], { kind: "terminated", reason: "deactivated", retryAfter: null });
    // at once the first time, then backing off
    expect(t.subs).toHaveLength(2);
    end(t.subs[1], { kind: "terminated", reason: "deactivated", retryAfter: null });
    expect(t.subs).toHaveLength(2);
    vi.advanceTimersByTime(2000);
    expect(t.subs).toHaveLength(3);
  });

  it("a NOTIFY resets the back-off", () => {
    const t = setup();
    t.link.watch(BOB);
    end(t.subs[0], { kind: "noAnswer" });
    vi.advanceTimersByTime(1000);
    t.subs[1]!.on.notify(AVAILABLE, "application/pidf+xml");
    end(t.subs[1], { kind: "terminated", reason: "deactivated", retryAfter: null });
    expect(t.subs).toHaveLength(3);
  });
});

describe("discovery (D8)", () => {
  it("a 2xx to SUBSCRIBE says yes, once", () => {
    const t = setup();
    t.link.watch(BOB);
    t.link.watch(CAROL);
    t.subs[0]!.on.accepted();
    t.subs[1]!.on.accepted();
    expect(t.support()).toEqual([{ type: "sip:presenceSupport", method: "subscribe", supported: true }]);
  });

  it.each([489, 405, 501])("a %i to SUBSCRIBE: everyone is dropped, nothing leaves again", (status) => {
    const t = setup();
    t.link.watch(BOB);
    t.link.watch(CAROL);
    end(t.subs[0], { kind: "refused", status });
    expect(t.support()).toEqual([{ type: "sip:presenceSupport", method: "subscribe", supported: false }]);
    expect(t.subs[1]!.terminated).toBe(true);
    t.link.watch("sip:dave@example.com");
    vi.advanceTimersByTime(3_600_000);
    expect(t.subs).toHaveLength(2);
  });

  it("the publisher's verdict is said once, as publish support", () => {
    const t = setup();
    t.link.publish({ state: "busy", note: null, since: null });
    t.publishSupport(false);
    expect(t.support()).toEqual([{ type: "sip:presenceSupport", method: "publish", supported: false }]);
  });
});

describe("publication", () => {
  it("our presence goes out as PIDF, with our entity and tuple", () => {
    const t = setup();
    t.link.publish({ state: "dnd", note: "Focus", since: null });
    const body = t.publisher.bodies[0]!;
    expect(body).toContain(`entity="sip:alice@example.com"`);
    expect(body).toContain(`<tuple id="dev1">`);
    expect(body).toContain("<trix:dnd/>");
    expect(body).toContain("<note>Focus</note>");
  });
});

describe("close", () => {
  it("withdraws, then unsubscribes everyone, then does nothing", () => {
    const t = setup();
    t.link.watch(BOB);
    t.link.watch(CAROL);
    t.link.publish({ state: "available", note: null, since: null });
    t.link.close();
    expect(t.log).toEqual(["withdraw", `unsubscribe ${BOB}`, `unsubscribe ${CAROL}`]);

    t.link.watch("sip:dave@example.com");
    t.link.publish({ state: "busy", note: null, since: null });
    t.subs[0]!.on.notify(AVAILABLE, "application/pidf+xml");
    t.publishSupport(true);
    expect(t.subs).toHaveLength(2);
    expect(t.publisher.bodies).toHaveLength(1);
    expect(t.events).toEqual([]);
  });

  it("a pending retry does not fire after close", () => {
    const t = setup();
    t.link.watch(BOB);
    end(t.subs[0], { kind: "noAnswer" });
    t.link.close();
    vi.advanceTimersByTime(3_600_000);
    expect(t.subs).toHaveLength(1);
  });

  it("rebind: events go to the new sink", () => {
    const t = setup();
    const other: PresenceSipEvent[] = [];
    t.link.watch(BOB);
    t.link.rebind((ev) => other.push(ev));
    t.subs[0]!.on.accepted();
    expect(t.events).toEqual([]);
    expect(other).toHaveLength(1);
  });
});
