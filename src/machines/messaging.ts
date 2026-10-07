/**
 * MessagingMachine — instant messages out of any call (ADR 0008, D12). A
 * peer of PhoneMachine and PresenceMachine: MESSAGEs arrive at any time,
 * in a call included, and `CallBlock` must never see them.
 *
 * The machines never see each other. `main.ts` translates PhoneMachine's
 * transitions into `phone:*` events (`machines/messagingsignals.ts`); the
 * SIP handle carried by `phone:up` hands incoming messages and send
 * outcomes straight to this machine through the link it opens
 * (`SipHandle.messaging`).
 *
 * States:
 * - `off`: no account chosen; nothing to show, nothing taken.
 * - `offline`: an account, not registered. What is written waits as
 *   `pending` and leaves at the next registration (D3).
 * - `online`: registered; the link is open.
 * - `disabled`: `messaging: "no"` in `config.json` (D13).
 *
 * Every state handles every event, spelled out in each — the diagram
 * extractor does not follow a spread: FSL keeps an event no state takes
 * for later, and an incoming MESSAGE must be answered before its handler
 * returns (`sip/message.ts`).
 *
 * ## Who may write (D4, D5)
 *
 * A contact is answered 200 and filed; a blocked one 603, and nothing is
 * kept. So is anyone we wrote to from this device: answering a message
 * of ours must not land in quarantine (ADR 0008, §6). Anyone else is
 * answered 202 and held in memory, never in the vault, until the user
 * accepts, refuses, or two minutes pass from when the prompt was first
 * shown in a visible tab and out of a call.
 *
 * ## Delivered twice, filed once (ADR 0009)
 *
 * A message in CPIM carries an `imdn.Message-ID`. One already filed, or
 * already held, under the same correspondent is answered as the first
 * delivery was — 200 or 202 — and kept once: a sender that resends after
 * a lost answer, or a server that delivers again after a wake-up, does
 * not double it. Bare `text/plain` has no such id, and is filed each time.
 *
 * ## Receipts (ADR 0010)
 *
 * A message filed in the thread owes the delivery receipt its sender asked
 * for; one held in quarantine owes nothing until it is accepted. A read
 * receipt is owed to a contact of the book only, once the line is read. A
 * blocked sender is owed nothing. What is owed while unregistered waits in
 * the vault (`deliveryOwed`, `displayWanted`) and leaves at the next
 * registration. The receipts that come back move our message from
 * "delivered to the server" to "delivered", then "read", never backwards.
 */

import { defineMachine, goto, stay, type Fx, type TaskResult } from "finite-state-language";
import { msg, type Msg } from "../i18n/types.js";
import type { MessagingLink, MessagingSipEvent } from "../sip/message.js";
import type { ImdnStatus, Wanted } from "../sip/imdn.js";
import type { SipHandle } from "../sip/port.js";
import { addressKey } from "../sip/uri.js";
import { COMPOSING_IDLE_MS, COMPOSING_REFRESH_S, REMOTE_REFRESH_S } from "../sip/iscomposing.js";
import { buildFtHttp, type UploadAccount, type UploadFailure, type UploadFile, type UploadResult } from "../sip/ftupload.js";
import {
  capMessages,
  newAccountId,
  type Contact,
  type MessageEntry,
  type SecureStore,
} from "../storage/store.js";

/** D5: how long an unknown sender's prompt stays, from when it is first shown. */
export const QUARANTINE_MS = 2 * 60_000;
/** D5: how many unknown senders are held at once; past this, 480. */
export const MAX_QUARANTINED = 20;

/** What MessagingMachine is told about PhoneMachine (see `messagingsignals.ts`). */
export type MessagingPhoneSignal =
  /** The account in use changed, or its book was first read: load its messages. */
  | { type: "phone:account"; accountId: string | null; contacts: Contact[] }
  /** Registered, from outside the registered corridor. */
  | { type: "phone:up"; handle: SipHandle }
  /** Left the registered corridor: the handle is about to stop. */
  | { type: "phone:down" }
  | { type: "phone:callStarted" }
  | { type: "phone:callEnded" }
  | { type: "phone:contacts"; contacts: Contact[] }
  /** The account's file store and credentials, at choice and at each change (ADR 0012, D1); null: none. */
  | { type: "phone:fileStore"; fileStore: UploadAccount | null };

