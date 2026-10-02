/**
 * What a call carries, and what may be offered or answered — the rules of
 * ADR 0003, without their wording or their icons.
 *
 * Any UI asks the same questions: which modes the account offers, what an
 * incoming offer may be answered with, what media each answer turns on, how
 * to name a call in one word or as a full F.703 profile. The answers are
 * here; turning them into labels and buttons is the screen's business
 * (`ui/screens/call/parts.ts`).
 */

import type { CallMedia } from "../sip/port.js";
import type { RttTransport } from "../sip/rtt.js";

/**
 * The call's medium in one word, the richest one: video, else audio, else
 * text. Used where one word is enough — the ringing icon, the system
 * notification.
 */
export type CallKind = "audio" | "video" | "text";

export function callKind(media: CallMedia): CallKind {
  return media.video ? "video" : media.audio ? "audio" : "text";
}

/**
 * The call's **profile**, as in the F.703 §7.2 table: the whole
 * combination, not the dominant medium. It is what the incoming-call screen
 * announces — saying "audio call" of a call that also carries text would
 * hide exactly what makes it accessible.
 *
 * Five combinations, the five Trix offers (D2):
 *
 * | profile | media | F.703 §7.2 |
 * |---|---|---|
 * | `text` | T | 3a — text telephone service |
 * | `audio` | A | telephony (single medium) |
 * | `audioText` | A + T | 3c — good text conversation with usable audio |
 * | `video` | A + V | 1b / 1c — videophone service |
 * | `videoText` | A + V + T | **4a / 4b — total conversation service** |
 *
 * Video without audio counts as videophony: the picture dominates, and the
 * word the person expects is "video".
 */
export type CallProfile = "audio" | "audioText" | "video" | "videoText" | "text";

export function callProfile(media: CallMedia): CallProfile {
  if (media.video) return media.text ? "videoText" : "video";
  if (media.audio) return media.text ? "audioText" : "audio";
  return "text";
}

/** The three ways of placing a call (ADR 0003, D2). */
export type CallModeId = "audio" | "video" | "text";

export interface CallMode {
  id: CallModeId;
  media: CallMedia;
}

/**
 * What each mode asks for **of its own accord**: text is not among it,
 * because it is never the caller's choice (ADR 0003, D2). It is there when
 * the account carries it, and `callModes` adds it — which is what avoids a
 * six-entry menu for three intentions.
 */
const MODE_MEDIA: readonly { id: CallModeId; audio: boolean; video: boolean }[] = [
  { id: "audio", audio: true, video: false },
  { id: "video", audio: true, video: true },
  { id: "text", audio: false, video: false },
];

/**
 * The modes the account offers, in menu order.
 *
 * Text joins **every** mode as soon as the account carries it (§4.9) —
 * which turns the audio call from F.703 profile "—" into profile 3c, and
 * the video call from videophony (1b/1c) into total conversation (4a/4b).
 * The **text call** itself is only offered then: without a transport, it
 * would be a call with nothing in it.
 */
export function callModes(rtt?: RttTransport): CallMode[] {
  const carriesText = rtt !== undefined && rtt !== "none";
  return MODE_MEDIA.filter((m) => m.id !== "text" || carriesText).map((m) => ({
    id: m.id,
    // the text call is the only one whose reason to be is text: it carries
    // it by definition, the other two because the account does
    media: { audio: m.audio, video: m.video, text: m.id === "text" || carriesText },
  }));
}

/** The answers to an incoming call. */
export type AnswerAct = "answer-av" | "answer-audio" | "answer-text";

/**
 * The answers on offer, derived from the media the INVITE offers alone
 * (docs/SPECS.md, phase 3): video offered → an A/V answer is possible;
 * audio offered → an audio-only answer is possible. A video-only offer
 * thus leaves only the A/V answer, an audio-only offer only audio. An offer
 * carrying neither is a text-only call — the port has already refused those
 * that were nothing at all (`unsupportedOffer`) — and is answered in text,
 * without microphone or camera.
 *
 * One answer per offered medium, richest first: that is all of D3's table —
 * an A V T offer gives "A V T · A T · T", a V T offer gives "V T · T" (no
 * audio to offer alone, since it is not offered).
 */
export function answerActs(offered: CallMedia): AnswerAct[] {
  const acts: AnswerAct[] = [];
  if (offered.video) acts.push("answer-av");
  if (offered.audio) acts.push("answer-audio");
  if (offered.text) acts.push("answer-text");
  return acts;
}

/**
 * The answer's media for a given choice. **Never a superset of the offer**
 * (F.703 §8.1, D3): the callee takes away, it does not add — adding comes
 * later, by re-INVITE.
 *
 * Text is not decided here: it follows the offer wherever it is offered. It
 * therefore shows up in no line as a choice — it is in every answer of the
 * line, or in none.
 */
export function answerMedia(act: AnswerAct, offered: CallMedia): CallMedia {
  if (act === "answer-av") return { audio: offered.audio, video: true, text: offered.text };
  // answering in text means turning on neither microphone nor camera — and
  // that choice is only offered when text is, so `text: true` is safe
  if (act === "answer-text") return { audio: false, video: false, text: true };
  return { audio: true, video: false, text: offered.text };
}
