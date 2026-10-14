/**
 * Sending a file the way Linphone does (ADR 0012, D7): upload it to the
 * account's HTTP store, then page the XML the store answers with.
 *
 * The sequence is RCS's (RCC.07 §3.5.4.8), bent to the reference store as
 * it is (elixip, DESIGN-CHAT-MEDIA §2.8, rehearsed in containers):
 *
 * 1. an empty `POST`, `From: sip:user@domain` — a **bare** URI: the store
 *    reads the user and the realm out of it by cutting at `:` and `@`, and a
 *    display name or angle brackets break the realm. 204: a store without
 *    authentication; 401: its challenge;
 * 2. the `POST` of the file, `multipart/form-data`, one part named `File`,
 *    with the `Authorization` answering that challenge. Not on the empty
 *    request: an authenticated empty POST is answered **400** by the
 *    reference store, which finds no file in it;
 * 3. 200 with the XML. A 401 to the file POST is answered once more, with
 *    the challenge it carries — the first nonce may have aged (10 s windows).
 *
 * The digest is computed from the account's **HA1s**, never a password —
 * Trix keeps none (`storage/ha1.ts`). The store's realm is the SIP domain
 * of the `From`, the realm both HA1s were computed with. MD5 or SHA-256 is
 * chosen among the challenges by which HA1 the account holds, SHA-256
 * first; an account saved before SHA-256 was kept answers MD5 only.
 *
 * `fetch` with `credentials: "omit"` and `mode: "cors"`: a cross-origin 401
 * never raises the browser's own login dialog, and `WWW-Authenticate` is
 * readable because the store exposes it.
 */

import { md5 } from "../storage/md5.js";
import { sha256 } from "../storage/sha256.js";
import { readFtHttp, type FileAttachment } from "./fthttp.js";
import type { XmlParser } from "./pidf.js";

/** What the upload needs of the account. */
export interface UploadAccount {
  /** The store's upload URL (`AccountConfig.fileStore`). */
  url: string;
  /** `sip:user@domain`, bare. */
  from: string;
  /** The digest username: the authentication id, else the user. */
  username: string;
  ha1: string;
  /** Empty when the account has none. */
  ha1Sha256: string;
}

/** The file to upload, as the picker or the recorder hands it. */
export interface UploadFile {
  name: string;
  /** Parameters included: a voice message is `audio/wav;voice-recording=yes`. */
  type: string;
  data: Blob;
  /** Voice messages: their length, written in the XML of the MESSAGE. */
  playingLengthMs?: number;
}

/** Why an upload failed, as a word the interface can say. */
export type UploadFailure = "tooLarge" | "credentials" | "noAnswer" | "refused" | "noDigest";

export type UploadResult = { ok: true; file: FileAttachment } | { ok: false; failure: UploadFailure; status: number | null };

/** The store URL as the settings take it: `https://…`, or `http://` on this machine only; else empty. */
export function parseFileStore(value: unknown): string {
  if (typeof value !== "string") return "";
  const url = value.trim();
  if (/^https:\/\/\S+$/i.test(url)) return url;
  if (/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/\S*$/i.test(url)) return url;
  return "";
}

interface Challenge {
  realm: string;
  nonce: string;
  opaque: string | null;
  qop: string | null;
  algorithm: "MD5" | "SHA-256";
}

/**
 * The digest challenges of a 401. `fetch` joins repeated `WWW-Authenticate`
 * fields with ", ", so the value is cut before each `Digest`.
 */
