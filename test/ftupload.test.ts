/**
 * Sending a file (ADR 0012, D7): the store URL setting, the digest answered
 * from the HA1s, the upload against a store that behaves as the reference
 * one does, and the XML the MESSAGE carries.
 */

import { DOMParser } from "@xmldom/xmldom";
import { describe, expect, it, vi } from "vitest";
import { readFtHttp } from "../src/sip/fthttp.js";
import { authorization, buildFtHttp, parseFileStore, readChallenges, uploadFile, type UploadAccount } from "../src/sip/ftupload.js";
import { md5 } from "../src/storage/md5.js";
import { sha256 } from "../src/storage/sha256.js";

const parser = new DOMParser() as never;
const URL_ = "https://files.example.org/files/hft.php";
const ACCOUNT: UploadAccount = {
  url: URL_,
  from: "sip:alice@example.org",
  username: "alice",
  ha1: md5("alice:example.org:secret"),
  ha1Sha256: sha256("alice:example.org:secret"),
};
const NONCE = "ae526c5c0a63c7a09a756166b922837adbbf43d99db562b9f1dfca4aae6f91e6";
const XML =
  '<?xml version="1.0" encoding="UTF-8"?>\n<file xmlns="urn:gsma:params:xml:ns:rcs:rcs:fthttp"><file-info type="file">' +
  "<file-size>5</file-size><file-name>photo.jpg</file-name><content-type>image/jpeg</content-type>" +
  '<data url="https://files.example.org/files/tmp/6ac6_9f8e.jpg" until="2026-10-14T15:30:46Z"/></file-info></file>\n';

describe("parseFileStore", () => {
  it("https, or http on this machine; anything else is no store", () => {
    expect(parseFileStore(" https://files.example.org/files/hft.php ")).toBe(URL_);
    expect(parseFileStore("http://localhost:8089/files/hft.php")).toBe("http://localhost:8089/files/hft.php");
    expect(parseFileStore("http://files.example.org/files/hft.php")).toBe("");
    expect(parseFileStore("javascript:alert(1)")).toBe("");
    expect(parseFileStore(undefined)).toBe("");
  });
});

describe("readChallenges", () => {
  it("the reference store's one challenge, and two joined by fetch", () => {
    const one = `Digest realm="example.org",qop="auth",algorithm=MD5,nonce="${NONCE}",opaque="o"`;
    expect(readChallenges(one)).toEqual([{ realm: "example.org", nonce: NONCE, opaque: "o", qop: "auth", algorithm: "MD5" }]);
    const two = `${one}, Digest realm="example.org",qop="auth",algorithm=SHA-256,nonce="${NONCE}",opaque="o"`;
    expect(readChallenges(two).map((c) => c.algorithm)).toEqual(["MD5", "SHA-256"]);
    expect(readChallenges('Bearer realm="x"')).toEqual([]);
  });
});

describe("authorization", () => {
  it("RFC 7616 with qop=auth, the HA1 of the challenged algorithm, the request path as uri", () => {
    const c = { realm: "example.org", nonce: NONCE, opaque: "o", qop: "auth", algorithm: "MD5" as const };
    const header = authorization(c, ACCOUNT, URL_, "0a4f113b");
    const ha2 = md5("POST:/files/hft.php");
    const expected = md5(`${ACCOUNT.ha1}:${NONCE}:00000001:0a4f113b:auth:${ha2}`);
    expect(header).toContain(`response="${expected}"`);
    expect(header).toContain('uri="/files/hft.php"');
    expect(header).toContain('opaque="o"');
    const strong = authorization({ ...c, algorithm: "SHA-256" }, ACCOUNT, URL_, "0a4f113b");
    expect(strong).toContain(`response="${sha256(`${ACCOUNT.ha1Sha256}:${NONCE}:00000001:0a4f113b:auth:${sha256("POST:/files/hft.php")}`)}"`);
  });
});

/**
 * flexisip-http-file-transfer-server 524ab71 as hft.php does it, MD5 alone
 * offered: every request challenged, an authenticated empty POST a 400.
 */
