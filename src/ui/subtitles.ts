/**
 * The conversation of a call as **subtitles** — WebVTT, from the model the
 * thread keeps (docs/CONCEPTION.md §4.9).
 *
 * The file is laid on the **start of the communication**, not on the time
 * of day: zero is the instant the call was answered, so the export drops
 * as-is onto a recording of that call. A frozen bubble becomes one cue,
 * from its first character to the separator that closed it.
 *
 * WebVTT and not SubRip, in the order the reasons weigh:
 *
 * - **UTF-8 is normative** there. SRT has no specified encoding, and Trix
 *   speaks Arabic, Japanese and Chinese;
 * - **overlapping cues are admitted** and stacked by players — and two
 *   people writing real-time text overlap all the time, so the times can
 *   stay those of the conversation, unarranged;
 * - **the speaker is data**, `<v Bob>`, not a prefix convention a tool has
 *   to guess at.
 *
 * The serialisation reads the model, never the page: what the DOM shows is
 * a projection, and a bubble that scrolled away is still in the thread.
 * Nothing here touches the document — `downloadSubtitles` alone does, at
 * the very end, and everything above it checks without a browser.
 */

import { localeTag, t } from "../i18n/index.js";
import { bubbleText, type ChatItem } from "../sip/transcript.js";
import type { CallLogEntry } from "../storage/store.js";

/**
 * Shortest cue we write. WebVTT wants an end strictly after its start, and
 * a bubble pasted in one go is frozen in the same millisecond it opened;
 * below a second a cue is unreadable anyway. Stretching an end may make it
 * overlap the next one — which is precisely what this format allows.
 */
const MIN_CUE = 1_000;

/** WebVTT's arrow: forbidden anywhere but between the two stamps of a cue. */
const ARROW = /-->/g;

/**
 * The zero of the file: the instant the call was **answered**. A call that
 * never connected has no communication to lay the text on — its own start
 * is then the only origin left.
 */
export function subtitleBase(entry: CallLogEntry): number {
  return entry.connectedAt ?? entry.startedAt;
}

/**
 * `hh:mm:ss.mmm`, WebVTT's own stamp. Hours are always written: the
 * two-field form is legal, but a single shape keeps the file readable by
 * eye and by the pickiest parsers.
 */
