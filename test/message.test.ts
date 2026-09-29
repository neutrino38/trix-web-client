/**
 * The messaging link (ADR 0008, D1, D2, D4): what an incoming MESSAGE is
 * answered before and after the machine chooses, and what a sent one
 * reports.
 */

import { DOMParser } from "@xmldom/xmldom";
import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error — JsSIP internal module, no type declarations
import Parser from "jssip/lib/Parser.js";
import {
  jssipIncoming,
  MAX_MESSAGE_BYTES,
  NO_MESSAGING,
  openMessaging,
  readableType,
  readDate,
  utf8Length,
  type IncomingView,
  type JsSipMessageEvent,
  type MessagingSipEvent,
} from "../src/sip/message.js";

const NOW = Date.parse("2026-09-29T10:00:00Z");

function incoming(over: Partial<IncomingView> = {}) {
  const replies: number[] = [];
  const view: IncomingView = {
    user: "bob",
    host: "Example.org",
    name: "Bob Martin",
    contentType: "text/plain;charset=UTF-8",
    body: "Bonjour",
    date: null,
    reply: (code) => replies.push(code),
    ...over,
  };
  return { view, replies };
}

function setup(choose?: (ev: Extract<MessagingSipEvent, { type: "sip:message" }>) => void) {
  const events: MessagingSipEvent[] = [];
  const sent: { uri: string; body: string; contentType: string; done: (status: number | null) => void }[] = [];
  const link = openMessaging({
    sender: (uri, body, contentType, done) => sent.push({ uri, body, contentType, done }),
    self: "sip:alice@example.org",
    parser: new DOMParser() as never,
    newId: () => "r1",
    send: (ev) => {
      events.push(ev);
      if (ev.type === "sip:message") choose?.(ev);
    },
    now: () => NOW,
  });
  return { link, events, sent };
}

afterEach(() => vi.restoreAllMocks());

describe("readableType", () => {
  it("takes text/plain in UTF-8 or US-ASCII, or without charset", () => {
    expect(readableType("text/plain")).toBe(true);
    expect(readableType("Text/Plain; charset=utf-8")).toBe(true);
    expect(readableType('text/plain;charset="US-ASCII"')).toBe(true);
  });

  it("refuses any other type, another charset, or no type at all", () => {
    expect(readableType("message/cpim")).toBe(false);
    expect(readableType("text/html")).toBe(false);
    expect(readableType("text/plain;charset=ISO-8859-1")).toBe(false);
    expect(readableType(null)).toBe(false);
  });
});

describe("readDate", () => {
  it("reads an RFC 1123 date", () => {
    expect(readDate("Tue, 29 Sep 2026 09:30:00 GMT", NOW)).toBe(Date.parse("2026-09-29T09:30:00Z"));
  });

  it("drops an absent, unreadable, or future date", () => {
    expect(readDate(null, NOW)).toBeNull();
    expect(readDate("yesterday", NOW)).toBeNull();
    expect(readDate("Tue, 29 Sep 2026 11:00:00 GMT", NOW)).toBeNull();
  });

  it("forgives a minute of clock skew", () => {
    expect(readDate("Tue, 29 Sep 2026 10:00:30 GMT", NOW)).not.toBeNull();
  });
});

