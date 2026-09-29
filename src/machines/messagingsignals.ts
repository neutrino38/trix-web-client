/**
 * The glue from PhoneMachine to MessagingMachine (ADR 0008, D12), on the
 * model of `presencesignals.ts`.
 *
 * Messaging needs one thing presence does not: the account in use even
 * while unregistered, because what was written offline waits in its
 * vault (D3), and the thread shows its messages all the same. Hence
 * `phone:account`, sent whenever the active account changes, before any
 * `phone:up`. The book, read a little later, follows as `phone:contacts`.
 */

import type { PhoneInstance } from "./phone.js";
import type { MessagingInstance, MessagingPhoneSignal } from "./messaging.js";
import type { PhoneView } from "./presencesignals.js";

const CORRIDOR = new Set(["ready", "in_call"]);

/** The signals between two successive views of the phone, in order. */
export function messagingSignals(before: PhoneView | null, after: PhoneView): MessagingPhoneSignal[] {
  const signals: MessagingPhoneSignal[] = [];
  const wasIn = before !== null && CORRIDOR.has(before.state);
  const isIn = CORRIDOR.has(after.state);

  if (before === null || before.activeId !== after.activeId) {
    signals.push({ type: "phone:account", accountId: after.activeId, contacts: after.contacts });
  } else if (before.contacts !== after.contacts) {
    signals.push({ type: "phone:contacts", contacts: after.contacts });
  }
  if (wasIn && !isIn) signals.push({ type: "phone:down" });
  if (!wasIn && after.state === "ready" && after.handle && after.activeId) {
    signals.push({ type: "phone:up", handle: after.handle });
  }
  if (before?.state === "ready" && after.state === "in_call") signals.push({ type: "phone:callStarted" });
  if (before?.state === "in_call" && after.state === "ready") signals.push({ type: "phone:callEnded" });
  return signals;
}

/** Wires a running phone to a running messaging machine; returns the unsubscribe. */
export function linkMessaging(phone: PhoneInstance, messaging: MessagingInstance): () => void {
  let before: PhoneView | null = null;
  const step = (state: string, ctx: PhoneInstance["context"]) => {
    const after: PhoneView = {
      state,
      handle: ctx.handle,
      activeId: ctx.activeId,
      contacts: ctx.contacts,
    };
    for (const signal of messagingSignals(before, after)) messaging.send(signal);
    before = after;
  };
  step(phone.state, phone.context);
  return phone.subscribe((n) => step(n.state, n.context));
}
