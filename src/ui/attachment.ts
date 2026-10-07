/**
 * A file in the conversation (ADR 0012, D3): a card — what it is, how big,
 * how long for a voice message — and a way to get it, until the store has
 * deleted it. Reception only: the file is not fetched here, the link hands
 * it to the browser.
 */

import { formatNumber, t } from "../i18n/index.js";
import { isExpired, isVoiceMessage, type FileAttachment } from "../sip/fthttp.js";
import type { MessageEntry } from "../storage/store.js";
import { esc } from "./el.js";

/** `m:ss`, from milliseconds. */
export function formatLength(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** A size as people read it: kilobytes below a megabyte, megabytes above. */
export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return t("message.file.kb", { n: formatNumber(bytes / 1024, bytes < 10 * 1024 ? 1 : 0) });
  return t("message.file.mb", { n: formatNumber(bytes / (1024 * 1024), 1) });
}

/** What a file is called where only a line fits: a list, a notification, a screen reader. */
export function fileLabel(file: FileAttachment): string {
  if (isVoiceMessage(file)) {
    return file.playingLengthMs !== null
      ? t("message.file.voiceLength", { duration: formatLength(file.playingLengthMs) })
      : t("message.file.voice");
  }
  return t("message.file.named", { name: file.name ?? t("message.file.unnamed") });
}

/** A message's text, or what its file is called when it came without one. */
export function entryText(m: Pick<MessageEntry, "text" | "file">): string {
  return m.text !== "" || !m.file ? m.text : fileLabel(m.file);
}

function icon(file: FileAttachment): string {
  if (isVoiceMessage(file)) return "🎤";
  if (file.contentType?.toLowerCase().startsWith("image/")) return "🖼️";
  return "📄";
}

/** The card of a file, as it stands at `now`. */
export function fileCard(file: FileAttachment, now: number): string {
  const facts = [
    file.size !== null ? formatSize(file.size) : null,
    isVoiceMessage(file) && file.playingLengthMs !== null ? formatLength(file.playingLengthMs) : null,
  ].filter((x): x is string => x !== null);
  const action = isExpired(file, now)
    ? `<span class="msg-file-state">${esc(t("message.file.expired"))}</span>`
    : `<a class="linkbtn" href="${esc(file.url)}" target="_blank" rel="noopener noreferrer" download>${esc(
        t("message.file.download"),
      )}</a>`;
  return `<div class="msg-file">
      <span class="msg-file-icon" aria-hidden="true">${icon(file)}</span>
      <span class="msg-file-body">
        <span class="msg-file-name" dir="auto">${esc(isVoiceMessage(file) ? fileLabel(file) : (file.name ?? t("message.file.unnamed")))}</span>
        ${facts.length ? `<span class="msg-file-facts">${esc(facts.join(" · "))}</span>` : ""}
      </span>
      ${action}
    </div>`;
}