describe("incoming MESSAGE", () => {
  it("hands a readable message to the machine, which answers it", () => {
    const { link, events } = setup((ev) => ev.answer(202));
    const { view, replies } = incoming({ date: "Tue, 29 Sep 2026 09:30:00 GMT" });
    link.receive(view);
    expect(replies).toEqual([202]);
    expect(events).toEqual([
      expect.objectContaining({
        type: "sip:message",
        from: "sip:bob@example.org",
        name: "Bob Martin",
        text: "Bonjour",
        date: Date.parse("2026-09-29T09:30:00Z"),
      }),
    ]);
  });

  it("answers once, whatever the machine calls after", () => {
    const { link } = setup((ev) => {
      ev.answer(200);
      ev.answer(603);
    });
    const { view, replies } = incoming();
    link.receive(view);
    expect(replies).toEqual([200]);
  });

  it("answers 480 when the machine chose nothing — never JsSIP's 200", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { link } = setup();
    const { view, replies } = incoming();
    link.receive(view);
    expect(replies).toEqual([480]);
  });

  it("refuses another body type with 415, unseen", () => {
    const { link, events } = setup((ev) => ev.answer(200));
    const { view, replies } = incoming({ contentType: "text/html" });
    link.receive(view);
    expect(replies).toEqual([415]);
    expect(events).toEqual([]);
  });

  it("takes an empty body with 200, and files nothing", () => {
    const { link, events } = setup((ev) => ev.answer(200));
    const { view, replies } = incoming({ body: "  \r\n", contentType: null });
    link.receive(view);
    expect(replies).toEqual([200]);
    expect(events).toEqual([]);
  });

  it("refuses a From with no user part with 403", () => {
    const { link, events } = setup((ev) => ev.answer(200));
    const { view, replies } = incoming({ user: null });
    link.receive(view);
    expect(replies).toEqual([403]);
    expect(events).toEqual([]);
  });

  it("answers 480 once the link is closed, and before any is open", () => {
    const { link, events } = setup((ev) => ev.answer(200));
    link.close();
    const a = incoming();
    link.receive(a.view);
    const b = incoming();
    NO_MESSAGING.receive(b.view);
    expect(a.replies).toEqual([480]);
    expect(b.replies).toEqual([480]);
    expect(events).toEqual([]);
  });

  it("goes to the new send after a rebind", () => {
    const { link, events } = setup((ev) => ev.answer(200));
    const later: MessagingSipEvent[] = [];
    link.rebind((ev) => {
      later.push(ev);
      if (ev.type === "sip:message") ev.answer(200);
    });
    link.receive(incoming().view);
    expect(events).toEqual([]);
    expect(later).toHaveLength(1);
  });
});

describe("incoming MESSAGE in CPIM (ADR 0009)", () => {
  const cpim = (over: { dateTime?: string; inner?: string; body?: string } = {}) =>
    [
      "From: <sip:bob@example.org>",
      "To: <sip:alice@example.org>",
      ...(over.dateTime === undefined ? ["DateTime: 2026-09-29T09:00:00Z"] : over.dateTime ? [`DateTime: ${over.dateTime}`] : []),
      "NS: imdn <urn:ietf:params:imdn>",
      "imdn.Message-ID: KfMgJ0nhBx",
      "imdn.Disposition-Notification: positive-delivery, display",
      "",
      `Content-Type: ${over.inner ?? "text/plain; charset=UTF-8"}`,
      "",
      over.body ?? "Bonjour",
    ].join("\r\n");

  it("hands the inner text to the machine, with DateTime and imdn.Message-ID", () => {
    const { link, events } = setup((ev) => ev.answer(200));
    const { view, replies } = incoming({ contentType: "message/cpim", body: cpim() });
    link.receive(view);
    expect(replies).toEqual([200]);
    expect(events).toEqual([
      expect.objectContaining({
        text: "Bonjour",
        date: Date.parse("2026-09-29T09:00:00Z"),
        messageId: "KfMgJ0nhBx",
      }),
    ]);
  });

  it("prefers DateTime to the Date header, and falls back to it", () => {
    const date = "Tue, 29 Sep 2026 09:30:00 GMT";
    const { link, events } = setup((ev) => ev.answer(200));
    link.receive(incoming({ contentType: "message/cpim", body: cpim(), date }).view);
    link.receive(incoming({ contentType: "message/cpim", body: cpim({ dateTime: "" }), date }).view);
    link.receive(incoming({ contentType: "message/cpim", body: cpim({ dateTime: "2026-09-29T11:00:00Z" }), date }).view);
    expect(events.map((e) => e.type === "sip:message" && e.date)).toEqual([
      Date.parse("2026-09-29T09:00:00Z"),
      Date.parse("2026-09-29T09:30:00Z"),
      Date.parse("2026-09-29T09:30:00Z"),
    ]);
  });

  it("takes an IMDN notification with 200, and shows nothing", () => {
    const { link, events } = setup((ev) => ev.answer(200));
    const { view, replies } = incoming({ contentType: "message/cpim", body: cpim({ inner: "message/imdn+xml", body: "<imdn/>" }) });
    link.receive(view);
    expect(replies).toEqual([200]);
    expect(events).toEqual([]);
  });

  it("refuses another inner type with 415 — a file transfer, say", () => {
    const { link, events } = setup((ev) => ev.answer(200));
    const inner = "application/vnd.gsma.rcs-ft-http+xml";
    const { view, replies } = incoming({ contentType: "message/cpim", body: cpim({ inner, body: "<file/>" }) });
    link.receive(view);
    expect(replies).toEqual([415]);
    expect(events).toEqual([]);
  });

  it("refuses a CPIM body it cannot read with 400", () => {
    const { link, events } = setup((ev) => ev.answer(200));
    const { view, replies } = incoming({ contentType: "message/cpim", body: "Bonjour" });
    link.receive(view);
    expect(replies).toEqual([400]);
    expect(events).toEqual([]);
  });

  it("gives bare text no Message-ID", () => {
    const { link, events } = setup((ev) => ev.answer(200));
    link.receive(incoming().view);
    expect(events).toEqual([expect.objectContaining({ messageId: null })]);
  });
});

