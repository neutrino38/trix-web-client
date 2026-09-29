/**
 * Blocked contacts (ADR 0008, D7), read by PhoneMachine and CallBlock
 * alike: an INVITE from a blocked address is refused 603 wherever it
 * lands — ready, in a call, or anywhere in between — before do-not-disturb
 * and before the busy answer.
 */

import { addressKey } from "../sip/uri.js";
import type { Contact } from "../storage/store.js";

/** Is `uri` a blocked contact of this book? */
export function isBlocked(contacts: readonly Contact[], uri: string): boolean {
  const key = addressKey(uri);
  return key !== null && contacts.some((c) => c.blocked && addressKey(c.uri) === key);
}
