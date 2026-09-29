/**
 * What a message arriving does outside the thread (ADR 0008, D10, D11):
 * the unread count in the tab title and the favicon, a system
 * notification when the tab is hidden, an announcement for screen
 * readers, and — during a call — the badge at the top of the screen.
 *
 * One watcher on MessagingMachine, which compares what it had with what
 * it has: a message or a held sender it had not seen is news. The first
 * look once the account's vault is read only takes stock — what was in
 * the vault is not news.
 *
 * The badge lives outside `#app`, like the announcement region: the call
 * screen is rebuilt on phone transitions only, and a message moves no
 * phone state. It opens nothing and leaves nothing: it says there is
 * something to read at the hang-up.
 */

import { t, tn } from "../i18n/index.js";
import type { MessagingInstance } from "../machines/messaging.js";
import type { PhoneInstance } from "../machines/phone.js";
import { addressKey } from "../sip/uri.js";
import type { MessageEntry } from "../storage/store.js";
import { announce } from "./announce.js";
import { setFaviconUnread } from "./favicon.js";
import { showNotice } from "./notify.js";
import { setTitleUnread } from "./title.js";

/** The favicon dot for unread messages: the accent, not the red of being unreachable. */
const UNREAD_COLOR = "#7B54A0";

/** What the badge says (D10); null: nothing to say. */
export function badgeText(
  messages: readonly MessageEntry[],
  strangers: number,
  nameOf: (key: string) => string,
): string | null {
  const unread = messages.filter((m) => !m.read);
  if (unread.length > 0) {
    const senders = new Set(unread.map((m) => m.key));
    if (senders.size === 1) return tn("message.badge", unread.length, { name: nameOf(unread[0]!.key) });
    return tn("message.badgeMany", unread.length);
  }
  return strangers > 0 ? t("message.badgeStranger") : null;
}

let badge: HTMLElement | null = null;

function showBadge(text: string | null): void {
  if (text === null) {
    badge?.remove();
    badge = null;
    return;
  }
  if (!badge) {
    badge = document.createElement("p");
    badge.className = "msg-badge";
    // said once per message by `announce`; the badge itself stays quiet
    badge.setAttribute("aria-hidden", "true");
    document.body.append(badge);
  }
  badge.textContent = text;
}

/** Wires the alerts to a running messaging machine; returns the unsubscribe. */
export function watchMessageAlerts(
  phone: PhoneInstance,
  messaging: MessagingInstance,
  openKey: () => string | null,
): () => void {
  let seen: Set<string> | null = null;
  let held = new Set<string>();
  let account: string | null = null;

  const nameOf = (key: string): string =>
    phone.context.contacts.find((c) => addressKey(c.uri) === key)?.name ?? key;

  const step = () => {
    const ctx = messaging.context;
    // another account: its vault is not news either
    if (ctx.accountId !== account) {
      account = ctx.accountId;
      seen = null;
    }
    const incoming = ctx.messages.filter((m) => m.direction === "incoming");
    const fresh = seen === null ? [] : incoming.filter((m) => !seen!.has(m.id) && !m.read);
    // the first look after the vault is read takes stock, and tells nothing
    if (ctx.loaded) seen = new Set(incoming.map((m) => m.id));
    const strangers = ctx.quarantine.filter((q) => !held.has(q.key));
    held = new Set(ctx.quarantine.map((q) => q.key));

    const unread = incoming.filter((m) => !m.read).length;
    setTitleUnread(unread);
    setFaviconUnread(unread > 0 ? UNREAD_COLOR : null);
    showBadge(ctx.inCall ? badgeText(ctx.messages, ctx.quarantine.length, nameOf) : null);

    const hidden = document.visibilityState !== "visible";
    for (const m of fresh) {
      const name = nameOf(m.key);
      if (hidden) {
        showNotice({ title: name, body: m.text, tag: `trix-message-${m.key}`, keep: false });
      }
      if (ctx.inCall) announce(t("message.announce", { name }));
      else if (!hidden && openKey() === m.key) announce(t("message.announceText", { name, text: m.text }));
    }
    for (const q of strangers) {
      // never the text of an unknown sender on a lock screen
      if (hidden) {
        showNotice({
          title: t("stranger.title"),
          body: t("message.notifyStranger"),
          tag: `trix-stranger-${q.key}`,
          keep: false,
        });
      }
      if (ctx.inCall) announce(t("message.badgeStranger"));
    }
  };

  step();
  return messaging.subscribe(step);
}
