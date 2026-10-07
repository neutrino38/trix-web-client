/**
 * A file in the conversation (ADR 0012, D3, D6): a card — what it is, how
 * big, how long for a voice message — and, once fetched (`filefetch.ts`),
 * the image shown, the voice message played, or the file to save. Past its
 * `until`, a file not fetched yet is said expired.
 */

import { formatNumber, t } from "../i18n/index.js";
import { isExpired, isVoiceMessage, type FileAttachment } from "../sip/fthttp.js";
import type { MessageEntry } from "../storage/store.js";
import { esc } from "./el.js";
import { fileState, wantsAutoFetch, type FileState } from "./filefetch.js";

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

/** The card of a file, as it stands at `now` and as far as its fetch went. */
export function fileCard(file: FileAttachment, now: number, state: FileState = fileState(file.url)): string {
  const name = file.name ?? t("message.file.unnamed");
  const facts = [
    file.size !== null ? formatSize(file.size) : null,
    isVoiceMessage(file) && file.playingLengthMs !== null ? formatLength(file.playingLengthMs) : null,
  ].filter((x): x is string => x !== null);
  const head = `<span class="msg-file-icon" aria-hidden="true">${icon(file)}</span>
      <span class="msg-file-body">
        <span class="msg-file-name" dir="auto">${esc(isVoiceMessage(file) ? fileLabel(file) : name)}</span>
        ${facts.length ? `<span class="msg-file-facts">${esc(facts.join(" · "))}</span>` : ""}
      </span>`;
  const fetchButton = (label: string) =>
    `<button type="button" class="linkbtn" data-act="file-fetch" data-url="${esc(file.url)}">${esc(label)}</button>`;
  const save = (objectUrl: string) =>
    `<a class="linkbtn" href="${esc(objectUrl)}" download="${esc(name)}">${esc(t("message.file.save"))}</a>`;

  let action: string;
  let shown = "";
  if (state.status === "ready" || state.status === "unplayable") {
    // fetched before it expired: what is here stays usable
    if (state.status === "ready" && state.kind === "image") {
      shown = `<img class="msg-file-img" src="${esc(state.objectUrl)}" alt="${esc(name)}">`;
    } else if (state.status === "ready" && state.kind === "audio") {
      shown = `<audio class="msg-file-audio" controls preload="metadata" src="${esc(state.objectUrl)}" data-file-url="${esc(file.url)}"></audio>`;
    }
    action =
      state.status === "unplayable"
        ? `<span class="msg-file-state">${esc(t("message.file.unplayable"))}</span> ${save(state.objectUrl)}`
        : save(state.objectUrl);
  } else if (isExpired(file, now)) {
    action = `<span class="msg-file-state">${esc(t("message.file.expired"))}</span>`;
  } else if (state.status === "loading") {
    action = `<span class="msg-file-state" role="status">${esc(t("message.file.loading"))}</span>`;
  } else if (state.status === "failed") {
    const why = state.httpStatus === 404 ? t("message.file.gone") : t("message.file.failed");
    action = `<span class="msg-file-state">${esc(why)}</span> ${state.httpStatus === 404 ? "" : fetchButton(t("message.retry"))}`;
  } else {
    action = fetchButton(t("message.file.download"));
  }
  const auto = state.status === "idle" && !isExpired(file, now) && wantsAutoFetch(file) ? ' data-autofetch="1"' : "";
  return `<div class="msg-file" data-file-card="${esc(file.url)}"${auto}>
      <div class="msg-file-row">${head}
      <span class="msg-file-action">${action}</span></div>${shown}
    </div>`;
}