export function readChallenges(header: string | null): Challenge[] {
  if (!header) return [];
  return header
    .split(/,?\s*(?=\bDigest\s)/i)
    .filter((part) => /^Digest\s/i.test(part.trim()))
    .flatMap((part) => {
      const params = new Map<string, string>();
      for (const m of part.matchAll(/([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|([^,\s]+))/g)) {
        params.set(m[1]!.toLowerCase(), m[2] ?? m[3]!);
      }
      const realm = params.get("realm");
      const nonce = params.get("nonce");
      if (realm === undefined || nonce === undefined) return [];
      const algo = (params.get("algorithm") ?? "MD5").toUpperCase();
      if (algo !== "MD5" && algo !== "SHA-256") return [];
      return [{ realm, nonce, opaque: params.get("opaque") ?? null, qop: params.get("qop") ?? null, algorithm: algo }];
    });
}

/** The challenge this account can answer, SHA-256 first; null when none. */
function pick(challenges: Challenge[], account: UploadAccount): Challenge | null {
  if (account.ha1Sha256) {
    const strong = challenges.find((c) => c.algorithm === "SHA-256");
    if (strong) return strong;
  }
  return challenges.find((c) => c.algorithm === "MD5") ?? null;
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** RFC 7616: the Authorization answering `c` for a POST to `url`. */
export function authorization(c: Challenge, account: UploadAccount, url: string, cnonce = randomHex(8)): string {
  const hash = c.algorithm === "SHA-256" ? sha256 : md5;
  const ha1 = c.algorithm === "SHA-256" ? account.ha1Sha256 : account.ha1;
  const u = new URL(url);
  const uri = u.pathname + u.search;
  const ha2 = hash(`POST:${uri}`);
  const nc = "00000001";
  const withQop = c.qop !== null && c.qop.split(",").map((q) => q.trim()).includes("auth");
  const response = withQop ? hash(`${ha1}:${c.nonce}:${nc}:${cnonce}:auth:${ha2}`) : hash(`${ha1}:${c.nonce}:${ha2}`);
  return [
    `Digest username="${account.username}"`,
    `realm="${c.realm}"`,
    `nonce="${c.nonce}"`,
    `uri="${uri}"`,
    `algorithm=${c.algorithm}`,
    `response="${response}"`,
    ...(withQop ? ["qop=auth", `nc=${nc}`, `cnonce="${cnonce}"`] : []),
    ...(c.opaque !== null ? [`opaque="${c.opaque}"`] : []),
  ].join(", ");
}

function failed(status: number | null): UploadResult {
  if (status === null) return { ok: false, failure: "noAnswer", status };
  if (status === 400 || status === 413) return { ok: false, failure: "tooLarge", status };
  if (status === 401 || status === 403) return { ok: false, failure: "credentials", status };
  return { ok: false, failure: "refused", status };
}

/**
 * Uploads `file` and answers what the store's XML says of it, with the
 * local name and type put back — the store drops a type's parameters — and
 * the voice length the recorder measured.
 */
export async function uploadFile(
  account: UploadAccount,
  file: UploadFile,
  parser: XmlParser,
  fetchImpl: typeof fetch = fetch,
): Promise<UploadResult> {
  const base: RequestInit = { method: "POST", credentials: "omit", mode: "cors" };
  try {
    const probe = await fetchImpl(account.url, { ...base, headers: { From: account.from } });
    let challenge: Challenge | null = null;
    if (probe.status === 401) {
      challenge = pick(readChallenges(probe.headers.get("WWW-Authenticate")), account);
      if (challenge === null) return { ok: false, failure: "noDigest", status: 401 };
    } else if (probe.status !== 204 && probe.status !== 200) {
      return failed(probe.status);
    }

    for (let tries = 2; tries > 0; tries--) {
      const form = new FormData();
      form.append("File", new Blob([file.data], { type: file.type }), file.name);
      const headers: Record<string, string> = { From: account.from };
      if (challenge !== null) headers.Authorization = authorization(challenge, account, account.url);
      const res = await fetchImpl(account.url, { ...base, headers, body: form });
      if (res.status === 200) {
        const read = readFtHttp(await res.text(), parser);
        if (read === null) return { ok: false, failure: "refused", status: 200 };
        return {
          ok: true,
          file: { ...read, name: file.name, contentType: file.type, playingLengthMs: file.playingLengthMs ?? read.playingLengthMs },
        };
      }
      if (res.status !== 401 || tries === 1) return failed(res.status);
      challenge = pick(readChallenges(res.headers.get("WWW-Authenticate")), account);
      if (challenge === null) return { ok: false, failure: "noDigest", status: 401 };
    }
    return failed(null);
  } catch (err) {
    // a CSP connect-src without the store, or a store without CORS, ends
    // here before any request shows in the network panel
    console.warn("[trix] upload to the file store failed", err);
    return failed(null);
  }
}

/** Percent-escapes a name as Linphone does: all but alphanumerics and `-_.[]`. */
function escapeName(name: string): string {
  return Array.from(new TextEncoder().encode(name), (b) => {
    const c = String.fromCharCode(b);
    return /[A-Za-z0-9\-_.[\]]/.test(c) ? c : `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
  }).join("");
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * The XML the MESSAGE carries, in Linphone's own shape (elixip,
 * DESIGN-CHAT-MEDIA §2.2): CRLF line ends, the `am` namespace, the store's
 * URL, `until` and size, the local name and type, and a voice message's
 * length in milliseconds.
 */
export function buildFtHttp(file: FileAttachment): string {
  const until = file.until !== null ? ` until="${new Date(file.until).toISOString().replace(/\.\d{3}Z$/, "Z")}"` : "";
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<file xmlns="urn:gsma:params:xml:ns:rcs:rcs:fthttp" xmlns:am="urn:gsma:params:xml:ns:rcs:rcs:rram">',
    '<file-info type="file">',
    ...(file.size !== null ? [`<file-size>${file.size}</file-size>`] : []),
    ...(file.name !== null ? [`<file-name>${xmlEscape(escapeName(file.name))}</file-name>`] : []),
    ...(file.contentType !== null ? [`<content-type>${xmlEscape(file.contentType)}</content-type>`] : []),
    ...(file.playingLengthMs !== null ? [`<am:playing-length>${file.playingLengthMs}</am:playing-length>`] : []),
    `<data url="${xmlEscape(file.url)}"${until}/>`,
    "</file-info>",
    "</file>",
    "",
  ].join("\r\n");
}