export type MessagingEvent =
  | MessagingPhoneSignal
  | MessagingSipEvent
  /** Write to `uri`, a normalized SIP address (`sip/uri.ts`). */
  | { type: "ui:send"; uri: string; text: string }
  /** Send `file` to `uri`, with `caption` as its text (ADR 0012, D7, D8). */
  | { type: "ui:sendFile"; uri: string; file: UploadFile; caption?: string }
  /** A key pressed in `uri`'s writing field (ADR 0012, D9). */
  | { type: "ui:typing"; uri: string }
  /** A voice message for `uri` started or stopped being recorded. */
  | { type: "ui:recording"; uri: string; on: boolean }
  /** A peer's `active` ran out, unless renewed since (`until` tells). */
  | { type: "composing:expire"; key: string; until: number }
  /** Our own typing: still going since `stamp`, or over. */
  | { type: "typing:check"; key: string; stamp: number }
  | { type: "ui:retry"; id: string }
  /** The correspondent's line is open in a visible tab. */
  | { type: "ui:read"; key: string }
  /** The prompt's answer: accepted (the contact is added by PhoneMachine), or not. */
  | { type: "ui:acceptSender"; key: string }
  | { type: "ui:refuseSender"; key: string }
  /** Erase the messages of one correspondent, or all of them without `key`. */
  | { type: "ui:clearMessages"; key?: string }
  | { type: "sys:visible"; visible: boolean }
  | { type: "quarantine:expire"; key: string; shownAt: number }
  | TaskResult<"loadMessages", { accountId: string; messages: MessageEntry[] }>
  | TaskResult<"upload", { id: string; result: UploadResult }>;

/** One message held for an unknown sender, with the receipts it will owe once accepted. */
export type HeldMessage = Pick<MessageEntry, "text" | "file" | "at" | "messageId" | "deliveryOwed" | "displayWanted">;

/** An unknown sender and what they wrote, held until the user decides (D5). */
export interface Quarantined {
  key: string;
  uri: string;
  name: string | null;
  messages: HeldMessage[];
  /** When the prompt was first shown; null while it waits its turn. */
  shownAt: number | null;
}

export interface MessagingCtx {
  /** Injected. */
  store: SecureStore;
  /** Injected: false when the deployment turns messaging off (D13). */
  enabled: boolean;
  /** Injected, for the tests. */
  now: () => number;

  accountId: string | null;
  /** The account's vault has been read (or failed to be): what follows is news. */
  loaded: boolean;
  /** In the order they were filed; the thread sorts by `at`. */
  messages: MessageEntry[];
  contacts: Contact[];
  link: MessagingLink | null;
  /** Ids sent and not answered yet. */
  inFlight: string[];
  inCall: boolean;
  visible: boolean;
  /** Oldest first; only the first one is ever shown. */
  quarantine: Quarantined[];
  /** The server answered 405 or 501 to a MESSAGE (D13); reset at each registration. */
  unsupported: boolean;
  /** Saves run one after the other, so an older list never lands last. */
  saving: Promise<void>;
  /** Injected: puts a file on the store (`sip/ftupload.ts`). */
  upload: (account: UploadAccount, file: UploadFile) => Promise<UploadResult>;
  /** The account's file store; null: attachments off (ADR 0012, D1). */
  fileStore: UploadAccount | null;
  /**
   * The files still to upload, by entry id — in memory only: a file is
   * never written to the vault, and one the page lost on reloading fails
   * (`message.reason.fileLost`).
   */
  pendingFiles: Map<string, UploadFile>;
  /** Who is writing to us, by key, and until when (ADR 0012, D9). A new object at each change. */
  composing: Readonly<Record<string, ComposingPeer>>;
  /** What we told each correspondent we are writing, by key. */
  typing: Record<string, OwnTyping>;
}

/** A correspondent writing to us — or recording a voice message — until `until`. */
export interface ComposingPeer {
  voice: boolean;
  until: number;
}

/** Our side of the indicator, for one correspondent. */
interface OwnTyping {
  uri: string;
  voice: boolean;
  /** When `active` last left. */
  lastSent: number;
  /** The last key pressed. */
  lastInput: number;
}

type Ev<T extends MessagingEvent["type"]> = Extract<MessagingEvent, { type: T }>;
type MFx = Fx<MessagingEvent, MessagingCtx>;

// ---- reading ----------------------------------------------------------------

/** Unread incoming messages, by correspondent key. */
export function unreadByKey(messages: readonly MessageEntry[]): Map<string, number> {
  const unread = new Map<string, number>();
  for (const m of messages) if (!m.read) unread.set(m.key, (unread.get(m.key) ?? 0) + 1);
  return unread;
}

/** The prompt to show now, if any (D5). */
export function shownPrompt(ctx: MessagingCtx): Quarantined | null {
  const head = ctx.quarantine[0];
  return head && head.shownAt !== null ? head : null;
}

/** Why a send failed, from its final status (D3); null status: no answer. */
export function failureReason(status: number | null): Msg {
  if (status === null || status === 408) return msg("message.reason.noAnswer");
  if (status === 404 || status === 604) return msg("message.reason.notFound");
  if (status === 480) return msg("message.reason.unreachable");
  if (status === 403 || status === 603) return msg("message.reason.refused");
  if (status === 415) return msg("message.reason.format");
  if (status === 405 || status === 501) return msg("message.reason.unsupported");
  return msg("message.reason.failed", { code: status });
}

// ---- helpers ----------------------------------------------------------------

function save(ctx: MessagingCtx): void {
  const id = ctx.accountId;
  if (id === null) return;
  ctx.messages = capMessages(ctx.messages);
  const snapshot = ctx.messages;
  ctx.saving = ctx.saving.then(() => ctx.store.saveMessages(id, snapshot)).catch(() => {});
}

function contactOf(ctx: MessagingCtx, key: string): Contact | undefined {
  return ctx.contacts.find((c) => addressKey(c.uri) === key);
}