describe("receipts (ADR 0010)", () => {
  const imdn = (status: "delivered" | "displayed", id = "m1") =>
    `<?xml version="1.0" encoding="UTF-8"?><imdn xmlns="urn:ietf:params:xml:ns:imdn"><message-id>${id}</message-id>` +
    `<datetime>2026-09-29T09:00:00Z</datetime>${
      status === "delivered"
        ? "<delivery-notification><status><delivered/></status></delivery-notification>"
        : "<display-notification><status><displayed/></status></display-notification>"
    }</imdn>`;
  const wrap = (inner: string, type = "message/imdn+xml") =>
    [
      "From: <sip:bob@example.org>",
      "To: <sip:alice@example.org>",
      "NS: imdn <urn:ietf:params:imdn>",
      "imdn.Message-ID: r9",
      "",
      `Content-Type: ${type}`,
      "Content-Disposition: notification",
      "",
      inner,
    ].join("\r\n");

  it("a receipt: 200, and a sip:receipt from its sender, never a message", () => {
    const { link, events } = setup((ev) => ev.answer(200));
    const { view, replies } = incoming({ contentType: "message/cpim", body: wrap(imdn("displayed")) });
    link.receive(view);
    expect(replies).toEqual([200]);
    expect(events).toEqual([{ type: "sip:receipt", from: "sip:bob@example.org", messageId: "m1", status: "displayed" }]);
  });

  it("several gathered in a multipart/mixed: one event each", () => {
    const { link, events } = setup();
    const body = ["--b", "Content-Type: message/imdn+xml", "", imdn("delivered", "m1"), "--b", "Content-Type: message/imdn+xml", "", imdn("delivered", "m2"), "--b--"].join("\r\n");
    const { view, replies } = incoming({ contentType: "message/cpim", body: wrap(body, "multipart/mixed;boundary=b") });
    link.receive(view);
    expect(replies).toEqual([200]);
    expect(events.map((e) => e.type === "sip:receipt" && e.messageId)).toEqual(["m1", "m2"]);
  });

  it("a negative receipt: 200, and nothing", () => {
    const { link, events } = setup();
    const { view, replies } = incoming({ contentType: "message/cpim", body: wrap(imdn("delivered").replace("<delivered/>", "<failed/>")) });
    link.receive(view);
    expect(replies).toEqual([200]);
    expect(events).toEqual([]);
  });

  it("a receipt with no link open: 480", () => {
    const { link, events } = setup();
    link.close();
    const { view, replies } = incoming({ contentType: "message/cpim", body: wrap(imdn("delivered")) });
    link.receive(view);
    expect(replies).toEqual([480]);
    expect(events).toEqual([]);
  });

  it("an incoming message says which receipts it asks for — none without a Message-ID", () => {
    const { link, events } = setup((ev) => ev.answer(200));
    const cpim = (headers: string[]) =>
      ["From: <sip:bob@example.org>", ...headers, "", "Content-Type: text/plain", "", "Bonjour"].join("\r\n");
    const asks = "imdn.Disposition-Notification: positive-delivery, display";
    link.receive(incoming({ contentType: "message/cpim", body: cpim(["imdn.Message-ID: a", asks]) }).view);
    link.receive(incoming({ contentType: "message/cpim", body: cpim(["imdn.Message-ID: b"]) }).view);
    link.receive(incoming({ contentType: "message/cpim", body: cpim([asks]) }).view);
    link.receive(incoming().view);
    expect(events.map((e) => e.type === "sip:message" && e.wants)).toEqual([
      { delivery: true, display: true },
      { delivery: false, display: false },
      { delivery: false, display: false },
      { delivery: false, display: false },
    ]);
  });

  it("receipt() sends an IMDN in CPIM, about the message and its date, and reports nothing", () => {
    const { link, events, sent } = setup();
    link.receipt("sip:bob@example.org", "KfMgJ0nhBx", Date.parse("2026-09-29T09:00:00Z"), "displayed");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.contentType).toBe("message/cpim");
    expect(sent[0]!.body).toContain("imdn.Message-ID: r1\r\n");
    expect(sent[0]!.body).not.toContain("Disposition-Notification");
    expect(sent[0]!.body).toContain("<message-id>KfMgJ0nhBx</message-id>");
    expect(sent[0]!.body).toContain("<datetime>2026-09-29T09:00:00Z</datetime>");
    expect(sent[0]!.body).toContain("<displayed/>");
    sent[0]!.done(200);
    expect(events).toEqual([]);
  });

  it("no receipt to a correspondent who refused CPIM, nor once closed", () => {
    const { link, sent } = setup();
    link.send("m1", "sip:bob@example.org", "Bonjour");
    sent[0]!.done(415);
    link.receipt("sip:bob@example.org", "x", 0, "delivered");
    expect(sent).toHaveLength(2);
    link.close();
    link.receipt("sip:carol@example.org", "x", 0, "delivered");
    expect(sent).toHaveLength(2);
  });
});

