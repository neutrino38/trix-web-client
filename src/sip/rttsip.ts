/**
 * Le branchement du texte sur WebSocket dans la signalisation
 * (docs/CONCEPTION.md §4.9).
 *
 * Tout tient en une phrase : **la section `m=text` est ajoutée à ce qui
 * part, et retirée de ce qui arrive avant que le navigateur ne la voie.**
 * Chrome ne connaît pas `m=text 60000 TCP/WSS t140` ; une description
 * distante qui en porte une est refusée par `setRemoteDescription`, et une
 * réponse qui en compte une de plus que l'offre locale ne correspond plus
 * à ce que la connexion a rédigé. Le texte vit donc entièrement en dehors
 * de la pile WebRTC — il passe par un socket à part, dont la passerelle
 * annonce l'URL dans son SDP.
 *
 * Quatre passages, et rien d'autre :
 *
 * | SDP | qui | quoi |
 * |---|---|---|
 * | offre | locale | on **ajoute** la section, en dernier |
 * | réponse | distante | on **lit** l'URL, puis on **retire** la section |
 * | offre | distante | on **lit** l'URL, puis on **retire** la section |
 * | réponse | locale | on **ajoute** la section, au rang qu'elle occupait dans l'offre |
 *
 * Le rôle (appelant, appelé) n'entre pas en ligne de compte : ces quatre
 * cas le décrivent déjà, re-INVITE compris.
 *
 * Le canal, lui, **existe dès le début de l'appel** et reste le même
 * jusqu'à la fin : ce qui est tapé pendant la sonnerie attend dans son
 * tampon, et son état (`connecting`, `open`, `closed`) dit à l'interface
 * où en est le lien sans qu'elle ait à guetter un objet qui apparaît.
 */

import {
  rttChannel,
  type RttChannel,
  type RttTransport,
  type RttWire,
  type RttWireHooks,
} from "./rtt.js";
import { openWsWire, stripTextSection, withTextOverWs, wsUrlFromSdp } from "./rttws.js";

/** Ce que le négociateur a besoin de savoir d'une session JsSIP, et rien de plus. */
export interface SdpSession {
  on(event: "sdp", listener: (e: SdpEvent) => void): void;
}

/**
 * L'événement `sdp` de JsSIP. Le champ `sdp` est **modifiable** : c'est
 * ainsi que la pile laisse retoucher ce qui part sur le fil comme ce
 * qu'elle s'apprête à donner à la connexion pair-à-pair.
 */
export interface SdpEvent {
  originator: string;
  type: string;
  sdp: string;
}

export interface RttNegotiation {
  /** Le lien texte de l'appel, du premier INVITE au raccrochage. */
  channel: RttChannel;
  /** Ferme le lien — l'appel est terminé. */
  close(): void;
}

/**
 * Un fil qui n'existe pas encore : le canal est créé avec l'appel, le
 * socket ne s'ouvre qu'une fois l'URL connue — plusieurs secondes plus
 * tard, le temps que le distant réponde.
 */
function deferredWire(hooks: RttWireHooks): {
  wire: RttWire;
  open(url: string): void;
  giveUp(): void;
} {
  let inner: RttWire | null = null;
  let closed = false;
  return {
    wire: {
      send(text) {
        inner?.send(text);
      },
      close() {
        closed = true;
        inner?.close();
        inner = null;
      },
    },
    open(url) {
      if (closed || inner) return;
      inner = openWsWire(url, hooks);
    },
    /** Le distant n'a pas voulu du texte : le lien ne s'ouvrira pas. */
    giveUp() {
      if (!closed && !inner) hooks.state("closed");
    },
  };
}

/**
 * Branche le texte sur WebSocket sur une session. À appeler **avant** que
 * le premier SDP ne soit rédigé : côté appelant, dans la foulée de
 * `ua.call()` ; côté appelé, avant de répondre.
 */
export function negotiateRttOverWs(session: SdpSession): RttNegotiation {
  let deferred: ReturnType<typeof deferredWire> | null = null;
  /** L'URL du socket, dès qu'un SDP distant l'a annoncée. */
  let url: string | null = null;
  /**
   * Rang de la section texte dans la dernière offre distante — `null`
   * quand elle n'en portait pas, auquel cas notre réponse n'en portera pas
   * non plus : on ne propose pas du texte dans une réponse (RFC 3264 §6).
   */
  let answerAt: number | null = null;

  const channel = rttChannel("websocket", (hooks) => {
    deferred = deferredWire(hooks);
    return deferred.wire;
  });

  session.on("sdp", (e) => {
    const local = e.originator === "local";

    if (local && e.type === "offer") {
      e.sdp = withTextOverWs(e.sdp);
      return;
    }

    if (local && e.type === "answer") {
      // on ne répond du texte que si l'offre en portait, et seulement là
      // où elle le portait
      if (url !== null && answerAt !== null) e.sdp = withTextOverWs(e.sdp, answerAt);
      return;
    }

    // SDP distant — offre comme réponse : la même chose à en faire
    const found = wsUrlFromSdp(e.sdp);
    const { sdp, at } = stripTextSection(e.sdp);
    e.sdp = sdp;
    if (e.type === "offer") answerAt = found !== null ? at : null;

    if (found !== null) {
      if (url === null) {
        url = found;
        deferred?.open(found);
      }
      return;
    }
    // rien à cette négociation-ci : si le lien n'a jamais été obtenu,
    // c'est que le distant n'en veut pas — un re-INVITE muet sur le texte
    // ne referme pas un socket déjà ouvert
    if (url === null) deferred?.giveUp();
  });

  return {
    channel,
    close() {
      channel.close();
    },
  };
}

/**
 * Le lien texte que le compte demande, branché sur la session — `null`
 * quand il n'y a rien à brancher.
 *
 * `none` ne touche à rien : aucun écouteur `sdp` n'est même posé, et
 * l'appel se négocie exactement comme avant l'existence de ce réglage.
 * `datachannel` a son fil (`sip/rttdc.ts`) mais pas encore sa
 * négociation — il ne branche donc rien non plus, pour l'instant.
 */
export function openRttFor(transport: RttTransport, session: SdpSession): RttNegotiation | null {
  return transport === "websocket" ? negotiateRttOverWs(session) : null;
}
