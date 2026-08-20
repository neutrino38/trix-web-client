/**
 * Serveurs ICE du compte — STUN et TURN (docs/CONCEPTION.md §2).
 * Traversée de NAT : sans eux, un appel entre deux réseaux privés
 * n'établit aucun flux média. Le réglage appartient au compte, comme le
 * proxy : c'est l'opérateur SIP qui fournit ces serveurs.
 *
 * L'utilisateur saisit un **hôte**, pas une URL : le schéma (`stun:`,
 * `turn:`, `turns:`) est dérivé ici, et pour TURN la case TLS en est la
 * seule source de vérité — un `turns:` collé dans le champ ne peut donc
 * pas contredire la case.
 */

/** Serveur TURN du compte. Le relais exige une authentification. */
export interface TurnServer {
  /** `hôte` ou `hôte:port` (sans port : 3478 en clair, 5349 en TLS — RFC 5766/7065). */
  host: string;
  username: string;
  /**
   * Mot de passe TURN, en clair : le mécanisme « long-term credential »
   * exige le secret lui-même à chaque allocation — aucune empreinte ne
   * peut s'y substituer, contrairement au HA1 du compte SIP. Il n'est
   * conservé que chiffré, avec le reste du compte (storage/store.ts).
   */
  password: string;
  /** TURN sur TLS : schéma `turns:` (et transport TCP) au lieu de `turn:`. */
  tls: boolean;
}

/** Serveurs ICE d'un compte ; `null` de part et d'autre = aucun (ICE en direct). */
export interface IceConfig {
  /** Hôte du serveur STUN (`hôte[:port]`), ou null. */
  stun: string | null;
  turn: TurnServer | null;
}

export const NO_ICE: IceConfig = { stun: null, turn: null };

/** Hôte ou hôte:port, IPv6 entre crochets comme l'exigent les URL ICE. */
const HOST_PORT = /^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9._-]+)(:\d{1,5})?$/;

/**
 * Normalise une saisie d'hôte : espaces, schéma collé depuis une doc
 * (`stun:`, `turn:`, `turns:`) et paramètre `?transport=…` sont retirés.
 * Rend null si ce qui reste n'est pas un `hôte[:port]` exploitable.
 */
export function parseIceHost(raw: string): string | null {
  const host = raw
    .trim()
    .replace(/^stuns?:/i, "")
    .replace(/^turns?:/i, "")
    .replace(/\?.*$/, "");
  if (!host || !HOST_PORT.test(host)) return null;
  return host;
}

/** URL ICE effectivement passée à WebRTC pour un serveur TURN. */
export function turnUrl(turn: TurnServer): string {
  // `?transport=tcp` : TLS n'a de sens que sur TCP, et l'expliciter évite
  // que la pile ne tente d'abord un UDP qui n'existe pas côté serveur.
  return turn.tls ? `turns:${turn.host}?transport=tcp` : `turn:${turn.host}`;
}

/**
 * Configuration ICE de la pile WebRTC. Liste vide quand rien n'est
 * configuré : la connexion reste possible en direct (même réseau, IP
 * publique), elle échouera simplement derrière un NAT symétrique.
 */
export function iceServers(ice: IceConfig): RTCIceServer[] {
  const servers: RTCIceServer[] = [];
  if (ice.stun) servers.push({ urls: `stun:${ice.stun}` });
  if (ice.turn) {
    servers.push({
      urls: turnUrl(ice.turn),
      username: ice.turn.username,
      credential: ice.turn.password,
    });
  }
  return servers;
}

/** Champs ICE du formulaire de configuration (`ConfigForm`). */
export interface IceForm {
  stun: string;
  turn: string;
  turnUsername: string;
  /** null = inchangé : conserver le mot de passe TURN déjà enregistré. */
  turnPassword: string | null;
  turnTls: boolean;
}

export type IceParse =
  | { ok: true; ice: IceConfig }
  | { ok: false; error: string; field: "stun" | "turn" };

/**
 * Validation de la section ICE du formulaire. Un champ serveur vide
 * signifie « aucun » — c'est un réglage optionnel, pas une omission.
 * `previous` fournit le mot de passe TURN quand l'utilisateur ne le
 * ressaisit pas, comme pour le mot de passe SIP.
 */
export function parseIceForm(f: IceForm, previous: IceConfig | null): IceParse {
  const stunRaw = f.stun.trim();
  const stun = stunRaw === "" ? null : parseIceHost(stunRaw);
  if (stunRaw !== "" && !stun) {
    return { ok: false, error: "Serveur STUN invalide (attendu : hôte ou hôte:port)", field: "stun" };
  }

  const turnRaw = f.turn.trim();
  if (turnRaw === "") return { ok: true, ice: { stun, turn: null } };
  const host = parseIceHost(turnRaw);
  if (!host) {
    return { ok: false, error: "Serveur TURN invalide (attendu : hôte ou hôte:port)", field: "turn" };
  }
  const username = f.turnUsername.trim();
  if (!username) {
    return { ok: false, error: "Identifiant TURN requis (le relais est toujours authentifié)", field: "turn" };
  }
  // mot de passe laissé vide : on ne peut le reprendre que s'il vise le
  // même serveur et le même identifiant — sinon il ne vaudrait rien
  const kept =
    previous?.turn && previous.turn.host === host && previous.turn.username === username
      ? previous.turn.password
      : null;
  const password = f.turnPassword !== null && f.turnPassword !== "" ? f.turnPassword : kept;
  if (!password) return { ok: false, error: "Mot de passe TURN requis", field: "turn" };

  return { ok: true, ice: { stun, turn: { host, username, password, tls: f.turnTls } } };
}
