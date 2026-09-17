import { describe, expect, it } from "vitest";
import { md5 } from "../src/storage/md5.js";
import { sha256 } from "../src/storage/sha256.js";
import { computeHa1, computeHa1Sha256 } from "../src/storage/ha1.js";

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

describe("sha256 — vecteurs FIPS 180-4", () => {
  it("chaîne vide", () => {
    expect(sha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
  it("abc", () => {
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("message long (multi-blocs)", () => {
    expect(sha256("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789")).toBe(
      "db4bfcbd4da0cd85a60c3c37d3fbd8805c77f15fc6b1fdfe614ee0a7c8fdb4c0",
    );
  });
  it("80 chiffres (padding à cheval sur deux blocs)", () => {
    expect(
      sha256("12345678901234567890123456789012345678901234567890123456789012345678901234567890"),
    ).toBe("f371bc4a311f2b009eef952dd83ca80e2b60026c8e935592d0f9c308453c813e");
  });
  it("UTF-8 non-ASCII", () => {
    // référence : crypto.createHash('sha256').update('héllo wörld', 'utf8')
    expect(sha256("héllo wörld")).toBe(
      "a1003f7d04a4115711d0b48a2eaf1359ce565d2d2a6fd65098dfcffadeeef59f",
    );
  });
  it("55 et 56 octets — la bascule du bloc de padding", () => {
    // référence : crypto.createHash('sha256')
    expect(sha256("a".repeat(55))).toBe(
      "9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318",
    );
    expect(sha256("a".repeat(56))).toBe(
      "b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a",
    );
  });
});

describe("computeHa1Sha256 — la même empreinte, autre condensé (RFC 8760)", () => {
  it("Mufasa / testrealm@host.com / Circle Of Life", () => {
    expect(computeHa1Sha256("Mufasa", "testrealm@host.com", "Circle Of Life")).toBe(
      "3ba6cd94661c5ef34598040c868f13b8775df29109986be50ad35ae537dd3aa4",
    );
  });

  it("les deux empreintes d'un même mot de passe ne se confondent pas", () => {
    const md5Ha1 = computeHa1("alice", "example.fr", "secret123");
    const shaHa1 = computeHa1Sha256("alice", "example.fr", "secret123");
    expect(md5Ha1).toHaveLength(32);
    expect(shaHa1).toHaveLength(64);
    expect(shaHa1.startsWith(md5Ha1)).toBe(false);
  });
});
