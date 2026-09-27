/**
 * The presence link: one subscription per contact (RFC 3856, RFC 6665),
 * our own publication (`sip/publish.ts`), and the discovery of what the
 * server takes (ADR 0007, D3 and D8).
 *
 * `openPresence` holds the policy and never sees JsSIP: it is handed a
 * `Watcher`, which opens one subscription and reports how it goes, and a
 * `Publisher`. `jssipWatcher` is the `Watcher` of a live UA. The link is
 * opened by `SipHandle.presence(send)` and its events go to that `send`
 * alone — PresenceMachine's, never PhoneMachine's (D12).
 *
 * ## Discovery
 *
 * The server's answer to the first SUBSCRIBE settles the question for
 * this registration: a 2xx says yes, 489, 405 or 501 say no — and then
 * every subscription stops and no SUBSCRIBE leaves again until the next
 * link. Same for PUBLISH, through the publisher. Each is said once, as
 * `sip:presenceSupport`. Any other refusal (403, 404…) is about that one
 * contact, not about the server.
 *
 * ## How a subscription ends (RFC 6665 §4.1.3)
 *
 * - `rejected`, `noresource`, `invariant`, or a 4xx other than the
 *   refusals above: the contact reads `unknown`, and we do not insist.
 * - `deactivated`, `timeout`, or no reason: subscribe again at once — the
 *   server moved the subscription, it did not refuse it.
 * - `probation`, `giveup`, no answer, a 5xx: subscribe again later, after
 *   `retry-after` when the server gave one.
 * Every renewal that is not followed by a NOTIFY doubles the next delay,
 * so a server that keeps ending subscriptions is not flooded.
 */

import type { UA } from "jssip";
import { normalizeTarget } from "jssip/lib/Utils.js";
import {
  readPidf,
  UNKNOWN,
  writePidf,
  PIDF_CONTENT_TYPE,
  type PresenceInfo,
  type PublishedPresence,
  type XmlParser,
} from "./pidf.js";
import type { Publisher } from "./publish.js";

export type PresenceSipEvent =
  | {
      type: "sip:presence";
      uri: string;
      info: PresenceInfo;
      /** The subscription waits for the contact's consent (`pending`). */
      pending: boolean;
    }
  | {
      type: "sip:presenceSupport";
      method: "subscribe" | "publish";
      supported: boolean;
    };

/** What we publish about ourselves. Invisible is `offline` (D4). */
export interface PublishedInfo {
  state: PublishedPresence;
  note: string | null;
  since: number | null;
}

export interface PresenceLink {
  /** Subscribes to this contact's presence. Idempotent. */
  watch(uri: string): void;
  /** Ends the subscription, if any. */
  unwatch(uri: string): void;
  /** Publishes our own presence. */
  publish(info: PublishedInfo): void;
}

/** How a subscription ended, as far as the policy cares. */
export type WatchEnd =
  /** A final non-2xx answer to the SUBSCRIBE (401/407: the challenge failed). */
  | { kind: "refused"; status: number }
  /** No answer, or the transport failed. */
  | { kind: "noAnswer" }
  /** A NOTIFY with `Subscription-State: terminated`. */
  | { kind: "terminated"; reason: string | null; retryAfter: number | null }
  /** A 2xx or a NOTIFY that does not follow the rules. */
  | { kind: "broken" };

export interface WatchHandlers {
  accepted(): void;
  pending(): void;
  notify(body: string, contentType: string | null): void;
  ended(end: WatchEnd): void;
}

/** Opens one subscription to `uri`; handlers are called until it ends. */
export type Watcher = (uri: string, on: WatchHandlers) => { terminate(): void };

export interface PresenceDeps {
  watcher: Watcher;
  /** Builds the publisher; `onSupport` is the server's verdict on PUBLISH. */
  publisher: (onSupport: (supported: boolean) => void) => Publisher;
  parser: XmlParser;
  /** Our address of record: the `entity` of what we publish. */
  entity: string;
  /** Names our tuple among our other devices' (`sip/pidf.ts`). */
  tupleId: string;
  send: (ev: PresenceSipEvent) => void;
  /** ADR 0007, D3. */
  maxWatched?: number;
  /** First delay before subscribing again, in milliseconds. */
  retryMs?: number;
}

