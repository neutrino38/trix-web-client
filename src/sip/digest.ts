/**
 * Répondre à un défi Digest en **SHA-256** (RFC 8760), ce que JsSIP ne
 * sait pas faire.
 *
 * Sa classe `DigestAuthentication` refuse tout algorithme autre que MD5 —
 * « authentication aborted » — et rend `false` : le 401 remonte tel quel,
 * l'enregistrement échoue, et rien ne dit pourquoi. RFC 8760 n'a pourtant
 * changé qu'une chose, la fonction de hachage ; la construction du HA1, du
 * HA2 et de la réponse est celle de RFC 2617, mot pour mot.
 *
 * ## Pourquoi une greffe sur le prototype
 *
 * JsSIP n'expose pas la classe (`lib/JsSIP.js` n'en exporte rien) et ne
 * donne aucun crochet : `RequestSender` en construit une lui-même, au
 * moment où il reçoit le 401. Il n'y a donc pas de point d'extension à
 * utiliser, et deux façons d'en fabriquer un — recopier tout le chemin
 * d'authentification de JsSIP, ou remplacer sa méthode. La seconde laisse
 * le cas MD5 intact, qui est celui de presque tous les serveurs, et ne
 * duplique rien.
 *
 * Le module interne est importé par son chemin : `jssip/lib/…`. C'est le
 * **même** module que celui dont `RequestSender` se sert — vérifié sur les
 * trois chemins de construction (vitest, `vite build`, pré-optimisation du
 * serveur de développement, où il devient un morceau partagé). Un jour où
 * ce ne serait plus vrai, la greffe ne prendrait pas : `test/digest.test.ts`
 * vérifie qu'un défi SHA-256 trouve réponse.
 *
 * ## Ce qui n'est pas là
 *
 * `SHA-512-256` (l'autre algorithme de RFC 8760) et les variantes `-sess`.
 * Aucune n'est stockée dans le coffre, donc aucune ne pourrait trouver
 * d'empreinte à présenter ; elles restent refusées, et le sont maintenant
 * en le disant.
 */

// @ts-expect-error — module interne de JsSIP, sans déclaration de types
import DigestAuthentication from "jssip/lib/DigestAuthentication.js";
import { sha256 } from "../storage/sha256.js";

/**
 * L'algorithme que ce module ajoute, tel que la grammaire JsSIP le rend
 * (elle met le jeton en capitales).
 */
const SHA256 = "SHA-256";

/**
 * L'empreinte SHA-256 d'un compte, et de quoi prévenir quand elle manque.
 *
 * `RequestSender` ne transmet au calcul que ce que porte la configuration
 * de l'UA — `username`, `password`, `realm`, `ha1` —, et il n'y a pas de
 * place pour un cinquième champ. L'empreinte SHA-256 est donc déposée ici,
 * sous l'identité qui a servi à la calculer : `identifiant:realm`, c'est-à-
 * dire exactement ce que le HA1 condense. Le port l'y met en ouvrant un UA
 * et l'en retire en le fermant (`sip/port.ts`).
 */
export interface Sha256Credential {
  /** `""` quand le compte n'en a pas — un défi SHA-256 restera sans réponse. */
  ha1: string;
  /** Appelé quand un défi SHA-256 est arrivé sans empreinte à lui opposer. */
  onMissing: () => void;
}

const credentials = new Map<string, Sha256Credential>();

const keyOf = (username: string, realm: string): string => `${username}:${realm}`;

/**
 * Déclare l'empreinte SHA-256 d'un compte le temps d'une session SIP, et
 * rend de quoi la retirer. Installe la greffe au passage : rien ne sert de
 * modifier JsSIP dans une application qui n'ouvre jamais d'UA (la page de
 * partage, les tests des écrans).
 */
export function useSha256Ha1(
  username: string,
  realm: string,
  credential: Sha256Credential,
): () => void {
  installSha256Digest();
  const key = keyOf(username, realm);
  credentials.set(key, credential);
  return () => {
    // seulement si c'est encore la nôtre : un UA fermé après qu'un autre a
    // pris la main ne doit pas emporter l'empreinte du compte en cours
    if (credentials.get(key) === credential) credentials.delete(key);
  };
}

/**
 * La forme minimale de ce que la greffe touche chez JsSIP. Elle est écrite
 * ici plutôt que devinée à l'usage : ces champs sont ce que `toString()`
 * relit pour fabriquer l'en-tête `Authorization`, et les nommer est la
 * seule façon de voir, le jour d'une montée de version, ce qui a bougé.
 */