/** A message of this correspondent with this `imdn.Message-ID` is already filed. */
function filed(ctx: MessagingCtx, key: string, messageId: string): boolean {
  return ctx.messages.some((m) => m.key === key && m.messageId === messageId);
}

/** Same, among the messages held for an unknown sender. */
function held(ctx: MessagingCtx, key: string, messageId: string): boolean {
  return ctx.quarantine.some((q) => q.key === key && q.messages.some((m) => m.messageId === messageId));
}

/** The receipts an incoming message will owe (ADR 0010). */
function owed(wants: Wanted): Pick<MessageEntry, "deliveryOwed" | "displayWanted"> {
  return { ...(wants.delivery ? { deliveryOwed: true } : {}), ...(wants.display ? { displayWanted: true } : {}) };
}

/**
 * Sends what is owed and can leave (ADR 0010): delivery receipts to
 * whoever's message is in the thread, read receipts to contacts once
 * read. A blocked sender's debts are forgiven, and so is a read receipt
 * to a correspondent who is not a contact when the line is read. Without
 * a link, everything waits.
 */
function settleReceipts(ctx: MessagingCtx): void {
  const link = ctx.link;
  ctx.messages = ctx.messages.map((m) => {
    if (m.direction !== "incoming" || (!m.deliveryOwed && !m.displayWanted)) return m;
    const { deliveryOwed, displayWanted, ...rest } = m;
    const contact = contactOf(ctx, m.key);
    if (!m.messageId || contact?.blocked) return rest;
    let delivery = deliveryOwed;
    let display = displayWanted;
    if (delivery && link) {
      link.receipt(m.uri, m.messageId, m.at, "delivered");
      delivery = undefined;
    }
    if (display && m.read) {
      if (!contact) display = undefined;
      else if (link) {
        link.receipt(m.uri, m.messageId, m.at, "displayed");
        display = undefined;
      }
    }
    return { ...rest, ...(delivery ? { deliveryOwed: true } : {}), ...(display ? { displayWanted: true } : {}) };
  });
}

/** Someone whose messages go straight to the thread. */
function known(ctx: MessagingCtx, key: string): boolean {
  if (contactOf(ctx, key)) return true;
  return ctx.messages.some((m) => m.key === key && m.direction === "outgoing");
}

function update(ctx: MessagingCtx, id: string, change: Partial<MessageEntry>): void {
  ctx.messages = ctx.messages.map((m) => (m.id === id ? { ...m, ...change } : m));
}

/** Hands one pending message to the link; a refusal of the link fails it at once. */
function dispatch(ctx: MessagingCtx, m: MessageEntry): void {
  if (!ctx.link) return;
  // a file not on the store yet is the upload's to hand over (ADR 0012, D7)
  if (m.file && m.file.url === "") return;
  try {
    if (m.file) ctx.link.sendFile(m.id, m.uri, buildFtHttp(m.file), m.text === "" ? undefined : m.text);
    else ctx.link.send(m.id, m.uri, m.text);
    ctx.inFlight = [...ctx.inFlight, m.id];
  } catch (e) {
    const reason = e instanceof RangeError ? msg("message.reason.tooLong") : msg("message.reason.invalid");
    update(ctx, m.id, { state: "failed", reason });
  }
}

/** Sends whatever waits, in the order it was written. */
function flush(ctx: MessagingCtx): void {
  if (!ctx.link || ctx.unsupported) return;
  for (const m of ctx.messages) {
    if (m.state === "pending" && m.direction === "outgoing" && !ctx.inFlight.includes(m.id)) dispatch(ctx, m);
  }
  save(ctx);
}

/**
 * Shows the next prompt if nothing stands in the way, and starts its two
 * minutes (D5). The timer carries `shownAt`, so a prompt decided in the
 * meantime lets it fall on nothing.
 */
function showNext(ctx: MessagingCtx, fx: MFx): void {
  const head = ctx.quarantine[0];
  if (!head || head.shownAt !== null || ctx.inCall || !ctx.visible) return;
  const shownAt = ctx.now();
  ctx.quarantine = [{ ...head, shownAt }, ...ctx.quarantine.slice(1)];
  fx.delay({ type: "quarantine:expire", key: head.key, shownAt }, QUARANTINE_MS, { sticky: true });
}

function dropQuarantined(ctx: MessagingCtx, key: string): Quarantined | null {
  const held = ctx.quarantine.find((q) => q.key === key) ?? null;
  ctx.quarantine = ctx.quarantine.filter((q) => q.key !== key);
  return held;
}

/** Why an upload failed, as the thread says it (ADR 0012, D7). */
export function uploadReason(failure: UploadFailure): Msg {
  switch (failure) {
    case "tooLarge":
      return msg("message.reason.fileTooLarge");
    case "credentials":
      return msg("message.reason.fileCredentials");
    default:
      return msg("message.reason.fileStore");
  }
}

/**
 * A file written before the page was reloaded, and not uploaded then, is
 * gone: its bytes were in memory only. It fails, said so.
 */
