/**
 * Attachments in chat, the way Linphone sends them (ADR 0012): the file
 * goes to an HTTP store, and the MESSAGE carries an RCS XML naming it —
 * `application/vnd.gsma.rcs-ft-http+xml` (GSMA RCC.07 §3.5.4.8).
 *
 * ```xml
 * <file xmlns="urn:gsma:params:xml:ns:rcs:rcs:fthttp"
 *       xmlns:am="urn:gsma:params:xml:ns:rcs:rcs:rram">
 *   <file-info type="file">
 *     <file-size>184233</file-size>
 *     <file-name>IMG_0042.jpg</file-name>
 *     <content-type>image/jpeg</content-type>
 *     <am:playing-length>4320</am:playing-length>
 *     <data url="https://files.example.com/files/tmp/68de…c2.jpg" until="2026-10-09T10:21:45Z"/>
 *   </file-info>
 * </file>
 * ```
 *
 * Read as Linphone reads it (elixip, DESIGN-CHAT-MEDIA §2.2-2.3): the
 * `file-info` of type `file` alone — a thumbnail is ignored —, the name
 * percent-decoded, a voice message recognised by its exact type
 * `audio/wav;voice-recording=yes` whatever the container really is, and
 * `playing-length` in **milliseconds** (RCS says seconds; Linphone writes
 * milliseconds). `file-key` and `file-authTag` belong to LIME and are
 * ignored.
 *
 * Where the XML is found, once the CPIM envelope is opened
 * (`sip/message.ts`): the body itself; a `multipart/mixed` whose XML part
 * comes with a `text/plain` caption; or the older
 * `message/external-body; access-type=URL; URL="…"`, which names a URL
 * and nothing else.
 *
 * No global DOM: the XML parser is injected, as for PIDF (`sip/pidf.ts`).
 */

import type { XmlParser } from "./pidf.js";

export const FTHTTP_CONTENT_TYPE = "application/vnd.gsma.rcs-ft-http+xml";
export const FTHTTP_NS = "urn:gsma:params:xml:ns:rcs:rcs:fthttp";
export const RRAM_NS = "urn:gsma:params:xml:ns:rcs:rcs:rram";

/** Linphone's voice message: this type, parameter included, and nothing else. */
export const VOICE_RECORDING_TYPE = "audio/wav;voice-recording=yes";

/** Past this, a body is not an fthttp document: they are a few hundred bytes. */
const MAX_XML_BYTES = 16 * 1024;

/** One file, as the XML describes it. Every field but `url` may be missing. */
export interface FileAttachment {
  url: string;
  name: string | null;
  size: number | null;
  /** As written, parameters included. */
  contentType: string | null;
  /** Epoch ms of `until`: past it, the store has deleted the file. */
  until: number | null;
  /** Voice messages: the length in milliseconds. */
  playingLengthMs: number | null;
}

/** What a MESSAGE body carries when it names a file: the file, and its caption if any. */
export interface Attachment {
  file: FileAttachment;
  /** The `text/plain` part beside the XML; null without one. */
  caption: string | null;
}

/** Is this a voice message? Strict, as Linphone's test is. */
export function isVoiceMessage(file: Pick<FileAttachment, "contentType">): boolean {
  return file.contentType?.replace(/\s+/g, "").toLowerCase() === VOICE_RECORDING_TYPE;
}

/** Has the store deleted it by now? A file without `until` is not known to expire. */
export function isExpired(file: Pick<FileAttachment, "until">, now: number): boolean {
  return file.until !== null && file.until <= now;
}

function mediaType(contentType: string | null): string {
  return contentType?.split(";")[0]!.trim().toLowerCase() ?? "";
}

