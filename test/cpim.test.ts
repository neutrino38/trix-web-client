/**
 * CPIM (ADR 0009): what is read from a Linphone message, and what is
 * written for one.
 */

import { describe, expect, it } from "vitest";
import { buildCpim, buildImdnCpim, formatDateTime, isCpim, parseCpim, parseDateTime } from "../src/sip/cpim.js";

/** A message as Linphone sends it, disposition request included. */
const LINPHONE = [
  "From: <sip:bob@example.org>",
  "To: <sip:alice@example.org>",
  "DateTime: 2026-09-29T09:30:00Z",
  "NS: imdn <urn:ietf:params:imdn>",
  "imdn.Message-ID: KfMgJ0nhBx",
  "imdn.Disposition-Notification: positive-delivery, display",
  "",
  "Content-Type: text/plain; charset=UTF-8",
  "",
  "Bonjour Alice",
].join("\r\n");

describe("isCpim", () => {
  it("takes message/cpim whatever its case and parameters", () => {
    expect(isCpim("message/cpim")).toBe(true);
    expect(isCpim("Message/CPIM; charset=utf-8")).toBe(true);
    expect(isCpim("text/plain")).toBe(false);
    expect(isCpim(null)).toBe(false);
  });
});

describe("parseCpim", () => {
  it("reads Linphone's message: DateTime, imdn.Message-ID, the inner part", () => {
    expect(parseCpim(LINPHONE)).toEqual({
      dateTime: Date.parse("2026-09-29T09:30:00Z"),
      messageId: "KfMgJ0nhBx",
      disposition: "positive-delivery, display",
      contentType: "text/plain; charset=UTF-8",
      body: "Bonjour Alice",
    });
  });

  it("keeps the inner body as it is, blank lines included", () => {
    const body = `${LINPHONE}\r\n\r\nDeuxième paragraphe`;
    expect(parseCpim(body)?.body).toBe("Bonjour Alice\r\n\r\nDeuxième paragraphe");
  });

  it("forgives bare LF line endings", () => {
    expect(parseCpim(LINPHONE.replace(/\r\n/g, "\n"))?.messageId).toBe("KfMgJ0nhBx");
  });

  it("follows the prefix NS binds to the IMDN namespace", () => {
    const body = LINPHONE.replace("NS: imdn <", "NS: d <").replace("imdn.Message-ID", "d.Message-ID");
    expect(parseCpim(body)?.messageId).toBe("KfMgJ0nhBx");
  });

  it("does without DateTime or Message-ID", () => {
    const body = ["From: <sip:bob@example.org>", "", "Content-Type: text/plain", "", "Salut"].join("\r\n");
    expect(parseCpim(body)).toEqual({
      dateTime: null,
      messageId: null,
      disposition: null,
      contentType: "text/plain",
      body: "Salut",
    });
  });

  it("drops a Message-ID too long to be one", () => {
    expect(parseCpim(LINPHONE.replace("KfMgJ0nhBx", "x".repeat(200)))?.messageId).toBeNull();
  });

  it("reads the inner Content-Type whatever the case of its name", () => {
    expect(parseCpim(LINPHONE.replace("Content-Type:", "content-type:"))?.contentType).toBe("text/plain; charset=UTF-8");
  });

  it("refuses a body without its two sections", () => {
    expect(parseCpim("Bonjour")).toBeNull();
    expect(parseCpim("From: <sip:bob@example.org>\r\n\r\nContent-Type: text/plain")).toBeNull();
  });
});

describe("parseDateTime", () => {
  it("reads RFC 3339, in UTC or with an offset, with or without fractions", () => {
    expect(parseDateTime("2026-09-29T09:30:00Z")).toBe(Date.parse("2026-09-29T09:30:00Z"));
    expect(parseDateTime("2026-09-29T11:30:00+02:00")).toBe(Date.parse("2026-09-29T09:30:00Z"));
    expect(parseDateTime("2026-09-29t09:30:00.250z")).toBe(Date.parse("2026-09-29T09:30:00.250Z"));
  });

  it("forgives an offset without its colon", () => {
    expect(parseDateTime("2026-09-29T11:30:00+0200")).toBe(Date.parse("2026-09-29T09:30:00Z"));
  });

  it("refuses anything else", () => {
    expect(parseDateTime("Tue, 29 Sep 2026 09:30:00 GMT")).toBeNull();
    expect(parseDateTime("2026-09-29T09:30:00")).toBeNull();
    expect(parseDateTime("2026-13-45T09:30:00Z")).toBeNull();
  });
});

describe("buildCpim", () => {
  const body = buildCpim({
    from: "sip:alice@example.org",
    to: "sip:bob@example.org",
    at: Date.parse("2026-09-29T10:00:00.123Z"),
    messageId: "m-1",
    text: "Bonjour Bob",
  });

  it("writes what Linphone reads, in CRLF, asking for both receipts", () => {
    expect(body).toBe(
      [
        "From: <sip:alice@example.org>",
        "To: <sip:bob@example.org>",
        "DateTime: 2026-09-29T10:00:00Z",
        "NS: imdn <urn:ietf:params:imdn>",
        "imdn.Message-ID: m-1",
        "imdn.Disposition-Notification: positive-delivery, display",
        "",
        "Content-Type: text/plain;charset=UTF-8",
        "",
        "Bonjour Bob",
      ].join("\r\n"),
    );
  });

  it("reads back what it wrote", () => {
    expect(parseCpim(body)).toMatchObject({ messageId: "m-1", body: "Bonjour Bob" });
  });

  it("dates to the second, in UTC", () => {
    expect(formatDateTime(Date.parse("2026-09-29T12:00:00.999+02:00"))).toBe("2026-09-29T10:00:00Z");
  });
});

describe("buildImdnCpim", () => {
  it("wraps a receipt: its own Message-ID, Content-Disposition: notification, no request", () => {
    const body = buildImdnCpim({
      from: "sip:alice@example.org",
      to: "sip:bob@example.org",
      at: Date.parse("2026-09-29T10:00:00Z"),
      messageId: "r-1",
      xml: "<imdn/>",
    });
    expect(body).toContain("imdn.Message-ID: r-1\r\n");
    expect(body).not.toContain("Disposition-Notification");
    expect(body).toContain("\r\n\r\nContent-Type: message/imdn+xml\r\nContent-Disposition: notification\r\n\r\n<imdn/>");
    expect(parseCpim(body)).toMatchObject({ messageId: "r-1", contentType: "message/imdn+xml", body: "<imdn/>" });
  });
});
