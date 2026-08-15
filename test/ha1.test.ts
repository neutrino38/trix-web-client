import { describe, expect, it } from "vitest";
import { md5 } from "../src/storage/md5.js";
import { computeHa1 } from "../src/storage/ha1.js";

describe("md5 — vecteurs RFC 1321", () => {
  it("chaîne vide", () => {
    expect(md5("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
  });
  it("abc", () => {
    expect(md5("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
  });
  it("message long (multi-blocs)", () => {
    expect(
      md5("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"),
    ).toBe("d174ab98d277d9f5a5611c2c9f419d9f");
  });
  it("80 chiffres (padding à cheval sur deux blocs)", () => {
    expect(
      md5("12345678901234567890123456789012345678901234567890123456789012345678901234567890"),
    ).toBe("57edf4a22be3c955ac49da2e2107b67a");
  });
  it("UTF-8 non-ASCII", () => {
    // référence : crypto.createHash('md5').update('héllo wörld', 'utf8')
    expect(md5("héllo wörld")).toBe("ed0c22cc110ede12327851863c078138");
  });
});

describe("computeHa1 — vecteur RFC 2617 §3.5", () => {
  it("Mufasa / testrealm@host.com / Circle Of Life", () => {
    expect(computeHa1("Mufasa", "testrealm@host.com", "Circle Of Life")).toBe(
      "939e7578ed9e3c518a452acee763bce9",
    );
  });
});
