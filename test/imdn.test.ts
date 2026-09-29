/**
 * IMDN (ADR 0010): the receipts asked for, written, and read.
 */

import { DOMParser } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import { buildImdn, imdnBodies, readImdn, wantedReceipts } from "../src/sip/imdn.js";
import type { XmlParser } from "../src/sip/pidf.js";

const parser = new DOMParser() as unknown as XmlParser;

/** A read receipt as Linphone writes it. */
const LINPHONE_DISPLAYED = `<?xml version="1.0" encoding="UTF-8"?>
<imdn xmlns="urn:ietf:params:xml:ns:imdn">
  <message-id>m-1</message-id>
  <datetime>2026-09-29T10:00:00Z</datetime>
  <recipient-uri>sip:bob@example.org</recipient-uri>
  <original-recipient-uri>sip:bob@example.org</original-recipient-uri>
  <display-notification>
    <status>
      <displayed/>
    </status>
  </display-notification>
</imdn>`;

describe("wantedReceipts", () => {
  it("reads Linphone's request", () => {
    expect(wantedReceipts("positive-delivery, display")).toEqual({ delivery: true, display: true });
  });

  it("asks for nothing without a header, or with negative-delivery alone", () => {
    expect(wantedReceipts(null)).toEqual({ delivery: false, display: false });
    expect(wantedReceipts("negative-delivery")).toEqual({ delivery: false, display: false });
  });

  it("takes each token alone, whatever its case", () => {
    expect(wantedReceipts("Display")).toEqual({ delivery: false, display: true });
    expect(wantedReceipts("positive-delivery,negative-delivery")).toEqual({ delivery: true, display: false });
  });
});

describe("buildImdn", () => {
  it("writes a receipt that reads back", () => {
    const at = Date.parse("2026-09-29T10:00:00Z");
    for (const status of ["delivered", "displayed"] as const) {
      const xml = buildImdn({ messageId: "m-1", at, status });
      expect(xml).toContain("<datetime>2026-09-29T10:00:00Z</datetime>");
      expect(readImdn(xml, parser)).toEqual({ messageId: "m-1", status });
    }
  });

  it("escapes the message id", () => {
    const xml = buildImdn({ messageId: "a<b&c", at: 0, status: "delivered" });
    expect(readImdn(xml, parser)?.messageId).toBe("a<b&c");
  });
});

describe("readImdn", () => {
  it("reads Linphone's read receipt", () => {
    expect(readImdn(LINPHONE_DISPLAYED, parser)).toEqual({ messageId: "m-1", status: "displayed" });
  });

  it("reads a prefixed namespace as well", () => {
    const xml = LINPHONE_DISPLAYED.replace(/<(\/?)([a-z-]+)/g, "<$1i:$2").replace('xmlns="', 'xmlns:i="');
    expect(readImdn(xml, parser)).toEqual({ messageId: "m-1", status: "displayed" });
  });

  it("reads negative outcomes as nothing", () => {
    const failed = LINPHONE_DISPLAYED.replace("<display-notification>", "<delivery-notification>")
      .replace("</display-notification>", "</delivery-notification>")
      .replace("<displayed/>", "<failed/>");
    expect(readImdn(failed, parser)).toBeNull();
    expect(readImdn(LINPHONE_DISPLAYED.replace("<displayed/>", "<forbidden/>"), parser)).toBeNull();
  });

  it("reads anything else as nothing, and never throws", () => {
    expect(readImdn("<imdn/>", parser)).toBeNull();
    expect(readImdn(LINPHONE_DISPLAYED.replace(/<message-id>.*<\/message-id>/, ""), parser)).toBeNull();
    expect(readImdn("not xml <", parser)).toBeNull();
  });
});

describe("imdnBodies", () => {
  it("one receipt", () => {
    expect(imdnBodies("message/imdn+xml", "<x/>")).toEqual(["<x/>"]);
  });

  it("several, gathered in a multipart/mixed", () => {
    const body = [
      "--b1",
      "Content-Type: message/imdn+xml",
      "Content-Disposition: notification",
      "",
      "<one/>",
      "--b1",
      "Content-Type: message/imdn+xml",
      "",
      "<two/>",
      "--b1--",
      "",
    ].join("\r\n");
    expect(imdnBodies('multipart/mixed;boundary="b1"', body)).toEqual(["<one/>", "<two/>"]);
  });

  it("not receipts: another type, or a multipart holding anything else", () => {
    expect(imdnBodies("text/plain", "Bonjour")).toBeNull();
    expect(imdnBodies(null, "<x/>")).toBeNull();
    const mixed = ["--b1", "Content-Type: text/plain", "", "Bonjour", "--b1--"].join("\r\n");
    expect(imdnBodies("multipart/mixed;boundary=b1", mixed)).toBeNull();
    expect(imdnBodies("multipart/mixed", mixed)).toBeNull();
  });
});
