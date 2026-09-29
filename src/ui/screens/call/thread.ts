/**
 * The "Échanges" thread on the stage (ADR 0007, D10): while no call is
 * going on, the stage that would hold the video holds the thread — search,
 * "Add a contact", then one line per correspondent grouped by the age of
 * the last exchange. A line unfolds into its calls, day by day, each with
 * the buttons it had in the history (conversation, SIP trace, media
 * report); unfolding also fills the address to dial.
 *
 * Instant messages (ADR 0008) fill the same lines: an unfolded line lists
 * its calls and messages oldest first, filtered by segment (All, Calls,
 * Messages), and ends with the field to write. Opening a line in a
 * visible tab reads its messages. A blocked contact keeps its line, with
 * neither call button nor writing field.
 *
 * The screen is rebuilt on phone transitions only. Presence, messages and
 * the contact book change without one, so the list redraws itself
 * (`refreshThread`), keeping the search field, the address being typed,
 * what is being written and — when it can — the focus.
 */

import type { PhoneInstance } from "../../../machines/phone.js";
import { activeAccount } from "../../../machines/phone.js";
import type { PresenceInstance } from "../../../machines/presence.js";
import type { MessagingInstance } from "../../../machines/messaging.js";
import { MAX_MESSAGE_BYTES, utf8Length } from "../../../sip/message.js";
import type { MessageEntry } from "../../../storage/store.js";
import { boundMessaging, canWrite, messagingOn } from "../../messaging.js";
import { formatDayMonth, formatTime, localeTag, t, tn } from "../../../i18n/index.js";
import { normalizeTarget } from "../../../sip/uri.js";
import { showChatDialog } from "../../chatdialog.js";
import { esc } from "../../el.js";
import { GLYPH_LABEL, boundPresence, glyph, type Glyph } from "../../presence.js";
import { showTraceDialog } from "../../tracedialog.js";
import {
  buildThreads,
  contactFor,
  groupOf,
  initials,
  lastEvent,
  lastStranger,
  threadEvents,
  threadSections,
  type Segment,
  type Thread,
  type ThreadGroup,
} from "../../thread.js";
import {
  HISTORY_ICONS,
  ICONS,
  OUTCOME_KEY,
  currentMode,
  displayTarget,
  fmtDuration,
  historyRow,
  setDraft,
} from "./parts.js";
import { showStatsDialog } from "./stats.js";
import type { MsgKey } from "../../../i18n/types.js";

// ---- what survives a rebuild ----------------------------------------------

let query = "";
let openKey: string | null = null;
let adding = false;
/** What the add form holds: a refused address redraws the form, not the typing. */
let addDraft = { name: "", uri: "" };
let renaming: string | null = null;
/** The "no presence here" banner is said once; dismissed, it stays so until reload. */
let noPresenceDismissed = false;
let segment: Segment = "all";
/** What is being written, per line: a redraw must not lose it. */
const drafts = new Map<string, string>();

/** Past this, the writing field shows how much room is left (D2). */
const COUNT_FROM = 800;

const GROUP_LABEL: Record<ThreadGroup, MsgKey> = {
  today: "thread.group.today",
  yesterday: "thread.group.yesterday",
  week: "thread.group.week",
  older: "thread.group.older",
  none: "thread.group.none",
};

const CHEVRON = `<svg class="chev" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const PLUS = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
const SEARCH = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16l4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
const BUBBLE = `<svg class="icon dir" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v10H10l-4 4v-4H5z"/></svg>`;
const DIAL = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 4h2l1.5 4-2 1.3a11 11 0 0 0 6.2 6.2L16 13.5l4 1.5v2a2 2 0 0 1-2 2A15 15 0 0 1 5 6a2 2 0 0 1 2-2z" fill="currentColor"/></svg>`;

// ---- presence of a line ---------------------------------------------------

interface LinePresence {
  glyph: Glyph | null;
  stale: boolean;
  text: string;
  /** Available and fresh: the call button is drawn full. */
  reachable: boolean;
}

/**
 * What a line says of its correspondent. No glyph at all when presence is
 * not there to be had (D8): a server that refused SUBSCRIBE, or presence
 * turned off — contacts stay callable, without pretending.
 */
