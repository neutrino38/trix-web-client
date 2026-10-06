/**
 * Presence on screen (ADR 0007, D4, D5, D11): the eight glyphs and their
 * words, and the status button of the header with its menu.
 *
 * Never colour alone: every state has a shape and a word, and the word is
 * always written next to the glyph, never only in a `title`. The three
 * tints are one step darker than the theme's green, orange and red so the
 * white mark keeps 3:1 (`--presence-*` in `theme.css`).
 *
 * The screen is rebuilt from strings on every phone change, a call
 * included. The menu therefore lives outside `#app`, as the announcement
 * region does: a rebuild re-anchors it to the new button instead of
 * closing it under the user's fingers.
 *
 * The menu is a non-modal dialog, not a bare `role="menu"`: it holds a
 * note field and two checkboxes, which a menu may not contain. The five
 * statuses inside it are a real menu of `menuitemradio`, walked with the
 * arrow keys; Tab reaches the note and the rules; Escape closes and gives
 * the focus back to the button.
 */

import type { PresenceView, Trix, TrixView } from "../core/index.js";
import type { Presence } from "../sip/pidf.js";
import type { ChosenStatus } from "../storage/session.js";
import { t } from "../i18n/index.js";
import type { MsgKey } from "../i18n/types.js";
import { announce } from "./announce.js";
import { esc } from "./el.js";

/** What a glyph can show: the seven states, plus our own Invisible. */
export type Glyph = Presence | "invisible";

const DISC = (tint: string, mark = "") =>
  `<circle cx="8" cy="8" r="7.5" fill="var(--presence-${tint})"/>${mark}`;
const CHECK = `<path d="M4.7 8.2l2.2 2.2 4.4-4.5" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;
const HANDS = `<path d="M8 4.2V8l2.6 1.7" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;
const BAR = `<path d="M4.4 8h7.2" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>`;
const HANDSET = `<path d="M5.2 4.3c.3-.3.8-.3 1.1 0l.9 1.1c.2.3.2.7 0 1l-.5.6c.5 1 1.2 1.7 2.2 2.2l.6-.5c.3-.2.7-.2 1 0l1.1.9c.3.3.3.8 0 1.1l-.6.6c-.6.6-1.5.7-2.2.3-1.6-.9-3-2.3-3.9-3.9-.4-.7-.3-1.6.3-2.2z" fill="#fff"/>`;
const RING = `<circle cx="8" cy="8" r="6" fill="none" stroke="var(--ink-soft)" stroke-width="2"/>`;
const DASHED = `<circle cx="8" cy="8" r="6" fill="none" stroke="var(--ink-soft)" stroke-width="1.6" stroke-dasharray="2.4 2"/>`;

const SHAPES: Record<Glyph, string> = {
  available: DISC("available", CHECK),
  busy: DISC("busy"),
  "on-the-phone": DISC("busy", HANDSET),
  away: DISC("away", HANDS),
  dnd: DISC("busy", BAR),
  offline: RING,
  unknown: DASHED,
  invisible: `${RING}<circle cx="8" cy="8" r="2" fill="var(--ink-soft)"/>`,
};

export const GLYPH_LABEL: Record<Glyph, MsgKey> = {
  available: "presence.available",
  busy: "presence.busy",
  "on-the-phone": "presence.onThePhone",
  away: "presence.away",
  dnd: "presence.dnd",
  offline: "presence.offline",
  unknown: "presence.unknown",
  invisible: "presence.invisible",
};

/**
 * A glyph, decorative: the word goes beside it. `stale` draws what we knew
 * with the dashed ring of the unknown (D9) — its word says the rest.
 */
export function glyph(state: Glyph, size = 15, stale = false): string {
  const shape = stale ? DASHED : SHAPES[state];
  return `<svg class="pglyph" viewBox="0 0 16 16" width="${size}" height="${size}" aria-hidden="true">${shape}</svg>`;
}

/** What the header shows of us: Invisible as such, otherwise what others see. */
export function myGlyph(p: PresenceView): Glyph {
  return p.prefs.chosen === "invisible" ? "invisible" : p.shown.state;
}

/**
 * The status button replaces the registration pill only while registered
 * and while the server takes SUBSCRIBE (D8): otherwise the pill of before.
 */
function statusShown(app: TrixView): PresenceView | null {
  return app.presence.state === "live" && app.registration === "registered" ? app.presence : null;
}

/**
 * What the header depends on, as one string: `renderApp` rebuilds the
 * screen when it changes, and only then — contact presence does not move
 * the header.
 */
