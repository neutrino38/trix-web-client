/**
 * "Is composing" (RFC 3994), the way Linphone sends it (ADR 0012, D9):
 *
 * ```xml
 * <?xml version="1.0" encoding="UTF-8"?>
 * <isComposing xmlns="urn:ietf:params:xml:ns:im-iscomposing">
 *   <state>active</state>
 *   <contenttype>text/plain</contenttype>
 *   <refresh>60</refresh>
 * </isComposing>
 * ```
 *
 * A MESSAGE of type `application/im-iscomposing+xml`, `Priority:
 * non-urgent`, `Expires: 0` — kelixip never stores one, and answers 480
 * for an absent recipient, which is not an error. `active` again every 60 s
 * while typing; `idle`, with neither `contenttype` nor `refresh`, after
 * 15 s without a key. The peer is taken as idle past its `refresh`, 120 s
 * when it gives none (Linphone's `composing_remote_refresh_timeout`). A
 * voice message being recorded is `active` with the voice message's type.
 *
 * No global DOM: the XML parser is injected, as for PIDF (`sip/pidf.ts`).
 */

import type { XmlParser } from "./pidf.js";

export const ISCOMPOSING_CONTENT_TYPE = "application/im-iscomposing+xml";
export const ISCOMPOSING_NS = "urn:ietf:params:xml:ns:im-iscomposing";

/** How often `active` is said again while it lasts, in seconds. */
export const COMPOSING_REFRESH_S = 60;
/** Silence after which typing is over. */
export const COMPOSING_IDLE_MS = 15_000;
/** How long a peer's `active` lasts when it says no `refresh`. */
export const REMOTE_REFRESH_S = 120;

/** The headers every isComposing MESSAGE carries. */
export const COMPOSING_HEADERS = ["Priority: non-urgent", "Expires: 0"] as const;

export interface Composing {
  active: boolean;
  /** What is being composed — `text/plain`, or a voice message's type; null for idle. */
  contentType: string | null;
  /** Seconds the `active` lasts; null when not said. */
  refreshS: number | null;
}

/** The body of an isComposing: `active` with what and for how long, or `idle` alone. */
export function buildIsComposing(active: boolean, contentType = "text/plain"): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<isComposing xmlns="${ISCOMPOSING_NS}">`,
    `<state>${active ? "active" : "idle"}</state>`,
    ...(active ? [`<contenttype>${contentType}</contenttype>`, `<refresh>${COMPOSING_REFRESH_S}</refresh>`] : []),
    "</isComposing>",
  ].join("\r\n");
}

function child(root: Element, name: string): string | null {
  const all = root.getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) {
    const el = all.item(i)!;
    if (el.localName === name) return el.textContent?.trim() || null;
  }
  return null;
}

/** Reads an isComposing; null when it is not one. Never throws. */
export function readIsComposing(xml: string, parser: XmlParser): Composing | null {
  if (xml.length > 4096 || /<!DOCTYPE/i.test(xml)) return null;
  let doc: Document;
  try {
    doc = parser.parseFromString(xml, "application/xml");
  } catch {
    return null;
  }
  const root = doc?.documentElement;
  if (!root || root.localName !== "isComposing" || doc.getElementsByTagName("parsererror").length > 0) return null;
  const state = child(root, "state")?.toLowerCase();
  if (state !== "active" && state !== "idle") return null;
  const refresh = child(root, "refresh");
  return {
    active: state === "active",
    contentType: state === "active" ? child(root, "contenttype") : null,
    refreshS: refresh !== null && /^\d+$/.test(refresh) ? Number(refresh) : null,
  };
}
