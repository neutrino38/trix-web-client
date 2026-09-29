/**
 * The messaging machine as the screens see it (ADR 0008): bound once by
 * `main.ts`, like presence (`ui/presence.ts`), and read by the thread and
 * the call screen.
 */

import type { MessagingInstance } from "../machines/messaging.js";

let messaging: MessagingInstance | null = null;

export function bindMessaging(instance: MessagingInstance): void {
  messaging = instance;
}

/** The messaging machine the screens read, once `main.ts` has bound it. */
export function boundMessaging(): MessagingInstance | null {
  return messaging;
}

/** Is messaging there at all: turned on, with an account? */
export function messagingOn(m: MessagingInstance | null = messaging): m is MessagingInstance {
  return m !== null && m.state !== "disabled" && m.state !== "off";
}

/**
 * Can a message be written now? Not when the server said it does not
 * route MESSAGE (D13) — until the next registration. Unregistered is
 * fine: the message waits (D3).
 */
export function canWrite(m: MessagingInstance | null = messaging): boolean {
  return messagingOn(m) && !m.context.unsupported;
}