function stamp(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor(ms / 60_000) % 60;
  const s = Math.floor(ms / 1_000) % 60;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms % 1_000, 3)}`;
}

/**
 * A moment of the call, as an offset from the base. Clamped at zero: a
 * bubble may predate the answer — text can flow before the call is
 * connected — and a negative stamp is not a stamp.
 */
const offset = (at: number, base: number): number => Math.max(0, at - base);

/**
 * The body of a cue. `&` and `<` open markup in WebVTT and must go through
 * an entity; `>` follows them, so that nothing of what the far end wrote
 * can be read back as a tag.
 *
 * Line breaks are turned into spaces: a blank line ends a cue, and the
 * thread has none to give anyway — the only separator T.140 knows is the
 * one that freezes a bubble.
 */
function cueText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\r\n\u2028\u2029]+/g, " ");
}

/**
 * A speaker name, fit for `<v …>`. It goes through the same escaping as a
 * cue body — which is what keeps a far end called `a-->b` from closing the
 * tag or writing a timing line, its `>` becoming an entity.
 */
function voice(name: string): string {
  return cueText(name).trim() || "?";
}

/** A line of prose in the file — header or comment: one line, no arrow. */
function plain(text: string): string {
  return text.replace(/[\r\n\u2028\u2029]+/g, " ").replace(ARROW, "→");
}

/** A block of the file, kept with the instant that orders it. */
interface Block {
  at: number;
  text: string;
}

/**
 * The conversation in WebVTT, `peer` naming the far end as the call log
 * names it, times counted from `base`.
 *
 * Bubbles are **sorted by their start**: the thread is built in the order
 * bubbles are frozen, and two people writing at once freeze out of order,
 * where the format wants non-decreasing starts. Empty bubbles are dropped —
 * a bubble opened and closed without a character subtitles nothing.
 *
 * The thread's own remarks (link opened, broken, refused, truncated) stay,
 * as `NOTE` comments at their place in time: they are not something anybody
 * said, and no player will show them, but they explain a gap to whoever
 * reads the file.
 */
export function chatAsWebVtt(items: readonly ChatItem[], peer: string, base: number): string {
  const cues: Block[] = [];
  const notes: Block[] = [];

  for (const item of items) {
    if (item.kind === "note") {
      notes.push({ at: offset(item.at, base), text: plain(t(item.key)) });
      continue;
    }
    const text = bubbleText(item);
    if (text === "") continue;
    const from = offset(item.startedAt, base);
    const to = Math.max(offset(item.endedAt ?? item.startedAt, base), from + MIN_CUE);
    const who = voice(item.side === "them" ? peer : t("chat.you"));
    cues.push({ at: from, text: `${stamp(from)} --> ${stamp(to)}\n<v ${who}>${cueText(text)}` });
  }

  // stable by start: the file wants its cues in non-decreasing order, and a
  // thread frozen bubble by bubble is not in that order when two people write
  // at once
  cues.sort((a, b) => a.at - b.at);

  return [head(peer, base), ...ordered(cues, notes)].join("\n\n") + "\n";
}

/**
 * Cues and comments in one sequence: each cue numbered in the order it is
 * written, each comment at its place in time.
 */
function ordered(cues: readonly Block[], notes: readonly Block[]): string[] {
  const all = [
    ...cues.map((c, i) => ({ at: c.at, rank: i * 2 + 1, text: `${i + 1}\n${c.text}` })),
    ...notes.map((n, i) => ({ at: n.at, rank: i * 2, text: `NOTE ${stamp(n.at)} ${n.text}` })),
  ];
  // a comment placed at the same instant as a cue comes first: it announces
  // what follows rather than commenting what is past
  all.sort((a, b) => a.at - b.at || a.rank - b.rank);
  return all.map((b) => b.text);
}

/**
 * The head of the file: the magic line, named after the call, and a comment
 * saying where zero is — without it, a file that starts at `00:00:03` looks
 * like a recording that lost its first seconds.
 */
function head(peer: string, base: number): string {
  const title = plain(t("chat.log.title", { target: peer }));
  const when = new Date(base).toLocaleString(localeTag(), {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return `WEBVTT - ${title}\n\nNOTE\n${plain(t("chat.log.vttBase", { at: when }))}`;
}

/** Characters a file name may carry everywhere; the rest becomes a dash. */
const NAME_OK = /[^A-Za-z0-9._@-]+/g;

/**
 * `trix-bob@example.fr-20260822-1431.vtt` — the far end and the moment of
 * the call, so that a folder of exports sorts and reads by itself. The
 * stamp is the **local** time of the call, the one the history shows.
 */
export function subtitlesFileName(entry: CallLogEntry): string {
  const d = new Date(entry.startedAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  const when = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const who = entry.target.replace(NAME_OK, "-").replace(/^-+|-+$/g, "");
  return `trix-${who || "call"}-${when}.vtt`;
}

/** A call log line as a subtitle file: its name, and its content. */
export function subtitlesOf(entry: CallLogEntry): { name: string; text: string } {
  return {
    name: subtitlesFileName(entry),
    text: chatAsWebVtt(entry.chat ?? [], entry.target, subtitleBase(entry)),
  };
}

/**
 * Hands the file to the browser. The only part of the export that touches
 * the document: a blob, an anchor that nobody sees, and the object URL
 * released once the click is through — a page that keeps them alive holds
 * the whole conversation in memory for as long as it lives.
 *
 * Returns `false` when the browser has no such door (no `URL.createObjectURL`),
 * so that the caller can say so instead of leaving a dead button.
 */
export function downloadSubtitles(entry: CallLogEntry): boolean {
  const { name, text } = subtitlesOf(entry);
  let url: string;
  try {
    url = URL.createObjectURL(new Blob([text], { type: "text/vtt;charset=utf-8" }));
  } catch {
    return false;
  }
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // let the download start before the URL goes: revoking in the same tick
  // cancels it on some browsers
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}
