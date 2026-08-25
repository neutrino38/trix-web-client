/**
 * Le partage d'un compte par un lien — encodage, décodage, et la forme de
 * l'URL.
 *
 * Un compte tient en une URL : c'est tout ce que le module fait. Rien n'est
 * déposé sur un serveur, aucun identifiant n'est réservé quelque part ; le
 * lien **est** le compte, et il voyage par le moyen que son auteur voudra.
 * Ce qui n'y voyage pas : l'historique d'appels, qui appartient à la
 * personne et non au compte, et l'identifiant interne du compte partagé —
 * celui qui le reçoit crée le sien (`storage/store.ts`).
 *
 * ## Le lien porte de quoi s'authentifier
 *
 * La charge contient le **HA1** (RFC 2617), et le mot de passe TURN s'il y
 * en a un. Le HA1 n'est pas le mot de passe, mais il en fait office : c'est
 * exactement ce qu'un client SIP présente au registrar. Un lien de partage
 * vaut donc le mot de passe du compte, et se transmet avec les mêmes
 * précautions — c'est ce que dit l'écran qui le fabrique, et il n'y a pas
 * de façon de rendre cela faux tout en transportant un compte utilisable.
 *
 * ## Pourquoi le fragment, et pas la requête
 *
 * La charge est publiée dans le **fragment** (`#data=`). Un fragment ne
 * quitte jamais le navigateur : il n'entre pas dans la requête HTTP, donc
 * pas dans les journaux d'accès du serveur, pas dans un en-tête `Referer`,
 * pas dans les traces d'un intermédiaire. La même charge dans la requête
 * (`?data=`) aurait déposé le HA1 dans le journal nginx de l'hébergeur à
 * chaque ouverture du lien.
 *
 * La lecture accepte quand même `?data=` : un lien recopié à la main, ou
 * réécrit par un outil de messagerie qui ne sait pas garder un fragment,
 * doit fonctionner plutôt que de laisser une page vide. Trix n'en fabrique
 * pas de cette forme.
 */

import { parseIceHost, type IceConfig, type TurnServer } from "../sip/ice.js";
import { parseRttTransport } from "../sip/rtt.js";
import type { AccountConfig } from "../storage/store.js";

/** La page qui reçoit les liens, servie à côté d'`index.html`. */
export const SHARE_PAGE = "share_account.html";

/** Le paramètre qui porte la charge, dans le fragment comme dans la requête. */
const PARAM = "data";

/**
 * Version du format. Elle est là pour que le jour où la charge change de
 * forme, un lien ancien soit **reconnu comme ancien** plutôt que rejeté
 * comme illisible : la page pourra le dire, ou le lire quand même.
 */
const VERSION = 1;

interface Payload {
  v: number;
  a: AccountConfig;
}

// ---------------------------------------------------------------------------
// Base64url
// ---------------------------------------------------------------------------

/**
 * Base64url sans remplissage (RFC 4648 §5) : ni `+`, ni `/`, ni `=`, donc
 * rien qu'un client de messagerie soit tenté de couper ou de réécrire, et
 * rien à échapper dans une URL.
 */
function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array | null {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null; // caractères hors alphabet, longueur impossible
  }
}

// ---------------------------------------------------------------------------
// Encodage
// ---------------------------------------------------------------------------

/**
 * La charge d'un compte : sa configuration entière, moins ce qui n'a de
 * sens que dans le coffre d'où elle sort. L'ordre des champs est celui de
 * `AccountConfig` — l'objet est reconstruit explicitement plutôt que copié,
 * pour qu'un champ ajouté un jour à un compte ne parte pas dans un lien
 * sans qu'on l'ait décidé.
 */
