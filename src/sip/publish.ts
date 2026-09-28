/**
 * PUBLISH — event state publication (RFC 3903), which JsSIP does not have
 * (ADR 0007, D2).
 *
 * Two layers. `createPublisher` owns the RFC 3903 cycle and nothing else:
 * it is handed a `PublishSend` and never sees JsSIP. `jssipPublishSend` is
 * that function for a live UA, grafted onto JsSIP's internals the way
 * `sip/digest.ts` is: `OutgoingRequest` builds the request,
 * `RequestSender` runs the transaction and answers the Digest challenge —
 * SHA-256 included, since the graft sits on the class it instantiates.
 *
 * ## The cycle
 *
 * - Initial publication: a body, no `SIP-If-Match`; the answer carries the
 *   `SIP-ETag` that names our publication from then on.
 * - Refresh at 80 % of the granted `Expires`: no body, `SIP-If-Match`.
 * - Modification: `SIP-If-Match` and the new body.
 * - **412** Conditional Request Failed: the server lost our entity tag
 *   (it restarted, or the publication expired while the page was frozen).
 *   We publish from scratch at once — once: a second 412 in a row waits
 *   for the retry delay, like any other failure.
 * - **423** Interval Too Brief: again with the server's `Min-Expires`.
 * - **489**, **405**, **501**: the server does not take PUBLISH. Said once
 *   through `onSupport(false)`, and nothing is ever sent again.
 * - Anything else (no answer, 5xx, an unexpected 4xx): tried again later,
 *   with the latest body.
 * - Withdrawal: `Expires: 0` and `SIP-If-Match`. It must leave before the
 *   un-REGISTER: `RequestSender` refuses to send once the UA is stopping,
 *   whereas `UA.stop()` waits for the transactions already under way.
 *
 * One request at most in flight: a change made while one is pending is
 * sent when it comes back, so the entity tag we hold always names the last
 * answer, never a guess.
 */

import SIPMessage from "jssip/lib/SIPMessage.js";
// @ts-expect-error — JsSIP internal module, no type declarations
import RequestSender from "jssip/lib/RequestSender.js";
import { newUUID } from "jssip/lib/Utils.js";
import { PIDF_CONTENT_TYPE } from "./pidf.js";

/**
 * `OutgoingRequest` as it really is: JsSIP's declaration omits the
 * constructor, which is the only part we use.
 */
const OutgoingRequest = SIPMessage.OutgoingRequest as unknown as new (
  method: string,
  ruri: object,
  ua: object,
  params: { to_uri: object; call_id: string; cseq: number },
  extraHeaders: string[],
  body?: string,
) => object;

/** What goes out: `body` null is a refresh, `expires` 0 a withdrawal. */
export interface PublishRequest {
  body: string | null;
  etag: string | null;
  expires: number;
}

/** What came back. `status` 0: no answer at all (timeout, transport). */
export interface PublishResponse {
  status: number;
  etag: string | null;
  expires: number | null;
  minExpires: number | null;
}

export type PublishSend = (req: PublishRequest) => Promise<PublishResponse>;

export interface Publisher {
  /** Publishes this body, first time or modification. */
  publish(body: string): void;
  /**
   * Withdraws the publication (`Expires: 0`) and stops for good. Sends
   * nothing if nothing was ever accepted.
   */
  withdraw(): void;
  /** Stops for good without sending anything — the UA is already gone. */
  stop(): void;
}

export interface PublisherOptions {
  send: PublishSend;
  /** Called once, on the first answer that settles the question. */
  onSupport: (publish: boolean) => void;
  /** Requested lifetime, in seconds. */
  expires?: number;
  /** Delay before another try after a failure, in milliseconds. */
  retryMs?: number;
}

export const PUBLISH_EXPIRES = 3600;
const RETRY_MS = 60_000;
const REFRESH_AT = 0.8;
/** The server said no to the method itself (ADR 0007, D8). */
const REFUSED = new Set([405, 489, 501]);

