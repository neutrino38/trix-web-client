/**
 * PresenceMachine (ADR 0007, D5, D8, D9, D12): what it publishes, whom it
 * watches, what it keeps when the registration goes, and what each server
 * answer does to it — driven by the `phone:*` signals, with a fake link.
 */

import { describe, expect, it } from "vitest";
import {
  PresenceMachine,
  publishedPresence,
  type PresenceEvent,
  type StatusStore,
} from "../src/machines/presence.js";
import type { Presence } from "../src/sip/pidf.js";
import type { SipHandle } from "../src/sip/port.js";
import type { PresenceLink, PresenceSipEvent, PublishedInfo } from "../src/sip/presence.js";
import { DEFAULT_STATUS, type StatusPrefs } from "../src/storage/session.js";

const BOB = "sip:bob@example.com";
const CAROL = "sip:carol@example.com";
const AVAILABLE = { state: "available", note: null, since: null } as const;

function fakeHandle() {
  const calls: string[] = [];
  const published: PublishedInfo[] = [];
  let send: ((ev: PresenceSipEvent) => void) | null = null;
  let self = 0;
  const link: PresenceLink = {
    watch: (uri) => calls.push(`watch ${uri}`),
    unwatch: (uri) => calls.push(`unwatch ${uri}`),
    watchSelf: () => {
      self += 1;
    },
    publish: (info) => published.push(info),
  };
  const handle = {
    presence(s: (ev: PresenceSipEvent) => void) {
      send = s;
      return link;
    },
  } as unknown as SipHandle;
  return {
    handle,
    calls,
    published,
    selfWatches: () => self,
    emit: (ev: PresenceSipEvent) => send!(ev),
  };
}

function memoryStatusStore(initial: Record<string, StatusPrefs> = {}) {
  const saved = new Map(Object.entries(initial));
  const store: StatusStore = {
    load: (id) => saved.get(id) ?? DEFAULT_STATUS,
    save: (id, prefs) => saved.set(id, prefs),
  };
  return { store, saved };
}

function start(opts: { enabled?: boolean; prefs?: Record<string, StatusPrefs> } = {}) {
  const status = memoryStatusStore(opts.prefs);
  const presence = PresenceMachine.start({
    args: { statusStore: status.store, enabled: opts.enabled ?? true },
  });
  const send = (ev: PresenceEvent) => presence.send(ev);
  return { presence, send, saved: status.saved };
}

function up(t: ReturnType<typeof start>, uris: string[] = [BOB], accountId = "acc") {
  const h = fakeHandle();
  t.send({ type: "phone:up", handle: h.handle, accountId, uris });
  return h;
}

describe("publishedPresence — the chosen status and the two rules (D5)", () => {
  const prefs = (over: Partial<StatusPrefs> = {}): StatusPrefs => ({ ...DEFAULT_STATUS, ...over });

  it("the chosen status, with its note", () => {
    expect(publishedPresence(prefs({ chosen: "busy", note: "Meeting" }), false, false)).toEqual({
      state: "busy",
      note: "Meeting",
    });
  });

  it("rule 1: on the phone during a call — but not in dnd", () => {
    expect(publishedPresence(prefs({ chosen: "away" }), true, false).state).toBe("on-the-phone");
    expect(publishedPresence(prefs({ chosen: "dnd" }), true, false).state).toBe("dnd");
    expect(publishedPresence(prefs({ onThePhone: false }), true, false).state).toBe("available");
  });

  it("rule 2: away when idle — only from available", () => {
    expect(publishedPresence(prefs(), false, true).state).toBe("away");
    expect(publishedPresence(prefs({ chosen: "busy" }), false, true).state).toBe("busy");
    expect(publishedPresence(prefs({ awayWhenIdle: false }), false, true).state).toBe("available");
  });

  it("invisible is offline, note withheld, whatever the rules", () => {
    expect(publishedPresence(prefs({ chosen: "invisible", note: "x" }), true, true)).toEqual({
      state: "offline",
      note: null,
    });
  });
});