export function linePresence(thread: Thread, presence: PresenceInstance | null): LinePresence {
  if (!thread.contact) return { glyph: null, stale: false, text: t("thread.notContact"), reachable: false };
  const state = presence?.state;
  if (!presence || state === "no_watch" || state === "disabled" || state === "off") {
    return { glyph: null, stale: false, text: "", reachable: false };
  }
  const p = thread.presence;
  if (!p) {
    // live: not heard of yet; stale: never heard of before we went down
    return { glyph: "unknown", stale: false, text: t(GLYPH_LABEL.unknown), reachable: false };
  }
  if (p.pending) return { glyph: "unknown", stale: false, text: t("thread.pending"), reachable: false };
  const word = t(GLYPH_LABEL[p.info.state]);
  const said = p.info.note ? `${word} · ${p.info.note}` : word;
  if (!p.fresh) {
    return {
      glyph: p.info.state,
      stale: true,
      text: t("thread.stale", { status: said, time: formatTime(p.receivedAt) }),
      reachable: false,
    };
  }
  return { glyph: p.info.state, stale: false, text: said, reachable: p.info.state === "available" };
}

// ---- markup -----------------------------------------------------------------

function when(ts: number, now: number): string {
  switch (groupOf(ts, now)) {
    case "today":
      return formatTime(ts);
    case "yesterday":
      return t("thread.yesterday");
    case "week":
      return new Intl.DateTimeFormat(localeTag(), { weekday: "long" }).format(ts);
    default:
      return formatDayMonth(ts);
  }
}

function summary(thread: Thread): string {
  const event = lastEvent(thread);
  if (event?.kind === "message") {
    const m = event.message;
    const text = m.direction === "outgoing" ? t("message.you", { text: m.text }) : m.text;
    return `${BUBBLE}<span dir="auto">${esc(text)}</span>`;
  }
  const last = thread.calls[0]?.entry;
  if (!last) return "";
  const duration = fmtDuration(last);
  return `${HISTORY_ICONS[last.outcome]}<span>${esc(t(OUTCOME_KEY[last.outcome]))}${
    duration ? ` · ${esc(duration)}` : ""
  }</span>`;
}

function avatar(thread: Thread, p: LinePresence): string {
  const face = thread.contact ? `<span>${esc(initials(thread.name))}</span>` : DIAL;
  return `<span class="avatar ${thread.contact ? "" : "number"}">${face}${p.glyph ? glyph(p.glyph, 15, p.stale) : ""}</span>`;
}

/** A day's heading, once per day, between the events of a line. */
function dayLabel(ts: number, now: number): string {
  const group = groupOf(ts, now);
  return group === "today" || group === "yesterday" ? t(GROUP_LABEL[group]) : formatDayMonth(ts);
}

/** What a message says of itself (D3): its state is always a word, never a color alone. */
function messageState(m: MessageEntry): string {
  switch (m.state) {
    case "pending":
      return t("message.state.pending");
    case "failed":
      return t("message.state.failed", { reason: m.reason ? t(m.reason) : "" });
    case "sent":
      return "";
    case "received":
      return "";
  }
}

function messageRow(m: MessageEntry, thread: Thread): string {
  const out = m.direction === "outgoing";
  const state = messageState(m);
  // the sender is said to screen readers; sight reads it from the side
  const who = out ? t("message.mine") : t("message.from", { name: thread.name });
  return `<div class="msg ${out ? "out" : "in"} ${m.state}">
    <span class="sr-only">${esc(who)}</span>
    <p dir="auto">${esc(m.text)}</p>
    <span class="msg-meta">${esc(formatTime(m.at))}${state ? ` · ${esc(state)}` : ""}${
      m.state === "sent" ? `<span class="sr-only"> · ${esc(t("message.state.sent"))}</span>` : ""
    }${
      m.state === "failed"
        ? ` <button type="button" class="linkbtn" data-act="thread-retry" data-id="${esc(m.id)}">${esc(
            t("message.retry"),
          )}</button>`
        : ""
    }</span>
  </div>`;
}

function segments(): string {
  const button = (value: Segment, key: MsgKey) =>
    `<button type="button" class="seg" data-act="thread-segment" data-key="${value}" aria-pressed="${
      segment === value
    }">${esc(t(key))}</button>`;
  return `<div class="thread-segments" role="group" aria-label="${esc(t("thread.segments"))}">
    ${button("all", "thread.segment.all")}${button("calls", "thread.segment.calls")}${button(
      "messages",
      "thread.segment.messages",
    )}
  </div>`;
}