export interface OpenPresence extends PresenceLink {
  /** Where events go from now on. */
  rebind(send: (ev: PresenceSipEvent) => void): void;
  /**
   * Withdraws the publication, ends every subscription, and turns the link
   * into a no-op. Must run before the UA stops: JsSIP sends nothing after.
   */
  close(): void;
}

export const MAX_WATCHED = 200;
export const SUBSCRIBE_EXPIRES = 3600;
const RETRY_MS = 30_000;
const MAX_RETRY_MS = 15 * 60_000;
/** The server does not take the method at all (D8). */
const REFUSED = new Set([405, 489, 501]);
const FINAL_REASONS = new Set(["rejected", "noresource", "invariant"]);
const AT_ONCE_REASONS = new Set(["deactivated", "timeout"]);

interface Entry {
  sub: { terminate(): void } | null;
  /** Identifies the subscription in progress (see `start`). */
  token: object | null;
  timer: ReturnType<typeof setTimeout> | null;
  /** Renewals since the last NOTIFY with a body. */
  failures: number;
}

export function openPresence(deps: PresenceDeps): OpenPresence {
  const maxWatched = deps.maxWatched ?? MAX_WATCHED;
  const retryMs = deps.retryMs ?? RETRY_MS;
  let send = deps.send;
  const watched = new Map<string, Entry>();
  let closed = false;
  let subscribeRefused = false;
  const said = new Set<"subscribe" | "publish">();
  let publisher: Publisher | null = null;

  const support = (method: "subscribe" | "publish", supported: boolean) => {
    if (said.has(method)) return;
    said.add(method);
    send({ type: "sip:presenceSupport", method, supported });
  };

  const presence = (uri: string, info: PresenceInfo, pending = false) =>
    send({ type: "sip:presence", uri, info, pending });

  const start = (uri: string, entry: Entry) => {
    entry.timer = null;
    // a handler may run after the entry was dropped or restarted: each
    // subscription gets its own token, and its callbacks check they still
    // hold the current one
    const token = {};
    entry.token = token;
    const current = () => !closed && watched.get(uri) === entry && entry.token === token;
    try {
      entry.sub = deps.watcher(uri, {
        accepted() {
          if (current()) support("subscribe", true);
        },
        pending() {
          if (current()) presence(uri, UNKNOWN, true);
        },
        notify(body, contentType) {
          if (!current()) return;
          entry.failures = 0;
          const pidf = contentType?.toLowerCase().startsWith(PIDF_CONTENT_TYPE) ?? true;
          presence(uri, pidf ? readPidf(body, deps.parser) : UNKNOWN);
        },
        ended(end) {
          if (!current()) return;
          entry.sub = null;
          entry.token = null;
          ended(uri, entry, end);
        },
      });
    } catch {
      // an address JsSIP cannot turn into a Request-URI: nothing to retry
      entry.token = null;
      presence(uri, UNKNOWN);
    }
  };

  const retry = (uri: string, entry: Entry, floorMs: number) => {
    const delay = Math.min(Math.max(floorMs, retryMs * 2 ** entry.failures), MAX_RETRY_MS);
    entry.failures += 1;
    entry.timer = setTimeout(() => start(uri, entry), delay);
  };

  const ended = (uri: string, entry: Entry, end: WatchEnd) => {
    switch (end.kind) {
      case "refused":
        if (REFUSED.has(end.status)) {
          refuseAll();
          return;
        }
        if (end.status >= 500 || end.status === 408) {
          retry(uri, entry, 0);
          return;
        }
        presence(uri, UNKNOWN);
        return;
      case "terminated": {
        const reason = end.reason?.toLowerCase() ?? null;
        if (reason !== null && FINAL_REASONS.has(reason)) {
          presence(uri, UNKNOWN);
          return;
        }
        const floor = end.retryAfter !== null ? end.retryAfter * 1000 : 0;
        if (floor === 0 && entry.failures === 0 && (reason === null || AT_ONCE_REASONS.has(reason))) {
          entry.failures = 1;
          start(uri, entry);
          return;
        }
        retry(uri, entry, floor);
        return;
      }
      case "noAnswer":
      case "broken":
        retry(uri, entry, 0);
        return;
    }
  };

  const drop = (entry: Entry) => {
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.timer = null;
    const sub = entry.sub;
    entry.sub = null;
    entry.token = null;
    try {
      sub?.terminate();
    } catch {
      // already over: nothing left to end
    }
  };

  /** The server said no to SUBSCRIBE itself: nobody is watched any more. */
  const refuseAll = () => {
    subscribeRefused = true;
    for (const entry of watched.values()) drop(entry);
    watched.clear();
    support("subscribe", false);
  };

  return {
    watch(uri) {
      if (closed || subscribeRefused || watched.has(uri) || watched.size >= maxWatched) return;
      const entry: Entry = { sub: null, token: null, timer: null, failures: 0 };
      watched.set(uri, entry);
      start(uri, entry);
    },
    unwatch(uri) {
      const entry = watched.get(uri);
      if (!entry) return;
      watched.delete(uri);
      drop(entry);
    },
    publish(info) {
      if (closed) return;
      publisher ??= deps.publisher((supported) => {
        if (!closed) support("publish", supported);
      });
      publisher.publish(writePidf(deps.entity, info, deps.tupleId));
    },
    rebind(next) {
      send = next;
    },
    close() {
      if (closed) return;
      closed = true;
      publisher?.withdraw();
      for (const entry of watched.values()) drop(entry);
      watched.clear();
    },
  };
}

