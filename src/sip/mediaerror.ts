/**
 * Les échecs WebRTC d'une session, dits **sans condition**.
 *
 * JsSIP réduit tout ce qui rate de la connexion pair-à-pair à une seule
 * cause — `WebRTC Error` — et à un `488 Not Acceptable Here` sur le fil.
 * Ni l'écran, ni la trace SIP, ni l'historique ne disaient alors *ce que*
 * le navigateur avait refusé : un SDP sans `ice-ufrag`, un codec
 * impossible et une caméra déjà prise se ressemblaient tous.
 *
 * Le message, lui, existe. Il voyage dans les événements
 * `getusermediafailed` et `peerconnection:*failed` que JsSIP émet juste
 * avant — ou juste après, selon l'endroit où ça casse — la fin de
 * session, et que personne n'écoutait. Ce module est le seul point où il
 * est lu, et il en fait trois choses :
 *
 * - **une ligne de console, toujours**, que la trace SIP soit cochée ou
 *   non : c'est le seul incident du port qu'on ne sait pas reproduire à
 *   volonté après coup, il ne peut pas dépendre d'une case qu'il aurait
 *   fallu cocher avant l'appel ;
 * - **une ligne du carnet** de l'appel (`sip/record.ts`), pour la même
 *   raison — elle part avec l'historique et se relit au parchemin, le
 *   message du navigateur entier ;
 * - **un détail court**, rendu à l'appelant : le port l'accroche à
 *   `sip:failed`, et c'est ce que le motif de fin d'appel montrera à côté
 *   de la cause JsSIP, sur l'écran comme dans l'historique.
 */

import { recordError } from "./record.js";

/** L'opération WebRTC qui a échoué, telle qu'on la nomme partout ensuite. */
export type MediaOp =
  | "getUserMedia"
  | "createOffer"
  | "createAnswer"
  | "setLocalDescription"
  | "setRemoteDescription";

/**
 * Les événements JsSIP qui portent une erreur du navigateur, et
 * l'opération que chacun désigne. Le port s'abonne à tous : l'échec peut
 * survenir à n'importe quelle étape de la négociation, à l'établissement
 * comme à un re-INVITE.
 */
export const MEDIA_ERROR_EVENTS: Readonly<Record<string, MediaOp>> = {
  getusermediafailed: "getUserMedia",
  "peerconnection:createofferfailed": "createOffer",
  "peerconnection:createanswerfailed": "createAnswer",
  "peerconnection:setlocaldescriptionfailed": "setLocalDescription",
  "peerconnection:setremotedescriptionfailed": "setRemoteDescription",
};

/** Un échec WebRTC, sous les deux longueurs dont on a besoin. */
export interface MediaFailure {
  op: MediaOp;
  /** Le message du navigateur, entier — c'est lui qui nomme la vraie cause. */
  message: string;
  /** Le même, abrégé et précédé de l'opération : ce qui tient dans un motif. */
  detail: string;
}

/**
 * Longueur du détail qui accompagne le motif de fin d'appel. Chrome écrit
 * des phrases longues (« Failed to execute 'setRemoteDescription' on
 * 'RTCPeerConnection': Failed to set remote offer sdp: Called with SDP
 * without ice-ufrag and ice-pwd. ») : la ligne d'historique en garde
 * assez pour comprendre, le carnet garde tout.
 */
const MAX_DETAIL = 200;

const TAG = "[trix]";

/** Où part la ligne de console. Injectable pour les tests, comme les autres puits. */
export interface ErrorSink {
  error(text: string, detail?: unknown): void;
}

export const consoleErrorSink: ErrorSink = {
  error: (text, detail) =>
    detail === undefined ? console.error(text) : console.error(text, detail),
};

/**
 * Met l'erreur en mots — sans rien écrire nulle part : c'est la partie qui
 * se relit et se vérifie sans navigateur.
 */
export function describeMediaError(op: MediaOp, error: unknown): MediaFailure {
  const message = messageOf(error);
  const short = message.length > MAX_DETAIL ? `${message.slice(0, MAX_DETAIL)}…` : message;
  return { op, message, detail: `${op} : ${short}` };
}

/**
 * Signale l'échec — console et carnet — et rend de quoi le rapporter aux
 * machines. L'objet d'origine accompagne la ligne de console : lui seul
 * porte la pile d'appels, que la console sait déplier.
 */
export function reportMediaError(
  op: MediaOp,
  error: unknown,
  sink: ErrorSink = consoleErrorSink,
): MediaFailure {
  const failure = describeMediaError(op, error);
  sink.error(`${TAG} WebRTC : ${failure.op} a échoué — ${failure.message}`, error);
  recordError(`WebRTC ${failure.op} : ${firstLine(failure.message)}`, bodyOf(failure, error));
  return failure;
}