function composer(thread: Thread, messaging: MessagingInstance): string {
  const draft = drafts.get(thread.key) ?? "";
  const bytes = utf8Length(draft);
  const over = bytes > MAX_MESSAGE_BYTES;
  const offline = messaging.state !== "online";
  return `<form class="thread-compose" data-form="compose" data-key="${esc(thread.key)}">
    <label class="sr-only" for="thread-compose">${esc(t("message.compose", { name: thread.name }))}</label>
    <textarea id="thread-compose" name="text" rows="2" dir="auto" placeholder="${esc(t("message.placeholder"))}"
              ${over ? 'aria-invalid="true"' : ""} aria-describedby="thread-compose-count">${esc(draft)}</textarea>
    <button type="submit" class="btn small primary" ${over || !draft.trim() ? "disabled" : ""}>${esc(
      t("message.send"),
    )}</button>
    <span class="compose-count ${over ? "over" : ""}" id="thread-compose-count" data-ref="compose-count"
          ${bytes >= COUNT_FROM ? "" : "hidden"}>${esc(t("message.count", { n: bytes, max: MAX_MESSAGE_BYTES }))}</span>
    ${offline ? `<span class="compose-hint">${esc(t("message.offline"))}</span>` : ""}
  </form>`;
}

function body(thread: Thread, now: number, messaging: MessagingInstance | null): string {
  const withMessages = messagingOn(messaging);
  const events = threadEvents(thread, withMessages ? segment : "calls");
  const days: string[] = [];
  let day = "";
  for (const event of events) {
    const label = dayLabel(event.at, now);
    if (label !== day) {
      day = label;
      days.push(`<div class="thread-day"><span>${esc(label)}</span></div>`);
    }
    days.push(
      event.kind === "call"
        ? historyRow(event.call.entry, event.call.index, "thread-")
        : messageRow(event.message, thread),
    );
  }
  const none =
    !withMessages || segment === "calls"
      ? "thread.noCalls"
      : segment === "messages"
        ? "thread.noMessages"
        : "thread.noEvents";
  const list = days.length
    ? `<div class="thread-events" data-ref="thread-events">${days.join("")}</div>`
    : `<p class="thread-none">${esc(t(none))}</p>`;
  const c = thread.contact;
  const block = c?.blocked
    ? `<button type="button" class="linkbtn" data-act="thread-unblock" data-id="${esc(c.id)}">${esc(t("thread.unblock"))}</button>`
    : `<button type="button" class="linkbtn" data-act="thread-block" data-key="${esc(thread.key)}">${esc(t("thread.block"))}</button>`;
  const actions =
    c && renaming === thread.key
      ? `<form class="thread-rename" data-form="rename" data-id="${esc(c.id)}">
           <label class="sr-only" for="thread-rename">${esc(t("thread.form.name"))}</label>
           <input id="thread-rename" name="name" value="${esc(c.name)}" maxlength="80" required>
           <button type="submit" class="btn small primary">${esc(t("thread.renameSave"))}</button>
           <button type="button" class="btn small" data-act="thread-rename-cancel">${esc(t("thread.form.cancel"))}</button>
         </form>`
      : `<div class="thread-actions">
           ${
             c
               ? `<button type="button" class="linkbtn" data-act="thread-rename" data-key="${esc(thread.key)}">${esc(t("thread.rename"))}</button>
                  <button type="button" class="linkbtn" data-act="thread-remove" data-id="${esc(c.id)}">${esc(t("thread.remove"))}</button>`
               : ""
           }
           ${block}
         </div>`;
  const write = withMessages && !thread.blocked && canWrite(messaging) ? composer(thread, messaging) : "";
  // the contact's actions come first: after a long history they would be out of sight
  return `<div class="thread-body">${actions}${withMessages ? segments() : ""}${list}${write}</div>`;
}