export function encodeAccount(cfg: AccountConfig): string {
  const payload: Payload = {
    v: VERSION,
    a: {
      proxy: cfg.proxy,
      domain: cfg.domain,
      displayName: cfg.displayName,
      username: cfg.username,
      authUsername: cfg.authUsername,
      ha1: cfg.ha1,
      flashAlert: cfg.flashAlert,
      ice: cfg.ice,
      rtt: cfg.rtt,
    },
  };
  return toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

/**
 * L'URL complète à copier. `base` est l'adresse de la page courante : le
 * lien pointe vers la page de partage **du même déploiement**, servie à
 * côté d'`index.html`. Un lien qui renverrait ailleurs enverrait le compte
 * à une installation qui n'est pas celle de son auteur.
 */
export function shareUrl(cfg: AccountConfig, base: string | URL): string {
  const url = new URL(SHARE_PAGE, base);
  url.hash = `${PARAM}=${encodeAccount(cfg)}`;
  return url.toString();
}

// ---------------------------------------------------------------------------
// Décodage
// ---------------------------------------------------------------------------

/**
 * La charge d'un lien ouvert : le fragment d'abord, la requête ensuite.
 * `null` quand le lien n'en porte pas — la page ouverte à la main, par
 * exemple, qui n'est pas une erreur mais n'a rien à proposer.
 */
export function linkPayload(loc: { hash: string; search: string }): string | null {
  const fragment = new URLSearchParams(loc.hash.replace(/^#/, "")).get(PARAM);
  if (fragment !== null && fragment !== "") return fragment;
  const query = new URLSearchParams(loc.search).get(PARAM);
  return query !== null && query !== "" ? query : null;
}

/** Pourquoi un lien n'a pas pu être lu — l'écran en fait une phrase. */
export type DecodeError = "malformed" | "version";

export type DecodeResult =
  | { ok: true; account: AccountConfig }
  | { ok: false; error: DecodeError };

const HA1 = /^[0-9a-f]{32}$/i;

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Un serveur TURN relu d'un lien. Les trois champs vont ensemble : le
 * mécanisme « long-term credential » (RFC 5766 §4) n'a pas de mode
 * anonyme, donc un relais amputé de son mot de passe n'échouerait que plus
 * tard, en silence — mieux vaut n'en garder aucun.
 */
function turnOf(value: unknown): TurnServer | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Partial<TurnServer>;
  const host = str(raw.host);
  const username = str(raw.username);
  const password = str(raw.password);
  if (host === null || username === null || password === null) return null;
  const parsed = parseIceHost(host);
  return parsed === null ? null : { host: parsed, username, password, tls: raw.tls === true };
}

function iceOf(value: unknown): IceConfig {
  if (typeof value !== "object" || value === null) return { stun: null, turn: null };
  const raw = value as Partial<IceConfig>;
  const stun = str(raw.stun);
  return { stun: stun === null ? null : parseIceHost(stun), turn: turnOf(raw.turn) };
}

/**
 * Décode une charge de lien.
 *
 * Ce qui arrive ici vient d'une URL, donc de n'importe où : chaque champ
 * est vérifié, et rien n'est relu en confiance. Un lien bricolé ne doit pas
 * pouvoir déposer dans le coffre un objet dont la forme ferait tomber
 * l'application plus tard — l'écran de partage montre ce qu'il a compris,
 * et c'est cela, et rien d'autre, qui sera créé.
 *
 * Les champs facultatifs suivent la même règle que les comptes relus d'un
 * coffre ancien (`storage/store.ts`) : absents, ils prennent le défaut le
 * plus discret — flash actif, aucun serveur ICE, aucun texte temps réel.
 */
export function decodeAccount(data: string): DecodeResult {
  const bytes = fromBase64Url(data);
  if (!bytes) return { ok: false, error: "malformed" };
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return { ok: false, error: "malformed" };
  }
  if (typeof payload !== "object" || payload === null) return { ok: false, error: "malformed" };
  const { v, a } = payload as Partial<Payload>;
  // un lien d'une version future porte peut-être des champs qu'on ne sait
  // pas lire : le dire vaut mieux que d'en créer un compte incomplet
  if (typeof v !== "number" || v > VERSION) return { ok: false, error: "version" };
  if (typeof a !== "object" || a === null) return { ok: false, error: "malformed" };
  const raw = a as Partial<AccountConfig>;
  const proxy = str(raw.proxy);
  const domain = str(raw.domain);
  const username = str(raw.username);
  const ha1 = str(raw.ha1);
  // le minimum sans lequel il n'y a pas de compte : où s'enregistrer, sous
  // quelle adresse, et avec quoi s'authentifier
  if (!proxy || !/^wss?:\/\/\S+$/i.test(proxy)) return { ok: false, error: "malformed" };
  if (!domain || !username || username.includes("@") || /\s/.test(`${username}${domain}`)) {
    return { ok: false, error: "malformed" };
  }
  if (!ha1 || !HA1.test(ha1)) return { ok: false, error: "malformed" };
  return {
    ok: true,
    account: {
      proxy,
      domain,
      displayName: str(raw.displayName) ?? "",
      username,
      authUsername: str(raw.authUsername),
      ha1: ha1.toLowerCase(),
      flashAlert: raw.flashAlert !== false,
      ice: iceOf(raw.ice),
      rtt: parseRttTransport(raw.rtt),
    },
  };
}
