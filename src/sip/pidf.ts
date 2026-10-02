/**
 * Presence documents — PIDF (RFC 3863) with the RPID extensions (RFC 4480),
 * read and written. The only module that knows what a presence body looks
 * like: everything above it sees a `PresenceInfo` (ADR 0007, D4).
 *
 * Reading never throws. A body that cannot be parsed, or is not a PIDF
 * document, reads as `unknown` — a NOTIFY we do not understand says nothing
 * about the contact, and must not break the subscription that carried it.
 *
 * Servers disagree on where things go: Kamailio aggregates one tuple and
 * one `<dm:person>` per publishing device, Asterisk puts its activities in a
 * `<dm:person>` beside a single tuple, older clients nest them in the tuple.
 * Activities are therefore looked up anywhere in the document, by local
 * name, whatever the prefix or namespace the sender chose. Only our own
 * `<trix:dnd/>` and `<trix:auto/>` are matched by namespace.
 *
 * When several devices speak for one person, the most constraining state
 * wins: someone on the phone at their desk is not "available" because their
 * browser is.
 *
 * No global DOM: the XML parser is injected, the browser's `DOMParser` in
 * the app, a Node one in the tests.
 */

export type Presence =
  | "available"
  | "busy"
  | "on-the-phone"
  | "away"
  | "dnd"
  | "offline"
  | "unknown";

/** What can be published: nobody publishes "we don't know". */
export type PublishedPresence = Exclude<Presence, "unknown">;

export interface PresenceInfo {
  state: Presence;
  /** Free text from `<note>`, trimmed; null when absent or empty. */
  note: string | null;
  /** Epoch milliseconds of the most recent timestamp in the document. */
  since: number | null;
}

/** The part of `DOMParser` we use. */
export interface XmlParser {
  parseFromString(text: string, type: "application/xml"): Document;
}

export const PIDF_NS = "urn:ietf:params:xml:ns:pidf";
export const DATA_MODEL_NS = "urn:ietf:params:xml:ns:pidf:data-model";
export const RPID_NS = "urn:ietf:params:xml:ns:pidf:rpid";
/** Our extension namespace: RPID has no "do not disturb" activity. */
export const TRIX_NS = "urn:trix:params:xml:ns:pidf";

export const PIDF_CONTENT_TYPE = "application/pidf+xml";

export const UNKNOWN: PresenceInfo = { state: "unknown", note: null, since: null };

/** Most constraining first (ADR 0007, D4). */
const RANK: readonly Presence[] = ["on-the-phone", "dnd", "busy", "away", "available", "offline"];

/**
 * RPID activities (RFC 4480 §3.2) folded into our states. Anything not
 * listed — `working`, `playing`, `unknown`… — leaves an open tuple
 * available.
 */
const ACTIVITY: Readonly<Record<string, Presence>> = {
  "on-the-phone": "on-the-phone",
  busy: "busy",
  meeting: "busy",
  presentation: "busy",
  performance: "busy",
  away: "away",
  appointment: "away",
  breakfast: "away",
  dinner: "away",
  meal: "away",
  holiday: "away",
  vacation: "away",
  sleeping: "away",
  travel: "away",
  "in-transit": "away",
  "permanent-absence": "away",
};

/** Reads a presence body. Never throws; anything unreadable is `unknown`. */
export function readPidf(body: string, parser: XmlParser): PresenceInfo {
  const root = parse(body, parser);
  if (!root) return UNKNOWN;
  const all = () => true;
  return { state: stateOf(root, all), note: noteOf(root, all), since: sinceOf(root, all) };
}

/** What the other devices of our own account say (`readOthers`). */
export interface OthersPresence {
  info: PresenceInfo;
  /** One of them publishes a state set by an automatic rule (`<trix:auto/>`). */
  automatic: boolean;
}

/**
 * Reads the NOTIFY of our own subscription, leaving out what this device
 * published: its tuple `tupleId` and its person `p-<tupleId>`, as
 * `writePidf` names them. What is left is the word of our other devices —
 * without the filter, our own publication would come back to us.
 */
export function readOthers(body: string, parser: XmlParser, tupleId: string): OthersPresence {
  const root = parse(body, parser);
  if (!root) return { info: UNKNOWN, automatic: false };
  const keep = (el: Element) => !ownedBy(el, tupleId);
  const automatic = elements(root, "*", "activities")
    .filter(keep)
    .some((a) => childElements(a).some((c) => c.namespaceURI === TRIX_NS && c.localName === "auto"));
  return {
    info: { state: stateOf(root, keep), note: noteOf(root, keep), since: sinceOf(root, keep) },
    automatic,
  };
}

/** The `<presence>` root of a PIDF document; null when it is not one. */
function parse(body: string, parser: XmlParser): Element | null {
  let doc: Document;
  try {
    doc = parser.parseFromString(body, "application/xml");
  } catch {
    return null;
  }
  const root = doc?.documentElement;
  if (
    !root ||
    root.localName !== "presence" ||
    root.namespaceURI !== PIDF_NS ||
    doc.getElementsByTagName("parsererror").length > 0
  ) {
    return null;
  }
  return root;
}

