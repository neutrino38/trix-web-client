/**
 * Reachability as data (ADR 0006): **can a call reach us**, and if not,
 * why. A phone that lies is worse than a phone that is off — every UI must
 * be able to say it, and none should have to work it out again.
 *
 * Saying it is the UI's part: the sentence in the page, the tab's title and
 * icon, the system notification, the ten-second threshold before alerting
 * (`ui/reachability.ts`).
 */

import type { ResumeStore } from "../storage/session.js";
import type { MsgKey } from "../i18n/types.js";

/**
 * D1's three levels — not a boolean.
 *
 * At step 1, **nothing ever produces `deferred`**: no code writes it, no
 * screen shows it, and the level reads like a boolean. It is here anyway,
 * because the day push arrives (ADR 0007), "the page is asleep" will stop
 * meaning "you cannot be reached": planning for it costs a dead branch, not
 * planning for it would cost reworking all the alert logic and its six
 * translations.
 */
export type Reachability = "direct" | "deferred" | "none";

/**
 * Why we cannot be reached — what makes the sentence. The first two come
 * from the page's lifecycle (frozen, machine asleep), the others are
 * observed: the network going offline, the tab discarded by the browser,
 * and `lost` when nothing explains the absence — the registration simply
 * dropped, which is the most common case and deserves better than a reason
 * borrowed from another.
 *
 * The page leaving (`PageSleepReason`'s `leave`) is not among them, and
 * that is why this list is written rather than derived: a page on its way
 * out has nobody left to explain anything to.
 */
export type UnreachableReason = "freeze" | "system" | "offline" | "discard" | "lost";

/**
 * The level derived from the phone machine's state, and from it alone (D1).
 * `ready` and `in_call` are the two states where the contact is alive at
 * the registrar; every other one goes through `stopSip()`.
 */
export function reachabilityOf(state: string): Reachability {
  return state === "ready" || state === "in_call" ? "direct" : "none";
}

/**
 * Is this absence worth making a fuss about? Only if the person wanted to
 * be reachable — which is exactly what the resume marker says (D4). Without
 * it, nobody asked to be registered: the home screen, an open form or a
 * first connection in progress are not failures, and have nothing to
 * announce.
 */
export function reachabilityWanted(session: ResumeStore): boolean {
  return session.resumeAccount() !== null;
}

/**
 * The sentence the page shows, or `null` when there is nothing to say.
 *
 * `direct` is not said again: the header's badge already reads
 * "Registered", and one more sentence confirming all is well would inform
 * nobody. `deferred` has none either, for another reason — at step 1,
 * nothing produces it (D1).
 */
export function reachSentence(state: string, session: ResumeStore): MsgKey | null {
  return reachabilityOf(state) === "none" && reachabilityWanted(session) ? "reach.none" : null;
}

/**
 * The reason to keep when an episode begins, from the surest to the
 * vaguest: a browser that says it is offline knows better than we do, then
 * comes what the lifecycle reported, and failing that nothing more than the
 * fact — the registration dropped, and we do not know why.
 */
export function unreachableReason(online: boolean, noted: UnreachableReason | null): UnreachableReason {
  if (!online) return "offline";
  return noted ?? "lost";
}