/** A link that does nothing: the UA never started, or presence is off. */
export const NO_PRESENCE: OpenPresence = {
  watch() {},
  unwatch() {},
  publish() {},
  rebind() {},
  close() {},
};

// ---- JsSIP ------------------------------------------------------------------

/**
 * The part of JsSIP's `Subscriber` we use, including the one private
 * method we wrap: its `terminated` event says *that* the SUBSCRIBE was
 * refused, never with *what* — and 489 and 404 do not mean the same thing.
 * The wrap is on the instance, not the prototype, and only reads.
 */
interface JsSipSubscriber {
  on(event: "accepted" | "pending", fn: () => void): void;
  on(
    event: "notify",
    fn: (isFinal: boolean, request: unknown, body: string | undefined, contentType: string | undefined) => void,
  ): void;
  on(event: "terminated", fn: (code: number, reason: string | undefined, retryAfter: number | undefined) => void): void;
  subscribe(): void;
  terminate(): void;
  _receiveSubscribeResponse(response: { status_code: number }): void;
}

/** `Subscriber.C` termination codes (JsSIP 3.13). */
const JSSIP_ENDS: Record<number, (status: number | null) => WatchEnd> = {
  0: () => ({ kind: "noAnswer" }), // SUBSCRIBE_RESPONSE_TIMEOUT
  1: () => ({ kind: "noAnswer" }), // SUBSCRIBE_TRANSPORT_ERROR
  2: (status) => ({ kind: "refused", status: status ?? 0 }), // SUBSCRIBE_NON_OK_RESPONSE
  3: () => ({ kind: "broken" }), // SUBSCRIBE_WRONG_OK_RESPONSE
  4: (status) => ({ kind: "refused", status: status ?? 401 }), // SUBSCRIBE_AUTHENTICATION_FAILED
  5: () => ({ kind: "noAnswer" }), // UNSUBSCRIBE_TIMEOUT
  7: () => ({ kind: "broken" }), // WRONG_NOTIFY_RECEIVED
};

/** The `Watcher` of a live UA: `Event: presence`, PIDF, one hour. */
export function jssipWatcher(ua: UA): Watcher {
  return (uri, on) => {
    // JsSIP would send `SUBSCRIBE undefined` rather than refuse
    if (!normalizeTarget(uri)) throw new TypeError(`invalid SIP target: ${uri}`);
    const sub = ua.subscribe(uri, "presence", PIDF_CONTENT_TYPE, {
      expires: SUBSCRIBE_EXPIRES,
      contentType: PIDF_CONTENT_TYPE,
    }) as unknown as JsSipSubscriber;

    let status: number | null = null;
    const receive = sub._receiveSubscribeResponse.bind(sub);
    sub._receiveSubscribeResponse = (response) => {
      status = response.status_code;
      receive(response);
    };

    sub.on("accepted", () => on.accepted());
    sub.on("pending", () => on.pending());
    sub.on("notify", (_final, _request, body, contentType) => {
      if (body) on.notify(body, contentType ?? null);
    });
    sub.on("terminated", (code, reason, retryAfter) => {
      on.ended(
        code === 6 // FINAL_NOTIFY_RECEIVED
          ? { kind: "terminated", reason: reason ?? null, retryAfter: retryAfter ?? null }
          : (JSSIP_ENDS[code]?.(status) ?? { kind: "broken" }),
      );
    });
    sub.subscribe();
    return sub;
  };
}