/** `el` sits in the tuple or the person this device published. */
function ownedBy(el: Element, tupleId: string): boolean {
  for (let n: Node | null = el; n && n.nodeType === 1; n = n.parentNode) {
    const e = n as Element;
    if (e.namespaceURI === PIDF_NS && e.localName === "tuple" && e.getAttribute("id") === tupleId) return true;
    if (e.localName === "person" && e.getAttribute("id") === `p-${tupleId}`) return true;
  }
  return false;
}

type Keep = (el: Element) => boolean;

function stateOf(root: Element, keep: Keep): Presence {
  const tuples = elements(root, PIDF_NS, "tuple").filter(keep);
  const open = tuples.some((t) => text(first(t, PIDF_NS, "basic")) === "open");
  if (!open) return "offline";

  const states = new Set<Presence>(["available"]);
  for (const activities of elements(root, "*", "activities").filter(keep)) {
    for (const child of childElements(activities)) {
      if (child.namespaceURI === TRIX_NS && child.localName === "dnd") {
        states.add("dnd");
        continue;
      }
      // Legacy form: `<activity>on-the-phone</activity>`.
      const name = child.localName === "activity" ? text(child) : child.localName;
      const state = name ? ACTIVITY[name] : undefined;
      if (state) states.add(state);
    }
  }
  return RANK.find((s) => states.has(s)) ?? "available";
}

/**
 * The first non-empty note, in document order: the presence-level one if
 * any, then the tuples', then the persons' (`<note>` or `<dm:note>`).
 */
function noteOf(root: Element, keep: Keep): string | null {
  for (const ns of [PIDF_NS, DATA_MODEL_NS]) {
    for (const note of elements(root, ns, "note").filter(keep)) {
      const t = text(note);
      if (t) return t;
    }
  }
  return null;
}

/** The most recent `<timestamp>` or `activities@from`, whichever is later. */
function sinceOf(root: Element, keep: Keep): number | null {
  const stamps = [
    ...elements(root, "*", "timestamp").filter(keep).map(text),
    ...elements(root, "*", "activities").filter(keep).map((a) => a.getAttribute("from")),
  ]
    .map((s) => (s ? Date.parse(s) : NaN))
    .filter((n) => !Number.isNaN(n));
  return stamps.length > 0 ? Math.max(...stamps) : null;
}

/**
 * Writes our own presence as a single-tuple PIDF document, the way
 * Kamailio's `presence` module expects to aggregate it with our other
 * devices. `tupleId` must be stable for this device across refreshes.
 *
 * Invisible is published as `offline` by the caller: `closed`, no person.
 * A state set by an automatic rule carries `<trix:auto/>`, so that our
 * other devices do not take it for a choice (`readOthers`).
 */
export function writePidf(
  entity: string,
  info: { state: PublishedPresence; note: string | null; since: number | null; automatic?: boolean },
  tupleId: string,
): string {
  const open = info.state !== "offline";
  const lines = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<presence xmlns="${PIDF_NS}" xmlns:dm="${DATA_MODEL_NS}" ` +
      `xmlns:rpid="${RPID_NS}" xmlns:trix="${TRIX_NS}" entity="${escape(entity)}">`,
    `<tuple id="${escape(tupleId)}">`,
    `<status><basic>${open ? "open" : "closed"}</basic></status>`,
  ];
  const note = info.note?.trim();
  if (note) lines.push(`<note>${escape(note)}</note>`);
  if (info.since !== null) lines.push(`<timestamp>${new Date(info.since).toISOString()}</timestamp>`);
  lines.push(`</tuple>`);

  const activities = activitiesOf(info.state);
  if (activities) {
    lines.push(
      `<dm:person id="p-${escape(tupleId)}">`,
      `<rpid:activities>${activities}${info.automatic ? "<trix:auto/>" : ""}</rpid:activities>`,
      `</dm:person>`,
    );
  }
  lines.push(`</presence>`);
  return lines.join("\n");
}

function activitiesOf(state: PublishedPresence): string | null {
  switch (state) {
    case "busy":
      return "<rpid:busy/>";
    // A client that is not Trix sees "busy", which is right.
    case "dnd":
      return "<rpid:busy/><trix:dnd/>";
    case "on-the-phone":
      return "<rpid:on-the-phone/>";
    case "away":
      return "<rpid:away/>";
    case "available":
    case "offline":
      return null;
  }
}

// DOM helpers that stick to what both browsers and Node XML parsers
// implement: no `children`, no `querySelector`.

function elements(root: Element, ns: string, name: string): Element[] {
  return Array.from(root.getElementsByTagNameNS(ns, name));
}

function first(root: Element, ns: string, name: string): Element | null {
  return root.getElementsByTagNameNS(ns, name).item(0);
}

function childElements(el: Element): Element[] {
  return Array.from(el.childNodes).filter((n): n is Element => n.nodeType === 1);
}

function text(el: Element | null): string | null {
  const t = el?.textContent?.trim();
  return t ? t : null;
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
