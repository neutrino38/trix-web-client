/**
 * Fetching the file a message names, to show it in the page (ADR 0012, D6):
 * an image displayed, a voice message played, anything else saved.
 *
 * - `fetch` with `credentials: "omit"`: the store serves files statically,
 *   the URL is the capability, and a cookie of ours has nothing to do there;
 * - the audio container is **sniffed** on its first four bytes, not read
 *   from the XML: Linphone labels its voice messages `audio/wav` whatever
 *   they are, and they are Matroska/Opus (elixip, DESIGN-CHAT-MEDIA §2.3);
 * - a browser that cannot play what it got says so through the `<audio>`
 *   element's `error`, and the card then offers to save the file instead
 *   (`markUnplayable`) — which browsers can is a measurement, not a guess;
 * - the object URLs are kept for the session, the oldest released past
 *   `MAX_KEPT`.
 *
 * The state lives here, by URL, outside the thread's redraws: a redraw
 * re-reads it, and a change of it updates the one card it concerns
 * (`onFileChange`), so a voice message playing is not cut off by another
 * file arriving.
 */

import { isVoiceMessage, type FileAttachment } from "../sip/fthttp.js";

/** Linphone downloads by itself below this (`auto_download_incoming_files_max_size`, desktop). */
export const AUTO_FETCH_MAX = 10 * 1024 * 1024;
/** Object URLs kept alive at once. */
export const MAX_KEPT = 40;

export type FileKind = "image" | "audio" | "other";

export type FileState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; objectUrl: string; kind: FileKind }
  /** Fetched, but this browser cannot play it: saved instead. */
  | { status: "unplayable"; objectUrl: string }
  /** `httpStatus` null: no answer (network, CORS). */
  | { status: "failed"; httpStatus: number | null };

const IDLE: FileState = { status: "idle" };
const states = new Map<string, FileState>();
const files = new Map<string, FileAttachment>();
let listener: ((file: FileAttachment) => void) | null = null;

export function fileState(url: string): FileState {
  return states.get(url) ?? IDLE;
}

/** Who is told when a file's state changes — the thread, which updates its card. */
export function onFileChange(fn: ((file: FileAttachment) => void) | null): void {
  listener = fn;
}

function set(file: FileAttachment, state: FileState): void {
  states.set(file.url, state);
  files.set(file.url, file);
  release();
  listener?.(file);
}

/** Past `MAX_KEPT` object URLs, the oldest go back to idle: fetched again if shown again. */
function release(): void {
  const kept = [...states].filter(([, s]) => s.status === "ready" || s.status === "unplayable");
  for (const [url, s] of kept.slice(0, Math.max(0, kept.length - MAX_KEPT))) {
    if ("objectUrl" in s) URL.revokeObjectURL(s.objectUrl);
    states.delete(url);
  }
}

/** The container the first bytes announce; null when none we know. */
export function sniff(head: Uint8Array): "wav" | "matroska" | "ogg" | "mp3" | null {
  const at = (i: number) => head[i] ?? -1;
  if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46) return "wav"; // RIFF
  if (at(0) === 0x1a && at(1) === 0x45 && at(2) === 0xdf && at(3) === 0xa3) return "matroska"; // EBML
  if (at(0) === 0x4f && at(1) === 0x67 && at(2) === 0x67 && at(3) === 0x53) return "ogg"; // OggS
  if ((at(0) === 0x49 && at(1) === 0x44 && at(2) === 0x33) || (at(0) === 0xff && (at(1) & 0xe0) === 0xe0)) return "mp3";
  return null;
}

const AUDIO_TYPE = { wav: "audio/wav", matroska: "audio/webm", ogg: "audio/ogg", mp3: "audio/mpeg" } as const;

/** What a fetched file is shown as, and the type its blob carries. */
export function kindOf(file: FileAttachment, head: Uint8Array): { kind: FileKind; type: string } {
  const declared = file.contentType?.split(";")[0]!.trim().toLowerCase() ?? "";
  if (isVoiceMessage(file) || declared.startsWith("audio/")) {
    const container = sniff(head);
    return container ? { kind: "audio", type: AUDIO_TYPE[container] } : { kind: "other", type: "application/octet-stream" };
  }
  // an image the browser would refuse shows as a broken picture: the declared type is enough
  if (declared.startsWith("image/") && declared !== "image/svg+xml") return { kind: "image", type: declared };
  return { kind: "other", type: declared || "application/octet-stream" };
}

/** Is this one fetched as soon as it is shown? Images and voice messages under 10 MB, as Linphone does. */
export function wantsAutoFetch(file: FileAttachment): boolean {
  const declared = file.contentType?.toLowerCase() ?? "";
  const small = file.size === null || file.size <= AUTO_FETCH_MAX;
  return small && (isVoiceMessage(file) || (declared.startsWith("image/") && !declared.startsWith("image/svg")));
}

/**
 * Fetches `file` once: a second call while loading, or once fetched, does
 * nothing. A failure can be retried by calling again.
 */
export async function fetchFile(file: FileAttachment, fetchImpl: typeof fetch = fetch): Promise<void> {
  const now = fileState(file.url).status;
  if (now === "loading" || now === "ready" || now === "unplayable") return;
  set(file, { status: "loading" });
  try {
    const res = await fetchImpl(file.url, { credentials: "omit", mode: "cors" });
    if (!res.ok) {
      set(file, { status: "failed", httpStatus: res.status });
      return;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const { kind, type } = kindOf(file, bytes.subarray(0, 4));
    set(file, { status: "ready", objectUrl: URL.createObjectURL(new Blob([bytes], { type })), kind });
  } catch {
    set(file, { status: "failed", httpStatus: null });
  }
}

/** The `<audio>` element refused it: offered as a file to save. */
export function markUnplayable(url: string): void {
  const s = fileState(url);
  const file = files.get(url);
  if (s.status === "ready" && file) set(file, { status: "unplayable", objectUrl: s.objectUrl });
}

/** The file registered under `url`, for a card to be redrawn alone. */
export function fileAt(url: string): FileAttachment | undefined {
  return files.get(url);
}

/** For the tests: forget everything. */
export function resetFiles(): void {
  for (const s of states.values()) if ("objectUrl" in s) URL.revokeObjectURL(s.objectUrl);
  states.clear();
  files.clear();
  listener = null;
}
