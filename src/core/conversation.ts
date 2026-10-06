/**
 * The conversation of a call — real-time text as a model (ADR 0011, D5;
 * docs/CONCEPTION.md §4.9).
 *
 * The protocol is elsewhere (`sip/t140.ts` decodes and computes what to
 * send), the pipe too (`sip/rtt.ts`, which knows nothing of T.140 but the
 * backspace): here there is only a thread of bubbles and a draft.
 *
 * It belongs to the core because losing it is not a display matter. The
 * conversation follows the call's channel from the moment it exists —
 * whether a screen shows it or not — and it is what the history keeps
 * (`transcript`). A UI without a chat pane, or one that shows it another
 * way, loses neither the text nor the record.
 *
 * Three rules govern everything below.
 *
 * **One live bubble per side.** It interprets the stream character by
 * character, like a terminal; the separator freezes it and opens a new one.
 * That is what T.140's appendix I already described in 1998.
 *
 * **The model is the source.** Nothing is read back from a page — not to
 * copy, not to export as subtitles. A received character is text, never
 * markup: rendering it safely is the UI's duty, and the model never builds
 * any HTML.
 *
 * **Nothing here renders on a timer.** Received text changes the model the
 * moment the fragment arrives and listeners hear of it at once — a hidden
 * tab, whose timers Chrome aligns on the second, would otherwise overrun
 * T.140 §6.1.1's 500 ms. The only timer serves sending: the two-second rule.
 */

import type { PhoneInstance } from "../machines/phone.js";
import type { RttChannel, RttState } from "../sip/rtt.js";
import {
  T140,
  dropLastGrapheme,
  sanitizeOutgoing,
  t140Decoder,
  t140Edit,
  type T140Attrs,
  type T140Decoder,
  type T140Event,
} from "../sip/t140.js";
import { bubbleText, sealTranscript, type ChatBubble, type ChatItem, type ChatSide } from "../sip/transcript.js";
import type { CoreMsgKey } from "../i18n/types.js";

/**
 * The silence to observe before reconciling an edit made **in the middle**
 * of text already sent: go back in one stroke to where it diverges, once,
 * rather than shaking at every keystroke (§4.9).
 */
export const CHAT_HOLD_MS = 2000;

/**
 * What a listener hears. `changed` follows every change of the model;
 * the others say what a screen may want to do about it, beyond repainting.
 */
export type ConversationEvent =
  /** A new call's channel: the thread starts empty. */
  | { type: "reset" }
  /** Anything in the model moved — repaint. */
  | { type: "changed" }
  /** The peer froze a bubble: the one moment worth announcing it. */
  | { type: "frozen"; bubble: ChatBubble }
  /** The peer rang the bell (`BEL`): it is addressed to someone who may not be looking. */
  | { type: "alert" }
  /** The link changed state. */
  | { type: "link"; state: RttState };

export interface Conversation {
  /** The thread: frozen bubbles, live bubbles, the thread's own remarks. */
  items(): readonly ChatItem[];
  /** The link, as the channel reports it. */
  link(): RttState;
  /**
   * The link died without ever serving — the peer did not want text. There
   * is then no thread to show.
   */
  refused(): boolean;
  /** What actually went out (T.140 §7: what is sent is what is shown). */
  sent(): string;
  /** What the input shows: the typing, cleaned of what a bubble cannot carry. */
  draft(): string;
  /** When the deferred reconciliation is due, `0` when there is none. */
  holdUntil(): number;
  /**
   * The thread as the history keeps it: live bubbles closed, a bounded
   * copy, and nothing at all if nobody wrote (`sip/transcript.ts`).
   */
  transcript(): ChatItem[];

  /**
   * The input changed. Three cases, and only one waits (§4.9):
   *
   * - writing at the end → the suffix leaves at once;
   * - erasing from the end → the backspaces leave at once;
   * - correcting in the middle → two seconds of silence, then back in one
   *   stroke to where it diverges, and the rest typed again.
   */
  type(value: string): void;
  /**
   * Enter: what remains to reconcile leaves without waiting, then the
   * separator freezes the bubble on both ends. The channel's 300 ms buffer
   * is flushed along — an end of line does not wait.
   */
  enter(): void;

