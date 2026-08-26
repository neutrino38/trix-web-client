/**
 * Le branchement du texte dans la signalisation (docs/CONCEPTION.md §4.9),
 * pour les deux transports — mais ils n'y ont rien en commun.
 *
 * Le **canal de données** (RFC 8865) ne demande rien à la signalisation :
 * il se greffe sur la connexion pair-à-pair avant que la première offre
 * ne soit rédigée, et DCEP annonce son sous-protocole dans le média. Pas
 * une ligne de SDP n'est lue ni écrite pour lui.
 *
 * Le **WebSocket**, lui, tient en une phrase : **la section `m=text` est ajoutée à ce qui
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
 * Dans les deux cas, le canal **existe dès le début de l'appel** et reste
 * le même jusqu'à la fin : ce qui est tapé pendant la sonnerie attend dans
 * son tampon, et son état (`connecting`, `open`, `lost`, `closed`) dit à
 * l'interface où en est le lien sans qu'elle ait à guetter un objet qui
 * apparaît.
 */

import {
  rttChannel,
  type RttChannel,
  type RttTransport,
  type RttWire,
  type RttWireHooks,
} from "./rtt.js";
import { openWsWire, stripTextSection, withTextOverWs, wsUrlFromSdp } from "./rttws.js";
import { openDcWire } from "./rttdc.js";

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

/**
 * What the data channel transport needs of a session: the peer
 * connection, as soon as JsSIP has one. `connection` is already there on
 * an outgoing call — `ua.call()` builds it before the offer is written —
 * and comes with the `peerconnection` event on an incoming one, fired
 * before the remote description is set.
 */
export interface PeerSession {
  connection?: RTCPeerConnection | null;
  on(event: "peerconnection", listener: (e: { peerconnection: RTCPeerConnection }) => void): void;
}

/** Which side we are on, and so who creates the T.140 channel. */
export type RttRole = "offer" | "answer";

export interface RttNegotiation {
  /** Le lien texte de l'appel, du premier INVITE au raccrochage. */
  channel: RttChannel;
  /**
   * Le texte est-il **négocié** ? C'est-à-dire : les deux bouts en ont-ils
   * convenu dans la signalisation — pas « le lien est-il ouvert », que dit
   * `channel.state` (ADR 0003, D1). Les deux transports répondent à des
   * endroits différents, et c'est toute la raison d'être de cette méthode :
   *
   * - **WebSocket** — le distant a annoncé l'URL de son socket dans son
   *   SDP. Tant qu'aucun SDP distant n'est arrivé, la réponse est non ;
   * - **canal de données** — l'association SCTP a été négociée
   *   (`RTCPeerConnection.sctp`). Le canal `t140` lui-même s'ouvre plus
   *   tard, par DCEP, et c'est justement la nuance : `text: true` avec un
   *   canal encore `connecting` est un état normal.
   */
  negotiated(): boolean;
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
  open(make: (hooks: RttWireHooks) => RttWire): void;
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
    open(make) {
      if (closed || inner) return;
      inner = make(hooks);
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
        deferred?.open((hooks) => openWsWire(found, hooks));
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
    // l'URL vient du SDP distant : la voir, c'est que le distant a répondu
    // du texte — la retirer de ce que le navigateur voit n'y change rien
    negotiated: () => url !== null,
    close() {
      channel.close();
    },
  };
}

/**
 * Binds the data channel transport to a session — RFC 8865.
 *
 * **Not one line of SDP is read or written here.** The channel is created
 * on the peer connection itself, before the first offer is written, and
 * DCEP carries the `t140` subprotocol in the media. Which is also why the
 * channel is opened with the call rather than when the user asks for
 * text: a data channel created mid-call on a connection that has no
 * `m=application` section triggers a renegotiation, hence a re-INVITE,
 * hence a possible SIP glare — for a feature the user believes is local.
 * An open, silent channel costs nothing.
 *
 * The role is the one the call gives it and never changes: the caller
 * writes the offer that establishes the SCTP association, so the caller
 * creates the channel. Should the far end create one too, `sip/rttdc.ts`
 * settles it on the channel id, for as long as the session lasts.
 */
export function negotiateRttOverDc(session: PeerSession, role: RttRole): RttNegotiation {
  let deferred: ReturnType<typeof deferredWire> | null = null;
  /** Le fil du canal, gardé pour pouvoir dire « fermé » sans passer par lui. */
  let link: RttWireHooks | null = null;

  const channel = rttChannel("datachannel", (hooks) => {
    link = hooks;
    deferred = deferredWire(hooks);
    return deferred.wire;
  });

  /** La connexion, dès qu'il y en a une : c'est elle qui porte le SCTP. */
  let peer: RTCPeerConnection | null = null;

  /**
   * **Le distant n'a pas voulu du texte.** Le canal a été créé avant
   * l'offre (RFC 8865 §5) : il existe donc déjà quand la réponse arrive, et
   * DCEP ne l'ouvrira jamais si l'association SCTP n'a pas été négociée —
   * le lien resterait `connecting` pour toute la durée de l'appel, et
   * l'interface promettrait un tchat qui n'a pas de fil. Sans association à
   * la première négociation aboutie, on le ferme, comme `giveUp()` le fait
   * pour le WebSocket qui n'a pas reçu d'URL.
   */
  const settle = (pc: RTCPeerConnection): void => {
    // `stable` est aussi l'état d'une connexion neuve : c'est la description
    // distante appliquée qui distingue « rien n'a encore été négocié » de
    // « la négociation est finie, et elle n'a pas porté de SCTP »
    if (pc.signalingState !== "stable" || pc.currentRemoteDescription === null) return;
    if ((pc.sctp ?? null) !== null) return;
    link?.state("closed");
  };

  const start = (pc: RTCPeerConnection): void => {
    peer = pc;
    deferred?.open((hooks) => openDcWire(pc, role, hooks));
    pc.addEventListener("signalingstatechange", () => settle(pc));
    // la connexion peut être arrivée déjà stable — un appel entrant dont le
    // `peerconnection` est signalé après la réponse
    settle(pc);
  };
  if (session.connection) start(session.connection);
  else session.on("peerconnection", (e) => start(e.peerconnection));

  return {
    channel,
    // `sctp` n'existe qu'une fois la section `m=application` négociée des
    // deux côtés : un distant qui l'a rejetée (port 0) la laisse à `null`
    negotiated: () => (peer?.sctp ?? null) !== null,
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
 * `datachannel` n'en pose pas davantage : il ne touche qu'à la connexion
 * pair-à-pair, jamais au SDP.
 */
export function openRttFor(
  transport: RttTransport,
  session: SdpSession & PeerSession,
  role: RttRole,
): RttNegotiation | null {
  if (transport === "websocket") return negotiateRttOverWs(session);
  if (transport === "datachannel") return negotiateRttOverDc(session, role);
  return null;
}
