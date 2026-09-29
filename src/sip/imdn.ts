/**
 * IMDN (RFC 5438): the receipts that travel in CPIM (ADR 0010).
 *
 * ```xml
 * <?xml version="1.0" encoding="UTF-8"?>
 * <imdn xmlns="urn:ietf:params:xml:ns:imdn">
 *   <message-id>KfMgJ0nhBx</message-id>
 *   <datetime>2026-09-29T09:30:00Z</datetime>
 *   <display-notification><status><displayed/></status></display-notification>
 * </imdn>
 * ```
 *
 * Two positive outcomes are read and written — `delivered` and `displayed`.
 * The negative ones (`failed`, `forbidden`, `error`…) are read as nothing:
 * a message already answered 2xx stays "delivered to the server".
 *
 * No global DOM: the XML parser is injected, as for PIDF (`sip/pidf.ts`).
 */

import { formatDateTime, IMDN_CONTENT_TYPE } from "./cpim.js";
import type { XmlParser } from "./pidf.js";

export const IMDN_XML_NS = "urn:ietf:params:xml:ns:imdn";

export type ImdnStatus = "delivered" | "displayed";

export interface Receipt {
  /** The `imdn.Message-ID` of the message it is about. */
  messageId: string;
  status: ImdnStatus;
}

/** The receipts a sender asks for in `imdn.Disposition-Notification`. */
export interface Wanted {
  delivery: boolean;
  display: boolean;
}

export const NOTHING_WANTED: Wanted = { delivery: false, display: false };

/**
 * Reads `imdn.Disposition-Notification`. `negative-delivery` alone asks
 * for nothing we would send: a message we file is never undelivered.
 */
export function wantedReceipts(disposition: string | null): Wanted {
  if (disposition === null) return NOTHING_WANTED;
  const tokens = new Set(disposition.split(",").map((t) => t.trim().toLowerCase()));
  return { delivery: tokens.has("positive-delivery"), display: tokens.has("display") };
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * A receipt for the message `messageId`, which the sender dated `at`:
 * `<datetime>` repeats the original message's `DateTime` (RFC 5438 §7.2.1.2).
 */
export function buildImdn(opts: { messageId: string; at: number; status: ImdnStatus }): string {
  const notification =
    opts.status === "delivered"
      ? "<delivery-notification><status><delivered/></status></delivery-notification>"
      : "<display-notification><status><displayed/></status></display-notification>";
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<imdn xmlns="${IMDN_XML_NS}">`,
    `<message-id>${escape(opts.messageId)}</message-id>`,
    `<datetime>${formatDateTime(opts.at)}</datetime>`,
    notification,
    "</imdn>",
  ].join("\r\n");
}

/** Reads one receipt; null when it is not an IMDN, or not a positive one. Never throws. */
export function readImdn(xml: string, parser: XmlParser): Receipt | null {
  let doc: Document;
  try {
    doc = parser.parseFromString(xml, "application/xml");
  } catch {
    return null;
  }
  const root = doc?.documentElement;
  if (
    !root ||
    root.localName !== "imdn" ||
    root.namespaceURI !== IMDN_XML_NS ||
    doc.getElementsByTagName("parsererror").length > 0
  ) {
    return null;
  }
  const messageId = root.getElementsByTagNameNS(IMDN_XML_NS, "message-id").item(0)?.textContent?.trim();
  if (!messageId) return null;
  if (statusIs(root, "display-notification", "displayed")) return { messageId, status: "displayed" };
  if (statusIs(root, "delivery-notification", "delivered")) return { messageId, status: "delivered" };
  return null;
}

function statusIs(root: Element, notification: string, status: string): boolean {
  const n = root.getElementsByTagNameNS(IMDN_XML_NS, notification).item(0);
  return (n?.getElementsByTagNameNS(IMDN_XML_NS, status).length ?? 0) > 0;
}

function mediaType(contentType: string | null): string {
  return contentType?.split(";")[0]!.trim().toLowerCase() ?? "";
}

/** The `boundary` parameter of a multipart type. */
function boundaryOf(contentType: string): string | null {
  const m = /;\s*boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  return m ? (m[1] ?? m[2]!) : null;
}

/**
 * The IMDN bodies of a CPIM part: itself when it is one, each of its parts
 * when it is a `multipart/mixed` of them — a client may gather several
 * receipts in one MESSAGE. Null when the part is not receipts.
 */
export function imdnBodies(contentType: string | null, body: string): string[] | null {
  const type = mediaType(contentType);
  if (type === IMDN_CONTENT_TYPE) return [body];
  if (type !== "multipart/mixed") return null;
  const boundary = boundaryOf(contentType!);
  if (boundary === null) return null;
  const bodies: string[] = [];
  for (const part of body.split(`--${boundary}`).slice(1)) {
    if (part.startsWith("--")) break;
    const m = /\r?\n\r?\n/.exec(part);
    if (!m) continue;
    const head = part.slice(0, m.index);
    const typeLine = /^content-type:\s*(.+)$/im.exec(head);
    if (mediaType(typeLine?.[1] ?? null) !== IMDN_CONTENT_TYPE) return null;
    bodies.push(part.slice(m.index + m[0].length).replace(/\r?\n$/, ""));
  }
  return bodies.length > 0 ? bodies : null;
}
