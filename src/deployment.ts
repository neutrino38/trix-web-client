/**
 * Deployment configuration — `config.json`, fetched over HTTP at start-up
 * and **never bundled**.
 *
 * The file belongs to whoever installs Trix, not to whoever builds it: an
 * operator drops it next to `index.html` and pins what their platform
 * already decides — the SIP proxy, the SIP domain, the NAT servers, the
 * real-time text transport, whether the SIP trace is offered at all. Every
 * pinned setting then disappears from the settings screen: a field the
 * person cannot change is a field they should not have to read.
 *
 * Three rules hold the whole module together.
 *
 * 1. **Absent, unreadable or malformed is not an error.** Trix behaves
 *    exactly as it does without the file — the settings screen shows every
 *    field. A deployment that mistypes a key gets the open form back, not a
 *    broken client, and never a half-pinned one.
 * 2. **Each key stands alone.** Pinning the domain says nothing about the
 *    proxy. What the file does not state, the person still chooses.
 * 3. **Pinned wins over stored.** An account saved before the file appeared
 *    is realigned when it is read back (`pinAccount`), so the hidden proxy
 *    field can never quietly disagree with the account actually in use.
 *
 * The one thing pinning cannot repair is a stored account on another SIP
 * domain: its HA1 was computed with that domain as the realm (RFC 2617),
 * so rewriting the domain would leave a password that authenticates
 * nothing. Such an account is dropped instead, and the person configures
 * theirs again — which is the only way to get a usable HA1 back anyway.
 */

import { parseIceHost, type IceConfig, type TurnServer } from "./sip/ice.js";
import type { RttTransport } from "./sip/rtt.js";
import type { AccountConfig } from "./storage/store.js";

/**
 * What the deployment pins. `null` always means "not pinned — the person
 * chooses", which is why the open deployment is all nulls: no file and a
 * file that states nothing are the same thing.
 */
export interface Deployment {
  /** SIP proxy (`wss://…`); the field is hidden when set. */
  proxy: string | null;
  /** SIP domain: the address field is pre-filled with it, and refuses any other. */
  domain: string | null;
  /** STUN/TURN servers; the whole NAT section is hidden when set. */
  ice: IceConfig | null;
  /** Real-time text transport; the menu is hidden when set. */
  rtt: RttTransport | null;
  /** False only for `"debug_activated": "no"`: no SIP trace, and no way to ask for one. */
  debug: boolean;
  /**
   * False only for `"presence": "no"` (ADR 0007, D8): no SUBSCRIBE, no
   * PUBLISH, no status menu — for a server known to refuse them, whose
   * operator does not want to see them tried at every registration.
   */
  presence: boolean;
  /**
   * False only for `"messaging": "no"` (ADR 0008, D13): no MESSAGE sent,
   * none taken — they get 405, and `Allow` no longer lists the method.
   */
  messaging: boolean;
}

/** No file, or nothing usable in it: Trix as it is without deployment configuration. */
export const OPEN_DEPLOYMENT: Deployment = {
  proxy: null,
  domain: null,
  ice: null,
  rtt: null,
  debug: true,
  presence: true,
  messaging: true,
};

/** Where the file is looked for, relative to wherever Trix is served from. */
export const DEPLOYMENT_URL = "config.json";

/** A hostname, possibly with a port — same shape the ICE fields accept. */
const DOMAIN = /^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9._-]+)(:\d{1,5})?$/;

