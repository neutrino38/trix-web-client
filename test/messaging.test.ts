/**
 * MessagingMachine (ADR 0008, D3, D4, D5, D10, D12): who gets which
 * answer, the quarantine and its clock, the send queue across
 * registrations — driven by `phone:*` signals, with a fake link and an
 * in-memory vault.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  failureReason,
  MAX_QUARANTINED,
  MessagingMachine,
  QUARANTINE_MS,
  shownPrompt,
  unreadByKey,
  type MessagingEvent,
} from "../src/machines/messaging.js";
import { messagingSignals } from "../src/machines/messagingsignals.js";
import type { PhoneView } from "../src/machines/presencesignals.js";
import type { MessageAnswer, MessagingLink, MessagingSipEvent } from "../src/sip/message.js";
import { NOTHING_WANTED, type ImdnStatus, type Wanted } from "../src/sip/imdn.js";
import type { SipHandle } from "../src/sip/port.js";
import type { Contact, MessageEntry, SecureStore } from "../src/storage/store.js";

const BOB: Contact = { id: "c1", name: "Bob", uri: "sip:bob@example.org", addedAt: 1, blocked: false };
const MALLORY: Contact = { id: "c2", name: "Mallory", uri: "sip:mallory@example.org", addedAt: 1, blocked: true };
const CARLA = "sip:carla@example.org";

function fakeStore(initial: MessageEntry[] = []) {
  const saved = new Map<string, MessageEntry[]>([["acc", initial]]);
  const store = {
    loadMessages: (id: string) => Promise.resolve(saved.get(id) ?? []),
    saveMessages: async (id: string, list: MessageEntry[]) => {
      saved.set(id, list);
    },
  } as unknown as SecureStore;
  return { store, saved };
}

function fakeHandle(opts: { throws?: Error } = {}) {
  const sent: { id: string; uri: string; text: string }[] = [];
  const receipts: { uri: string; messageId: string; at: number; status: ImdnStatus }[] = [];
  let send: ((ev: MessagingSipEvent) => void) | null = null;
  const link: MessagingLink = {
    send(id, uri, text) {
      if (opts.throws) throw opts.throws;
      sent.push({ id, uri, text });
    },
    receipt(uri, messageId, at, status) {
      receipts.push({ uri, messageId, at, status });
    },
  };
  const handle = {
    messaging(s: (ev: MessagingSipEvent) => void) {
      send = s;
      return link;
    },
  } as unknown as SipHandle;
  /** A MESSAGE arriving; returns what it was answered. */
  const deliver = (
    from: string,
    text: string,
    date: number | null = null,
    messageId: string | null = null,
    wants: Wanted = NOTHING_WANTED,
  ): MessageAnswer | null => {
    let answer: MessageAnswer | null = null;
    send!({ type: "sip:message", from, name: null, text, date, messageId, wants, answer: (c) => (answer ??= c) });
    return answer;
  };
  const outcome = (id: string, status: number | null) => send!({ type: "sip:messageSent", id, status });
  const receipt = (from: string, messageId: string, status: ImdnStatus) =>
    send!({ type: "sip:receipt", from, messageId, status });
  return { handle, sent, receipts, deliver, outcome, receipt };
}

let clock = 1_000_000;

async function start(opts: { contacts?: Contact[]; initial?: MessageEntry[]; enabled?: boolean } = {}) {
  const store = fakeStore(opts.initial);
  const m = MessagingMachine.start({
    args: { store: store.store, enabled: opts.enabled ?? true, now: () => clock },
  });
  const send = (ev: MessagingEvent) => m.send(ev);
  send({ type: "phone:account", accountId: "acc", contacts: opts.contacts ?? [BOB, MALLORY] });
  await vi.waitFor(() => expect(m.pending).toEqual([]));
  await Promise.resolve();
  return { m, send, saved: store.saved };
}

function up(t: Awaited<ReturnType<typeof start>>, opts: { throws?: Error } = {}) {
  const h = fakeHandle(opts);
  t.send({ type: "phone:up", handle: h.handle });
  return h;
}

