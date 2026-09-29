/**
 * The messaging link: SIP MESSAGE out of any call (RFC 3428), in
 * `text/plain`, bare or wrapped in CPIM (ADR 0008, D1; ADR 0009).
 *
 * `openMessaging` holds the policy and never sees JsSIP: it is handed a
 * `MessageSender`, and the port feeds it each incoming request as an
 * `IncomingView`. `jssipSender` and `jssipIncoming` are the two ends of a
 * live UA. The link is opened by `SipHandle.messaging(send)` and its
 * events go to that `send` alone — MessagingMachine's, never
 * PhoneMachine's (D12).
 *
 * ## What an incoming MESSAGE gets
 *
 * - an empty body: **200**, and nothing more (D1);
 * - a `message/cpim` body is opened first (`sip/cpim.ts`): **400** when it
 *   cannot be read, **200** and nothing more for an empty part; what
 *   follows applies to the part inside, and its `DateTime`,
 *   `imdn.Message-ID` and the receipts it asks for go with the event
 *   (ADR 0009, ADR 0010);
 * - a receipt (IMDN, `sip/imdn.ts`), alone or gathered in a
 *   `multipart/mixed`: **200**, from anyone, and one `sip:receipt` per
 *   positive receipt it holds — the machine matches it against what we
 *   sent to that sender, and nothing else;
 * - a body type other than `text/plain`, or a charset other than UTF-8 or
 *   US-ASCII: **415**, before anyone sees it. JsSIP writes the `Accept`
 *   header of a 415 from `C.ACCEPTED_BODY_TYPES`, which the port extends
 *   with `text/plain` and `message/cpim` (`sip/port.ts`);
 * - a `From` with no user part: **403** — there is no address to file it
 *   under, nor to answer;
 * - no link open yet, or closed: **480**;
 * - anything else: a `sip:message` event, whose `answer()` the machine
 *   calls before returning — 200, 202, 480 or 603 (D4). JsSIP answers 200
 *   on its own to a request nobody answered, so a machine that did not
 *   choose gets 480 here instead, with a console line: a message nobody
 *   filed must not look delivered.
 *
 * ## What a sent MESSAGE reports
 *
 * One `sip:messageSent` per `send()`, with the final status, or `null`
 * when no answer came (timeout, transport). The text leaves in CPIM, with
 * the caller's id as `imdn.Message-ID`; a correspondent who answers 415
 * gets it again in bare `text/plain`, and so does everything sent to them
 * while this link lives (ADR 0009). CPIM asks for both receipts; they come
 * back as `sip:receipt` (ADR 0010). The text is capped at
 * `MAX_MESSAGE_BYTES` (D2); the caller checks first, and `send()` throws
 * past it, as it does for a target JsSIP cannot parse.
 *
 * ## What a receipt we send reports
 *
 * Nothing: `receipt()` sends an IMDN and forgets it. A lost receipt only
 * leaves the other side's message a step behind, and resending it could
 * only say the same thing again.
 */

import type { UA } from "jssip";
import { normalizeTarget } from "jssip/lib/Utils.js";
import { buildCpim, buildImdnCpim, CPIM_CONTENT_TYPE, isCpim, parseCpim } from "./cpim.js";
import {
  buildImdn,
  imdnBodies,
  NOTHING_WANTED,
  readImdn,
  wantedReceipts,
  type ImdnStatus,
  type Wanted,
} from "./imdn.js";
import type { XmlParser } from "./pidf.js";
import { addressKey } from "./uri.js";

export const MESSAGE_CONTENT_TYPE = "text/plain;charset=UTF-8";

/**
 * D2: RFC 3428 §8 caps the whole request at 1300 bytes; this leaves room
 * for headers. It caps the text: CPIM adds some 200 bytes around it, and
 * the request may then pass 1300 (ADR 0009).
 */
export const MAX_MESSAGE_BYTES = 1000;

/** A clock skew we tolerate before calling a `Date` header "in the future". */
const DATE_SKEW_MS = 60_000;

/** The answers the machine may choose (D4). */
export type MessageAnswer = 200 | 202 | 480 | 603;

export type MessagingSipEvent =
  | {
      type: "sip:message";
      /** `sip:user@host`, without parameters or display name. */
      from: string;
      /** The display name of the `From`, if any. */
      name: string | null;
      text: string;
      /**
       * When it was written: the CPIM `DateTime`, else the `Date` header —
       * when present, readable and not in the future (D8, ADR 0009).
       */
      date: number | null;
      /** The CPIM `imdn.Message-ID`, the same on each delivery of one message; null in bare text. */
      messageId: string | null;
      /** The receipts the sender asks for; none without a `messageId` to name the message by. */
      wants: Wanted;
      /** Must be called before the event handler returns. Only the first call counts. */
      answer(code: MessageAnswer): void;
    }
  | {
      type: "sip:messageSent";
      id: string;
      /** Final status of the MESSAGE; null when no answer came. */
      status: number | null;
    }
  | {
      /** A positive IMDN about one of our messages (ADR 0010). */
      type: "sip:receipt";
      /** The receipt's sender, `sip:user@host`. */
      from: string;
      /** The `imdn.Message-ID` of the message it is about: our entry's id. */
      messageId: string;
      status: ImdnStatus;
    };

