/**
 * The "Échanges" thread, as data (ADR 0007, D10): one line per
 * correspondent, built from the contact book, the call history and what
 * presence knows — nothing is stored twice. The history stays a list of
 * calls; the thread is a view of it grouped by address key
 * (`sip/uri.ts`), so a call made to `bob` and one received from
 * `sip:bob@example.fr` land on the same line.
 *
 * A number that is not in the book gets its own line, offered to be added.
 * A contact nobody called yet sits in "Sans échange".
 *
 * Instant messages (ADR 0008) fill the same lines: a line's last exchange
 * is its last call or its last message, whichever came later, and its
 * unfolded body mixes both, oldest first, filtered by segment.
 *
 * Pure: the screen renders what this returns, the tests read it.
 */

import type { ContactPresence } from "../machines/presence.js";
import { addressKey } from "../sip/uri.js";
import type { CallLogEntry, Contact, MessageEntry } from "../storage/store.js";

export type ThreadGroup = "today" | "yesterday" | "week" | "older" | "none";

export const GROUP_ORDER: readonly ThreadGroup[] = ["today", "yesterday", "week", "older", "none"];

/** A call of the thread, with its place in `ctx.history` (the row buttons need it). */
export interface ThreadCall {
  entry: CallLogEntry;
  index: number;
}

export interface Thread {
  /** The address key: stable across renders, used to remember what is open. */
  key: string;
  /** What a call to this line dials. */
  target: string;
  name: string;
  contact: Contact | null;
  presence: ContactPresence | null;
  /** Most recent first. */
  calls: ThreadCall[];
  /** Oldest first, as a conversation reads. */
  messages: MessageEntry[];
  /** Incoming messages not read yet. */
  unread: number;
  /** A blocked contact (ADR 0008, D7): no call button, no writing field. */
  blocked: boolean;
  /** Time of the last call or message, or null for a line with neither. */
  last: number | null;
}

/** What an unfolded line shows (ADR 0007, D10). */
export type Segment = "all" | "calls" | "messages";

/** One event of an unfolded line: a call or a message. */
export type ThreadEvent =
  | { kind: "call"; at: number; call: ThreadCall }
  | { kind: "message"; at: number; message: MessageEntry };

export interface ThreadSection {
  group: ThreadGroup;
  threads: Thread[];
}

const DAY = 24 * 3600_000;

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Which group the last exchange falls in, seen from `now`. */
export function groupOf(last: number | null, now: number): ThreadGroup {
  if (last === null) return "none";
  const today = startOfDay(now);
  if (last >= today) return "today";
  if (last >= today - DAY) return "yesterday";
  if (last >= today - 6 * DAY) return "week";
  return "older";
}

/** One line per correspondent, before grouping. */
export function buildThreads(
  contacts: readonly Contact[],
  history: readonly CallLogEntry[],
  presence: Readonly<Record<string, ContactPresence>>,
  messages: readonly MessageEntry[] = [],
): Thread[] {
  const byKey = new Map<string, Thread>();
  for (const contact of contacts) {
    const key = addressKey(contact.uri);
    if (!key || byKey.has(key)) continue;
    byKey.set(key, {
      key,
      target: contact.uri,
      name: contact.name,
      contact,
      presence: presence[contact.uri] ?? null,
      calls: [],
      messages: [],
      unread: 0,
      blocked: contact.blocked,
      last: null,
    });
  }
  history.forEach((entry, index) => {
    const key = addressKey(entry.target);
    if (!key) return;
    let thread = byKey.get(key);
    if (!thread) {
      thread = stranger(key, entry.target);
      byKey.set(key, thread);
    }
    thread.calls.push({ entry, index });
  });
  for (const message of messages) {
    let thread = byKey.get(message.key);
    if (!thread) {
      thread = stranger(message.key, message.uri.replace(/^sips?:/i, ""));
      byKey.set(message.key, thread);
    }
    thread.messages.push(message);
    if (!message.read) thread.unread++;
  }
  for (const thread of byKey.values()) {
    thread.calls.sort((a, b) => b.entry.startedAt - a.entry.startedAt);
    thread.messages.sort((a, b) => a.at - b.at);
    const lastCall = thread.calls[0]?.entry.startedAt ?? null;
    const lastMessage = thread.messages.at(-1)?.at ?? null;
    thread.last = lastCall === null ? lastMessage : lastMessage === null ? lastCall : Math.max(lastCall, lastMessage);
  }
  return [...byKey.values()];
}

/** A line for an address outside the book. */
function stranger(key: string, target: string): Thread {
  return {
    key,
    target,
    name: target,
    contact: null,
    presence: null,
    calls: [],
    messages: [],
    unread: 0,
    blocked: false,
    last: null,
  };
}

/** The events of a line for a segment, oldest first: what its unfolded body lists. */
export function threadEvents(thread: Thread, segment: Segment): ThreadEvent[] {
  const events: ThreadEvent[] = [];
  if (segment !== "messages") {
    for (const call of thread.calls) events.push({ kind: "call", at: call.entry.startedAt, call });
  }
  if (segment !== "calls") {
    for (const message of thread.messages) events.push({ kind: "message", at: message.at, message });
  }
  return events.sort((a, b) => a.at - b.at);
}

/** The line's most recent event, the one its summary shows. */
export function lastEvent(thread: Thread): ThreadEvent | null {
  return threadEvents(thread, "all").at(-1) ?? null;
}

/** Does this line answer the search? Name, address or a message, case and accents aside. */
export function matches(thread: Thread, query: string): boolean {
  const q = fold(query.trim());
  if (!q) return true;
  return (
    fold(thread.name).includes(q) ||
    fold(thread.key).includes(q) ||
    thread.messages.some((m) => fold(m.text).includes(q))
  );
}

function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/**
 * The thread as the screen shows it: filtered, grouped by the age of the
 * last exchange, most recent first — and the lines without any exchange
 * last, by name.
 */
export function threadSections(threads: readonly Thread[], query: string, now: number): ThreadSection[] {
  const sections = new Map<ThreadGroup, Thread[]>();
  for (const thread of threads) {
    if (!matches(thread, query)) continue;
    const group = groupOf(thread.last, now);
    sections.set(group, [...(sections.get(group) ?? []), thread]);
  }
  return GROUP_ORDER.flatMap((group) => {
    const threads = sections.get(group);
    if (!threads) return [];
    threads.sort((a, b) =>
      group === "none" ? a.name.localeCompare(b.name) : (b.last ?? 0) - (a.last ?? 0),
    );
    return [{ group, threads }];
  });
}

/** The contact an address typed in the dialer names, if any. */
export function contactFor(contacts: readonly Contact[], typed: string, domain: string): Contact | null {
  const raw = typed.trim();
  if (!raw) return null;
  const key = addressKey(raw.includes("@") ? raw : `${raw}@${domain}`);
  return key ? (contacts.find((c) => addressKey(c.uri) === key) ?? null) : null;
}

/** Initials for the avatar: first letters of the first two words, or of the address. */
export function initials(name: string): string {
  const words = name.replace(/@.*$/, "").split(/[\s._-]+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => Array.from(w)[0] ?? "");
  return letters.join("").toUpperCase() || "?";
}

/**
 * The most recent line outside the book: what an empty book offers to add
 * first ("Ajouter bob@example.fr"), so the first contact is one click away.
 */
export function lastStranger(threads: readonly Thread[]): Thread | null {
  let best: Thread | null = null;
  for (const thread of threads) {
    if (thread.contact || thread.last === null) continue;
    if (!best || thread.last > (best.last ?? 0)) best = thread;
  }
  return best;
}
