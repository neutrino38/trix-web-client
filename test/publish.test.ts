/**
 * PUBLISH (ADR 0007, D2): the RFC 3903 cycle against a scripted server,
 * then the JsSIP graft itself — a request JsSIP never meant to send must
 * still go through its Digest machinery, SHA-256 included.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { URI } from "jssip";
// @ts-expect-error — JsSIP internal module, no type declarations
import RequestSender from "jssip/lib/RequestSender.js";
import {
  createPublisher,
  jssipPublishSend,
  type JsSipUa,
  type PublishRequest,
  type PublishResponse,
} from "../src/sip/publish.js";
import { useSha256Ha1 } from "../src/sip/digest.js";
import { computeHa1Sha256 } from "../src/storage/ha1.js";
import { sha256 } from "../src/storage/sha256.js";

// ---- the cycle ----------------------------------------------------------

interface Pending {
  req: PublishRequest;
  reply: (res: Partial<PublishResponse> & { status: number }) => Promise<void>;
}

/** A server that answers when told to, one request at a time. */
function scriptedServer() {
  const sent: Pending[] = [];
  const send = (req: PublishRequest) =>
    new Promise<PublishResponse>((resolve) => {
      sent.push({
        req,
        reply: async (res) => {
          resolve({ etag: null, expires: null, minExpires: null, ...res });
          await vi.advanceTimersByTimeAsync(0);
        },
      });
    });
  const last = () => {
    const p = sent.at(-1);
    if (!p) throw new Error("nothing was sent");
    return p;
  };
  return { send, sent, last };
}

function setup(opts: { expires?: number } = {}) {
  const server = scriptedServer();
  const onSupport = vi.fn();
  const publisher = createPublisher({ send: server.send, onSupport, retryMs: 60_000, ...opts });
  return { server, onSupport, publisher };
}

