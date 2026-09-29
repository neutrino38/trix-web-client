/**
 * The prompt for a message from an unknown address (ADR 0008, D5): one
 * native `<dialog>` at a time, for the sender MessagingMachine shows.
 *
 * The machine decides what is shown and when its two minutes run; this
 * module only mirrors it. It never opens during a call (D10): a prompt
 * shown when a call starts is closed without an answer, and comes back
 * at the hang-up.
 *
 * The address is what the prompt names first. The display name travels
 * in the `From` as the sender wrote it: shown, but never alone — it is
 * the part anyone can forge.
 *
 * Escape answers Refuse, and the dialog says so: a prompt dismissed
 * without an answer would come back at the next render.
 */

import { t } from "../i18n/index.js";
import type { MessagingInstance, Quarantined } from "../machines/messaging.js";
import { shownPrompt } from "../machines/messaging.js";
import type { PhoneInstance } from "../machines/phone.js";
import { esc } from "./el.js";

let open: { key: string; dialog: HTMLDialogElement } | null = null;

/** The dialog's content: what reads and checks without a browser. */
export function strangerPromptHtml(q: Quarantined): string {
  const address = q.uri.replace(/^sips?:/i, "");
  const who = q.name ? t("stranger.named", { name: q.name, address }) : address;
  return `<h2 id="stranger-title">${esc(t("stranger.title"))}</h2>
    <p>${esc(t("stranger.intro", { who }))}</p>
    <div class="stranger-messages">${q.messages
      .map((m) => `<p dir="auto">${esc(m.text)}</p>`)
      .join("")}</div>
    <p class="stranger-expiry">${esc(t("stranger.expiry"))}</p>
    <div class="stranger-actions">
      <button type="button" class="btn primary small" data-act="accept">${esc(t("stranger.accept"))}</button>
      <button type="button" class="btn small" data-act="refuse">${esc(t("stranger.refuse"))}</button>
      <button type="button" class="btn small danger" data-act="block">${esc(t("stranger.block"))}</button>
    </div>`;
}

function close(): void {
  const current = open;
  open = null;
  // `open` is cleared first, so nothing answers twice; the element goes at
  // once — Chrome does not always fire `close` after a prevented `cancel`
  current?.dialog.close();
  current?.dialog.remove();
}

function show(q: Quarantined, phone: PhoneInstance, messaging: MessagingInstance): void {
  const dlg = document.createElement("dialog");
  dlg.className = "stranger-dialog";
  dlg.setAttribute("aria-labelledby", "stranger-title");
  dlg.innerHTML = strangerPromptHtml(q);
  const answer = (act: string) => {
    close();
    if (act === "accept") {
      // the book files what was held (`phone:contacts`); acceptSender covers
      // an address the book refuses to take
      phone.send({ type: "ui:addContact", name: q.name ?? "", uri: q.uri });
      messaging.send({ type: "ui:acceptSender", key: q.key });
    } else if (act === "block") {
      phone.send({ type: "ui:blockContact", uri: q.uri, name: q.name ?? "" });
      messaging.send({ type: "ui:refuseSender", key: q.key });
    } else {
      messaging.send({ type: "ui:refuseSender", key: q.key });
    }
  };
  dlg.addEventListener("click", (e) => {
    const act = (e.target as Element).closest<HTMLElement>("[data-act]")?.dataset.act;
    if (act) answer(act);
  });
  dlg.addEventListener("cancel", (e) => {
    e.preventDefault();
    answer("refuse");
  });
  document.body.appendChild(dlg);
  open = { key: q.key, dialog: dlg };
  dlg.showModal();
}

/** After each change of the messaging machine: show, swap or close the prompt. */
export function syncStrangerPrompt(phone: PhoneInstance, messaging: MessagingInstance): void {
  const wanted = messaging.context.inCall ? null : shownPrompt(messaging.context);
  if (open && open.key === wanted?.key) {
    // a second message from the same sender joins the open prompt
    const list = open.dialog.querySelector(".stranger-messages");
    if (list && wanted.messages.length !== list.children.length) {
      list.innerHTML = wanted.messages.map((m) => `<p dir="auto">${esc(m.text)}</p>`).join("");
    }
    return;
  }
  close();
  if (wanted) show(wanted, phone, messaging);
}