function failLostUploads(ctx: MessagingCtx): void {
  ctx.messages = ctx.messages.map((m) =>
    m.direction === "outgoing" && m.state === "pending" && m.file?.url === "" && !ctx.pendingFiles.has(m.id)
      ? { ...m, state: "failed", reason: msg("message.reason.fileLost") }
      : m,
  );
}

/** Past this, an upload is given up: a photo on a slow uplink, but never a message stuck pending. */
export const UPLOAD_TIMEOUT_MS = 5 * 60_000;

/**
 * Starts uploading the file of entry `id`. The promise carries the id
 * whatever happens — a timeout included — so the entry always learns its
 * fate.
 */
function startUpload(ctx: MessagingCtx, fx: MFx, id: string, store: UploadAccount, file: UploadFile): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<UploadResult>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, failure: "noAnswer", status: null }), UPLOAD_TIMEOUT_MS);
  });
  const result = Promise.race([
    ctx.upload(store, file).catch((): UploadResult => ({ ok: false, failure: "noAnswer", status: null })),
    late,
  ]).finally(() => clearTimeout(timer));
  fx.task(
    result.then((r) => ({ id, result: r })),
    "upload",
    { timeout: UPLOAD_TIMEOUT_MS + 5_000 },
  );
}

/** A correspondent stops being shown as writing. */
function quiet(ctx: MessagingCtx, key: string): void {
  if (!(key in ctx.composing)) return;
  const { [key]: _gone, ...rest } = ctx.composing;
  ctx.composing = rest;
}

/** A message left for `key`: what we were writing is in it, nothing more to say (Linphone drops it too). */
function doneTyping(ctx: MessagingCtx, key: string): void {
  delete ctx.typing[key];
}

// ---- handlers ---------------------------------------------------------------

function account(ev: Ev<"phone:account">, ctx: MessagingCtx, fx: MFx) {
  ctx.contacts = ev.contacts;
  if (ev.accountId === ctx.accountId) return stay("same account");
  ctx.accountId = ev.accountId;
  ctx.loaded = false;
  ctx.messages = [];
  ctx.inFlight = [];
  ctx.quarantine = [];
  ctx.pendingFiles = new Map();
  ctx.composing = {};
  ctx.typing = {};
  ctx.link = null;
  if (ev.accountId === null) return goto("off", "no account");
  const id = ev.accountId;
  fx.task(
    ctx.store.loadMessages(id).then((messages) => ({ accountId: id, messages })),
    "loadMessages",
    { timeout: 3000 },
  );
  return goto("offline", "account chosen");
}

/**
 * The vault's messages, under whatever arrived or was written while they
 * were read. A message still `pending` in the vault leaves again: the
 * vault does not know whether it was in flight when the page went away,
 * so one that was — a window of a few seconds — may arrive twice.
 */
function loaded(ev: Ev<"task:loadMessages">, ctx: MessagingCtx) {
  if (ev.ok && ev.value.accountId !== ctx.accountId) return stay("messages not for us");
  ctx.loaded = true;
  if (!ev.ok) return stay("vault unreadable");
  const ids = new Set(ev.value.messages.map((m) => m.id));
  const delivered = new Set(ev.value.messages.flatMap((m) => (m.messageId ? [`${m.key} ${m.messageId}`] : [])));
  // filed while the vault was read, and already in it: delivered twice (ADR 0009)
  const fresh = ctx.messages.filter((m) => !ids.has(m.id) && !(m.messageId && delivered.has(`${m.key} ${m.messageId}`)));
  ctx.messages = [...ev.value.messages, ...fresh];
  failLostUploads(ctx);
  settleReceipts(ctx);
  flush(ctx);
  return stay("messages loaded");
}

function up(ev: Ev<"phone:up">, ctx: MessagingCtx, fx: MFx) {
  if (ctx.accountId === null) return stay("no account");
  ctx.unsupported = false;
  ctx.inFlight = [];
  ctx.link = ev.handle.messaging((e) => fx.send(e));
  settleReceipts(ctx);
  flush(ctx);
  return goto("online", "registered");
}

function down(_ev: Ev<"phone:down">, ctx: MessagingCtx) {
  ctx.link = null;
  // their outcome will never come: say so, rather than send twice (D3)
  for (const id of ctx.inFlight) update(ctx, id, { state: "failed", reason: msg("message.reason.interrupted") });
  ctx.inFlight = [];
  save(ctx);
  return goto("offline", "unregistered");
}

function contactsChanged(ev: Ev<"phone:contacts">, ctx: MessagingCtx, fx: MFx) {
  ctx.contacts = ev.contacts;
  // a sender added from elsewhere (the thread, another prompt) is no longer unknown
  for (const q of [...ctx.quarantine]) {
    const c = contactOf(ctx, q.key);
    if (!c) continue;
    dropQuarantined(ctx, q.key);
    if (!c.blocked) fileAll(ctx, q);
  }
  settleReceipts(ctx);
  save(ctx);
  showNext(ctx, fx);
  return stay("contacts changed");
}

