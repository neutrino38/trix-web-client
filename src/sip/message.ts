/**
 * The messaging link: SIP MESSAGE out of any call (RFC 3428), in
 * `text/plain` only (ADR 0008, D1).
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
 * - a body type other than `text/plain`, or a charset other than UTF-8 or
 *   US-ASCII: **415**, before anyone sees it. JsSIP writes the `Accept`
 *   header of a 415 from `C.ACCEPTED_BODY_TYPES`, which the port extends
 *   with `text/plain` (`sip/port.ts`);
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
 * when no answer came (timeout, transport). The body is capped at
 * `MAX_MESSAGE_BYTES` (D2); the caller checks first, and `send()` throws
 * past it, as it does for a target JsSIP cannot parse.
 */

import type { UA } from "jssip";
import { normalizeTarget } from "jssip/lib/Utils.js";

export const MESSAGE_CONTENT_TYPE = "text/plain;charset=UTF-8";

/** D2: RFC 3428 §8 caps the whole request at 1300 bytes; this leaves room for headers. */
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
      /** The `Date` header, when present, readable and not in the future (D8). */
      date: number | null;
      /** Must be called before the event handler returns. Only the first call counts. */
      answer(code: MessageAnswer): void;
    }
  | {
      type: "sip:messageSent";
      id: string;
      /** Final status of the MESSAGE; null when no answer came. */
      status: number | null;
    };

export interface MessagingLink {
  /**
   * Sends `text` to `uri`; the outcome comes back as `sip:messageSent`
   * with this `id`. Throws on an unusable target or a body past
   * `MAX_MESSAGE_BYTES`, and then reports nothing.
   */
  send(id: string, uri: string, text: string): void;
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
export type MessageSender = (uri: string, text: string, done: (status: number | null) => void) => void;

export interface MessagingDeps {
  sender: MessageSender;
  send: (ev: MessagingSipEvent) => void;
  now?: () => number;
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
  const at = Date.parse(header);
  if (Number.isNaN(at) || at > now + DATE_SKEW_MS) return null;
  return at;
}

export function openMessaging(deps: MessagingDeps): OpenMessaging {
  let send: ((ev: MessagingSipEvent) => void) | null = deps.send;
  const now = deps.now ?? Date.now;

  return {
    send(id, uri, text) {
      if (utf8Length(text) > MAX_MESSAGE_BYTES) {
        throw new RangeError(`message of ${utf8Length(text)} bytes, over ${MAX_MESSAGE_BYTES}`);
      }
      if (send === null) return;
      deps.sender(uri, text, (status) => send?.({ type: "sip:messageSent", id, status }));
    },

    receive(req) {
      if (req.body.trim() === "") {
        req.reply(200);
        return;
      }
      if (!readableType(req.contentType)) {
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
        text: req.body,
        date: readDate(req.date, now()),
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
  return (uri, text, done) => {
    // JsSIP would send `MESSAGE undefined` rather than refuse
    if (!normalizeTarget(uri)) throw new TypeError(`invalid SIP target: ${uri}`);
    type Outcome = { response?: { status_code?: number } | null };
    ua.sendMessage(uri, text, {
      contentType: MESSAGE_CONTENT_TYPE,
      eventHandlers: {
        succeeded: (e: Outcome) => done(e.response?.status_code ?? 200),
        // a local failure (timeout, transport) carries no response
        failed: (e: Outcome) => done(e.response?.status_code ?? null),
      },
    } as never);
  };
}