export function headerKey(app: TrixView): string {
  const p = statusShown(app);
  if (!p) return app.presence.state;
  return [p.state, myGlyph(p), p.prefs.note ?? "", p.support.publish].join("|");
}

// ---- the button -------------------------------------------------------------

const MENU_ID = "status-menu";

/**
 * The status button, or null when the registration pill must stay (D8).
 * `identity` is the account's address, shown after the status as before.
 */
export function statusButton(app: TrixView, identity: string): string | null {
  const p = statusShown(app);
  if (!p) return null;
  const g = myGlyph(p);
  return `<button type="button" class="pill statusbtn" data-ref="statusbtn"
      aria-haspopup="dialog" aria-expanded="${open ? "true" : "false"}" aria-controls="${MENU_ID}">
    ${glyph(g)}
    <span>${esc(t(GLYPH_LABEL[g]))}</span>${identity ? `<span class="who">${esc(identity)}</span>` : ""}
    <svg class="chev" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </button>`;
}

/**
 * The pill's word while the page sleeps (D9). Once the server took our
 * PUBLISH, being asleep also means being offline for the contacts: the
 * pill says so, rather than leave the user to believe they still show.
 */
export function pillLabel(app: TrixView, label: string): string {
  const seen = app.presence.state === "stale" && app.presence.support.publish === true;
  return app.registration === "sleeping" && seen ? t("status.sleepingSeen") : label;
}

// ---- the menu ---------------------------------------------------------------

const CHOICES: readonly { status: ChosenStatus; glyph: Glyph; hint?: MsgKey }[] = [
  { status: "available", glyph: "available" },
  { status: "busy", glyph: "busy", hint: "presenceMenu.busyHint" },
  { status: "away", glyph: "away" },
  { status: "dnd", glyph: "dnd", hint: "presenceMenu.dndHint" },
  { status: "invisible", glyph: "invisible", hint: "presenceMenu.invisibleHint" },
];

const TICK = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** The menu's markup, from the view's presence alone. */
export function statusMenuHtml(p: PresenceView): string {
  const { prefs } = p;
  const items = CHOICES.map((c) => {
    const on = prefs.chosen === c.status;
    return `<button type="button" role="menuitemradio" aria-checked="${on}" tabindex="${on ? 0 : -1}"
        class="statusitem${on ? " on" : ""}" data-status="${c.status}">
      ${glyph(c.glyph, 18)}
      <span class="lbl">${esc(t(GLYPH_LABEL[c.glyph]))}</span>
      ${on ? TICK : "<span></span>"}
      ${c.hint ? `<span class="sub">${esc(t(c.hint))}</span>` : ""}
    </button>`;
  }).join("");
  const rule = (name: "onThePhone" | "awayWhenIdle", label: MsgKey, hint?: MsgKey) =>
    `<label class="statusrule"><input type="checkbox" data-rule="${name}" ${prefs[name] ? "checked" : ""}>
      <span>${esc(t(label))}${hint ? `<span class="sub">${esc(t(hint))}</span>` : ""}</span></label>`;
  return `<div id="${MENU_ID}" class="statusmenu" role="dialog" aria-label="${esc(t("presenceMenu.label"))}">
    ${p.support.publish === false ? `<p class="statusnote-off">${esc(t("presenceMenu.noPublish"))}</p>` : ""}
    <div class="sect" id="status-seen">${esc(t("presenceMenu.seen"))}</div>
    <div role="menu" aria-labelledby="status-seen">${items}</div>
    <hr>
    <div class="statusnote">
      <label class="sect" for="status-note">${esc(t("presenceMenu.note"))}</label>
      <div class="row">
        <input id="status-note" type="text" maxlength="140" value="${esc(prefs.note ?? "")}">
        <button type="button" class="iconbtn" data-act="clear-note" aria-label="${esc(t("presenceMenu.clearNote"))}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>
    </div>
    <hr>
    <div class="sect">${esc(t("presenceMenu.auto"))}</div>
    ${rule("onThePhone", "presenceMenu.onThePhone", "presenceMenu.onThePhoneHint")}
    ${rule("awayWhenIdle", "presenceMenu.awayWhenIdle")}
    <p class="statushint">${esc(t("presenceMenu.sleepHint"))}</p>
  </div>`;
}

let open = false;
/** The menu closed giving the focus back: the rebuilt button must take it. */
let refocus = false;
let layer: HTMLElement | null = null;
let detach: (() => void) | null = null;

function button(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-ref="statusbtn"]');
}