describe("PresenceMachine — up and down (D9, D12)", () => {
  it("starts off; phone:up watches every contact and publishes", () => {
    const t = start();
    expect(t.presence.state).toBe("off");
    const h = up(t, [BOB, CAROL]);
    expect(t.presence.state).toBe("live");
    expect(h.calls).toEqual([`watch ${BOB}`, `watch ${CAROL}`]);
    expect(h.selfWatches()).toBe(1);
    expect(h.published).toHaveLength(1);
    expect(h.published[0]).toMatchObject({ state: "available", note: null });
  });

  it("a NOTIFY becomes the contact's presence, fresh", () => {
    const t = start();
    const h = up(t);
    h.emit({ type: "sip:presence", uri: BOB, info: AVAILABLE, pending: false });
    expect(t.presence.context.contacts[BOB]).toMatchObject({ info: AVAILABLE, fresh: true });
  });

  it("down: what we knew is kept, marked stale; up again refreshes it", () => {
    const t = start();
    const h = up(t);
    h.emit({ type: "sip:presence", uri: BOB, info: AVAILABLE, pending: false });
    t.send({ type: "phone:down" });
    expect(t.presence.state).toBe("stale");
    expect(t.presence.context.contacts[BOB]).toMatchObject({ info: AVAILABLE, fresh: false });

    // a late event of the closed link changes nothing
    h.emit({ type: "sip:presence", uri: BOB, info: { ...AVAILABLE, state: "busy" }, pending: false });
    expect(t.presence.context.contacts[BOB]!.info.state).toBe("available");

    const h2 = up(t);
    expect(t.presence.state).toBe("live");
    expect(h2.calls).toEqual([`watch ${BOB}`]);
    // the same account: what we knew stays until the server says otherwise
    expect(t.presence.context.contacts[BOB]).toMatchObject({ fresh: false });
  });

  it("another account starts from nothing, with its own status", () => {
    const t = start({ prefs: { other: { ...DEFAULT_STATUS, chosen: "busy" } } });
    const h = up(t);
    h.emit({ type: "sip:presence", uri: BOB, info: AVAILABLE, pending: false });
    t.send({ type: "phone:down" });
    const h2 = up(t, [CAROL], "other");
    expect(t.presence.context.contacts).toEqual({});
    expect(h2.published[0]!.state).toBe("busy");
  });

  it("presence of an address no longer in the book is ignored", () => {
    const t = start();
    const h = up(t, [BOB]);
    h.emit({ type: "sip:presence", uri: CAROL, info: AVAILABLE, pending: false });
    expect(t.presence.context.contacts[CAROL]).toBeUndefined();
  });
});

describe("PresenceMachine — the contact book", () => {
  it("added contacts are watched, removed ones unwatched and forgotten", () => {
    const t = start();
    const h = up(t, [BOB]);
    h.emit({ type: "sip:presence", uri: BOB, info: AVAILABLE, pending: false });
    t.send({ type: "phone:contacts", uris: [CAROL] });
    expect(h.calls).toEqual([`watch ${BOB}`, `unwatch ${BOB}`, `watch ${CAROL}`]);
    expect(t.presence.context.contacts[BOB]).toBeUndefined();
  });

  it("while stale, the book is followed without watching", () => {
    const t = start();
    const h = up(t, [BOB]);
    t.send({ type: "phone:down" });
    t.send({ type: "phone:contacts", uris: [BOB, CAROL] });
    expect(h.calls).toEqual([`watch ${BOB}`]);
    const h2 = up(t, [BOB, CAROL]);
    expect(h2.calls).toEqual([`watch ${BOB}`, `watch ${CAROL}`]);
  });
});

describe("PresenceMachine — discovery (D8)", () => {
  it("SUBSCRIBE refused: no_watch, contacts forgotten, the book no longer watched", () => {
    const t = start();
    const h = up(t, [BOB]);
    h.emit({ type: "sip:presence", uri: BOB, info: AVAILABLE, pending: false });
    h.emit({ type: "sip:presenceSupport", method: "subscribe", supported: false });
    expect(t.presence.state).toBe("no_watch");
    expect(t.presence.context.contacts).toEqual({});
    t.send({ type: "phone:contacts", uris: [BOB, CAROL] });
    expect(h.calls).toEqual([`watch ${BOB}`]);
  });

  it("PUBLISH refused: a flag, and nothing published any more", () => {
    const t = start();
    const h = up(t);
    h.emit({ type: "sip:presenceSupport", method: "publish", supported: false });
    expect(t.presence.state).toBe("live");
    expect(t.presence.context.support.publish).toBe(false);
    t.send({ type: "ui:setStatus", status: "busy" });
    expect(h.published).toHaveLength(1);
    // the choice is kept all the same: the next server may take it
    expect(t.presence.context.prefs.chosen).toBe("busy");
  });

  it("discovery starts over on each registration", () => {
    const t = start();
    const h = up(t);
    h.emit({ type: "sip:presenceSupport", method: "subscribe", supported: false });
    t.send({ type: "phone:down" });
    up(t);
    expect(t.presence.state).toBe("live");
    expect(t.presence.context.support).toEqual({ subscribe: null, publish: null });
  });
});