/** A held sender's messages enter the thread, unread, at their arrival time. */
function fileAll(ctx: MessagingCtx, q: Quarantined): void {
  ctx.messages = [
    ...ctx.messages,
    ...q.messages.map(
      (m): MessageEntry => ({
        id: newAccountId(),
        key: q.key,
        uri: q.uri,
        direction: "incoming",
        text: m.text,
        ...(m.file ? { file: m.file } : {}),
        at: m.at,
        ...(m.messageId ? { messageId: m.messageId } : {}),
        ...(m.deliveryOwed ? { deliveryOwed: true } : {}),
        ...(m.displayWanted ? { displayWanted: true } : {}),
        state: "received",
        reason: null,
        read: false,
      }),
    ),
  ];
}

/** D4: the answer is chosen here, before this handler returns. */
function received(ev: Ev<"sip:message">, ctx: MessagingCtx, fx: MFx) {
  const key = addressKey(ev.from);
  if (key === null || ctx.accountId === null) {
    ev.answer(480);
    return stay("message with nowhere to go");
  }
  // what they were writing has arrived
  quiet(ctx, key);
  const at = ev.date ?? ctx.now();
  const contact = contactOf(ctx, key);
  if (contact?.blocked) {
    ev.answer(603);
    return stay("blocked sender");
  }
  const messageId = ev.messageId ?? undefined;
  if (messageId !== undefined && filed(ctx, key, messageId)) {
    ev.answer(200);
    return stay("message already filed");
  }
  if (messageId !== undefined && held(ctx, key, messageId)) {
    ev.answer(202);
    return stay("message already held");
  }
  const file = ev.file ? { file: ev.file } : {};
  const one: HeldMessage = { text: ev.text, ...file, at, ...(messageId !== undefined ? { messageId } : {}), ...owed(ev.wants) };
  if (known(ctx, key)) {
    ev.answer(200);
    const entry: MessageEntry = {
      id: newAccountId(),
      key,
      uri: ev.from,
      direction: "incoming",
      text: ev.text,
      ...file,
      at,
      ...(messageId !== undefined ? { messageId } : {}),
      ...owed(ev.wants),
      state: "received",
      reason: null,
      read: false,
    };
    ctx.messages = [...ctx.messages, entry];
    settleReceipts(ctx);
    save(ctx);
    return stay("message filed");
  }
  const holding = ctx.quarantine.find((q) => q.key === key);
  if (holding) {
    ev.answer(202);
    ctx.quarantine = ctx.quarantine.map((q) => (q === holding ? { ...q, messages: [...q.messages, one] } : q));
    return stay("more from a held sender");
  }
  if (ctx.quarantine.length >= MAX_QUARANTINED) {
    ev.answer(480);
    return stay("quarantine full");
  }
  ev.answer(202);
  ctx.quarantine = [...ctx.quarantine, { key, uri: ev.from, name: ev.name, messages: [one], shownAt: null }];
  showNext(ctx, fx);
  return stay("unknown sender held");
}

function sent(ev: Ev<"sip:messageSent">, ctx: MessagingCtx) {
  if (!ctx.inFlight.includes(ev.id)) return stay("outcome of a message no longer in flight");
  ctx.inFlight = ctx.inFlight.filter((id) => id !== ev.id);
  // a receipt that came first says it arrived, whatever the answer says
  const ok = (ev.status !== null && ev.status >= 200 && ev.status < 300) || !!ctx.messages.find((m) => m.id === ev.id)?.receipt;
  update(ctx, ev.id, ok ? { state: "sent", reason: null } : { state: "failed", reason: failureReason(ev.status) });
  if (ev.status === 405 || ev.status === 501) ctx.unsupported = true;
  save(ctx);
  return stay(ok ? "message sent" : "message failed");
}

const RECEIPT_RANK: Record<ImdnStatus, number> = { delivered: 1, displayed: 2 };

/** A receipt counts only from the one we wrote to, about what we wrote them (ADR 0010). */
function receiptCame(ev: Ev<"sip:receipt">, ctx: MessagingCtx) {
  const key = addressKey(ev.from);
  const m = ctx.messages.find((x) => x.id === ev.messageId && x.direction === "outgoing" && x.key === key);
  if (!m) return stay("receipt for nothing of ours");
  if (m.receipt && RECEIPT_RANK[m.receipt] >= RECEIPT_RANK[ev.status]) return stay("receipt already known");
  // it arrived: a failure said otherwise only for want of an answer
  update(ctx, m.id, m.state === "failed" ? { receipt: ev.status, state: "sent", reason: null } : { receipt: ev.status });
  save(ctx);
  return stay(ev.status === "displayed" ? "message read" : "message delivered");
}

function write(ev: Ev<"ui:send">, ctx: MessagingCtx) {
  const key = addressKey(ev.uri);
  const text = ev.text.trim();
  if (key === null || text === "" || ctx.accountId === null) return stay("nothing to send");
  if (ctx.unsupported) return stay("server does not route messages");
  const entry: MessageEntry = {
    id: newAccountId(),
    key,
    uri: ev.uri,
    direction: "outgoing",
    text,
    at: ctx.now(),
    state: "pending",
    reason: null,
    read: true,
  };
  ctx.messages = [...ctx.messages, entry];
  dispatch(ctx, entry);
  doneTyping(ctx, key);
  save(ctx);
  return stay("message written");
}