function text(raw: Record<string, unknown>, key: string): string | null {
  const value = raw[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function flag(raw: Record<string, unknown>, key: string): boolean {
  // `true` and `"yes"` both read naturally in a hand-written JSON file
  const value = raw[key];
  return value === true || (typeof value === "string" && value.trim().toLowerCase() === "yes");
}

/**
 * A WebSocket URL, and nothing else. A proxy that cannot be dialled is
 * worse pinned than absent: the field would be hidden and every call would
 * fail with no way to correct it — so a malformed value leaves the field.
 */
function proxyOf(raw: Record<string, unknown>): string | null {
  const value = text(raw, "sip_server");
  return value !== null && /^wss?:\/\/\S+$/i.test(value) ? value : null;
}

function domainOf(raw: Record<string, unknown>): string | null {
  const value = text(raw, "sip_domain");
  return value !== null && DOMAIN.test(value) ? value : null;
}

/**
 * The NAT section as a block: it is pinned as soon as the file mentions
 * either server, even to say there is none (`"stun_server": ""`). Pinning
 * one and leaving the other to the person would hide a column that still
 * has a field in it.
 *
 * A TURN server without both credentials is dropped: the long-term
 * credential mechanism (RFC 5766 §4) has no anonymous mode, so a relay
 * missing its password would only fail later, silently.
 */
function iceOf(raw: Record<string, unknown>): IceConfig | null {
  if (!("stun_server" in raw) && !("turn_server" in raw)) return null;
  const stunHost = text(raw, "stun_server");
  const stun = stunHost === null ? null : parseIceHost(stunHost);
  return { stun, turn: turnOf(raw) };
}

function turnOf(raw: Record<string, unknown>): TurnServer | null {
  const turnHost = text(raw, "turn_server");
  const host = turnHost === null ? null : parseIceHost(turnHost);
  const username = text(raw, "turn_username");
  const password = text(raw, "turn_password");
  if (host === null || username === null || password === null) return null;
  return { host, username, password, tls: flag(raw, "turn_tls") };
}

/**
 * `"user_choice"` — like an absent key — leaves the menu in place. The
 * three other values are the transports themselves (`sip/rtt.ts`), pinned
 * and hidden; `"none"` also takes every mention of the chat out of the
 * interface, since there is then no text to be had.
 */
function rttOf(raw: Record<string, unknown>): RttTransport | null {
  const value = text(raw, "realtime_text");
  return value === "none" || value === "websocket" || value === "datachannel" ? value : null;
}

/** Parses whatever `config.json` held. Anything unusable falls back to open. */
export function parseDeployment(raw: unknown): Deployment {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return OPEN_DEPLOYMENT;
  const obj = raw as Record<string, unknown>;
  return {
    proxy: proxyOf(obj),
    domain: domainOf(obj),
    ice: iceOf(obj),
    rtt: rttOf(obj),
    // stated and not "no" — an absent key leaves the trace available
    debug: text(obj, "debug_activated")?.toLowerCase() !== "no",
    // same reading: only "no" turns it off, and discovery (D8) does the rest
    presence: text(obj, "presence")?.toLowerCase() !== "no",
    messaging: text(obj, "messaging")?.toLowerCase() !== "no",
  };
}

let current: Deployment = OPEN_DEPLOYMENT;

/**
 * What the deployment pins, read synchronously by the screens and the
 * machine. Open until `loadDeployment()` has resolved, which is why
 * `main.ts` awaits it before the first render.
 */
export function deployment(): Deployment {
  return current;
}

/** Injects a deployment — tests, and nothing else. */
export function setDeployment(d: Deployment): void {
  current = d;
}

/**
 * Fetches `config.json` and installs it. Never rejects: a missing file, a
 * server that answers `index.html` to a 404, a truncated download all end
 * up as the open deployment.
 *
 * `no-store`: the file is small, read once per session, and an operator
 * changing it must not have to reason about a cached copy in someone's
 * browser. The served cache headers say the same thing
 * (docs/utilisation/deploiement.md).
 */
export async function loadDeployment(url: string = DEPLOYMENT_URL): Promise<Deployment> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return (current = OPEN_DEPLOYMENT);
    current = parseDeployment(JSON.parse(await res.text()) as unknown);
  } catch {
    current = OPEN_DEPLOYMENT;
  }
  return current;
}

/**
 * Realigns a stored account on what the deployment pins. Returns `null`
 * when the account belongs to another SIP domain than the pinned one — its
 * HA1 cannot follow (see the module header), so the account is not usable
 * here and the person is sent back to an empty form.
 */
export function pinAccount(
  cfg: AccountConfig,
  dep: Deployment = deployment(),
): AccountConfig | null {
  if (dep.domain !== null && cfg.domain !== dep.domain) return null;
  return {
    ...cfg,
    proxy: dep.proxy ?? cfg.proxy,
    ice: dep.ice ?? cfg.ice,
    rtt: dep.rtt ?? cfg.rtt,
  };
}