describe("PresenceMachine — our status (D5)", () => {
  it("a chosen status is saved for the account and published", () => {
    const t = start();
    const h = up(t);
    t.send({ type: "ui:setStatus", status: "dnd" });
    t.send({ type: "ui:setNote", note: "  Focus  " });
    expect(t.saved.get("acc")).toMatchObject({ chosen: "dnd", note: "Focus" });
    expect(h.published.map((p) => [p.state, p.note])).toEqual([
      ["available", null],
      ["dnd", null],
      ["dnd", "Focus"],
    ]);
  });

  it("a call: on the phone, then back to the chosen status", () => {
    const t = start();
    const h = up(t);
    t.send({ type: "phone:callStarted" });
    t.send({ type: "phone:callEnded" });
    expect(h.published.map((p) => p.state)).toEqual(["available", "on-the-phone", "available"]);
  });

  it("idle then active; nothing is published when nothing changes", () => {
    const t = start();
    const h = up(t);
    t.send({ type: "ui:setStatus", status: "busy" });
    t.send({ type: "sys:idle" });
    t.send({ type: "sys:active" });
    expect(h.published.map((p) => p.state)).toEqual(["available", "busy"]);
  });

  it("since dates the state, not the note", () => {
    const t = start();
    const h = up(t);
    t.send({ type: "ui:setNote", note: "Hi" });
    expect(h.published[1]!.since).toBe(h.published[0]!.since);
  });

  it("switching a rule off applies at once", () => {
    const t = start();
    const h = up(t);
    t.send({ type: "phone:callStarted" });
    t.send({ type: "ui:setRule", rule: "onThePhone", on: false });
    expect(h.published.map((p) => p.state)).toEqual(["available", "on-the-phone", "available"]);
    expect(t.saved.get("acc")!.onThePhone).toBe(false);
  });

  it("a status chosen while stale is kept, and published at the next up", () => {
    const t = start();
    up(t);
    t.send({ type: "phone:down" });
    t.send({ type: "ui:setStatus", status: "away" });
    const h2 = up(t);
    expect(h2.published[0]!.state).toBe("away");
  });
});

describe("PresenceMachine — our other devices", () => {
  const said = (state: Presence, since: number | null = null, automatic = false): PresenceSipEvent => ({
    type: "sip:ownPresence",
    info: { state, note: null, since },
    automatic,
  });

  it("a status chosen elsewhere becomes ours, saved and published", () => {
    const t = start();
    const h = up(t);
    h.emit(said("available"));
    h.emit(said("busy"));
    expect(t.presence.context.prefs.chosen).toBe("busy");
    expect(t.saved.get("acc")!.chosen).toBe("busy");
    expect(h.published.map((p) => p.state)).toEqual(["available", "busy"]);
  });

  it("the first word, and a repeat, change nothing", () => {
    const t = start();
    const h = up(t);
    h.emit(said("dnd"));
    h.emit(said("dnd"));
    expect(t.presence.context.prefs.chosen).toBe("available");
    expect(h.published).toHaveLength(1);
  });

  it("neither a rule nor an absence is a choice, nor moves the reference", () => {
    const t = start();
    const h = up(t);
    h.emit(said("available"));
    h.emit(said("away", null, true));
    h.emit(said("on-the-phone"));
    h.emit(said("offline"));
    h.emit(said("available"));
    expect(t.presence.context.prefs.chosen).toBe("available");
    expect(h.published).toHaveLength(1);
  });

  it("a choice older than ours loses", () => {
    const t = start();
    const h = up(t);
    h.emit(said("available"));
    t.send({ type: "ui:setStatus", status: "away" });
    h.emit(said("busy", Date.now() - 60_000));
    expect(t.presence.context.prefs.chosen).toBe("away");
    h.emit(said("dnd", Date.now() + 1000));
    expect(t.presence.context.prefs.chosen).toBe("dnd");
  });

  it("a new registration starts listening over", () => {
    const t = start();
    up(t).emit(said("available"));
    t.send({ type: "phone:down" });
    const h2 = up(t);
    h2.emit(said("busy"));
    expect(t.presence.context.prefs.chosen).toBe("available");
  });

  it("what we publish by a rule is marked as such", () => {
    const t = start();
    const h = up(t);
    t.send({ type: "phone:callStarted" });
    t.send({ type: "phone:callEnded" });
    expect(h.published.map((p) => !!p.automatic)).toEqual([false, true, false]);
  });
});

describe("PresenceMachine — turned off (D8)", () => {
  it("disabled: nothing is watched, nothing published", () => {
    const t = start({ enabled: false });
    expect(t.presence.state).toBe("disabled");
    const h = up(t);
    t.send({ type: "ui:setStatus", status: "busy" });
    expect(h.calls).toEqual([]);
    expect(h.published).toEqual([]);
    expect(t.presence.pending).toEqual([]);
  });
});