function phpStore(opts: { digest?: boolean; xml?: string } = {}) {
  const seen: { auth: string | null; from: string | null; file: boolean }[] = [];
  const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    const auth = headers.get("Authorization");
    const file = init.body instanceof FormData;
    seen.push({ auth, from: headers.get("From"), file });
    const valid = (() => {
      if (!auth) return false;
      const p = new Map([...auth.matchAll(/(\w+)="?([^",]+)"?/g)].map((m) => [m[1]!, m[2]!]));
      const ha2 = md5(`POST:${p.get("uri")}`);
      return p.get("response") === md5(`${ACCOUNT.ha1}:${NONCE}:${p.get("nc")}:${p.get("cnonce")}:auth:${ha2}`);
    })();
    if (opts.digest !== false && !valid) {
      return new Response(null, {
        status: 401,
        headers: { "WWW-Authenticate": `Digest realm="example.org",qop="auth",algorithm=MD5,nonce="${NONCE}",opaque="o"` },
      });
    }
    if (!file) return new Response(null, { status: opts.digest === false ? 204 : 400 });
    return new Response(opts.xml ?? XML, { status: 200 });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, seen };
}

const FILE = { name: "IMG 0042.jpg", type: "image/jpeg", data: new Blob(["hello"]) };

describe("uploadFile", () => {
  it("the challenge learnt on the empty POST, answered on the file POST; the local name and type put back", async () => {
    const { fetchImpl, seen } = phpStore();
    const r = await uploadFile(ACCOUNT, FILE, parser, fetchImpl);
    expect(r).toEqual({ ok: true, file: expect.objectContaining({ url: "https://files.example.org/files/tmp/6ac6_9f8e.jpg", name: "IMG 0042.jpg", contentType: "image/jpeg", size: 5 }) });
    expect(seen).toEqual([
      { auth: null, from: "sip:alice@example.org", file: false },
      { auth: expect.stringContaining("Digest"), from: "sip:alice@example.org", file: true },
    ]);
  });

  it("an account without its SHA-256 digest answers MD5", async () => {
    const { fetchImpl } = phpStore();
    expect((await uploadFile({ ...ACCOUNT, ha1Sha256: "" }, FILE, parser, fetchImpl)).ok).toBe(true);
  });

  it("wrong credentials: a second try, then 'credentials'", async () => {
    const { fetchImpl, seen } = phpStore();
    const r = await uploadFile({ ...ACCOUNT, ha1: md5("alice:example.org:wrong") }, FILE, parser, fetchImpl);
    expect(r).toEqual({ ok: false, failure: "credentials", status: 401 });
    expect(seen).toHaveLength(3);
  });

  it("a store without digest: 204, then the file with no Authorization", async () => {
    const { fetchImpl, seen } = phpStore({ digest: false });
    expect((await uploadFile(ACCOUNT, FILE, parser, fetchImpl)).ok).toBe(true);
    expect(seen.map((s) => s.auth)).toEqual([null, null]);
  });

  it("too large, no answer, an answer that is not the XML", async () => {
    const big = vi.fn(async () => new Response(null, { status: 400 })) as unknown as typeof fetch;
    expect(await uploadFile(ACCOUNT, FILE, parser, big)).toEqual({ ok: false, failure: "tooLarge", status: 400 });
    const down = vi.fn(async () => Promise.reject(new TypeError("network"))) as unknown as typeof fetch;
    expect(await uploadFile(ACCOUNT, FILE, parser, down)).toEqual({ ok: false, failure: "noAnswer", status: null });
    const { fetchImpl } = phpStore({ xml: "<html/>" });
    expect(await uploadFile(ACCOUNT, FILE, parser, fetchImpl)).toEqual({ ok: false, failure: "refused", status: 200 });
  });
});

describe("buildFtHttp", () => {
  it("Linphone's shape, read back to the same file", () => {
    const file = {
      url: "https://files.example.org/files/tmp/v.mka",
      name: "vocal 1.mka",
      size: 18432,
      contentType: "audio/wav;voice-recording=yes",
      until: Date.parse("2026-10-09T10:21:45Z"),
      playingLengthMs: 4320,
    };
    const xml = buildFtHttp(file);
    expect(xml).toContain("<file-name>vocal%201.mka</file-name>\r\n");
    expect(xml).toContain('until="2026-10-09T10:21:45Z"');
    expect(readFtHttp(xml, parser)).toEqual(file);
  });
});