/**
 * Ce que le navigateur a dit. Une `DOMException` porte le nom qui distingue
 * les familles d'échec (`NotAllowedError` = l'utilisateur a refusé la
 * caméra, `OperationError` = le SDP est irrecevable) : il vaut d'être
 * gardé devant le message.
 */
function messageOf(error: unknown): string {
  if (error instanceof Error) {
    if (error.name && error.message) return `${error.name}: ${error.message}`;
    return error.message || error.name;
  }
  if (typeof error === "string" && error !== "") return error;
  if (error !== null && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message !== "") return message;
  }
  return error === undefined || error === null ? "erreur sans détail" : String(error);
}

/** Le carnet garde le message entier, et la pile quand il y en a une. */
function bodyOf(failure: MediaFailure, error: unknown): string {
  const stack = error instanceof Error && error.stack ? `\n${error.stack}` : "";
  return `${failure.op}\n${failure.message}${stack}`;
}

/** L'entête du carnet tient sur une ligne : le reste se déplie. */
function firstLine(text: string): string {
  const end = text.indexOf("\n");
  return end === -1 ? text : text.slice(0, end);
}

/**
 * L'INVITE entrant refusé avant d'avoir sonné : son offre n'est pas
 * établissable ici (`sdp.unsupportedOffer`). Même règle que pour un échec
 * du navigateur — console et carnet, sans condition —, à ceci près que le
 * corps gardé est **l'offre elle-même** : c'est elle qui se relit, et qui
 * dit au passage quelle passerelle manque en face.
 */
export function reportOfferRefused(
  problem: string,
  sdp: string | null,
  sink: ErrorSink = consoleErrorSink,
): void {
  sink.error(`${TAG} INVITE refusé (488) : offre média incompatible WebRTC — ${problem}`);
  recordError(`Offre média incompatible WebRTC : ${problem}`, sdp ?? "");
}

/** Une panne du canal texte, telle qu'on la raconte. */
export interface TextChannelFailure {
  /** Ce qui est arrivé, en une phrase — c'est l'entête du carnet. */
  problem: string;
  /** L'erreur du navigateur quand il y en a une (`RTCErrorEvent.error`). */
  error?: unknown;
  /** Les faits qui accompagnent, rendus tels quels sous l'entête. */
  notes?: Readonly<Record<string, string | number>>;
}

/**
 * Une panne du **canal texte T.140** (`sip/rttdc.ts`) : rupture en cours
 * d'appel, ou canal qui ne s'établit jamais.
 *
 * Même règle que les deux fonctions ci-dessus, et pour la même raison —
 * console et carnet, sans condition. Un canal de données qui tombe ne
 * laisse aucune trace SIP : il vit sur l'association SCTP que l'appel
 * porte déjà, se rouvre sans renégociation, et son échec ne se voit nulle
 * part ailleurs. Sans cette ligne, il n'en resterait qu'un panneau de
 * tchat devenu muet, et personne ne saurait après coup si c'est le réseau,
 * la passerelle ou nous.
 *
 * `notes` porte les faits techniques que l'erreur du navigateur ne dit pas
 * — état de la connexion pair-à-pair, rôle, nombre de reprises : c'est ce
 * qui distingue une association SCTP détruite d'un distant qui n'ouvre
 * simplement jamais son canal.
 */
export function reportTextChannelError(
  failure: TextChannelFailure,
  sink: ErrorSink = consoleErrorSink,
): void {
  const message = failure.error === undefined ? "" : messageOf(failure.error);
  const notes = noteLines(failure);
  const cert = certificateFault(failure.error);
  const said = message === "" ? failure.problem : `${failure.problem} : ${firstLine(message)}`;
  const head = cert === null ? said : `${said} — ${cert}`;
  const line0 = `${TAG} Texte temps réel : ${head}`;
  const line = notes === "" ? line0 : `${line0}\n${notes}`;
  if (failure.error === undefined) sink.error(line);
  else sink.error(line, failure.error);
  recordError(`Canal texte T.140 : ${head}`, textChannelBody(failure, message, notes));
}

/**
 * Les faits techniques, un par ligne. Ceux d'une `RTCError` s'y ajoutent
 * d'office : `errorDetail` nomme la famille de l'échec (`sctp-failure`,
 * `data-channel-failure`) et `sctpCauseCode` le motif exact rendu par la
 * pile — c'est ce qui sépare un distant parti proprement d'une association
 * tombée en route.
 */