describe("createPublisher — RFC 3903 cycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("initial publication: a body, no SIP-If-Match; the ETag is kept", async () => {
    const { server, onSupport, publisher } = setup();
    publisher.publish("A");
    expect(server.last().req).toEqual({ body: "A", etag: null, expires: 3600 });
    await server.last().reply({ status: 200, etag: "e1", expires: 3600 });
    expect(onSupport).toHaveBeenCalledExactlyOnceWith(true);

    publisher.publish("B");
    expect(server.last().req).toEqual({ body: "B", etag: "e1", expires: 3600 });
  });

  it("refresh at 80 % of the granted Expires: no body, SIP-If-Match", async () => {
    const { server, publisher } = setup();
    publisher.publish("A");
    await server.last().reply({ status: 200, etag: "e1", expires: 100 });

    await vi.advanceTimersByTimeAsync(79_999);
    expect(server.sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(server.last().req).toEqual({ body: null, etag: "e1", expires: 3600 });

    // the server may hand out a new tag on refresh (RFC 3903 §6)
    await server.last().reply({ status: 200, etag: "e2", expires: 100 });
    await vi.advanceTimersByTimeAsync(80_000);
    expect(server.last().req.etag).toBe("e2");
  });

  it("a change made while a request is in flight leaves when it comes back", async () => {
    const { server, publisher } = setup();
    publisher.publish("A");
    publisher.publish("B");
    publisher.publish("C");
    expect(server.sent).toHaveLength(1);
    await server.last().reply({ status: 200, etag: "e1" });
    expect(server.sent).toHaveLength(2);
    expect(server.last().req).toEqual({ body: "C", etag: "e1", expires: 3600 });
  });

  it("412: publish from scratch, once", async () => {
    const { server, publisher } = setup();
    publisher.publish("A");
    await server.last().reply({ status: 200, etag: "e1" });
    publisher.publish("B");
    await server.last().reply({ status: 412 });
    expect(server.last().req).toEqual({ body: "B", etag: null, expires: 3600 });

    // a second 412 in a row is not answered right away…
    await server.last().reply({ status: 412 });
    expect(server.sent).toHaveLength(3);
    // …but later, from scratch again
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.last().req).toEqual({ body: "B", etag: null, expires: 3600 });
  });

  it("412 on a refresh: the body goes out again", async () => {
    const { server, publisher } = setup();
    publisher.publish("A");
    await server.last().reply({ status: 200, etag: "e1", expires: 100 });
    await vi.advanceTimersByTimeAsync(80_000);
    expect(server.last().req.body).toBeNull();
    await server.last().reply({ status: 412 });
    expect(server.last().req).toEqual({ body: "A", etag: null, expires: 3600 });
  });

  it("423: again with the server's Min-Expires", async () => {
    const { server, publisher } = setup({ expires: 60 });
    publisher.publish("A");
    await server.last().reply({ status: 423, minExpires: 600 });
    expect(server.last().req).toEqual({ body: "A", etag: null, expires: 600 });
  });

  it.each([489, 405, 501])("%i: said once, and nothing is ever sent again", async (status) => {
    const { server, onSupport, publisher } = setup();
    publisher.publish("A");
    await server.last().reply({ status });
    expect(onSupport).toHaveBeenCalledExactlyOnceWith(false);
    publisher.publish("B");
    publisher.withdraw();
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(server.sent).toHaveLength(1);
  });

  it("no answer, or a 5xx: tried again later with the latest body", async () => {
    const { server, onSupport, publisher } = setup();
    publisher.publish("A");
    await server.last().reply({ status: 0 });
    publisher.publish("B");
    // publish() does not wait for the retry: a change goes out at once
    expect(server.last().req.body).toBe("B");
    await server.last().reply({ status: 503 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.last().req).toEqual({ body: "B", etag: null, expires: 3600 });
    expect(onSupport).not.toHaveBeenCalled();
  });

  it("a send that rejects counts as no answer", async () => {
    const onSupport = vi.fn();
    const send = vi.fn().mockRejectedValue(new Error("socket closed"));
    const publisher = createPublisher({ send, onSupport, retryMs: 1000 });
    publisher.publish("A");
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("withdrawal: Expires 0 with the ETag, then silence", async () => {
    const { server, publisher } = setup();
    publisher.publish("A");
    await server.last().reply({ status: 200, etag: "e1", expires: 100 });
    publisher.withdraw();
    expect(server.last().req).toEqual({ body: null, etag: "e1", expires: 0 });
    publisher.publish("B");
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(server.sent).toHaveLength(2);
  });

  it("withdrawal of what was never accepted sends nothing", () => {
    const { server, publisher } = setup();
    publisher.withdraw();
    expect(server.sent).toHaveLength(0);
  });

  it("stop: nothing more, not even a withdrawal, and late answers are ignored", async () => {
    const { server, onSupport, publisher } = setup();
    publisher.publish("A");
    publisher.stop();
    await server.last().reply({ status: 200, etag: "e1" });
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(server.sent).toHaveLength(1);
    expect(onSupport).not.toHaveBeenCalled();
  });
});

// ---- the JsSIP graft --------------------------------------------------------

const ALICE = { user: "alice", realm: "example.com", password: "s3cret" };

interface Sender {
  _request: {
    method: string;
    cseq: number;
    body?: string;
    getHeader(name: string): string | undefined;
    toString(): string;
  };
  _receiveResponse(res: unknown): void;
}

/** Just enough of a UA for `OutgoingRequest` and `RequestSender`. */
function fakeUa() {
  return {
    status: 0,
    C: { STATUS_USER_CLOSED: 3 },
    _configuration: { authorization_jwt: null },
    configuration: {
      uri: URI.parse(`sip:${ALICE.user}@${ALICE.realm}`),
      authorization_user: ALICE.user,
      realm: ALICE.realm,
      password: null,
      ha1: "md5-ha1-irrelevant-here",
      display_name: null,
      extra_headers: null,
      use_preloaded_route: false,
      jssip_id: "abcde",
    },
    set: () => true,
  };
}

function response(status: number, headers: Record<string, string> = {}, challenge?: object) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status_code: status,
    cseq: 0,
    hasHeader: (name: string) => name.toLowerCase() in lower,
    getHeader: (name: string) => lower[name.toLowerCase()],
    parseHeader: () => challenge,
  };
}