function row(
  thread: Thread,
  presence: PresenceInstance | null,
  messaging: MessagingInstance | null,
  ready: boolean,
  now: number,
): string {
  const open = openKey === thread.key;
  const p = thread.blocked
    ? { glyph: null, stale: false, text: t("thread.blocked"), reachable: false }
    : linePresence(thread, presence);
  return `<li class="thread ${open ? "open" : ""}">
    <div class="thread-head">
      <button type="button" class="thread-toggle" data-act="thread-toggle" data-key="${esc(thread.key)}"
              aria-expanded="${open}">
        ${CHEVRON}
        ${avatar(thread, p)}
        <span class="thread-who">
          <span class="name">${esc(thread.name)}</span>
          ${p.text ? `<span class="status ${p.stale ? "stale" : ""}">${esc(p.text)}</span>` : ""}
        </span>
        <span class="thread-last">${summary(thread)}</span>
        <span class="when">${thread.last !== null ? esc(when(thread.last, now)) : ""}${
          thread.unread > 0
            ? `<span class="unread"><span aria-hidden="true">${thread.unread}</span><span class="sr-only">${esc(
                tn("thread.unread", thread.unread),
              )}</span></span>`
            : ""
        }</span>
      </button>
      ${
        open && !thread.contact
          ? `<button type="button" class="btn small" data-act="thread-add-number" data-key="${esc(thread.key)}">${esc(
              t("thread.addToContacts"),
            )}</button>`
          : ""
      }
      ${
        thread.blocked
          ? ""
          : `<button type="button" class="thread-call ${p.reachable ? "go" : ""}" data-act="thread-call"
              data-key="${esc(thread.key)}" ${ready ? "" : "disabled"}
              aria-label="${esc(t("thread.call", { name: thread.name }))}">${ICONS.phone}</button>`
      }
    </div>
    ${open ? body(thread, now, messaging) : ""}
  </li>`;
}

function addForm(phone: PhoneInstance): string {
  const error = phone.context.contactError;
  return `<form class="thread-addform" data-form="add">
    <div class="field">
      <label for="thread-add-name">${esc(t("thread.form.name"))}</label>
      <input id="thread-add-name" name="name" maxlength="80" autocomplete="off" value="${esc(addDraft.name)}">
    </div>
    <div class="field">
      <label for="thread-add-uri">${esc(t("thread.form.address"))}</label>
      <input id="thread-add-uri" name="uri" autocomplete="off" required value="${esc(addDraft.uri)}"
             ${error ? 'aria-invalid="true" aria-describedby="thread-add-error"' : ""}>
      ${error ? `<span class="call-error" id="thread-add-error">${esc(t(error))}</span>` : ""}
    </div>
    <div class="thread-formbtns">
      <button type="submit" class="btn primary small">${esc(t("thread.form.save"))}</button>
      <button type="button" class="btn small" data-act="thread-add-cancel">${esc(t("thread.form.cancel"))}</button>
    </div>
  </form>`;
}

/**
 * An empty book still opens the thread: one sentence, and the most recent
 * correspondent offered as the first contact.
 */
function firstContact(threads: readonly Thread[]): string {
  const last = lastStranger(threads);
  return `<div class="thread-first">
    <p>${esc(t("thread.firstContact"))}</p>
    <div class="thread-formbtns">
      <button type="button" class="btn small" data-act="thread-add">${PLUS}${esc(t("thread.add"))}</button>
      ${
        last
          ? `<button type="button" class="btn small primary" data-act="thread-add-number" data-key="${esc(last.key)}">${esc(
              t("thread.addLast", { name: displayTarget(last.target) }),
            )}</button>`
          : ""
      }
    </div>
  </div>`;
}

/** The list alone: what `refreshThread` redraws. */
function threadsOf(phone: PhoneInstance): Thread[] {
  const messaging = boundMessaging();
  return buildThreads(
    phone.context.contacts,
    phone.context.history,
    boundPresence()?.context.contacts ?? {},
    messagingOn(messaging) ? messaging.context.messages : [],
  );
}

function listHtml(phone: PhoneInstance, now: number): string {
  const presence = boundPresence();
  const messaging = boundMessaging();
  const threads = threadsOf(phone);
  const sections = threadSections(threads, query, now);
  const ready = phone.state === "ready";
  const first = !adding && !query.trim() && phone.context.contacts.length === 0 ? firstContact(threads) : "";
  const content = sections.length
    ? sections
        .map(
          (s) => `<section class="thread-group">
            <h2>${esc(t(GROUP_LABEL[s.group]))}</h2>
            <ul>${s.threads.map((th) => row(th, presence, messaging, ready, now)).join("")}</ul>
          </section>`,
        )
        .join("")
    : threads.length
      ? `<p class="thread-none">${esc(t("thread.noMatch"))}</p>`
      : "";
  return `${adding ? addForm(phone) : first}${content}`;
}

