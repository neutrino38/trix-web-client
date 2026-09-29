import { afterEach, describe, expect, it } from "vitest";
import Constants from "jssip/lib/Constants.js";
// @ts-expect-error — JsSIP internal module, no type declarations
import Parser from "jssip/lib/Parser.js";
import {
  ACCEPTED_BODY_TYPES,
  ACCEPTED_BODY_TYPES_WITH_TEXT,
  ALLOWED_METHODS,
  ALLOWED_METHODS_WITH_MESSAGE,
  announceMessaging,
  createJsSipPort,
} from "../src/sip/port.js";

/**
 * What Trix announces in `Allow` and `Accept` follows whether messaging is
 * on (ADR 0008, D13): off, an incoming MESSAGE is answered 405, and a 405
 * whose own `Allow` lists the refused method would contradict itself.
 */

const MESSAGE = (contentType: string) =>
  [
    "MESSAGE sip:alice@example.org SIP/2.0",
    "Via: SIP/2.0/WSS proxy.example.org;branch=z9hG4bK776asdhds",
    "Max-Forwards: 70",
    "To: <sip:alice@example.org>",
    "From: <sip:bob@example.org>;tag=49583",
    "Call-ID: a84b4c76e66710",
    "CSeq: 1 MESSAGE",
    `Content-Type: ${contentType}`,
    "Content-Length: 5",
    "",
    "Hello",
  ].join("\r\n");

/** The response JsSIP writes for `code`, headers split into lines. */
function replyTo(raw: string, code: number): string[] {
  const request = Parser.parseMessage(raw, { configuration: {} });
  let sent = "";
  request.server_transaction = {
    receiveResponse: (_code: number, response: string) => {
      sent = response;
    },
  };
  request.reply(code);
  return sent.split("\r\n");
}

afterEach(() => announceMessaging(false));

describe("Allow header, messaging off", () => {
  it("leaves MESSAGE out until a port says otherwise", () => {
    expect(ALLOWED_METHODS.split(",")).not.toContain("MESSAGE");
    expect(Constants.ALLOWED_METHODS).toBe(ALLOWED_METHODS);
  });

  it("goes out on the 405 answering a MESSAGE", () => {
    createJsSipPort({ messaging: false });
    const lines = replyTo(MESSAGE("text/plain"), 405);
    expect(lines[0]).toMatch(/^SIP\/2\.0 405 /);
    expect(lines).toContain(`Allow: ${ALLOWED_METHODS}`);
  });

  it("keeps JsSIP's own Accept", () => {
    createJsSipPort({ messaging: false });
    expect(Constants.ACCEPTED_BODY_TYPES).toBe(ACCEPTED_BODY_TYPES);
  });
});

describe("Allow header, messaging on", () => {
  it("announces MESSAGE", () => {
    createJsSipPort();
    expect(Constants.ALLOWED_METHODS).toBe(ALLOWED_METHODS_WITH_MESSAGE);
    expect(ALLOWED_METHODS_WITH_MESSAGE.split(",")).toContain("MESSAGE");
  });

  it("names text/plain and message/cpim in the 415 refusing another body type", () => {
    createJsSipPort({ messaging: true });
    const lines = replyTo(MESSAGE("text/html"), 415);
    expect(lines).toContain(`Accept: ${ACCEPTED_BODY_TYPES_WITH_TEXT}`);
    expect(ACCEPTED_BODY_TYPES_WITH_TEXT).toContain("message/cpim");
  });
});