function place(): void {
  const b = button();
  if (!layer || !b) return;
  const r = b.getBoundingClientRect();
  layer.style.top = `${Math.round(r.bottom + 6)}px`;
  // anchored to the button's start, kept on screen
  const width = layer.offsetWidth;
  const left = document.dir === "rtl" ? r.right - width : r.left;
  layer.style.left = `${Math.max(8, Math.min(left, window.innerWidth - width - 8))}px`;
}

export function closeStatusMenu(focusButton = false): void {
  if (!open) return;
  open = false;
  detach?.();
  detach = null;
  layer?.remove();
  layer = null;
  const b = button();
  b?.setAttribute("aria-expanded", "false");
  if (focusButton) {
    b?.focus();
    // a choice rebuilds the header, and the button with it
    refocus = true;
    queueMicrotask(() => queueMicrotask(() => (refocus = false)));
  }
}

function openStatusMenu(trix: Trix): void {
  const shown = trix.view()?.presence;
  if (!shown || open) return;
  open = true;
  layer = document.createElement("div");
  layer.className = "statuslayer";
  layer.innerHTML = statusMenuHtml(shown);
  document.body.append(layer);
  place();
  button()?.setAttribute("aria-expanded", "true");

  const items = () => Array.from(layer!.querySelectorAll<HTMLElement>('[role="menuitemradio"]'));
  const choose = (status: ChosenStatus) => {
    trix.presence.setStatus(status);
    // D11: our own change answers a gesture, so it is said out loud
    const now = trix.view()!.presence;
    announce(t("announce.statusChanged", { status: t(GLYPH_LABEL[myGlyph(now)]) }));
    closeStatusMenu(true);
  };
  const note = layer.querySelector<HTMLInputElement>("#status-note")!;
  const commitNote = () => {
    const value = note.value.trim() || null;
    if (value !== trix.view()!.presence.prefs.note) trix.presence.setNote(value);
  };

  const onClick = (e: MouseEvent) => {
    const target = e.target as Element;
    const item = target.closest<HTMLElement>("[data-status]");
    if (item) return choose(item.dataset.status as ChosenStatus);
    if (target.closest('[data-act="clear-note"]')) {
      note.value = "";
      commitNote();
      note.focus();
    }
  };
  const onChange = (e: Event) => {
    const box = e.target as HTMLInputElement;
    if (box.dataset.rule) {
      trix.presence.setRule(box.dataset.rule as "onThePhone" | "awayWhenIdle", box.checked);
    } else if (box === note) {
      commitNote();
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      commitNote();
      return closeStatusMenu(true);
    }
    if (e.target === note && e.key === "Enter") {
      e.preventDefault();
      return commitNote();
    }
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    const go = (i: number) => {
      e.preventDefault();
      list[(i + list.length) % list.length]!.focus();
    };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(list.length - 1);
  };
  // a click anywhere else closes, the button's own included (it toggles)
  const onOutside = (e: PointerEvent) => {
    const target = e.target as Node;
    if (layer?.contains(target) || button()?.contains(target)) return;
    commitNote();
    closeStatusMenu();
  };
  const onFocusOut = (e: FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    if (next && !layer?.contains(next) && !button()?.contains(next)) {
      commitNote();
      closeStatusMenu();
    }
  };

  layer.addEventListener("click", onClick);
  layer.addEventListener("change", onChange);
  layer.addEventListener("keydown", onKey);
  layer.addEventListener("focusout", onFocusOut);
  document.addEventListener("pointerdown", onOutside, true);
  window.addEventListener("resize", place);
  detach = () => {
    document.removeEventListener("pointerdown", onOutside, true);
    window.removeEventListener("resize", place);
  };

  (items().find((i) => i.getAttribute("aria-checked") === "true") ?? items()[0])?.focus();
}

/**
 * After each rebuild of the screen: wire the new button, and keep an open
 * menu anchored to it — or close it if the button is gone (the phone left
 * `ready`, the server refused SUBSCRIBE).
 */
export function wireStatusButton(root: ParentNode, trix: Trix): void {
  const b = root.querySelector<HTMLElement>('[data-ref="statusbtn"]');
  if (!b) {
    closeStatusMenu();
    return;
  }
  if (refocus) {
    refocus = false;
    queueMicrotask(() => b.focus());
  }
  b.addEventListener("click", () => (open ? closeStatusMenu(true) : openStatusMenu(trix)));
  b.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && !open) {
      e.preventDefault();
      openStatusMenu(trix);
    }
  });
  if (open) queueMicrotask(place);
}
