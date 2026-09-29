/**
 * The glue from PhoneMachine to PresenceMachine (ADR 0007, D12).
 *
 * The two machines never see each other: `linkPresence` watches the phone
 * and tells presence what it needs to know, as `phone:*` events. The
 * translation itself is `presenceSignals`, a pure function of two
 * successive views of the phone, so that every exit from the registered
 * corridor can be tested without starting anything.
 *
 * The corridor, for presence, is `ready` and `in_call`: the UA is
 * registered and a SIP handle is there to carry subscriptions. Entering
 * `ready` from outside it is `phone:up`; leaving it for anything else is
 * `phone:down`. FSL notifies a transition *before* the new state's
 * `enter()` runs, so `phone:down` reaches presence before PhoneMachine
 * stops the handle — but nothing relies on it: a link whose handle has
 * stopped does nothing (`SipHandle.presence`).
 */

import type { SipHandle } from "../sip/port.js";
import type { Contact } from "../storage/store.js";
import type { PhoneInstance } from "./phone.js";
import type { PhoneSignal, PresenceInstance } from "./presence.js";

/** What the glue reads of PhoneMachine. */
export interface PhoneView {
  state: string;
  handle: SipHandle | null;
  activeId: string | null;
  contacts: Contact[];
}

const CORRIDOR = new Set(["ready", "in_call"]);

/** The addresses to watch: a blocked contact is not (ADR 0008, D7). */
const urisOf = (contacts: Contact[]): string[] => contacts.filter((c) => !c.blocked).map((c) => c.uri);

/** The signals between two successive views of the phone, in order. */
export function presenceSignals(before: PhoneView | null, after: PhoneView): PhoneSignal[] {
  const wasIn = before !== null && CORRIDOR.has(before.state);
  const isIn = CORRIDOR.has(after.state);
  const signals: PhoneSignal[] = [];

  if (!wasIn && after.state === "ready" && after.handle && after.activeId) {
    // the addresses ride along: no separate phone:contacts
    return [{ type: "phone:up", handle: after.handle, accountId: after.activeId, uris: urisOf(after.contacts) }];
  }
  if (wasIn && !isIn) signals.push({ type: "phone:down" });
  if (before?.state === "ready" && after.state === "in_call") signals.push({ type: "phone:callStarted" });
  if (before?.state === "in_call" && after.state === "ready") signals.push({ type: "phone:callEnded" });
  if (before !== null && before.contacts !== after.contacts) {
    signals.push({ type: "phone:contacts", uris: urisOf(after.contacts) });
  }
  return signals;
}

/** Wires a running phone to a running presence machine; returns the unsubscribe. */
export function linkPresence(phone: PhoneInstance, presence: PresenceInstance): () => void {
  let before: PhoneView | null = null;
  const step = (state: string, ctx: PhoneInstance["context"]) => {
    const after: PhoneView = {
      state,
      handle: ctx.handle,
      activeId: ctx.activeId,
      contacts: ctx.contacts,
    };
    for (const signal of presenceSignals(before, after)) presence.send(signal);
    before = after;
  };
  step(phone.state, phone.context);
  return phone.subscribe((n) => step(n.state, n.context));
}