describe("sent MESSAGE", () => {
  it("reports the final status under the caller's id", () => {
    const { link, events, sent } = setup();
    link.send("m1", "sip:bob@example.org", "Bonjour");
    link.send("m2", "sip:carol@example.org", "Salut");
    sent[1]!.done(404);
    sent[0]!.done(200);
    expect(events).toEqual([
      { type: "sip:messageSent", id: "m2", status: 404 },
      { type: "sip:messageSent", id: "m1", status: 200 },
    ]);
  });

  it("leaves in CPIM, dated, with the caller's id as imdn.Message-ID", () => {
    const { link, sent } = setup();
    link.send("m1", "sip:bob@example.org", "Bonjour");
    expect(sent[0]!.contentType).toBe("message/cpim");
    expect(sent[0]!.body).toContain("From: <sip:alice@example.org>\r\nTo: <sip:bob@example.org>\r\n");
    expect(sent[0]!.body).toContain("DateTime: 2026-09-29T10:00:00Z\r\n");
    expect(sent[0]!.body).toContain("imdn.Message-ID: m1\r\n");
    expect(sent[0]!.body.endsWith("\r\n\r\nBonjour")).toBe(true);
  });

  it("a 415 to CPIM sends it again in bare text, and so everything after to that correspondent", () => {
    const { link, events, sent } = setup();
    link.send("m1", "sip:bob@example.org", "Bonjour");
    sent[0]!.done(415);
    expect(events).toEqual([]);
    expect(sent[1]).toMatchObject({ contentType: "text/plain;charset=UTF-8", body: "Bonjour" });
    sent[1]!.done(200);
    expect(events).toEqual([{ type: "sip:messageSent", id: "m1", status: 200 }]);
    link.send("m2", "sip:bob@Example.org", "Encore");
    link.send("m3", "sip:carol@example.org", "Salut");
    expect(sent.slice(2).map((s) => s.contentType)).toEqual(["text/plain;charset=UTF-8", "message/cpim"]);
  });

  it("a 415 to bare text is a failure", () => {
    const { link, events, sent } = setup();
    link.send("m1", "sip:bob@example.org", "Bonjour");
    sent[0]!.done(415);
    sent[1]!.done(415);
    expect(sent).toHaveLength(2);
    expect(events).toEqual([{ type: "sip:messageSent", id: "m1", status: 415 }]);
  });

  it("reports no answer as null", () => {
    const { link, events, sent } = setup();
    link.send("m1", "sip:bob@example.org", "Bonjour");
    sent[0]!.done(null);
    expect(events).toEqual([{ type: "sip:messageSent", id: "m1", status: null }]);
  });

  it("counts the cap in UTF-8 bytes, and throws past it", () => {
    const { link, sent } = setup();
    const accents = "é".repeat(MAX_MESSAGE_BYTES / 2);
    expect(utf8Length(accents)).toBe(MAX_MESSAGE_BYTES);
    link.send("ok", "sip:bob@example.org", accents);
    expect(() => link.send("ko", "sip:bob@example.org", `${accents}a`)).toThrow(RangeError);
    expect(sent).toHaveLength(1);
  });

  it("sends nothing once closed, and drops outcomes in flight", () => {
    const { link, events, sent } = setup();
    link.send("m1", "sip:bob@example.org", "Bonjour");
    link.close();
    link.send("m2", "sip:bob@example.org", "Encore");
    sent[0]!.done(200);
    expect(sent).toHaveLength(1);
    expect(events).toEqual([]);
  });
});