/** A parameter of a media type, unquoted; null when absent. */
function param(contentType: string, name: string): string | null {
  const m = new RegExp(`;\\s*${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, "i").exec(contentType);
  return m ? (m[1] ?? m[2]!) : null;
}

/** Elements under `parent`, at any depth, by local name — whatever their prefix. */
function byLocalName(parent: Element | Document, name: string): Element[] {
  const all = parent.getElementsByTagName("*");
  const out: Element[] = [];
  for (let i = 0; i < all.length; i++) if (all.item(i)!.localName === name) out.push(all.item(i)!);
  return out;
}

function textOf(el: Element | undefined): string | null {
  const text = el?.textContent?.trim();
  return text ? text : null;
}

function count(text: string | null): number | null {
  if (text === null || !/^\d+$/.test(text)) return null;
  return Number(text);
}

function decodeName(name: string | null): string | null {
  if (name === null) return null;
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/** Only a web address is a file the browser may fetch: no `javascript:`, no `data:`. */
function webUrl(url: string | null): string | null {
  return url !== null && /^https?:\/\/\S+$/i.test(url) ? url : null;
}

/** Reads an fthttp document; null when it is not one, or names no fetchable file. Never throws. */
export function readFtHttp(xml: string, parser: XmlParser): FileAttachment | null {
  if (xml.length > MAX_XML_BYTES || /<!DOCTYPE/i.test(xml)) return null;
  let doc: Document;
  try {
    doc = parser.parseFromString(xml, "application/xml");
  } catch {
    return null;
  }
  const root = doc?.documentElement;
  if (!root || root.localName !== "file" || doc.getElementsByTagName("parsererror").length > 0) return null;
  const info = byLocalName(root, "file-info").find((el) => el.getAttribute("type") === "file");
  if (!info) return null;
  const data = byLocalName(info, "data")[0];
  const url = webUrl(data?.getAttribute("url") ?? null);
  if (url === null) return null;
  const until = data?.getAttribute("until");
  const at = until ? Date.parse(until) : NaN;
  const playing = byLocalName(info, "playing-length").find((el) => el.namespaceURI === RRAM_NS);
  return {
    url,
    name: decodeName(textOf(byLocalName(info, "file-name")[0])),
    size: count(textOf(byLocalName(info, "file-size")[0])),
    contentType: textOf(byLocalName(info, "content-type")[0]),
    until: Number.isNaN(at) ? null : at,
    playingLengthMs: count(textOf(playing)),
  };
}

/** The parts of a multipart body, each with its type; the line break before a delimiter is the delimiter's. */
function parts(contentType: string, body: string): { type: string | null; body: string }[] | null {
  const boundary = param(contentType, "boundary");
  if (boundary === null) return null;
  const out: { type: string | null; body: string }[] = [];
  for (const chunk of body.split(new RegExp(`\\r?\\n?--${boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)).slice(1)) {
    if (chunk.startsWith("--")) break;
    const part = chunk.replace(/^[ \t]*\r?\n/, "");
    const m = /\r?\n\r?\n/.exec(part);
    if (!m) continue;
    const head = part.slice(0, m.index);
    const typeLine = /^content-type:\s*(.+)$/im.exec(head);
    out.push({ type: typeLine?.[1]?.trim() ?? null, body: part.slice(m.index + m[0].length) });
  }
  return out;
}

/** A caption is text a person wrote: `text/plain` in UTF-8 or US-ASCII. */
function caption(type: string | null, body: string): string | null {
  if (mediaType(type) !== "text/plain") return null;
  const charset = type ? param(type, "charset")?.toLowerCase() : null;
  if (charset && charset !== "utf-8" && charset !== "us-ascii") return null;
  return body.trim() === "" ? null : body;
}

/**
 * The file a body names, with its caption; null when it names none. The
 * body is the one CPIM wrapped, or the bare one (`sip/message.ts`).
 */
export function readAttachment(contentType: string | null, body: string, parser: XmlParser): Attachment | null {
  const type = mediaType(contentType);
  if (type === FTHTTP_CONTENT_TYPE) {
    const file = readFtHttp(body, parser);
    return file ? { file, caption: null } : null;
  }
  if (type === "message/external-body" && contentType !== null) {
    if (param(contentType, "access-type")?.toLowerCase() !== "url") return null;
    const url = webUrl(param(contentType, "URL"));
    if (url === null) return null;
    const name = decodeName(new URL(url).pathname.split("/").pop() || null);
    return { file: { url, name, size: null, contentType: null, until: null, playingLengthMs: null }, caption: null };
  }
  if (type === "multipart/mixed" && contentType !== null) {
    const list = parts(contentType, body);
    if (list === null) return null;
    let file: FileAttachment | null = null;
    let text: string | null = null;
    for (const p of list) {
      if (file === null && mediaType(p.type) === FTHTTP_CONTENT_TYPE) file = readFtHttp(p.body, parser);
      else text ??= caption(p.type, p.body);
    }
    return file ? { file, caption: text } : null;
  }
  return null;
}