/** A file to send: an entry at once, pending, while the store takes it (ADR 0012, D7). */
function writeFile(ev: Ev<"ui:sendFile">, ctx: MessagingCtx, fx: MFx) {
  const key = addressKey(ev.uri);
  const store = ctx.fileStore;
  if (key === null || ctx.accountId === null || store === null) return stay("nowhere to send a file");
  if (ctx.unsupported) return stay("server does not route messages");
  const caption = ev.caption?.trim() ?? "";
  const entry: MessageEntry = {
    id: newAccountId(),
    key,
    uri: ev.uri,
    direction: "outgoing",
    text: caption,
    file: {
      url: "",
      name: ev.file.name,
      size: ev.file.data.size,
      contentType: ev.file.type,
      until: null,
      playingLengthMs: ev.file.playingLengthMs ?? null,
    },
    at: ctx.now(),
    state: "pending",
    reason: null,
    read: true,
  };
  ctx.messages = [...ctx.messages, entry];
  ctx.pendingFiles.set(entry.id, ev.file);
  doneTyping(ctx, key);
  startUpload(ctx, fx, entry.id, store, ev.file);
  save(ctx);
  return stay("file written");
}

/** The store answered: the entry learns its URL and leaves, or fails with the store's reason. */
function uploaded(ev: Ev<"task:upload">, ctx: MessagingCtx) {
  // startUpload's promise never rejects and ends on its own bound, with
  // the id: a failed task is a bug, and there is no entry to tell
  if (!ev.ok) return stay("upload task failed");
  const { id, result } = ev.value;
  const m = ctx.messages.find((x) => x.id === id);
  if (!m || !m.file) return stay("upload of a message no longer here");
  if (!result.ok) {
    update(ctx, id, { state: "failed", reason: uploadReason(result.failure) });
    save(ctx);
    return stay("upload refused");
  }
  ctx.pendingFiles.delete(id);
  update(ctx, id, { file: result.file });
  const fresh = ctx.messages.find((x) => x.id === id)!;
  dispatch(ctx, fresh);
  save(ctx);
  return stay("file uploaded");
}

function retry(ev: Ev<"ui:retry">, ctx: MessagingCtx, fx: MFx) {
  const m = ctx.messages.find((x) => x.id === ev.id);
  if (!m || m.state !== "failed") return stay("nothing to retry");
  // it goes back to the end of the conversation, as if written now
  ctx.messages = [...ctx.messages.filter((x) => x.id !== m.id), { ...m, state: "pending", reason: null, at: ctx.now() }];
  // a file the store never took is uploaded again, if the page still has it
  if (m.file?.url === "") {
    const file = ctx.pendingFiles.get(m.id);
    if (!file || ctx.fileStore === null) {
      update(ctx, m.id, { state: "failed", reason: msg("message.reason.fileLost") });
      save(ctx);
      return stay("file lost");
    }
    startUpload(ctx, fx, m.id, ctx.fileStore, file);
    save(ctx);
    return stay("file retried");
  }
  flush(ctx);
  return stay("message retried");
}

function fileStoreChanged(ev: Ev<"phone:fileStore">, ctx: MessagingCtx) {
  ctx.fileStore = ev.fileStore;
  return stay(ev.fileStore ? "file store known" : "no file store");
}

/**
 * A correspondent writes, records, or stopped (ADR 0012, D9). Shown only
 * for a line of ours — a stranger's indicator says nothing to show.
 */
function composingCame(ev: Ev<"sip:composing">, ctx: MessagingCtx, fx: MFx) {
  const key = addressKey(ev.from);
  if (key === null || !known(ctx, key) || contactOf(ctx, key)?.blocked) return stay("indicator from no line of ours");
  if (!ev.active) {
    quiet(ctx, key);
    return stay("peer stopped writing");
  }
  const until = ctx.now() + (ev.refreshS ?? REMOTE_REFRESH_S) * 1000;
  ctx.composing = { ...ctx.composing, [key]: { voice: ev.voice, until } };
  fx.delay({ type: "composing:expire", key, until }, until - ctx.now(), { sticky: true });
  return stay(ev.voice ? "peer recording" : "peer writing");
}

function composingExpire(ev: Ev<"composing:expire">, ctx: MessagingCtx) {
  if (ctx.composing[ev.key]?.until !== ev.until) return stay("indicator renewed since");
  quiet(ctx, ev.key);
  return stay("peer indicator ran out");
}

/** A key pressed: `active` if not said within the refresh, and a check for silence. */
function typingInput(ev: Ev<"ui:typing">, ctx: MessagingCtx, fx: MFx) {
  const key = addressKey(ev.uri);
  if (key === null || ctx.accountId === null) return stay("typing to nobody");
  const now = ctx.now();
  const own = ctx.typing[key];
  if (own?.voice) return stay("recording, not typing");
  if (!own || now - own.lastSent >= COMPOSING_REFRESH_S * 1000) {
    ctx.link?.composing(ev.uri, true);
    ctx.typing[key] = { uri: ev.uri, voice: false, lastSent: now, lastInput: now };
  } else {
    own.lastInput = now;
  }
  fx.delay({ type: "typing:check", key, stamp: now }, COMPOSING_IDLE_MS, { sticky: true });
  return stay("typing");
}