describe("jssipPublishSend — through JsSIP's own machinery", () => {
  let senders: Sender[];

  beforeEach(() => {
    senders = [];
    // the transaction layer is the one thing not exercised: no socket here
    vi.spyOn(RequestSender.prototype, "send").mockImplementation(function (this: Sender) {
      senders.push(this);
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds a PUBLISH for our own address of record", async () => {
    const send = jssipPublishSend(fakeUa() as unknown as JsSipUa);
    const answer = send({ body: "<presence/>", etag: "e1", expires: 3600 });
    const req = senders[0]!._request;
    const wire = req.toString();
    expect(wire).toMatch(/^PUBLISH sip:alice@example\.com SIP\/2\.0\r\n/);
    expect(req.getHeader("To")).toBe("<sip:alice@example.com>");
    expect(req.getHeader("Event")).toBe("presence");
    expect(req.getHeader("Expires")).toBe("3600");
    expect(req.getHeader("SIP-If-Match")).toBe("e1");
    expect(req.getHeader("Content-Type")).toBe("application/pidf+xml");
    expect(wire.endsWith("\r\n\r\n<presence/>")).toBe(true);

    senders[0]!._receiveResponse(response(100));
    senders[0]!._receiveResponse(response(200, { "SIP-ETag": "e2", Expires: "1800" }));
    expect(await answer).toEqual({ status: 200, etag: "e2", expires: 1800, minExpires: null });
  });

  it("a refresh carries neither body nor Content-Type; CSeq only goes up", async () => {
    const send = jssipPublishSend(fakeUa() as unknown as JsSipUa);
    void send({ body: "<presence/>", etag: null, expires: 3600 });
    void send({ body: null, etag: "e1", expires: 3600 });
    const [first, second] = senders.map((s) => s._request);
    expect(first!.getHeader("SIP-If-Match")).toBeUndefined();
    expect(second!.getHeader("Content-Type")).toBeUndefined();
    expect(second!.cseq).toBe(first!.cseq + 1);
    expect(second!.getHeader("Call-ID")).toBe(first!.getHeader("Call-ID"));
  });

  it("a SHA-256 challenge is answered, over the PUBLISH itself", async () => {
    const ha1 = computeHa1Sha256(ALICE.user, ALICE.realm, ALICE.password);
    const release = useSha256Ha1(ALICE.user, ALICE.realm, {
      ha1,
      onMissing: () => expect.unreachable("the digest is there"),
    });
    const send = jssipPublishSend(fakeUa() as unknown as JsSipUa);
    const answer = send({ body: "<presence/>", etag: null, expires: 3600 });
    const nonce = "n0nce";
    const firstCseq = senders[0]!._request.cseq;
    senders[0]!._receiveResponse(
      response(401, {}, { algorithm: "SHA-256", realm: ALICE.realm, nonce, qop: ["auth"] }),
    );

    // RequestSender sent again — the same sender, over a clone of the
    // request — and the clone carries the answer
    expect(senders).toHaveLength(2);
    const retry = senders[1]!._request;
    expect(retry.method).toBe("PUBLISH");
    expect(retry.cseq).toBe(firstCseq + 1);
    const auth = retry.getHeader("Authorization")!;
    expect(auth).toContain("algorithm=SHA-256");
    const cnonce = /cnonce="([^"]+)"/.exec(auth)![1];
    const ha2 = sha256("PUBLISH:sip:alice@example.com");
    expect(auth).toContain(`response="${sha256(`${ha1}:${nonce}:00000001:${cnonce}:auth:${ha2}`)}"`);

    senders[1]!._receiveResponse(response(200, { "SIP-ETag": "e1" }));
    expect((await answer).status).toBe(200);
    release();
  });

  it("timeout and transport error both read as no answer", async () => {
    const send = jssipPublishSend(fakeUa() as unknown as JsSipUa);
    const answer = send({ body: null, etag: "e1", expires: 0 });
    (senders[0] as unknown as { _eventHandlers: { onRequestTimeout(): void } })._eventHandlers.onRequestTimeout();
    expect(await answer).toEqual({ status: 0, etag: null, expires: null, minExpires: null });
  });
});