interface DigestState {
  _credentials: { username: string; password: string | null; realm: string; ha1: string | null };
  _algorithm: string | null;
  _realm: string | null;
  _nonce: string | null;
  _opaque: string | null;
  _stale: boolean | null;
  _qop: string | null;
  _method: string | null;
  _uri: string | null;
  _cnonce: string | null;
  _nc: number;
  _ncHex: string;
  _ha1: string | null;
  _response: string | null;
}

interface Challenge {
  algorithm?: string;
  realm?: string;
  nonce?: string;
  opaque?: string;
  stale?: boolean;
  qop?: string[];
}

interface DigestRequest {
  method: string;
  ruri: string;
  body?: string | null;
}

/** Jeton aléatoire du client (`cnonce`), même forme que celui de JsSIP. */
function randomToken(size: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let token = "";
  for (let i = 0; i < size; i++) {
    token += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return token;
}

let installed = false;

/**
 * Remplace `authenticate()` par une version qui traite SHA-256 et délègue
 * tout le reste — MD5 compris — à celle de JsSIP. Idempotent : le port
 * l'appelle à chaque ouverture d'UA.
 */
export function installSha256Digest(): void {
  if (installed) return;
  installed = true;
  const proto = (DigestAuthentication as { prototype: DigestState & Record<string, unknown> })
    .prototype;
  const original = proto.authenticate as (
    request: DigestRequest,
    challenge: Challenge,
    cnonce?: string | null,
  ) => boolean;

  proto.authenticate = function (
    this: DigestState,
    request: DigestRequest,
    challenge: Challenge,
    cnonce?: string | null,
  ): boolean {
    if ((challenge.algorithm ?? "MD5").toUpperCase() !== SHA256) {
      return original.call(this, request, challenge, cnonce ?? null);
    }
    return answerSha256(this, request, challenge, cnonce ?? null);
  };
}

/**
 * La réponse à un défi SHA-256, écrite dans l'objet de JsSIP tel qu'il
 * s'attend à se relire : `toString()` n'est pas réécrit, et l'en-tête
 * `Authorization` sort de là — avec `algorithm=SHA-256`, que RFC 8760
 * §2.4 demande de renvoyer tel qu'il a été reçu.
 */
function answerSha256(
  auth: DigestState,
  request: DigestRequest,
  challenge: Challenge,
  cnonce: string | null,
): boolean {
  if (!challenge.nonce || !challenge.realm) return false;

  // le mot de passe n'est jamais là (Trix n'en stocke pas) : c'est
  // l'empreinte déposée par le port qui répond, et son absence est
  // exactement le cas dont l'utilisateur doit être averti
  const credential = credentials.get(keyOf(auth._credentials.username, challenge.realm));
  if (!credential || credential.ha1 === "") {
    credential?.onMissing();
    return false;
  }

  // qop : le même tri que JsSIP, et le même refus quand ni `auth` ni
  // `auth-int` n'est proposé
  let qop: string | null = null;
  if (challenge.qop) {
    if (challenge.qop.includes("auth-int")) qop = "auth-int";
    else if (challenge.qop.includes("auth")) qop = "auth";
    else return false;
  }

  auth._algorithm = SHA256;
  auth._realm = challenge.realm;
  auth._nonce = challenge.nonce;
  auth._opaque = challenge.opaque ?? null;
  auth._stale = challenge.stale ?? null;
  auth._qop = qop;
  auth._method = request.method;
  auth._uri = request.ruri;
  auth._cnonce = cnonce || randomToken(12);
  auth._nc += 1;
  if (auth._nc === 4294967296) auth._nc = 1;
  auth._ncHex = auth._nc.toString(16).padStart(8, "0");
  auth._ha1 = credential.ha1;

  // RFC 2617 §3.2.2, à la fonction de hachage près
  const a2 =
    qop === "auth-int"
      ? `${request.method}:${request.ruri}:${sha256(request.body ?? "")}`
      : `${request.method}:${request.ruri}`;
  const ha2 = sha256(a2);
  auth._response = sha256(
    qop === null
      ? `${auth._ha1}:${auth._nonce}:${ha2}`
      : `${auth._ha1}:${auth._nonce}:${auth._ncHex}:${auth._cnonce}:${qop}:${ha2}`,
  );
  return true;
}