beforeEach(() => {
  clock = 1_000_000;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("who gets which answer (D4)", () => {
  it("a contact: 200, filed unread", async () => {
    const t = await start();
    const h = up(t);
    expect(h.deliver(BOB.uri, "Salut")).toBe(200);
    expect(t.m.context.messages).toEqual([
      expect.objectContaining({ key: "bob@example.org", direction: "incoming", text: "Salut", read: false }),
    ]);
    expect(unreadByKey(t.m.context.messages).get("bob@example.org")).toBe(1);
  });

  it("a blocked contact: 603, and nothing kept", async () => {
    const t = await start();
    const h = up(t);
    expect(h.deliver(MALLORY.uri, "Hé")).toBe(603);
    expect(t.m.context.messages).toEqual([]);
    expect(t.m.context.quarantine).toEqual([]);
  });

  it("an unknown sender: 202, held out of the thread", async () => {
    const t = await start();
    const h = up(t);
    expect(h.deliver(CARLA, "Bonjour")).toBe(202);
    expect(t.m.context.messages).toEqual([]);
    expect(t.m.context.quarantine).toEqual([
      expect.objectContaining({ key: "carla@example.org", messages: [{ text: "Bonjour", at: clock }] }),
    ]);
  });

  it("someone we wrote to answers straight into the thread", async () => {
    const t = await start();
    const h = up(t);
    t.send({ type: "ui:send", uri: CARLA, text: "Bonjour Carla" });
    expect(h.deliver(CARLA, "Bonjour !")).toBe(200);
    expect(t.m.context.quarantine).toEqual([]);
  });

  it("uses the Date header when there is one (D8)", async () => {
    const t = await start();
    const h = up(t);
    h.deliver(BOB.uri, "Parti pendant la veille", 42);
    expect(t.m.context.messages[0]!.at).toBe(42);
  });
});

describe("delivered twice, filed once (ADR 0009)", () => {
  it("a contact's message with a known imdn.Message-ID: 200 again, filed once", async () => {
    const t = await start();
    const h = up(t);
    expect(h.deliver(BOB.uri, "Salut", null, "KfMgJ0nhBx")).toBe(200);
    expect(h.deliver(BOB.uri, "Salut", null, "KfMgJ0nhBx")).toBe(200);
    expect(t.m.context.messages).toEqual([expect.objectContaining({ text: "Salut", messageId: "KfMgJ0nhBx" })]);
  });

  it("the same id from another correspondent is another message", async () => {
    const t = await start();
    const h = up(t);
    h.deliver(BOB.uri, "Salut", null, "same");
    t.send({ type: "ui:send", uri: CARLA, text: "Bonjour Carla" });
    h.deliver(CARLA, "Salut", null, "same");
    expect(t.m.context.messages.filter((m) => m.direction === "incoming")).toHaveLength(2);
  });

  it("bare text has no id, and is filed each time", async () => {
    const t = await start();
    const h = up(t);
    h.deliver(BOB.uri, "Salut");
    h.deliver(BOB.uri, "Salut");
    expect(t.m.context.messages).toHaveLength(2);
  });

  it("an unknown sender's message held already: 202 again, held once, and filed with its id", async () => {
    const t = await start();
    const h = up(t);
    expect(h.deliver(CARLA, "Bonjour", null, "c1")).toBe(202);
    expect(h.deliver(CARLA, "Bonjour", null, "c1")).toBe(202);
    expect(t.m.context.quarantine[0]!.messages).toHaveLength(1);
    t.send({ type: "ui:acceptSender", key: "carla@example.org" });
    expect(t.m.context.messages).toEqual([expect.objectContaining({ text: "Bonjour", messageId: "c1" })]);
    expect(h.deliver(CARLA, "Bonjour", null, "c1")).toBe(200);
    expect(t.m.context.messages).toHaveLength(1);
  });

  it("a message filed while the vault was read, and already in it, is kept once", async () => {
    const stored: MessageEntry = {
      id: "old",
      key: "bob@example.org",
      uri: BOB.uri,
      direction: "incoming",
      text: "Salut",
      at: 1,
      messageId: "KfMgJ0nhBx",
      state: "received",
      reason: null,
      read: true,
    };
    const store = fakeStore([stored]);
    const m = MessagingMachine.start({ args: { store: store.store, enabled: true, now: () => clock } });
    m.send({ type: "phone:account", accountId: "acc", contacts: [BOB] });
    const h = fakeHandle();
    m.send({ type: "phone:up", handle: h.handle });
    expect(h.deliver(BOB.uri, "Salut", null, "KfMgJ0nhBx")).toBe(200);
    await vi.waitFor(() => expect(m.context.loaded).toBe(true));
    expect(m.context.messages).toEqual([stored]);
  });
});

describe("receipts we owe (ADR 0010)", () => {
  const BOTH: Wanted = { delivery: true, display: true };
  const DAN = "sip:dan@example.org";

  it("a contact: delivered at once, displayed once the line is read, each once", async () => {
    const t = await start();
    const h = up(t);
    clock = 5_000;
    h.deliver(BOB.uri, "Salut", 4_000, "b1", BOTH);
    expect(h.receipts).toEqual([{ uri: BOB.uri, messageId: "b1", at: 4_000, status: "delivered" }]);
    t.send({ type: "ui:read", key: "bob@example.org" });
    t.send({ type: "ui:read", key: "bob@example.org" });
    expect(h.receipts.map((r) => r.status)).toEqual(["delivered", "displayed"]);
    expect(t.m.context.messages[0]).not.toHaveProperty("displayWanted");
    expect(t.m.context.messages[0]).not.toHaveProperty("deliveryOwed");
  });

  it("nothing the sender did not ask for", async () => {
    const t = await start();
    const h = up(t);
    h.deliver(BOB.uri, "Salut", null, "b1", { delivery: false, display: true });
    expect(h.receipts).toEqual([]);
    h.deliver(BOB.uri, "Encore", null, "b2", { delivery: true, display: false });
    t.send({ type: "ui:read", key: "bob@example.org" });
    expect(h.receipts.map((r) => [r.messageId, r.status])).toEqual([
      ["b2", "delivered"],
      ["b1", "displayed"],
    ]);
  });

  it("someone we wrote to, not a contact: delivered, never displayed", async () => {
    const t = await start();
    const h = up(t);
    t.send({ type: "ui:send", uri: DAN, text: "Bonjour Dan" });
    h.deliver(DAN, "Bonjour", null, "d1", BOTH);
    t.send({ type: "ui:read", key: "dan@example.org" });
    expect(h.receipts.map((r) => r.status)).toEqual(["delivered"]);
    expect(t.m.context.messages.find((m) => m.messageId === "d1")).not.toHaveProperty("displayWanted");
  });

  it("an unknown sender: nothing while held, delivered once accepted, displayed once a contact reads", async () => {
    const t = await start();
    const h = up(t);
    h.deliver(CARLA, "Bonjour", null, "c1", BOTH);
    expect(h.receipts).toEqual([]);
    t.send({ type: "ui:acceptSender", key: "carla@example.org" });
    expect(h.receipts.map((r) => r.status)).toEqual(["delivered"]);
    const carla: Contact = { id: "c3", name: "Carla", uri: CARLA, addedAt: 2, blocked: false };
    t.send({ type: "phone:contacts", contacts: [BOB, MALLORY, carla] });
    t.send({ type: "ui:read", key: "carla@example.org" });
    expect(h.receipts.map((r) => r.status)).toEqual(["delivered", "displayed"]);
  });

  it("an unknown sender refused: nothing, ever", async () => {
    const t = await start();
    const h = up(t);
    h.deliver(CARLA, "Bonjour", null, "c1", BOTH);
    t.send({ type: "ui:refuseSender", key: "carla@example.org" });
    expect(h.receipts).toEqual([]);
  });

  it("read while unregistered: the read receipt waits in the vault, and leaves at the next registration", async () => {
    const t = await start();
    const h = up(t);
    h.deliver(BOB.uri, "Salut", null, "b1", BOTH);
    t.send({ type: "phone:down" });
    t.send({ type: "ui:read", key: "bob@example.org" });
    await vi.waitFor(() => expect(t.saved.get("acc")?.[0]).toMatchObject({ read: true, displayWanted: true }));
    const again = up(t);
    expect(again.receipts.map((r) => [r.messageId, r.status])).toEqual([["b1", "displayed"]]);
    expect(t.m.context.messages[0]).not.toHaveProperty("displayWanted");
  });

  it("a contact blocked before the line is read is owed nothing more", async () => {
    const t = await start();
    const h = up(t);
    h.deliver(BOB.uri, "Salut", null, "b1", BOTH);
    t.send({ type: "phone:contacts", contacts: [{ ...BOB, blocked: true }, MALLORY] });
    t.send({ type: "ui:read", key: "bob@example.org" });
    expect(h.receipts.map((r) => r.status)).toEqual(["delivered"]);
    expect(t.m.context.messages[0]).not.toHaveProperty("displayWanted");
  });
});

describe("receipts that come back (ADR 0010)", () => {
  async function sentToBob() {
    const t = await start();
    const h = up(t);
    t.send({ type: "ui:send", uri: BOB.uri, text: "Bonjour" });
    const id = h.sent[0]!.id;
    return { t, h, id, entry: () => t.m.context.messages.find((m) => m.id === id)! };
  }

  it("delivered, then displayed — never backwards", async () => {
    const { h, id, entry } = await sentToBob();
    h.outcome(id, 200);
    h.receipt(BOB.uri, id, "delivered");
    expect(entry()).toMatchObject({ state: "sent", receipt: "delivered" });
    h.receipt(BOB.uri, id, "displayed");
    h.receipt(BOB.uri, id, "delivered");
    expect(entry().receipt).toBe("displayed");
  });

  it("only from the one we wrote to", async () => {
    const { h, id, entry } = await sentToBob();
    h.outcome(id, 200);
    h.receipt(CARLA, id, "displayed");
    expect(entry()).not.toHaveProperty("receipt");
  });

  it("a receipt says it arrived, whatever the answer said", async () => {
    const { h, id, entry } = await sentToBob();
    h.receipt(BOB.uri, id, "delivered");
    h.outcome(id, null);
    expect(entry()).toMatchObject({ state: "sent", reason: null, receipt: "delivered" });
  });

  it("a message failed for want of an answer is sent after all when its receipt comes", async () => {
    const { h, id, entry } = await sentToBob();
    h.outcome(id, 408);
    expect(entry().state).toBe("failed");
    h.receipt(BOB.uri, id, "delivered");
    expect(entry()).toMatchObject({ state: "sent", reason: null, receipt: "delivered" });
  });
});

describe("the quarantine (D5)", () => {
  it("one prompt at a time, shown at once in a visible tab", async () => {
    const t = await start();
    const h = up(t);
    h.deliver(CARLA, "Un");
    h.deliver("sip:dan@example.org", "Deux");
    expect(shownPrompt(t.m.context)?.key).toBe("carla@example.org");
    expect(t.m.context.quarantine[1]!.shownAt).toBeNull();
  });

  it("a second message from the same sender joins the same prompt", async () => {
    const t = await start();
    const h = up(t);
    h.deliver(CARLA, "Un");
    expect(h.deliver(CARLA, "Deux")).toBe(202);
    expect(t.m.context.quarantine).toHaveLength(1);
    expect(t.m.context.quarantine[0]!.messages.map((m) => m.text)).toEqual(["Un", "Deux"]);
  });

  it("accepted: every held message enters the thread, unread, at its arrival time", async () => {
    const t = await start();
    const h = up(t);
    h.deliver(CARLA, "Un");
    clock += 5000;
    h.deliver(CARLA, "Deux");
    t.send({ type: "ui:acceptSender", key: "carla@example.org" });
    expect(t.m.context.quarantine).toEqual([]);
    expect(t.m.context.messages.map((m) => [m.text, m.at, m.read])).toEqual([
      ["Un", 1_000_000, false],
      ["Deux", 1_005_000, false],
    ]);
  });

  it("refused: gone, and the next prompt shows", async () => {
    const t = await start();
    const h = up(t);
    h.deliver(CARLA, "Un");
    h.deliver("sip:dan@example.org", "Deux");
    t.send({ type: "ui:refuseSender", key: "carla@example.org" });
    expect(t.m.context.messages).toEqual([]);
    expect(shownPrompt(t.m.context)?.key).toBe("dan@example.org");
  });

  it("expires two minutes after it was shown", async () => {
    vi.useFakeTimers();
    const t = await start();
    const h = up(t);
    h.deliver(CARLA, "Un");
    vi.advanceTimersByTime(QUARANTINE_MS - 1);
    expect(t.m.context.quarantine).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(t.m.context.quarantine).toEqual([]);
    expect(t.m.context.messages).toEqual([]);
  });

  it("does not start its clock in a hidden tab", async () => {
    vi.useFakeTimers();
    const t = await start();
    const h = up(t);
    t.send({ type: "sys:visible", visible: false });
    h.deliver(CARLA, "Un");
    vi.advanceTimersByTime(QUARANTINE_MS * 3);
    expect(t.m.context.quarantine).toHaveLength(1);
    t.send({ type: "sys:visible", visible: true });
    expect(shownPrompt(t.m.context)).not.toBeNull();
    vi.advanceTimersByTime(QUARANTINE_MS);
    expect(t.m.context.quarantine).toEqual([]);
  });

  it("waits for the hang-up during a call (D10), then counts from there", async () => {
    vi.useFakeTimers();
    const t = await start();
    const h = up(t);
    t.send({ type: "phone:callStarted" });
    expect(h.deliver(CARLA, "Un")).toBe(202);
    vi.advanceTimersByTime(QUARANTINE_MS * 5);
    expect(shownPrompt(t.m.context)).toBeNull();
    t.send({ type: "phone:callEnded" });
    expect(shownPrompt(t.m.context)?.key).toBe("carla@example.org");
    vi.advanceTimersByTime(QUARANTINE_MS);
    expect(t.m.context.quarantine).toEqual([]);
  });

  it("an expiry that comes after the decision falls on nothing", async () => {
    vi.useFakeTimers();
    const t = await start();
    const h = up(t);
    h.deliver(CARLA, "Un");
    t.send({ type: "ui:refuseSender", key: "carla@example.org" });
    vi.advanceTimersByTime(1000);
    clock += 1000;
    h.deliver(CARLA, "Encore");
    vi.advanceTimersByTime(QUARANTINE_MS - 1000);
    // the first prompt's timer fired and found a newer prompt: it stays
    expect(t.m.context.quarantine).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(t.m.context.quarantine).toEqual([]);
  });

  it(`holds ${MAX_QUARANTINED} senders; past that, 480`, async () => {
    const t = await start();
    const h = up(t);
    for (let i = 0; i < MAX_QUARANTINED; i++) expect(h.deliver(`sip:u${i}@example.org`, "x")).toBe(202);
    expect(h.deliver("sip:late@example.org", "x")).toBe(480);
  });

  it("a sender added to the book elsewhere leaves the quarantine for the thread", async () => {
    const t = await start();
    const h = up(t);
    h.deliver(CARLA, "Un");
    const carla: Contact = { id: "c3", name: "Carla", uri: CARLA, addedAt: 2, blocked: false };
    t.send({ type: "phone:contacts", contacts: [BOB, carla] });
    expect(t.m.context.quarantine).toEqual([]);
    expect(t.m.context.messages.map((m) => m.text)).toEqual(["Un"]);
  });

  it("a sender blocked from the prompt is dropped, not filed", async () => {
    const t = await start();
    const h = up(t);
    h.deliver(CARLA, "Un");
    const carla: Contact = { id: "c3", name: CARLA, uri: CARLA, addedAt: 2, blocked: true };
    t.send({ type: "phone:contacts", contacts: [BOB, carla] });
    expect(t.m.context.quarantine).toEqual([]);
    expect(t.m.context.messages).toEqual([]);
  });

  it("is never saved", async () => {
    const t = await start();
    const h = up(t);
    h.deliver(CARLA, "Secret");
    await Promise.resolve();
    expect(JSON.stringify([...t.saved.values()])).not.toContain("Secret");
  });
});

describe("sending (D3)", () => {
  it("a message goes out at once when registered, and is sent on a 2xx", async () => {
    const t = await start();
    const h = up(t);
    t.send({ type: "ui:send", uri: BOB.uri, text: "  Bonjour  " });
    expect(h.sent).toEqual([{ id: expect.any(String), uri: BOB.uri, text: "Bonjour" }]);
    h.outcome(h.sent[0]!.id, 202);
    expect(t.m.context.messages[0]).toMatchObject({ state: "sent", reason: null, read: true });
  });

  it("written offline, it waits, then leaves at the next registration, in order", async () => {
    const t = await start();
    t.send({ type: "ui:send", uri: BOB.uri, text: "Un" });
    t.send({ type: "ui:send", uri: BOB.uri, text: "Deux" });
    expect(t.m.context.messages.map((m) => m.state)).toEqual(["pending", "pending"]);
    const h = up(t);
    expect(h.sent.map((s) => s.text)).toEqual(["Un", "Deux"]);
  });

  it("a failure says why, and is not retried by itself", async () => {
    const t = await start();
    const h = up(t);
    t.send({ type: "ui:send", uri: BOB.uri, text: "Un" });
    h.outcome(h.sent[0]!.id, 480);
    expect(t.m.context.messages[0]).toMatchObject({ state: "failed", reason: { key: "message.reason.unreachable" } });
    t.send({ type: "phone:down" });
    const h2 = up(t);
    expect(h2.sent).toEqual([]);
  });

  it("retry sends it again, as if written now", async () => {
    const t = await start();
    const h = up(t);
    t.send({ type: "ui:send", uri: BOB.uri, text: "Un" });
    h.outcome(h.sent[0]!.id, null);
    clock += 1000;
    t.send({ type: "ui:retry", id: h.sent[0]!.id });
    expect(h.sent).toHaveLength(2);
    expect(t.m.context.messages[0]).toMatchObject({ state: "pending", at: clock });
  });

  it("one in flight when the registration goes fails as interrupted, not sent twice", async () => {
    const t = await start();
    const h = up(t);
    t.send({ type: "ui:send", uri: BOB.uri, text: "Un" });
    t.send({ type: "phone:down" });
    expect(t.m.context.messages[0]).toMatchObject({ state: "failed", reason: { key: "message.reason.interrupted" } });
    const h2 = up(t);
    expect(h2.sent).toEqual([]);
    h.outcome(h.sent[0]!.id, 200);
    expect(t.m.context.messages[0]!.state).toBe("failed");
  });

  it("405 or 501: the server does not route MESSAGE, and writing stops until the next registration (D13)", async () => {
    const t = await start();
    const h = up(t);
    t.send({ type: "ui:send", uri: BOB.uri, text: "Un" });
    h.outcome(h.sent[0]!.id, 405);
    expect(t.m.context.unsupported).toBe(true);
    t.send({ type: "ui:send", uri: BOB.uri, text: "Deux" });
    expect(t.m.context.messages).toHaveLength(1);
    t.send({ type: "phone:down" });
    up(t);
    expect(t.m.context.unsupported).toBe(false);
  });

  it("a body the link refuses fails at once", async () => {
    const t = await start();
    up(t, { throws: new RangeError("too long") });
    t.send({ type: "ui:send", uri: BOB.uri, text: "x" });
    expect(t.m.context.messages[0]).toMatchObject({ state: "failed", reason: { key: "message.reason.tooLong" } });
  });

  it("the vault's pending messages leave once read and registered", async () => {
    const pending: MessageEntry = {
      id: "old",
      key: "bob@example.org",
      uri: BOB.uri,
      direction: "outgoing",
      text: "D'hier",
      at: 1,
      state: "pending",
      reason: null,
      read: true,
    };
    const t = await start({ initial: [pending] });
    const h = up(t);
    expect(h.sent.map((s) => s.id)).toEqual(["old"]);
  });
});

describe("reading, saving, accounts", () => {
  it("ui:read marks a correspondent's messages read, and saves", async () => {
    const t = await start();
    const h = up(t);
    h.deliver(BOB.uri, "Un");
    h.deliver(BOB.uri, "Deux");
    t.send({ type: "ui:read", key: "bob@example.org" });
    expect(unreadByKey(t.m.context.messages).size).toBe(0);
    await vi.waitFor(() => expect(t.saved.get("acc")!.every((m) => m.read)).toBe(true));
  });

  it("ui:clearMessages erases one correspondent's conversation, and saves", async () => {
    const t = await start();
    const h = up(t);
    h.deliver(BOB.uri, "Un");
    t.send({ type: "ui:send", uri: CARLA, text: "Deux" });
    t.send({ type: "ui:clearMessages", key: "bob@example.org" });
    expect(t.m.context.messages.map((m) => m.text)).toEqual(["Deux"]);
    await vi.waitFor(() => expect(t.saved.get("acc")!.map((m) => m.text)).toEqual(["Deux"]));
  });

  it("ui:clearMessages without a key erases them all", async () => {
    const t = await start();
    const h = up(t);
    h.deliver(BOB.uri, "Un");
    t.send({ type: "ui:send", uri: CARLA, text: "Deux" });
    t.send({ type: "ui:clearMessages" });
    expect(t.m.context.messages).toEqual([]);
    await vi.waitFor(() => expect(t.saved.get("acc")).toEqual([]));
  });

  it("an erased message in flight stays erased, and a stranger we wrote to is held again", async () => {
    const t = await start();
    const h = up(t);
    t.send({ type: "ui:send", uri: CARLA, text: "Un" });
    t.send({ type: "ui:clearMessages", key: "carla@example.org" });
    h.outcome(h.sent[0]!.id, 200);
    expect(t.m.context.messages).toEqual([]);
    expect(h.deliver(CARLA, "Réponse")).toBe(202);
  });

  it("another account starts from its own vault, and drops the quarantine", async () => {
    const t = await start();
    const h = up(t);
    h.deliver(BOB.uri, "Un");
    h.deliver(CARLA, "Deux");
    t.send({ type: "phone:down" });
    t.send({ type: "phone:account", accountId: "other", contacts: [] });
    expect(t.m.context.messages).toEqual([]);
    expect(t.m.context.quarantine).toEqual([]);
  });

  it("messaging off: no link is opened, nothing is written", async () => {
    const t = await start({ enabled: false });
    expect(t.m.state).toBe("disabled");
    const h = up(t);
    expect(() => h.deliver(BOB.uri, "x")).toThrow(TypeError);
    t.send({ type: "ui:send", uri: BOB.uri, text: "x" });
    expect(h.sent).toEqual([]);
    expect(t.m.context.messages).toEqual([]);
  });
});

describe("failureReason", () => {
  it("says why in words, and keeps the code for the rest", () => {
    expect(failureReason(null).key).toBe("message.reason.noAnswer");
    expect(failureReason(404).key).toBe("message.reason.notFound");
    expect(failureReason(603).key).toBe("message.reason.refused");
    expect(failureReason(500)).toEqual({ key: "message.reason.failed", vars: { code: 500 } });
  });
});

describe("messagingSignals", () => {
  const handle = {} as SipHandle;
  const view = (over: Partial<PhoneView> = {}): PhoneView => ({
    state: "home",
    handle: null,
    activeId: null,
    contacts: [],
    ...over,
  });

  it("the account first, then up", () => {
    const contacts = [BOB];
    expect(messagingSignals(null, view({ state: "ready", handle, activeId: "a", contacts }))).toEqual([
      { type: "phone:account", accountId: "a", contacts },
      { type: "phone:up", handle },
    ]);
  });

  it("the account while unregistered too", () => {
    expect(messagingSignals(view(), view({ state: "connecting", activeId: "a" }))).toEqual([
      { type: "phone:account", accountId: "a", contacts: [] },
    ]);
  });

  it("the book, when it changes under the same account", () => {
    const before = view({ state: "ready", handle, activeId: "a" });
    const contacts = [BOB];
    expect(messagingSignals(before, { ...before, contacts })).toEqual([{ type: "phone:contacts", contacts }]);
  });

  it("down on leaving the corridor, calls within it", () => {
    const ready = view({ state: "ready", handle, activeId: "a" });
    expect(messagingSignals(ready, { ...ready, state: "in_call" })).toEqual([{ type: "phone:callStarted" }]);
    expect(messagingSignals({ ...ready, state: "in_call" }, ready)).toEqual([{ type: "phone:callEnded" }]);
    expect(messagingSignals(ready, { ...ready, state: "sleeping" })).toEqual([{ type: "phone:down" }]);
  });
});
