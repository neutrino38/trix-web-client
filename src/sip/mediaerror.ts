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
