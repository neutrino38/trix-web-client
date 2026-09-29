/**
 * The glue from PhoneMachine to PresenceMachine (ADR 0007, D12): every
 * way into and out of the registered corridor, and what rides along.
 */

import { describe, expect, it } from "vitest";
import { presenceSignals, type PhoneView } from "../src/machines/presencesignals.js";
import type { SipHandle } from "../src/sip/port.js";
import type { Contact } from "../src/storage/store.js";

const handle = { name: "handle" } as unknown as SipHandle;
const BOB: Contact = { id: "c1", name: "Bob", uri: "sip:bob@example.com", addedAt: 1, blocked: false };
const book = [BOB];

const view = (state: string, over: Partial<PhoneView> = {}): PhoneView => ({
  state,
  handle: state === "ready" || state === "in_call" || state === "registering" ? handle : null,
  activeId: "acc",
  contacts: book,
  ...over,
});

describe("presenceSignals", () => {
  it("registered: phone:up carries the handle, the account and the book", () => {
    expect(presenceSignals(view("registering"), view("ready"))).toEqual([
      { type: "phone:up", handle, accountId: "acc", uris: ["sip:bob@example.com"] },
    ]);
  });

  it("a blocked contact is not watched, and blocking one unwatches it (ADR 0008, D7)", () => {
    const blocked = { ...BOB, id: "c2", uri: "sip:mallory@example.com", blocked: true };
    expect(presenceSignals(view("registering"), view("ready", { contacts: [BOB, blocked] }))).toEqual([
      { type: "phone:up", handle, accountId: "acc", uris: ["sip:bob@example.com"] },
    ]);
    expect(presenceSignals(view("ready"), view("ready", { contacts: [{ ...BOB, blocked: true }] }))).toEqual([
      { type: "phone:contacts", uris: [] },
    ]);
  });

  it("the first view already in ready is an up", () => {
    expect(presenceSignals(null, view("ready"))[0]!.type).toBe("phone:up");
  });

  it.each(["reconnecting", "sleeping", "reg_failed", "unregistering", "reconfiguring", "switching"])(
    "ready → %s is a down",
    (state) => {
      expect(presenceSignals(view("ready"), view(state))).toEqual([{ type: "phone:down" }]);
    },
  );

  it.each(["reconnecting", "sleeping", "reg_failed"])("in_call → %s is a down", (state) => {
    expect(presenceSignals(view("in_call"), view(state))).toEqual([{ type: "phone:down" }]);
  });

  it("a call starts and ends", () => {
    expect(presenceSignals(view("ready"), view("in_call"))).toEqual([{ type: "phone:callStarted" }]);
    expect(presenceSignals(view("in_call"), view("ready"))).toEqual([{ type: "phone:callEnded" }]);
  });

  it("moving outside the corridor says nothing", () => {
    expect(presenceSignals(view("home"), view("connecting"))).toEqual([]);
    expect(presenceSignals(view("connecting"), view("registering"))).toEqual([]);
  });

  it("staying in a state says nothing, unless the book changed", () => {
    expect(presenceSignals(view("ready"), view("ready"))).toEqual([]);
    const carol: Contact = { ...BOB, id: "c2", uri: "sip:carol@example.com" };
    expect(presenceSignals(view("ready"), view("ready", { contacts: [BOB, carol] }))).toEqual([
      { type: "phone:contacts", uris: ["sip:bob@example.com", "sip:carol@example.com"] },
    ]);
  });

  it("the book is followed outside the corridor too", () => {
    expect(presenceSignals(view("sleeping"), view("sleeping", { contacts: [] }))).toEqual([
      { type: "phone:contacts", uris: [] },
    ]);
  });

  it("a book loaded on the way up rides with phone:up, not beside it", () => {
    const signals = presenceSignals(view("registering", { contacts: [] }), view("ready"));
    expect(signals.map((s) => s.type)).toEqual(["phone:up"]);
  });

  it("leaving and changing the book at once: down first", () => {
    const signals = presenceSignals(view("ready"), view("switching", { contacts: [] }));
    expect(signals.map((s) => s.type)).toEqual(["phone:down", "phone:contacts"]);
  });
});