/** Silence since `stamp`: typing is over, said `idle`. A recording is renewed instead. */
function typingCheck(ev: Ev<"typing:check">, ctx: MessagingCtx, fx: MFx) {
  const own = ctx.typing[ev.key];
  if (!own) return stay("nothing being written");
  if (own.voice) {
    if (ev.stamp !== own.lastSent) return stay("renewed since");
    const now = ctx.now();
    ctx.link?.composing(own.uri, true, true);
    own.lastSent = now;
    fx.delay({ type: "typing:check", key: ev.key, stamp: now }, COMPOSING_REFRESH_S * 1000, { sticky: true });
    return stay("still recording");
  }
  if (ev.stamp !== own.lastInput) return stay("typed since");
  ctx.link?.composing(own.uri, false);
  delete ctx.typing[ev.key];
  return stay("typing over");
}

/** A voice message recorded for `uri`: `active` with its type while it lasts (design §9.2). */
function recording(ev: Ev<"ui:recording">, ctx: MessagingCtx, fx: MFx) {
  const key = addressKey(ev.uri);
  if (key === null || ctx.accountId === null) return stay("recording for nobody");
  const now = ctx.now();
  if (ev.on) {
    ctx.link?.composing(ev.uri, true, true);
    ctx.typing[key] = { uri: ev.uri, voice: true, lastSent: now, lastInput: now };
    fx.delay({ type: "typing:check", key, stamp: now }, COMPOSING_REFRESH_S * 1000, { sticky: true });
    return stay("recording");
  }
  // stopped: sent (the message says the rest) or cancelled (said idle)
  if (ctx.typing[key]?.voice) {
    delete ctx.typing[key];
    ctx.link?.composing(ev.uri, false);
  }
  return stay("recording over");
}

function markRead(ev: Ev<"ui:read">, ctx: MessagingCtx) {
  if (!ctx.messages.some((m) => m.key === ev.key && !m.read)) return stay("nothing unread");
  ctx.messages = ctx.messages.map((m) => (m.key === ev.key && !m.read ? { ...m, read: true } : m));
  settleReceipts(ctx);
  save(ctx);
  return stay("messages read");
}

/**
 * Erases one correspondent's messages, or all of them. What is owed and can
 * leave now leaves first; what still waits for a registration is forgiven
 * with the message. A message in flight is erased too: its outcome will
 * fall on nothing. A stranger we wrote to becomes a stranger again — their
 * next message is held (D5).
 */
function clearMessages(ev: Ev<"ui:clearMessages">, ctx: MessagingCtx) {
  const key = ev.key;
  const erased = (m: MessageEntry) => key === undefined || m.key === key;
  if (!ctx.messages.some(erased)) return stay("nothing to clear");
  settleReceipts(ctx);
  const gone = new Set(ctx.messages.filter(erased).map((m) => m.id));
  ctx.messages = ctx.messages.filter((m) => !gone.has(m.id));
  ctx.inFlight = ctx.inFlight.filter((id) => !gone.has(id));
  save(ctx);
  return stay(key === undefined ? "messages cleared" : "conversation cleared");
}

function accept(ev: Ev<"ui:acceptSender">, ctx: MessagingCtx, fx: MFx) {
  const held = dropQuarantined(ctx, ev.key);
  if (held) fileAll(ctx, held);
  settleReceipts(ctx);
  save(ctx);
  showNext(ctx, fx);
  return stay("sender accepted");
}

function refuse(ev: Ev<"ui:refuseSender">, ctx: MessagingCtx, fx: MFx) {
  dropQuarantined(ctx, ev.key);
  showNext(ctx, fx);
  return stay("sender refused");
}

function expire(ev: Ev<"quarantine:expire">, ctx: MessagingCtx, fx: MFx) {
  const held = ctx.quarantine.find((q) => q.key === ev.key);
  if (!held || held.shownAt !== ev.shownAt) return stay("prompt already decided");
  dropQuarantined(ctx, ev.key);
  showNext(ctx, fx);
  return stay("prompt expired");
}

function callStarted(_ev: MessagingEvent, ctx: MessagingCtx) {
  ctx.inCall = true;
  return stay("in a call");
}

function callEnded(_ev: MessagingEvent, ctx: MessagingCtx, fx: MFx) {
  ctx.inCall = false;
  showNext(ctx, fx);
  return stay("call ended");
}

function visibility(ev: Ev<"sys:visible">, ctx: MessagingCtx, fx: MFx) {
  ctx.visible = ev.visible;
  showNext(ctx, fx);
  return stay(ev.visible ? "tab visible" : "tab hidden");
}