/**
 * The whole stage at rest. `notice` is what the phone has to say above the
 * thread — a failed registration, a reconnection, the page asleep.
 */
export function threadStage(phone: PhoneInstance, notice: string): string {
  const history = phone.context.history.length > 0;
  // SUBSCRIBE refused (D8): said once, above the lines that lost their glyph
  const noPresence = boundPresence()?.state === "no_watch" && !noPresenceDismissed;
  // MESSAGE refused by the server (ADR 0008, D13): said while it lasts
  const messaging = boundMessaging();
  const noMessaging = messagingOn(messaging) && messaging.context.unsupported;
  return `<div class="thread-stage">
    ${notice ? `<div class="thread-notice">${notice}</div>` : ""}
    ${
      noPresence
        ? `<p class="reach-note thread-banner" role="status">${esc(t("thread.noPresence"))}
             <button type="button" class="linkbtn" data-act="thread-banner-dismiss">${esc(t("reach.dismiss"))}</button>
           </p>`
        : ""
    }
    ${noMessaging ? `<p class="reach-note thread-banner" role="status">${esc(t("thread.noMessaging"))}</p>` : ""}
    <div class="thread-bar">
      <h1>${esc(t("thread.title"))}</h1>
      <span class="thread-sub">${esc(t(messagingOn(messaging) ? "thread.subtitleMessages" : "thread.subtitle"))}</span>
      <span class="spacer"></span>
      <label class="sr-only" for="thread-search">${esc(t("thread.search"))}</label>
      <span class="thread-search">${SEARCH}<input id="thread-search" type="search" data-ref="thread-search"
            value="${esc(query)}" placeholder="${esc(t("thread.search"))}" autocomplete="off"></span>
      <button type="button" class="btn small" data-act="thread-add">${PLUS}${esc(t("thread.add"))}</button>
    </div>
    <div class="thread-list" data-ref="thread-list">${listHtml(phone, Date.now())}</div>
    ${
      history
        ? `<div class="thread-foot"><button type="button" class="linkbtn" data-act="thread-clear-history">${esc(
            t("history.clear"),
          )}</button></div>`
        : ""
    }
  </div>`;
}

/** The hint under the address field: who it is, and how they are (D10). */
export function contactHint(phone: PhoneInstance, typed: string): string {
  const cfg = activeAccount(phone.context);
  if (!cfg) return "";
  const contact = contactFor(phone.context.contacts, typed, cfg.domain);
  if (!contact) return "";
  const presence = boundPresence();
  const thread = buildThreads([contact], [], presence?.context.contacts ?? {})[0]!;
  const status = linePresence(thread, presence).text;
  return status ? t("call.contactHint", { name: contact.name, status }) : contact.name;
}

// ---- wiring -----------------------------------------------------------------

interface Mounted {
  node: HTMLElement;
  phone: PhoneInstance;
  signature: readonly unknown[];
}

let mounted: Mounted | null = null;

function signature(phone: PhoneInstance): readonly unknown[] {
  const presence = boundPresence();
  const messaging = boundMessaging();
  return [
    messaging?.state,
    messaging?.context.messages,
    messaging?.context.unsupported,
    phone.state,
    phone.context.contacts,
    phone.context.history,
    phone.context.contactError,
    presence?.state,
    presence?.context.contacts,
  ];
}

