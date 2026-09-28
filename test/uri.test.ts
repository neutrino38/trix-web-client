/**
 * The address key (ADR 0007, D7): what says that a call in the history and
 * a contact in the book are the same correspondent.
 */

import { describe, expect, it } from "vitest";
import { addressKey, normalizeTarget } from "../src/sip/uri.js";

describe("addressKey", () => {
  it("a history target and a contact URI meet", () => {
    expect(addressKey("bob@example.fr")).toBe("bob@example.fr");
    expect(addressKey("sip:bob@example.fr")).toBe("bob@example.fr");
    expect(addressKey("sips:bob@example.fr")).toBe("bob@example.fr");
  });

  it("the domain is case-insensitive, the user part is not (RFC 3261 §19.1.4)", () => {
    expect(addressKey("sip:Bob@Example.FR")).toBe("Bob@example.fr");
  });

  it("URI parameters are not part of who it is", () => {
    expect(addressKey("sip:bob@example.fr;transport=ws")).toBe("bob@example.fr");
  });

  it("agrees with normalizeTarget on a short number", () => {
    expect(addressKey(normalizeTarget("1000", "pbx.example.fr")!)).toBe("1000@pbx.example.fr");
  });

  it.each(["", "bob", "@example.fr", "bob@", "bob smith@example.fr", "a@b@c"])(
    "%j has no key",
    (raw) => {
      expect(addressKey(raw)).toBeNull();
    },
  );
});