export function createPublisher(opts: PublisherOptions): Publisher {
  let expires = opts.expires ?? PUBLISH_EXPIRES;
  const retryMs = opts.retryMs ?? RETRY_MS;

  /** The latest body we were asked to publish. */
  let body: string | null = null;
  let etag: string | null = null;
  /** The body the server holds, as far as we know. */
  let published: string | null = null;
  let inFlight = false;
  let dead = false;
  let supportSaid = false;
  /** A 412 was just answered by publishing from scratch. */
  let recovering = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const say = (publish: boolean) => {
    if (supportSaid) return;
    supportSaid = true;
    opts.onSupport(publish);
  };

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const schedule = (ms: number, refresh: boolean) => {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      // a refresh is only a refresh if the server still holds our body
      if (refresh && published === body) next(true);
      else next(false);
    }, ms);
  };

  /** Sends what is due: a refresh, or the latest body. */
  const next = (refresh: boolean) => {
    if (dead || inFlight || body === null) return;
    const outgoing = refresh && etag !== null ? null : body;
    inFlight = true;
    void opts
      .send({ body: outgoing, etag, expires })
      .catch((): PublishResponse => ({ status: 0, etag: null, expires: null, minExpires: null }))
      .then((res) => {
        inFlight = false;
        if (!dead) answer(res, outgoing ?? published);
      });
  };

  const answer = (res: PublishResponse, sent: string | null) => {
    const { status } = res;
    if (status >= 200 && status < 300) {
      say(true);
      recovering = false;
      // a 2xx without SIP-ETag breaks RFC 3903 §11.3; keeping the old tag
      // is the least bad guess, and a 412 would correct it
      etag = res.etag ?? etag;
      published = sent;
      const granted = res.expires ?? expires;
      if (body !== published) next(false);
      else schedule(granted * 1000 * REFRESH_AT, true);
      return;
    }
    if (REFUSED.has(status)) {
      say(false);
      halt();
      return;
    }
    if (status === 412) {
      etag = null;
      published = null;
      if (recovering) {
        // twice in a row: something else is wrong, wait and see
        recovering = false;
        schedule(retryMs, false);
        return;
      }
      recovering = true;
      next(false);
      return;
    }
    if (status === 423 && res.minExpires !== null && res.minExpires > expires) {
      expires = res.minExpires;
      next(false);
      return;
    }
    schedule(retryMs, false);
  };

  const halt = () => {
    dead = true;
    clearTimer();
  };

  return {
    publish(pidf) {
      if (dead) return;
      body = pidf;
      clearTimer();
      next(false);
    },
    withdraw() {
      if (dead) return;
      const tag = etag;
      halt();
      if (tag !== null) {
        void opts.send({ body: null, etag: tag, expires: 0 }).catch(() => {});
      }
    },
    stop: halt,
  };
}

// ---- JsSIP ------------------------------------------------------------------

/**
 * What the graft touches on a JsSIP response. Written out rather than
 * guessed: on a JsSIP upgrade, this is the list of what to check.
 */
interface JsSipResponse {
  status_code: number;
  cseq: number;
  hasHeader(name: string): boolean;
  getHeader(name: string): string | undefined;
}

/**
 * The JsSIP `UA`, as far as this module reads it. `OutgoingRequest` and
 * `RequestSender` read more; they get the real thing.
 */
export interface JsSipUa {
  /** Our address of record, a JsSIP `URI` — `To` refuses a string. */
  configuration: { uri: object };
}

/**
 * `PublishSend` over a live JsSIP UA, publishing the `presence` event of
 * our own address of record — both the Request-URI and `To`.
 *
 * One Call-ID for the life of the publisher and a CSeq that only goes up,
 * as `Registrator` does for REGISTER: a server may use them to spot a
 * stale request (RFC 3903 does not demand it, RFC 3261 §8.1.1.4 advises it).
 */
export function jssipPublishSend(ua: JsSipUa): PublishSend {
  const aor = ua.configuration.uri;
  const callId = newUUID();
  let cseq = 0;

  return (req) =>
    new Promise<PublishResponse>((resolve) => {
      const headers = ["Event: presence", `Expires: ${req.expires}`];
      if (req.etag !== null) headers.push(`SIP-If-Match: ${req.etag}`);
      if (req.body !== null) headers.push(`Content-Type: ${PIDF_CONTENT_TYPE}`);

      cseq += 1;
      const request = new OutgoingRequest(
        "PUBLISH",
        aor,
        ua,
        { to_uri: aor, call_id: callId, cseq },
        headers,
        req.body ?? undefined,
      );
      const noAnswer = () => resolve({ status: 0, etag: null, expires: null, minExpires: null });

      const sender = new RequestSender(ua, request, {
        onRequestTimeout: noAnswer,
        onTransportError: noAnswer,
        // RequestSender bumped the CSeq of its clone; keep in step
        onAuthenticated: () => {
          cseq += 1;
        },
        onReceiveResponse: (res: JsSipResponse) => {
          if (res.status_code < 200) return;
          resolve({
            status: res.status_code,
            etag: header(res, "SIP-ETag"),
            expires: seconds(header(res, "Expires")),
            minExpires: seconds(header(res, "Min-Expires")),
          });
        },
      });
      sender.send();
    });
}

function header(res: JsSipResponse, name: string): string | null {
  const value = res.hasHeader(name) ? res.getHeader(name)?.trim() : undefined;
  return value ? value : null;
}

function seconds(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  return Number(value);
}
