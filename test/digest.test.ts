import { describe, expect, it, vi } from "vitest";
// @ts-expect-error — module interne de JsSIP, sans déclaration de types
import DigestAuthentication from "jssip/lib/DigestAuthentication.js";
import { installSha256Digest, useSha256Ha1 } from "../src/sip/digest.js";
import { computeHa1, computeHa1Sha256 } from "../src/storage/ha1.js";

/**
 * Le défi et sa réponse tels que RFC 7616 §3.9.1 les donne — le seul
 * vecteur publié qui couvre SHA-256 de bout en bout. La méthode et l'URI
 * sont celles de HTTP ; la construction de RFC 2617 §3.2.2 ne les regarde
 * pas autrement que comme deux chaînes, et c'est justement ce qui permet à
 * SIP de reprendre le calcul tel quel.
 */
const RFC = {
  username: "Mufasa",
  realm: "http-auth@example.org",
  password: "Circle of Life",
  nonce: "7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v",
  cnonce: "f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ",
  method: "GET",
  uri: "/dir/index.html",
  response: "753927fa0e85d155564e2e272a28d1802ca10daf4496794697cf8db5856cb6c1",
};

interface Digest {
  authenticate(
    request: { method: string; ruri: string; body?: string | null },
    challenge: Record<string, unknown>,
    cnonce?: string | null,
  ): boolean;
  toString(): string;
}

/** Une authentification telle que `RequestSender` la construit. */
function newDigest(over: Partial<Record<string, unknown>> = {}): Digest {
  const Klass = DigestAuthentication as new (credentials: unknown) => Digest;
  return new Klass({
    username: RFC.username,
    password: null, // Trix n'en stocke pas : seules les empreintes répondent
    realm: RFC.realm,
    ha1: computeHa1(RFC.username, RFC.realm, RFC.password),
    ...over,
  });
}

const sha256Challenge = (over: Record<string, unknown> = {}) => ({
  algorithm: "SHA-256",
  realm: RFC.realm,
  nonce: RFC.nonce,
  qop: ["auth"],
  ...over,
});

const request = { method: RFC.method, ruri: RFC.uri, body: null };

describe("défi SHA-256 (RFC 8760) — la greffe sur JsSIP", () => {
  it("répond au vecteur de RFC 7616 §3.9.1", () => {
    const release = useSha256Ha1(RFC.username, RFC.realm, {
      ha1: computeHa1Sha256(RFC.username, RFC.realm, RFC.password),
      onMissing: () => expect.unreachable("l'empreinte est là"),
    });
    const auth = newDigest();
    expect(auth.authenticate(request, sha256Challenge(), RFC.cnonce)).toBe(true);
    const header = auth.toString();
    expect(header).toContain(`response="${RFC.response}"`);
    // RFC 8760 §2.4 : l'algorithme est renvoyé tel qu'il a été reçu
    expect(header).toContain("algorithm=SHA-256");
    expect(header).toContain("nc=00000001");
    expect(header).toContain(`cnonce="${RFC.cnonce}"`);
    release();
  });

  it("sans qop, la réponse suit la forme courte de RFC 2617", () => {
    const release = useSha256Ha1(RFC.username, RFC.realm, {
      ha1: computeHa1Sha256(RFC.username, RFC.realm, RFC.password),
      onMissing: () => expect.unreachable("l'empreinte est là"),
    });
    const auth = newDigest();
    expect(auth.authenticate(request, sha256Challenge({ qop: undefined }))).toBe(true);
    const header = auth.toString();
    expect(header).toContain("algorithm=SHA-256");
    expect(header).not.toContain("qop=");
    release();
  });

  it("empreinte vide : pas de réponse, et l'utilisateur est averti", () => {
    const onMissing = vi.fn();
    const release = useSha256Ha1(RFC.username, RFC.realm, { ha1: "", onMissing });
    const auth = newDigest();
    expect(auth.authenticate(request, sha256Challenge(), RFC.cnonce)).toBe(false);
    expect(onMissing).toHaveBeenCalledOnce();
    // rien à présenter : l'en-tête ne peut pas être fabriqué
    expect(() => auth.toString()).toThrow();
    release();
  });

  it("realm inconnu : refus, mais ce n'est pas l'empreinte qui manque", () => {
    const onMissing = vi.fn();
    const release = useSha256Ha1(RFC.username, RFC.realm, {
      ha1: computeHa1Sha256(RFC.username, RFC.realm, RFC.password),
      onMissing,
    });
    const auth = newDigest();
    expect(auth.authenticate(request, sha256Challenge({ realm: "autre.example.org" }))).toBe(false);
    expect(onMissing).not.toHaveBeenCalled();
    release();
  });

  it("le compte rendu s'arrête avec la session SIP", () => {
    const onMissing = vi.fn();
    const release = useSha256Ha1(RFC.username, RFC.realm, {
      ha1: computeHa1Sha256(RFC.username, RFC.realm, RFC.password),
      onMissing,
    });
    release();
    expect(newDigest().authenticate(request, sha256Challenge(), RFC.cnonce)).toBe(false);
    expect(onMissing).not.toHaveBeenCalled();
  });
});

describe("MD5 reste ce que JsSIP en fait", () => {
  it("le vecteur de RFC 2617 §3.5 traverse la greffe intact", () => {
    installSha256Digest();
    const auth = newDigest({
      username: "Mufasa",
      realm: "testrealm@host.com",
      ha1: computeHa1("Mufasa", "testrealm@host.com", "Circle Of Life"),
    });
    const ok = auth.authenticate(
      { method: "GET", ruri: "/dir/index.html", body: null },
      {
        algorithm: "MD5",
        realm: "testrealm@host.com",
        nonce: "dcd98b7102dd2f0e8b11d0f600bfb0c093",
        qop: ["auth"],
      },
      "0a4f113b",
    );
    expect(ok).toBe(true);
    expect(auth.toString()).toContain('response="6629fae49393a05397450978507c4ef1"');
  });

  it("un défi sans algorithme reste du MD5, empreinte SHA-256 ou non", () => {
    installSha256Digest();
    const auth = newDigest({
      username: "Mufasa",
      realm: "testrealm@host.com",
      ha1: computeHa1("Mufasa", "testrealm@host.com", "Circle Of Life"),
    });
    const ok = auth.authenticate(
      { method: "GET", ruri: "/dir/index.html", body: null },
      {
        realm: "testrealm@host.com",
        nonce: "dcd98b7102dd2f0e8b11d0f600bfb0c093",
        qop: ["auth"],
      },
      "0a4f113b",
    );
    expect(ok).toBe(true);
    expect(auth.toString()).toContain("algorithm=MD5");
  });

  it("un algorithme que Trix ne sait pas condenser reste refusé", () => {
    installSha256Digest();
    expect(newDigest().authenticate(request, sha256Challenge({ algorithm: "SHA-512-256" }))).toBe(
      false,
    );
  });
});
