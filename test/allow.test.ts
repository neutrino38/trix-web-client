import { describe, expect, it } from "vitest";
import Constants from "jssip/lib/Constants.js";
// @ts-expect-error — JsSIP internal module, no type declarations
import Parser from "jssip/lib/Parser.js";
import { ALLOWED_METHODS } from "../src/sip/port.js";

/**
 * The `Allow` header must not announce MESSAGE while an incoming MESSAGE
 * is answered 405: a 405 whose own `Allow` lists the refused method
 * contradicts itself.
 */
describe("Allow header", () => {
  it("leaves MESSAGE out of what Trix announces", () => {
    const methods = ALLOWED_METHODS.split(",");
    expect(methods).not.toContain("MESSAGE");
    expect(methods).toContain("INVITE");
  });

  it("reaches the constants JsSIP writes its headers from", () => {
    expect(Constants.ALLOWED_METHODS).toBe(ALLOWED_METHODS);
  });

  it("goes out on the 405 answering a MESSAGE", () => {
    const raw = [
      "MESSAGE sip:alice@example.org SIP/2.0",
      "Via: SIP/2.0/WSS proxy.example.org;branch=z9hG4bK776asdhds",
      "Max-Forwards: 70",
      "To: <sip:alice@example.org>",
      "From: <sip:bob@example.org>;tag=49583",
      "Call-ID: a84b4c76e66710",
      "CSeq: 1 MESSAGE",
      "Content-Type: text/plain",
      "Content-Length: 5",
      "",
      "Hello",
    ].join("\r\n");
    const ua = { configuration: {} };
    const request = Parser.parseMessage(raw, ua);
    let sent = "";
    request.server_transaction = {
      receiveResponse: (_code: number, response: string) => {
        sent = response;
      },
    };
    request.reply(405);
    expect(sent.startsWith("SIP/2.0 405 ")).toBe(true);
    expect(sent.split("\r\n")).toContain(`Allow: ${ALLOWED_METHODS}`);
  });
});