export interface MessagingLink {
  /**
   * Sends `text` to `uri`; the outcome comes back as `sip:messageSent`
   * with this `id`. Throws on an unusable target or a body past
   * `MAX_MESSAGE_BYTES`, and then reports nothing.
   */
  send(id: string, uri: string, text: string): void;
  /**
   * Tells `uri` that its message `messageId`, which it dated `at`, was
   * delivered or displayed (ADR 0010). Reports nothing, and never throws.
   */
  receipt(uri: string, messageId: string, at: number, status: ImdnStatus): void;
}

export interface OpenMessaging extends MessagingLink {
  /** Where events go from now on. */
  rebind(send: (ev: MessagingSipEvent) => void): void;
  /** Files an incoming MESSAGE, answering it one way or another. */
  receive(req: IncomingView): void;
  /** No more events; later sends do nothing, and outcomes still in flight are dropped. */
  close(): void;
}

/** An incoming MESSAGE, as the policy reads it. */
export interface IncomingView {
  /** User part of the `From` URI; null when there is none. */
  user: string | null;
  host: string;
  name: string | null;
  contentType: string | null;
  body: string;
  date: string | null;
  reply(code: number): void;
}

/** Sends one MESSAGE; `done` gets its final status, or null for no answer. */
export type MessageSender = (
  uri: string,
  body: string,
  contentType: string,
  done: (status: number | null) => void,
) => void;

export interface MessagingDeps {
  sender: MessageSender;
  /** Our own address, `sip:user@domain`: the CPIM `From`. */
  self: string;
  /** Reads receipts (`sip/imdn.ts`). */
  parser: XmlParser;
  send: (ev: MessagingSipEvent) => void;
  now?: () => number;
  /** The `imdn.Message-ID` of a receipt we send. */
  newId?: () => string;
}

/** Length of `text` once encoded in UTF-8. */
export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Is this body type one we display (D1)? A body without a type is not: RFC 3428 requires one. */
export function readableType(contentType: string | null): boolean {
  if (contentType === null) return false;
  const [type, ...params] = contentType.split(";").map((p) => p.trim().toLowerCase());
  if (type !== "text/plain") return false;
  for (const p of params) {
    const [name, value] = p.split("=").map((s) => s.trim().replace(/^"|"$/g, ""));
    if (name === "charset" && value !== "utf-8" && value !== "us-ascii") return false;
  }
  return true;
}

/** The `Date` header as epoch ms; null when absent, unreadable, or in the future. */
export function readDate(header: string | null, now: number): number | null {
  if (header === null) return null;
  return notFuture(Date.parse(header), now);
}

function notFuture(at: number | null, now: number): number | null {
  if (at === null || Number.isNaN(at) || at > now + DATE_SKEW_MS) return null;
  return at;
}