export const MessagingMachine = defineMachine<MessagingCtx, MessagingEvent>()({
  name: "MessagingMachine",

  context: () => ({
    store: undefined as unknown as SecureStore,
    enabled: true,
    now: Date.now,
    accountId: null,
    loaded: false,
    messages: [],
    contacts: [],
    link: null,
    inFlight: [],
    inCall: false,
    visible: true,
    quarantine: [],
    unsupported: false,
    saving: Promise.resolve(),
    upload: () => Promise.resolve({ ok: false, failure: "noAnswer", status: null } as UploadResult),
    fileStore: null,
    pendingFiles: new Map(),
    composing: {},
    typing: {},
  }),

  states: {
    initial_state: {
      enter(ctx) {
        return ctx.enabled ? goto("off") : goto("disabled", "messaging turned off");
      },
    },

    off: {
      on: {
        "phone:account": account,
        "phone:contacts": contactsChanged,
        "phone:callStarted": callStarted,
        "phone:callEnded": callEnded,
        "sip:message": received,
        "sip:messageSent": sent,
        "sip:receipt": receiptCame,
        "task:loadMessages": loaded,
        "ui:send": write,
        "ui:sendFile": writeFile,
        "task:upload": uploaded,
        "phone:fileStore": fileStoreChanged,
        "sip:composing": composingCame,
        "composing:expire": composingExpire,
        "ui:typing": typingInput,
        "typing:check": typingCheck,
        "ui:recording": recording,
        "ui:retry": retry,
        "ui:read": markRead,
        "ui:acceptSender": accept,
        "ui:refuseSender": refuse,
        "ui:clearMessages": clearMessages,
        "sys:visible": visibility,
        "quarantine:expire": expire,
        "phone:up": () => stay("no account"),
        "phone:down": () => stay("never up"),
      },
    },

    offline: {
      on: {
        "phone:account": account,
        "phone:contacts": contactsChanged,
        "phone:callStarted": callStarted,
        "phone:callEnded": callEnded,
        "sip:message": received,
        "sip:messageSent": sent,
        "sip:receipt": receiptCame,
        "task:loadMessages": loaded,
        "ui:send": write,
        "ui:sendFile": writeFile,
        "task:upload": uploaded,
        "phone:fileStore": fileStoreChanged,
        "sip:composing": composingCame,
        "composing:expire": composingExpire,
        "ui:typing": typingInput,
        "typing:check": typingCheck,
        "ui:recording": recording,
        "ui:retry": retry,
        "ui:read": markRead,
        "ui:acceptSender": accept,
        "ui:refuseSender": refuse,
        "ui:clearMessages": clearMessages,
        "sys:visible": visibility,
        "quarantine:expire": expire,
        "phone:up": up,
        "phone:down": () => stay("already down"),
      },
    },

    online: {
      on: {
        "phone:account": account,
        "phone:contacts": contactsChanged,
        "phone:callStarted": callStarted,
        "phone:callEnded": callEnded,
        "sip:message": received,
        "sip:messageSent": sent,
        "sip:receipt": receiptCame,
        "task:loadMessages": loaded,
        "ui:send": write,
        "ui:sendFile": writeFile,
        "task:upload": uploaded,
        "phone:fileStore": fileStoreChanged,
        "sip:composing": composingCame,
        "composing:expire": composingExpire,
        "ui:typing": typingInput,
        "typing:check": typingCheck,
        "ui:recording": recording,
        "ui:retry": retry,
        "ui:read": markRead,
        "ui:acceptSender": accept,
        "ui:refuseSender": refuse,
        "ui:clearMessages": clearMessages,
        "sys:visible": visibility,
        "quarantine:expire": expire,
        "phone:up": up,
        "phone:down": down,
      },
    },

    disabled: {
      on: {
        "phone:account": () => stay("messaging off"),
        "phone:up": () => stay("messaging off"),
        "phone:down": () => stay("messaging off"),
        "phone:contacts": () => stay("messaging off"),
        "phone:callStarted": () => stay("messaging off"),
        "phone:callEnded": () => stay("messaging off"),
        // the port has no listener then: nothing arrives, but answer anyway
        "sip:message": (ev) => {
          ev.answer(480);
          return stay("messaging off");
        },
        "sip:messageSent": () => stay("messaging off"),
        "sip:receipt": () => stay("messaging off"),
        "task:loadMessages": () => stay("messaging off"),
        "ui:send": () => stay("messaging off"),
        "ui:sendFile": () => stay("messaging off"),
        "sip:composing": () => stay("messaging off"),
        "composing:expire": () => stay("messaging off"),
        "ui:typing": () => stay("messaging off"),
        "typing:check": () => stay("messaging off"),
        "ui:recording": () => stay("messaging off"),
        "task:upload": () => stay("messaging off"),
        "phone:fileStore": () => stay("messaging off"),
        "ui:retry": () => stay("messaging off"),
        "ui:read": () => stay("messaging off"),
        "ui:acceptSender": () => stay("messaging off"),
        "ui:refuseSender": () => stay("messaging off"),
        "ui:clearMessages": () => stay("messaging off"),
        "sys:visible": () => stay("messaging off"),
        "quarantine:expire": () => stay("messaging off"),
      },
    },
  },
});

export type MessagingInstance = ReturnType<typeof MessagingMachine.start>;