function same(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Redraws the list, putting the focus back where it was if it was inside. */
function redraw(m: Mounted): void {
  const list = m.node.querySelector<HTMLElement>('[data-ref="thread-list"]');
  if (!list) return;
  const active = document.activeElement as HTMLElement | null;
  const inside = active && list.contains(active);
  const act = inside ? active.dataset.act : undefined;
  const key = inside ? (active.dataset.key ?? active.dataset.id) : undefined;
  const id = inside ? active.id : undefined;
  list.innerHTML = listHtml(m.phone, Date.now());
  m.signature = signature(m.phone);
  // the conversation reads from the bottom, where the writing field is
  const events = list.querySelector<HTMLElement>('[data-ref="thread-events"]');
  if (events) events.scrollTop = events.scrollHeight;
  markRead();
  if (!inside) return;
  const back = id
    ? list.querySelector<HTMLElement>(`#${CSS.escape(id)}`)
    : Array.from(list.querySelectorAll<HTMLElement>("[data-act]")).find(
        (el) => el.dataset.act === act && (el.dataset.key ?? el.dataset.id) === key,
      );
  back?.focus();
  // what was being written keeps its caret at the end
  if (back instanceof HTMLTextAreaElement) back.setSelectionRange(back.value.length, back.value.length);
}

/**
 * The open line's messages are read once it shows in a visible tab
 * (ADR 0008, D11). The machine changes nothing when nothing is unread,
 * so the redraw this causes does not loop.
 */
function markRead(): void {
  const messaging = boundMessaging();
  if (!openKey || !messagingOn(messaging) || document.visibilityState !== "visible") return;
  const key = openKey;
  if (messaging.context.messages.some((m) => m.key === key && !m.read)) {
    messaging.send({ type: "ui:read", key });
  }
}

// a line left open in a hidden tab is read when the tab comes back
if (typeof document !== "undefined") document.addEventListener("visibilitychange", markRead);

/** After each `renderApp`: redraw the list if what it shows has changed. */
export function refreshThread(): void {
  const m = mounted;
  if (!m || !m.node.isConnected) return;
  const next = signature(m.phone);
  if (!same(next, m.signature)) redraw(m);
}

export function wireThread(node: HTMLElement, phone: PhoneInstance): void {
  const stage = node.querySelector<HTMLElement>(".thread-stage");
  if (!stage) {
    mounted = null;
    return;
  }
  const m: Mounted = { node, phone, signature: signature(phone) };
  mounted = m;
  const target = node.querySelector<HTMLInputElement>('[data-ref="target"]');
  const hint = node.querySelector<HTMLElement>('[data-ref="contacthint"]');
  const updateHint = () => {
    if (hint && target) hint.textContent = contactHint(phone, target.value);
  };
  target?.addEventListener("input", updateHint);

  const threadOf = (key: string | undefined): Thread | undefined => threadsOf(phone).find((th) => th.key === key);
  const entryAt = (i: string | undefined) => phone.context.history[Number(i)];

  stage.addEventListener("input", (e) => {
    const input = e.target as HTMLInputElement;
    if (input.dataset.ref === "thread-search") {
      query = input.value;
      redraw(m);
    } else if (input.id === "thread-add-name") {
      addDraft = { ...addDraft, name: input.value };
    } else if (input.id === "thread-add-uri") {
      addDraft = { ...addDraft, uri: input.value };
    } else if (input.id === "thread-compose") {
      const key = input.closest<HTMLElement>("[data-key]")?.dataset.key;
      if (!key) return;
      drafts.set(key, input.value);
      // the counter and the button follow the typing, without a redraw
      const bytes = utf8Length(input.value);
      const over = bytes > MAX_MESSAGE_BYTES;
      const count = stage.querySelector<HTMLElement>('[data-ref="compose-count"]');
      if (count) {
        count.hidden = bytes < COUNT_FROM;
        count.textContent = t("message.count", { n: bytes, max: MAX_MESSAGE_BYTES });
        count.classList.toggle("over", over);
      }
      // an empty aria-invalid reads as valid: the value is spelled out
      if (over) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
      const send = input.form?.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (send) send.disabled = over || !input.value.trim();
    }
  });

  // Enter sends, Shift+Enter goes to the next line
  stage.addEventListener("keydown", (e) => {
    const input = e.target as HTMLElement;
    if (input.id !== "thread-compose" || e.key !== "Enter" || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    const form = (input as HTMLTextAreaElement).form;
    const send = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (form && send && !send.disabled) form.requestSubmit();
  });

  stage.addEventListener("click", (e) => {
    const el = (e.target as Element).closest<HTMLElement>("[data-act]");
    if (!el || !stage.contains(el)) return;
    const { act, key, id, i } = el.dataset;
    switch (act) {
      case "thread-toggle": {
        openKey = openKey === key ? null : (key ?? null);
        renaming = null;
        const thread = threadOf(key);
        if (openKey && thread && target && !target.disabled) {
          // D10: unfolding a line fills the address to dial
          target.value = displayTarget(thread.target);
          setDraft(target.value);
          updateHint();
        }
        redraw(m);
        return;
      }
      case "thread-call": {
        const cfg = activeAccount(phone.context);
        const thread = threadOf(key);
        const to = cfg && thread ? normalizeTarget(thread.target, cfg.domain) : null;
        if (cfg && to) phone.send({ type: "ui:call", target: to, media: currentMode(cfg.rtt).media });
        return;
      }
      case "thread-add":
        adding = !adding;
        redraw(m);
        if (adding) stage.querySelector<HTMLInputElement>("#thread-add-name")?.focus();
        return;
      case "thread-add-cancel":
        adding = false;
        addDraft = { name: "", uri: "" };
        redraw(m);
        stage.querySelector<HTMLElement>('[data-act="thread-add"]')?.focus();
        return;
      case "thread-add-number": {
        const thread = threadOf(key);
        if (!thread) return;
        phone.send({ type: "ui:addContact", name: "", uri: thread.target });
        // the button is gone with the stranger's line: the focus goes to the
        // line that now holds the contact, same key
        redraw(m);
        stage
          .querySelector<HTMLElement>(`[data-act="thread-toggle"][data-key="${CSS.escape(thread.key)}"]`)
          ?.focus();
        return;
      }
      case "thread-rename":
        renaming = key ?? null;
        redraw(m);
        stage.querySelector<HTMLInputElement>("#thread-rename")?.select();
        return;
      case "thread-rename-cancel":
        renaming = null;
        redraw(m);
        return;
      case "thread-remove":
        if (id) phone.send({ type: "ui:removeContact", id });
        return;
      case "thread-block": {
        const thread = threadOf(key);
        if (thread) phone.send({ type: "ui:blockContact", uri: thread.target, name: thread.contact ? thread.name : "" });
        return;
      }
      case "thread-unblock":
        if (id) phone.send({ type: "ui:unblockContact", id });
        return;
      case "thread-segment":
        segment = (key as Segment | undefined) ?? "all";
        redraw(m);
        return;
      case "thread-retry":
        if (id) boundMessaging()?.send({ type: "ui:retry", id });
        return;
      case "thread-banner-dismiss":
        noPresenceDismissed = true;
        el.closest(".thread-banner")?.remove();
        return;
      case "thread-clear-history":
        phone.send({ type: "ui:clearHistory" });
        return;
      case "thread-trace": {
        const entry = entryAt(i);
        if (entry) showTraceDialog(entry);
        return;
      }
      case "thread-stats": {
        const entry = entryAt(i);
        if (entry) showStatsDialog(entry);
        return;
      }
      case "thread-chat-log": {
        const entry = entryAt(i);
        if (entry) showChatDialog(entry);
        return;
      }
    }
  });

  stage.addEventListener("submit", (e) => {
    const form = e.target as HTMLFormElement;
    e.preventDefault();
    const data = new FormData(form);
    if (form.dataset.form === "add") {
      phone.send({ type: "ui:addContact", name: String(data.get("name") ?? ""), uri: String(data.get("uri") ?? "") });
      // refused: the form stays, with the reason (the machine said it in contactError)
      if (!phone.context.contactError) {
        adding = false;
        addDraft = { name: "", uri: "" };
        redraw(m);
        stage.querySelector<HTMLElement>('[data-act="thread-add"]')?.focus();
      } else {
        redraw(m);
        stage.querySelector<HTMLInputElement>("#thread-add-uri")?.focus();
      }
    } else if (form.dataset.form === "compose" && form.dataset.key) {
      const key = form.dataset.key;
      const thread = threadOf(key);
      const cfg = activeAccount(phone.context);
      const to = thread && cfg ? normalizeTarget(thread.target, cfg.domain) : null;
      const text = String(data.get("text") ?? "");
      if (!to || !text.trim() || utf8Length(text) > MAX_MESSAGE_BYTES) return;
      boundMessaging()?.send({ type: "ui:send", uri: to, text });
      drafts.delete(key);
      redraw(m);
      stage.querySelector<HTMLTextAreaElement>("#thread-compose")?.focus();
    } else if (form.dataset.form === "rename" && form.dataset.id) {
      renaming = null;
      phone.send({ type: "ui:renameContact", id: form.dataset.id, name: String(data.get("name") ?? "") });
      redraw(m);
    }
  });
}