export function openMessaging(deps: MessagingDeps): OpenMessaging {
  let send: ((ev: MessagingSipEvent) => void) | null = deps.send;
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  /** Correspondents who refused CPIM with 415: bare text from then on. */
  const plainOnly = new Set<string>();

  /** Receipts are taken from anyone; the machine only matches them against what we sent. */
  function receiveReceipts(req: IncomingView, bodies: string[]): void {
    if (req.user === null || req.user === "") {
      req.reply(403);
      return;
    }
    if (send === null) {
      req.reply(480);
      return;
    }
    req.reply(200);
    const from = `sip:${req.user}@${req.host.toLowerCase()}`;
    for (const xml of bodies) {
      const r = readImdn(xml, deps.parser);
      if (r) send?.({ type: "sip:receipt", from, ...r });
    }
  }

  return {
    send(id, uri, text) {
      if (utf8Length(text) > MAX_MESSAGE_BYTES) {
        throw new RangeError(`message of ${utf8Length(text)} bytes, over ${MAX_MESSAGE_BYTES}`);
      }
      if (send === null) return;
      const report = (status: number | null) => send?.({ type: "sip:messageSent", id, status });
      const key = addressKey(uri) ?? uri;
      const plain = () => deps.sender(uri, text, MESSAGE_CONTENT_TYPE, report);
      if (plainOnly.has(key)) {
        plain();
        return;
      }
      const cpim = buildCpim({ from: deps.self, to: uri, at: now(), messageId: id, text });
      deps.sender(uri, cpim, CPIM_CONTENT_TYPE, (status) => {
        // refused before anyone read it: sending again cannot make it arrive twice
        if (status === 415 && send !== null) {
          plainOnly.add(key);
          plain();
        } else report(status);
      });
    },

    receipt(uri, messageId, at, status) {
      const key = addressKey(uri);
      // no receipt to someone who refused CPIM: it would be refused too
      if (send === null || key === null || plainOnly.has(key)) return;
      const xml = buildImdn({ messageId, at, status });
      const body = buildImdnCpim({ from: deps.self, to: uri, at: now(), messageId: newId(), xml });
      try {
        deps.sender(uri, body, CPIM_CONTENT_TYPE, () => {});
      } catch {
        // an address that came in on a MESSAGE and cannot go out again: nothing to tell
      }
    },

    receive(req) {
      if (req.body.trim() === "") {
        req.reply(200);
        return;
      }
      let contentType = req.contentType;
      let body = req.body;
      let date = readDate(req.date, now());
      let messageId: string | null = null;
      let wants = NOTHING_WANTED;
      if (isCpim(contentType)) {
        const cpim = parseCpim(body);
        if (cpim === null) {
          req.reply(400);
          return;
        }
        const receipts = imdnBodies(cpim.contentType, cpim.body);
        if (receipts !== null) {
          receiveReceipts(req, receipts);
          return;
        }
        if (cpim.body.trim() === "") {
          req.reply(200);
          return;
        }
        contentType = cpim.contentType;
        body = cpim.body;
        date = notFuture(cpim.dateTime, now()) ?? date;
        messageId = cpim.messageId;
        if (messageId !== null) wants = wantedReceipts(cpim.disposition);
      }
      if (!readableType(contentType)) {
        req.reply(415);
        return;
      }
      if (req.user === null || req.user === "") {
        req.reply(403);
        return;
      }
      if (send === null) {
        req.reply(480);
        return;
      }
      let answered = false;
      const from = `sip:${req.user}@${req.host.toLowerCase()}`;
      send({
        type: "sip:message",
        from,
        name: req.name,
        text: body,
        date,
        messageId,
        wants,
        answer(code) {
          if (answered) return;
          answered = true;
          req.reply(code);
        },
      });
      if (!answered) {
        answered = true;
        console.warn(`[trix] MESSAGE de ${from} : aucune réponse choisie, 480`);
        req.reply(480);
      }
    },

    rebind(next) {
      if (send !== null) send = next;
    },

    close() {
      send = null;
    },
  };
}

/** A link that does nothing: before registration, or after `stop()`. */
export const NO_MESSAGING: OpenMessaging = {
  send() {},
  receipt() {},
  receive(req) {
    req.reply(480);
  },
  rebind() {},
  close() {},
};

// ---- JsSIP ------------------------------------------------------------------

/**
 * The part of JsSIP's `newMessage` event we read (types omit most of it),
 * including one private field: `Message.accept()` can only say 200, and
 * the quarantine answers 202 (D5). So the answer goes to the request
 * itself, and `_is_replied` tells the `Message` it was given — otherwise
 * it would send its own 200 once the event returns.
 */
export interface JsSipMessageEvent {
  originator: "local" | "remote";
  request: {
    from?: { display_name?: string | null; uri?: { user?: string | null; host?: string } };
    body?: string | null;
    getHeader(name: string): string | undefined;
    reply(code: number): void;
  };
  message: { _is_replied: boolean };
}

/** An incoming request as `receive()` wants it. */
export function jssipIncoming(e: JsSipMessageEvent): IncomingView {
  const from = e.request.from;
  const name = from?.display_name?.trim();
  return {
    user: from?.uri?.user ?? null,
    host: from?.uri?.host ?? "",
    name: name ? name : null,
    contentType: e.request.getHeader("content-type") ?? null,
    body: e.request.body ?? "",
    date: e.request.getHeader("date") ?? null,
    reply(code) {
      e.message._is_replied = true;
      e.request.reply(code);
    },
  };
}

/** The `MessageSender` of a live UA. */
export function jssipSender(ua: UA): MessageSender {
  return (uri, body, contentType, done) => {
    // JsSIP would send `MESSAGE undefined` rather than refuse
    if (!normalizeTarget(uri)) throw new TypeError(`invalid SIP target: ${uri}`);
    type Outcome = { response?: { status_code?: number } | null };
    ua.sendMessage(uri, body, {
      contentType,
      eventHandlers: {
        succeeded: (e: Outcome) => done(e.response?.status_code ?? 200),
        // a local failure (timeout, transport) carries no response
        failed: (e: Outcome) => done(e.response?.status_code ?? null),
      },
    } as never);
  };
}
