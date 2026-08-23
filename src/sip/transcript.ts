/**
 * The conversation of a call, in the form it is **kept** — the model the
 * chat panel builds while the call lasts (`ui/screens/call/chat.ts`), and
 * that the call log line carries once it is over (docs/CONCEPTION.md §4.9).
 *
 * It lives here, beside the codec, and not in the panel that fills it, for
 * one reason: `storage/store.ts` persists it. A call log entry already
 * carries its SIP notebook (`sip/record.ts`) and its media report
 * (`sip/stats.ts`); the thread is the third of those, and the vault has no
 * business importing a screen.
 *
 * Two rules, both here:
 *
 * - **what is kept is what was seen** — the live bubble of each side is
 *   closed where the call ended, nothing is re-decoded, and no draft ever
 *   enters: a bubble holds what actually went on the wire (T.140 §7);
 * - **a conversation is bounded**. Fifty calls live encrypted in the same
 *   vault, rewritten at every call: a thread that would not stop growing
 *   would take the whole history down with it. Past the ceiling the
 *   **oldest** bubbles go — a conversation is read from its end — and a
 *   note says so at the head.
 */

import type { MsgKey } from "../i18n/types.js";
import type { T140Attrs } from "./t140.js";

/** Who wrote it. `us` is this end, `them` the far one. */
export type ChatSide = "them" | "us";

/** A stretch of a bubble under one set of attributes. */
export interface ChatRun {
  text: string;
  attrs: T140Attrs;
  /** Missing text marker (`U+FFFD`): this one was not typed. */
  lost?: boolean;
}

export interface ChatBubble {
  kind: "bubble";
  id: number;
  side: ChatSide;
  runs: ChatRun[];
  startedAt: number;
  /** `null` while it is live; the instant of the separator once frozen. */
  endedAt: number | null;
}

/** What the thread says of itself: link opened, broken, refused, truncated. */
export interface ChatNote {
  kind: "note";
  id: number;
  key: MsgKey;
  at: number;
}

export type ChatItem = ChatBubble | ChatNote;

/** The text of a bubble, runs joined — the only reading of its content. */
export function bubbleText(b: ChatBubble): string {
  return b.runs.map((r) => r.text).join("");
}

/**
 * Ceilings of a kept conversation. An hour of real-time text is a few
 * thousand characters — typed by hand, one keystroke at a time — so these
 * are not a budget, they are a stop.
 */
const MAX_CHARS = 32_000;
const MAX_ITEMS = 400;

/** The note that heads a conversation kept from its end only. */
const CUT: MsgKey = "chat.log.cut";

/**
 * The thread as it goes into the call log: live bubbles closed at `at`,
 * oldest items dropped past the ceilings, and a copy throughout — the
 * model keeps mutating its runs in place, and the vault writes later.
 *
 * Renders `[]` for anything that is not a conversation: no bubble, or
 * bubbles without a character. A link that opened and closed without a
 * word is not worth a line in the history, and its notes alone would only
 * say that nobody wrote.
 */
export function sealTranscript(items: readonly ChatItem[], at: number): ChatItem[] {
  const sealed: ChatItem[] = [];
  let chars = 0;
  let cut = false;

  // walked backwards: what the ceiling drops is the beginning
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item.kind === "note") {
      sealed.unshift({ ...item });
      continue;
    }
    const text = bubbleText(item);
    if (sealed.length >= MAX_ITEMS || chars + text.length > MAX_CHARS) {
      cut = true;
      break;
    }
    chars += text.length;
    sealed.unshift({
      ...item,
      endedAt: item.endedAt ?? at,
      runs: item.runs.map((r) => ({ ...r, attrs: { ...r.attrs } })),
    });
  }

  // a note that came before the oldest kept bubble would date text that is
  // no longer there: the cut note replaces the lot
  if (cut) {
    while (sealed[0]?.kind === "note") sealed.shift();
  }

  const first = sealed[0];
  if (!first || !sealed.some((i) => i.kind === "bubble" && bubbleText(i) !== "")) return [];
  if (cut) {
    // dated from what is left: it says where the kept thread starts
    const from = first.kind === "bubble" ? first.startedAt : first.at;
    sealed.unshift({ kind: "note", id: 0, key: CUT, at: from });
  }
  return sealed;
}