describe("jssipIncoming", () => {
  function parsed(raw: string) {
    const request = Parser.parseMessage(raw, { configuration: {} });
    const replies: string[] = [];
    request.server_transaction = {
      receiveResponse: (_code: number, response: string) => replies.push(response.split("\r\n")[0]!),
    };
    const message = { _is_replied: false };
    const e: JsSipMessageEvent = { originator: "remote", request, message };
    return { view: jssipIncoming(e), replies, message };
  }

  const raw = [
    "MESSAGE sip:alice@example.org SIP/2.0",
    "Via: SIP/2.0/WSS proxy.example.org;branch=z9hG4bK776asdhds",
    "Max-Forwards: 70",
    "To: <sip:alice@example.org>",
    '"Bob Martin" <sip:bob@Example.org;transport=ws>;tag=49583',
    "Call-ID: a84b4c76e66710",
    "CSeq: 1 MESSAGE",
    "Date: Tue, 29 Sep 2026 09:30:00 GMT",
    "Content-Type: text/plain;charset=UTF-8",
    "Content-Length: 7",
    "",
    "Bonjour",
  ];
  raw[4] = `From: ${raw[4]}`;

  it("reads what the policy needs from a parsed request", () => {
    const { view } = parsed(raw.join("\r\n"));
    expect(view).toMatchObject({
      user: "bob",
      host: "example.org",
      name: "Bob Martin",
      contentType: "text/plain;charset=UTF-8",
      body: "Bonjour",
      date: "Tue, 29 Sep 2026 09:30:00 GMT",
    });
  });

  it("sends the chosen code itself — 202 included — and tells JsSIP it did", () => {
    const a = parsed(raw.join("\r\n"));
    a.view.reply(202);
    const b = parsed(raw.join("\r\n"));
    b.view.reply(603);
    expect(a.replies).toEqual(["SIP/2.0 202 Accepted"]);
    expect(b.replies).toEqual(["SIP/2.0 603 Decline"]);
    expect(a.message._is_replied).toBe(true);
  });
});
