/**
 * Messaging as the screens see it (ADR 0008): what the view says of it,
 * read by the thread and the call screen.
 */

import type { MessagingView } from "../core/index.js";

/** Is messaging there at all: turned on, with an account? */
export function messagingOn(m: MessagingView): boolean {
  return m.state !== "disabled" && m.state !== "off";
}

/**
 * Can a message be written now? Not when the server said it does not
 * route MESSAGE (D13) — until the next registration. Unregistered is
 * fine: the message waits (D3).
 */
export function canWrite(m: MessagingView): boolean {
  return messagingOn(m) && !m.unsupported;
}