  /** The channel followed, `null` between calls. */
  channel(): RttChannel | null;
  /**
   * Follows a call's channel, from an empty thread. The first listener of a
   * channel receives what arrived before it: the channel opens with the
   * call, possibly well before anybody follows it.
   */
  attach(channel: RttChannel): void;
  /** The call is over: the conversation stops following, and empties. */
  detach(): void;

  subscribe(listener: (e: ConversationEvent) => void): () => void;
}

interface State {
  items: ChatItem[];
  live: { them: ChatBubble | null; us: ChatBubble | null };
  attrs: T140Attrs;
  decoder: T140Decoder;
  link: RttState;
  /** The link opened at least once — a `closed` does not mean the same otherwise. */
  everOpen: boolean;
  sent: string;
  draft: string;
  holdUntil: number;
  seq: number;
}

function blank(): State {
  return {
    items: [],
    live: { them: null, us: null },
    attrs: {},
    decoder: t140Decoder(),
    link: "connecting",
    everOpen: false,
    sent: "",
    draft: "",
    holdUntil: 0,
    seq: 0,
  };
}

function sameAttrs(a: T140Attrs, b: T140Attrs): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.color === b.color &&
    a.background === b.background
  );
}

export function createConversation(): Conversation {
  let s = blank();
  let bound: RttChannel | null = null;
  let unlisten: (() => void) | null = null;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<(e: ConversationEvent) => void>();

  const tell = (e: ConversationEvent): void => {
    for (const fn of listeners) fn(e);
  };
  const touch = (): void => tell({ type: "changed" });

  // --- writing into the model ------------------------------------------------

  const openBubble = (side: ChatSide): ChatBubble => {
    const b: ChatBubble = { kind: "bubble", id: ++s.seq, side, runs: [], startedAt: Date.now(), endedAt: null };
    s.items.push(b);
    s.live[side] = b;
    return b;
  };

  const note = (key: CoreMsgKey): void => {
    const last = s.items.at(-1);
    // the same remark twice in a row says nothing more
    if (last?.kind === "note" && last.key === key) return;
    s.items.push({ kind: "note", id: ++s.seq, key, at: Date.now() });
  };

  const appendText = (side: ChatSide, text: string, attrs: T140Attrs): void => {
    if (text === "") return;
    const b = s.live[side] ?? openBubble(side);
    const last = b.runs.at(-1);
    if (last && !last.lost && sameAttrs(last.attrs, attrs)) last.text += text;
    else b.runs.push({ text, attrs: { ...attrs } });
  };

  /** The lost-text marker, never twice in a row (§4.9). */
  const appendLost = (side: ChatSide): void => {
    const b = s.live[side] ?? openBubble(side);
    if (b.runs.at(-1)?.lost) return;
    b.runs.push({ text: T140.LOST, attrs: {}, lost: true });
  };

  const drop = (b: ChatBubble): void => {
    const at = s.items.indexOf(b);
    if (at !== -1) s.items.splice(at, 1);
    if (s.live[b.side] === b) s.live[b.side] = null;
  };

  /**
   * A backspace, in both cases the standard provides for: erase one
   * grapheme of the live bubble, or — live bubble empty — **erase the
   * separator**, which merges the previous frozen bubble back (§8.2,
   * command sequences are erased in one operation).
   */
  const eraseOne = (side: ChatSide): void => {
    const live = s.live[side];
    if (live && bubbleText(live) !== "") {
      const last = live.runs.at(-1)!;
      last.text = dropLastGrapheme(last.text);
      if (last.text === "") live.runs.pop();
      return;
    }
    if (live) drop(live);
    // this side's last frozen bubble comes back to life
    const prev = [...s.items].reverse().find((i) => i.kind === "bubble" && i.side === side) as
      | ChatBubble
      | undefined;
    if (!prev) {
      s.live[side] = null;
      return;
    }
    prev.endedAt = null;
    s.live[side] = prev;
  };

  /**
   * The separator freezes the live bubble. Received on an empty bubble, it
   * creates nothing: the thread does not fill with blank bubbles because
   * the peer pressed Enter twice.
   */
  const freeze = (side: ChatSide): void => {
    const live = s.live[side];
    if (!live) return;
    s.live[side] = null;
    if (bubbleText(live) === "") {
      drop(live);
      return;
    }
    live.endedAt = Date.now();
    if (side === "them") tell({ type: "frozen", bubble: live });
  };

  // --- receiving -------------------------------------------------------------

  const apply = (events: readonly T140Event[]): void => {
    for (const ev of events) {
      switch (ev.type) {
        case "text":
          appendText("them", ev.text, s.attrs);
          break;
        case "erase":
          eraseOne("them");
          break;
        case "break":
          freeze("them");
          break;
        case "attrs":
          s.attrs = ev.attrs;
          break;
        case "lost":
          note("chat.note.lost");
          appendLost("them");
          break;
        case "alert":
          note("chat.note.alert");
          tell({ type: "alert" });
          break;
      }
    }
  };

  const receive = (chunk: string): void => {
    apply(s.decoder.feed(chunk));
    touch();
  };

  const linkTo = (state: RttState): void => {
    if (state === s.link) return;
    const was = s.link;
    s.link = state;
    if (state === "open") {
      if (!s.everOpen) note("chat.note.opened");
      s.everOpen = true;
    } else if (state === "lost") {
      note("chat.note.broken");
    } else if (state === "closed" && was !== "closed") {
      note(s.everOpen ? "chat.note.closed" : "chat.note.refused");
    }
    tell({ type: "link", state });
    touch();
  };

  // --- sending ---------------------------------------------------------------

  const clearHold = (): void => {
    if (holdTimer !== null) clearTimeout(holdTimer);
    holdTimer = null;
    s.holdUntil = 0;
  };

  /**
   * What actually goes out on the wire, and shows at once in the local
   * bubble: T.140 §7 requires sent characters to be displayed locally, and
   * that is what makes the gap visible during the two seconds of waiting.
   */
  const emit = (back: number, add: string): void => {
    if (back === 0 && add === "") return;
    if (back > 0) {
      bound?.backspace(back);
      for (let i = 0; i < back; i++) eraseOne("us");
    }
    if (add !== "") {
      bound?.send(add);
      appendText("us", add, {});
    }
    s.sent = s.draft;
    touch();
  };

  const startHold = (): void => {
    s.holdUntil = Date.now() + CHAT_HOLD_MS;
    holdTimer = setTimeout(() => {
      holdTimer = null;
      const late = t140Edit(s.sent, s.draft);
      clearHold();
      emit(late.back, late.add);
    }, CHAT_HOLD_MS);
  };

  return {
    items: () => s.items,
    link: () => s.link,
    refused: () => s.link === "closed" && !s.everOpen,
    sent: () => s.sent,
    draft: () => s.draft,
    holdUntil: () => s.holdUntil,
    transcript: () => sealTranscript(s.items, Date.now()),

    type(value) {
      clearHold();
      s.draft = sanitizeOutgoing(value);
      const edit = t140Edit(s.sent, s.draft);
      if (edit.kind === "same") {
        touch();
        return;
      }
      if (edit.kind !== "rewrite") {
        emit(edit.back, edit.add);
        return;
      }
      startHold();
      touch();
    },

    enter() {
      clearHold();
      const edit = t140Edit(s.sent, s.draft);
      emit(edit.back, edit.add);
      if (s.sent !== "") {
        bound?.send(T140.LS);
        bound?.flush();
        freeze("us");
      }
      s.sent = "";
      s.draft = "";
      touch();
    },

    channel: () => bound,

    attach(channel) {
      if (channel === bound) return;
      unlisten?.();
      clearHold();
      s = blank();
      bound = channel;
      tell({ type: "reset" });
      unlisten = channel.listen({ text: receive, state: linkTo });
      touch();
    },

    detach() {
      if (!bound) return;
      clearHold();
      unlisten?.();
      unlisten = null;
      bound = null;
      s = blank();
      tell({ type: "reset" });
      touch();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Keeps a conversation on the phone's current call: attached to the call's
 * channel as soon as it exists, detached when the call is gone.
 *
 * Checked a microtask after each notification, like the render and for the
 * same reason: a notification leaves before the arrival state's `enter()`,
 * hence before what it writes into the context. The history reads the
 * transcript inside the very transition that files the call, before this
 * runs — the conversation is still whole then.
 *
 * Returns what stops following.
 */
export function followCalls(phone: PhoneInstance, conversation: Conversation): () => void {
  let queued = false;
  const sync = (): void => {
    queued = false;
    const channel = phone.context.session?.rtt() ?? null;
    if (channel) conversation.attach(channel);
    else conversation.detach();
  };
  const unsubscribe = phone.subscribe(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(sync);
  });
  sync();
  return unsubscribe;
}
