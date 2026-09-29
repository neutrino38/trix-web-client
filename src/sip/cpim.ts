/**
 * CPIM (RFC 3862) as Linphone writes and reads it: a `message/cpim` body
 * wrapping one MIME part, with the IMDN namespace (RFC 5438) for
 * `imdn.Message-ID` (ADR 0009).
 *
 * ```
 * From: <sip:alice@example.org>
 * To: <sip:bob@example.org>
 * DateTime: 2026-09-29T10:00:00Z
 * NS: imdn <urn:ietf:params:imdn>
 * imdn.Message-ID: 5GjI8B~cU
 *
 * Content-Type: text/plain;charset=UTF-8
 *
 * Bonjour
 * ```
 *
 * Two headers are read, and nothing else: `DateTime`, the time the sender
 * wrote the message, and `imdn.Message-ID`, which lets a message delivered
 * twice be filed once. The CPIM `From` is not: the sender is the SIP
 * `From`, the one the proxy authenticated. A disposition request
 * (`imdn.Disposition-Notification`) is not honoured, and none is made.
 */

export const CPIM_CONTENT_TYPE = "message/cpim";
export const IMDN_CONTENT_TYPE = "message/imdn+xml";
const IMDN_NS = "urn:ietf:params:imdn";

/** Past this, a Message-ID is not one we keep: RFC 5438 ids are short tokens. */
const MAX_MESSAGE_ID_LENGTH = 128;

export interface CpimMessage {
  /** `DateTime` as epoch ms; null when absent or not RFC 3339. */
  dateTime: number | null;
  /** `imdn.Message-ID`; null when absent or unusable. */
  messageId: string | null;
  /** The inner part's `Content-Type`; null when it has none. */
  contentType: string | null;
  body: string;
}

/** Is this a CPIM body type? Parameters are ignored. */
export function isCpim(contentType: string | null): boolean {
  return contentType?.split(";")[0]!.trim().toLowerCase() === CPIM_CONTENT_TYPE;
}

/** Splits `text` at its first empty line; null when there is none. */
function cut(text: string): [head: string, rest: string] | null {
  const m = /\r?\n\r?\n/.exec(text);
  if (!m) return null;
  return [text.slice(0, m.index), text.slice(m.index + m[0].length)];
}

/** `Name: value` lines, first occurrence kept; names as written (CPIM names are case-sensitive). */
function headers(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of block.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim();
    if (!out.has(name)) out.set(name, line.slice(colon + 1).trim());
  }
  return out;
}

/** Same, with lower-cased names: the inner part's headers are MIME ones. */
function mimeHeaders(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [name, value] of headers(block)) {
    if (!out.has(name.toLowerCase())) out.set(name.toLowerCase(), value);
  }
  return out;
}

/**
 * The prefixes bound to the IMDN namespace. `NS` may appear several times,
 * so it is read line by line; `imdn` counts even undeclared, since that is
 * the only prefix anyone uses.
 */
function imdnPrefixes(block: string): Set<string> {
  const prefixes = new Set(["imdn"]);
  for (const line of block.split(/\r?\n/)) {
    const m = /^NS:\s*([^\s<]*)\s*<([^>]*)>/.exec(line.trim());
    if (m && m[2]!.trim() === IMDN_NS && m[1]) prefixes.add(m[1]);
  }
  return prefixes;
}

/**
 * An RFC 3339 date-time as epoch ms. `+hhmm` is taken as `+hh:mm`: not
 * RFC 3339, but it costs nothing to forgive.
 */
export function parseDateTime(value: string): number | null {
  const m = /^(\d{4}-\d{2}-\d{2})[Tt ](\d{2}:\d{2}:\d{2}(?:\.\d+)?)([Zz]|[+-]\d{2}:?\d{2})$/.exec(value.trim());
  if (!m) return null;
  const zone = m[3]!.toUpperCase() === "Z" ? "Z" : m[3]!.replace(/^([+-]\d{2}):?(\d{2})$/, "$1:$2");
  const at = Date.parse(`${m[1]}T${m[2]}${zone}`);
  return Number.isNaN(at) ? null : at;
}

/** Reads a CPIM body; null when it has not the two blank-line-separated sections. */
export function parseCpim(body: string): CpimMessage | null {
  const outer = cut(body);
  if (!outer) return null;
  const [cpimBlock, rest] = outer;
  const inner = cut(rest);
  if (!inner) return null;
  const [mimeBlock, content] = inner;

  const cpim = headers(cpimBlock);
  const dateTime = cpim.has("DateTime") ? parseDateTime(cpim.get("DateTime")!) : null;
  let messageId: string | null = null;
  for (const prefix of imdnPrefixes(cpimBlock)) {
    const id = cpim.get(`${prefix}.Message-ID`);
    if (id && id.length <= MAX_MESSAGE_ID_LENGTH) {
      messageId = id;
      break;
    }
  }
  return {
    dateTime,
    messageId,
    contentType: mimeHeaders(mimeBlock).get("content-type") ?? null,
    body: content,
  };
}

/** RFC 3339 in UTC, to the second: what Linphone writes. */
export function formatDateTime(at: number): string {
  return new Date(at).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** A `text/plain` message wrapped in CPIM, with its `imdn.Message-ID`. */
export function buildCpim(opts: { from: string; to: string; at: number; messageId: string; text: string }): string {
  return [
    `From: <${opts.from}>`,
    `To: <${opts.to}>`,
    `DateTime: ${formatDateTime(opts.at)}`,
    `NS: imdn <${IMDN_NS}>`,
    `imdn.Message-ID: ${opts.messageId}`,
    "",
    "Content-Type: text/plain;charset=UTF-8",
    "",
    opts.text,
  ].join("\r\n");
}
