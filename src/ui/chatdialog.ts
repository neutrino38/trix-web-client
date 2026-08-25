/**
 * Reading back the conversation of a past call — what the two people
 * wrote to each other, as the panel showed it while the call lasted
 * (docs/CONCEPTION.md §4.9).
 *
 * Same shape as the SIP notebook (`ui/tracedialog.ts`): a native
 * `<dialog>`, which brings for free what a hand-rolled overlay
 * reimplements badly — Escape, focus trap, inert background, and the
 * focus given back where it was. The component knows neither the machine
 * nor the screen: it is handed a call log line, it shows it and steps
 * back. Nothing re-renders over it — a finished call does not move.
 *
 * The thread itself is drawn by the panel's own renderer
 * (`chatThreadHtml`), from the items kept in the entry: one model, one
 * rendering, whether the call is in progress or ten days old.
 */

import { formatTime, t, tn } from "../i18n/index.js";
import { bubbleText, type ChatItem } from "../sip/transcript.js";
import type { CallLogEntry } from "../storage/store.js";
import { chatThreadHtml } from "./screens/call/chat.js";
import { downloadSubtitles } from "./subtitles.js";
import { esc } from "./el.js";

/**
 * The « T » bubble: what tells, in the call log, that a call carried a
 * conversation. A speech bubble with the letter punched out of it —
 * `evenodd` makes the hole, so the glyph follows the row's colour like
 * the scroll and the lens beside it.
 */
export const CHAT_LOG_ICON = `<svg class="icon chatlog" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM8 6h8v2h-3v6h-2V8H8V6z"/></svg>`;

/** The bubbles of a thread — its notes are not messages. */
const messages = (items: ChatItem[]): ChatItem[] => items.filter((i) => i.kind === "bubble");

/**
 * The dialog's content, apart from its opening: the part that reads and
 * checks without a browser.
 */
export function chatLogDialogHtml(entry: CallLogEntry): string {
  const items = entry.chat ?? [];
  return `<div class="trace-head">
      <div>
        <h2>${esc(t("chat.log.title", { target: entry.target }))}</h2>
        <p class="trace-sub">${esc(formatTime(entry.startedAt))} — ${esc(
          tn("chat.log.count", messages(items).length),
        )}</p>
      </div>
      <div class="trace-actions">
        <button class="linkbtn" data-act="copy">${esc(t("chat.log.copy"))}</button>
        <button class="linkbtn" data-act="export">${esc(t("chat.log.export"))}</button>
        <button class="linkbtn" data-act="close">${esc(t("chat.log.close"))}</button>
      </div>
    </div>
    <div class="chat-thread chatlog-body" role="log" tabindex="0">${chatThreadHtml(
      items,
      entry.target,
    )}</div>`;
}

/**
 * The conversation in plain text, ready to paste in a report or a mail:
 * one line per bubble, the far end named as the history line names it.
 * Notes keep their place — a broken link explains a gap.
 */
export function chatAsText(items: ChatItem[], peer: string): string {
  return items
    .map((i) =>
      i.kind === "note"
        ? `— ${t(i.key)}`
        : `${formatTime(i.endedAt ?? i.startedAt)}  ${i.side === "them" ? peer : t("chat.you")} : ${bubbleText(i)}`,
    )
    .join("\n");
}

/**
 * Opens the conversation of a call log line. Without one there is nothing
 * to open — the bubble does not show up in the first place.
 */
export function showChatDialog(entry: CallLogEntry): void {
  const items = entry.chat ?? [];
  if (items.length === 0) return;

  const dlg = document.createElement("dialog");
  dlg.className = "trace-dialog chatlog-dialog";
  dlg.innerHTML = chatLogDialogHtml(entry);

  const copy = dlg.querySelector<HTMLButtonElement>('[data-act="copy"]')!;
  copy.addEventListener("click", () => {
    void navigator.clipboard?.writeText(chatAsText(items, entry.target)).then(
      () => {
        copy.textContent = t("chat.log.copied");
      },
      () => {
        // clipboard refused (insecure context, permission): the text stays
        // selectable in the dialog, nothing is lost
        copy.textContent = t("chat.log.copyFailed");
      },
    );
  });
  // the conversation as subtitles (`ui/subtitles.ts`): a file laid on the
  // start of the communication, which drops as-is onto a recording of it
  const save = dlg.querySelector<HTMLButtonElement>('[data-act="export"]')!;
  save.addEventListener("click", () => {
    if (!downloadSubtitles(entry)) save.textContent = t("chat.log.exportFailed");
  });
  dlg.querySelector('[data-act="close"]')!.addEventListener("click", () => dlg.close());
  // click on the backdrop, outside the frame: same gesture as Escape
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) dlg.close();
  });
  dlg.addEventListener("close", () => dlg.remove());

  document.body.appendChild(dlg);
  dlg.showModal();
}