function noteLines(failure: TextChannelFailure): string {
  const notes: Record<string, string | number> = { ...failure.notes };
  const error = failure.error;
  if (error !== null && typeof error === "object") {
    const rtc = error as {
      errorDetail?: unknown;
      sctpCauseCode?: unknown;
      sentAlert?: unknown;
      receivedAlert?: unknown;
    };
    if (typeof rtc.errorDetail === "string") notes["errorDetail"] = rtc.errorDetail;
    if (typeof rtc.sctpCauseCode === "number") notes["sctpCauseCode"] = rtc.sctpCauseCode;
    if (typeof rtc.sentAlert === "number") notes["alerte envoyée"] = alertName(rtc.sentAlert);
    if (typeof rtc.receivedAlert === "number") {
      notes["alerte reçue"] = alertName(rtc.receivedAlert);
    }
  }
  return Object.entries(notes)
    .map(([key, value]) => `${key} : ${value}`)
    .join("\n");
}

/** Le carnet garde le message entier, les faits, et la pile s'il y en a une. */
function textChannelBody(failure: TextChannelFailure, message: string, notes: string): string {
  const stack =
    failure.error instanceof Error && failure.error.stack ? `\n${failure.error.stack}` : "";
  return [failure.problem, message, notes].filter((part) => part !== "").join("\n") + stack;
}

/**
 * **Le certificat du serveur, quand le navigateur veut bien le dire.**
 *
 * Une poignée de main DTLS qui échoue se solde par une **alerte** TLS, et
 * l'alerte porte un numéro qui nomme la cause (RFC 5246 §7.2, RFC 8446
 * §6.2). WebRTC est le seul endroit où le navigateur nous la rend :
 * `RTCError` porte `sentAlert` et `receivedAlert` quand `errorDetail` vaut
 * `dtls-failure`. Les alertes 42 à 46 et 48 désignent le **certificat**, et
 * la 45 dit précisément qu'il est **expiré** — c'est-à-dire exactement ce
 * qu'un exploitant veut lire dans un carnet d'appel plutôt que « échec
 * DTLS ».
 *
 * Le sens de l'alerte compte autant que son numéro : celle que **nous
 * envoyons** rejette le certificat d'en face, celle que nous **recevons**
 * rejette le nôtre. Confondre les deux enverrait le support réparer le
 * mauvais serveur.
 *
 * Sur WebSocket, rien de tel n'existe : la RFC 6455 réserve le code 1015
 * pour l'échec TLS mais **interdit** de le remonter à l'application, et les
 * navigateurs ferment sur 1006 sans motif — un certificat expiré, un DNS
 * mort et un port fermé y sont indistinguables (`sip/rttws.ts` le dit
 * plutôt que de deviner).
 */
export function certificateFault(error: unknown): string | null {
  if (error === null || typeof error !== "object") return null;
  const rtc = error as { sentAlert?: unknown; receivedAlert?: unknown };
  if (typeof rtc.sentAlert === "number" && CERTIFICATE_ALERTS.has(rtc.sentAlert)) {
    const what = rtc.sentAlert === 45 ? "expiré" : "invalide";
    return `certificat du serveur ${what}, refusé par ce poste (${alertName(rtc.sentAlert)})`;
  }
  if (typeof rtc.receivedAlert === "number" && CERTIFICATE_ALERTS.has(rtc.receivedAlert)) {
    return `notre certificat refusé par le serveur (${alertName(rtc.receivedAlert)})`;
  }
  return null;
}

/** Les alertes TLS qu'une pile DTLS émet en pratique, par leur nom de RFC. */
const TLS_ALERTS: Readonly<Record<number, string>> = {
  40: "handshake_failure",
  42: "bad_certificate",
  43: "unsupported_certificate",
  44: "certificate_revoked",
  45: "certificate_expired",
  46: "certificate_unknown",
  47: "illegal_parameter",
  48: "unknown_ca",
  49: "access_denied",
  50: "decode_error",
  51: "decrypt_error",
  70: "protocol_version",
  71: "insufficient_security",
  80: "internal_error",
  112: "unrecognized_name",
};

/**
 * Celles qui parlent du certificat et de lui seul. `decrypt_error` (51) n'y
 * est pas : elle accompagne le plus souvent une **empreinte SDP** qui ne
 * correspond pas, ce qui est un problème de signalisation — pas un
 * certificat périmé.
 */
const CERTIFICATE_ALERTS = new Set([42, 43, 44, 45, 46, 48]);

const alertName = (code: number): string => {
  const name = TLS_ALERTS[code];
  return name === undefined ? `alerte ${code}` : `alerte ${code} ${name}`;
};
