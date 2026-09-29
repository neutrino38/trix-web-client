/**
 * The messaging link (ADR 0008, D1, D2, D4): what an incoming MESSAGE is
 * answered before and after the machine chooses, and what a sent one
 * reports.
 */

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
  const sent: { uri: string; text: string; done: (status: number | null) => void }[] = [];
  const link = openMessaging({
    sender: (uri, text, done) => sent.push({ uri, text, done }),
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
    const { view, replies } = incoming({ contentType: "message/cpim" });
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
