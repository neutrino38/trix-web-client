/**
 * Port SIP : la seule frontière entre les machines FSL et JsSIP
 * (docs/CONCEPTION.md §2). Les machines reçoivent des événements
 * `sip:*` et ne voient jamais un type JsSIP ; les tests injectent
 * un port factice.
 */

import JsSIP from "jssip";
import type { AccountConfig } from "../storage/store.js";
import { iceServers } from "./ice.js";
import { answeredMedia, offeredMedia, withoutVideo } from "./sdp.js";
import { traceSocket } from "./trace.js";
import { openCallTrace, type CallTraceHandle, type TraceLine } from "./record.js";
import { MEDIA_ERROR_EVENTS, reportMediaError, type MediaFailure } from "./mediaerror.js";
import { createCallStats, STATS_SAMPLE_MS, type MediaStats } from "./stats.js";
import { sipTraceEnabled } from "./trace.js";

export type SipEvent =
  | { type: "sip:connected" }
  | { type: "sip:disconnected" }
  | { type: "sip:registered" }
  | { type: "sip:unregistered" }
  | { type: "sip:registrationFailed"; cause: string; statusCode?: number }
  /** URL de proxy rejetée par JsSIP avant toute tentative réseau (schéma/syntaxe). */
  | { type: "sip:invalidProxy"; detail: string }
  /** INVITE entrant : la machine décide de répondre ou de refuser. */
  | { type: "sip:incoming"; call: IncomingCall };

/**
 * Combinaison de médias d'un appel. Extensible : les modes exotiques à
 * venir (vidéo sans son, texte seul…) s'ajouteront ici sans toucher aux
 * machines — elles ne font que transporter le descripteur.
 */
export interface CallMedia {
  audio: boolean;
  video: boolean;
}

/** Qui est à l'origine de la fin de session, tel que vu par JsSIP. */
export type SipOriginator = "local" | "remote" | "system";

/** Événements d'une session d'appel, envoyés au bloc CallBlock. */
export type CallSipEvent =
  | { type: "sip:progress" }
  | { type: "sip:accepted" }
  | { type: "sip:confirmed" }
  | { type: "sip:ended"; cause: string; originator?: SipOriginator }
  /**
   * Fin de session avant établissement. `detail` porte ce que le
   * navigateur a dit quand l'échec vient du média (`sip/mediaerror.ts`) :
   * la cause JsSIP seule (« WebRTC Error ») ne nomme jamais le vrai
   * problème.
   */
  | {
      type: "sip:failed";
      cause: string;
      statusCode?: number;
      originator?: SipOriginator;
      detail?: string;
    }
  /**
   * Les médias de l'appel viennent d'être négociés — à l'établissement
   * comme après un re-INVITE, dans un sens ou dans l'autre. C'est le
   * **résultat**, lu sur la connexion pair-à-pair : ce que l'appel
   * transporte réellement, et non ce qui avait été demandé.
   */
  | { type: "sip:mediaChanged"; media: CallMedia }
  /**
   * Notre demande de changement n'a pas abouti : l'appel continue tel
   * qu'il était. `by` sépare les deux refus, qui ne se disent pas de la
   * même façon à l'écran — le distant a dit non (488, ou 200 OK dont la
   * réponse SDP désactive le flux), ou bien la demande n'a jamais pu
   * partir d'ici (caméra indisponible, négociation déjà en cours).
   */
  | { type: "sip:mediaRefused"; by: "remote" | "local"; statusCode?: number }
  /**
   * Le distant demande à ajouter la vidéo à un appel qui n'en a pas : sa
   * caméra s'allumerait sans que personne l'ait décidé ici, donc la
   * réponse SIP attend la décision de l'utilisateur.
   */
  | { type: "sip:mediaOffer"; media: CallMedia; offer: MediaOffer };

/**
 * Demande de changement de média venue du distant, en attente de
 * décision. Répondre est obligatoire : tant que ni `accept` ni `reject`
 * n'est appelé, le re-INVITE reste sans réponse finale (le 100 Trying est
 * déjà parti) et l'appelant patiente.
 */
export interface MediaOffer {
  /** 200 OK : la caméra s'allume et la vidéo rejoint l'appel. */
  accept(): void;
  /** 488 Not Acceptable Here : l'appel continue sans la vidéo. */
  reject(): void;
}

/**
 * Session d'appel côté machine/UI : la frontière média. `attachMedia`
 * est le seul point où l'UI touche aux flux WebRTC — jamais à JsSIP.
 */
export interface CallSession {
  /** CANCEL / BYE selon l'état ; sans effet si la session est déjà terminée. */
  terminate(): void;
  /**
   * Les paquets SIP de cet appel et les états traversés, quand la trace
   * était active (`sip/record.ts`) — vide sinon. À prendre une fois, la
   * session finie : le carnet se referme en rendant ses lignes.
   */
  trace(): TraceLine[];
  setMicMuted(muted: boolean): void;
  /**
   * Ajoute ou retire la vidéo de l'appel en cours par re-INVITE
   * (docs/CONCEPTION.md §4.4) — il n'y a pas de « couper sa caméra » en
   * conversation totale : ne plus émettre d'image, c'est retirer la vidéo
   * de l'appel, et le distant doit le savoir.
   *
   * Ne rend rien : l'issue arrive par événement, `sip:mediaChanged` si le
   * distant a suivi, `sip:mediaRefused` s'il a dit non.
   */
  setVideo(on: boolean): void;
  attachMedia(remote: HTMLVideoElement, local: HTMLVideoElement | null): void;
  /**
   * L'état du média sur les dix dernières secondes — ce que l'UI affiche
   * pendant la conversation. `null` tant que rien n'a été mesuré, et quand
   * la trace est décochée : c'est la même case qui commande (§5.4).
   */
  mediaStats(): MediaStats | null;
  /**
   * Le bilan de tout ce qui a été mesuré de l'appel, pour l'historique. À
   * prendre une fois la session finie, comme `trace()` — le dernier
   * échantillon date d'au plus une seconde avant le raccrochage, la
   * connexion pair-à-pair ne survivant pas à la fin de session.
   */
  callStats(): MediaStats | null;
}

/**
 * Motif de refus d'un appel entrant. Le port seul connaît les codes SIP
 * correspondants — les machines raisonnent en intentions.
 */
export type RejectReason = "declined" | "busy" | "timeout";

/**
 * Appel entrant en attente de décision (docs/CONCEPTION.md §4.3).
 * L'identité et les médias proposés sont figés à l'arrivée de l'INVITE ;
 * `listen` doit être appelé avant toute décision pour ne pas manquer une
 * annulation de l'appelant.
 */
export interface IncomingCall {
  /** URI de l'appelant (`sip:bob@example.fr`). */
  from: string;
  /** Nom affiché porté par l'en-tête From, s'il y en a un. */
  displayName: string | null;
  /** Médias réellement proposés par l'offre SDP de l'INVITE. */
  offered: CallMedia;
  /** Branche les événements de la session (annulation comprise) et rend la session. */
  listen(send: (ev: CallSipEvent) => void): CallSession;
  /** 200 OK avec la combinaison de médias choisie (sous-ensemble de `offered`). */
  answer(media: CallMedia): void;
  reject(reason: RejectReason): void;
}

export interface SipHandle {
  /**
   * unREGISTER + fermeture du transport. Les événements continuent
   * d'arriver jusqu'à `sip:disconnected`, après quoi le port se détache.
   */
  stop(): void;
  /**
   * Renvoie un REGISTER sur le transport existant : même Call-ID, CSeq
   * suivant, aucun nouveau contact chez le registrar. Rend `false` si le
   * transport est déjà fermé — il faut alors repartir d'un nouvel UA.
   */
  refresh(): boolean;
  /** INVITE sortant avec la combinaison de médias demandée. Peut lever si la cible est invalide. */
  call(target: string, media: CallMedia, send: (ev: CallSipEvent) => void): CallSession;
}

export interface SipPort {
  start(cfg: AccountConfig, send: (ev: SipEvent) => void): SipHandle;
}

export function createJsSipPort(): SipPort {
  return {
    start(cfg, send) {
      let ua: JsSIP.UA;
      try {
        // enveloppé sans condition : la trace se décide paquet par paquet
        // (src/sip/trace.ts), pour que cocher la case en cours de
        // communication n'oblige pas à rouvrir le transport
        const socket = traceSocket(new JsSIP.WebSocketInterface(cfg.proxy));
        ua = new JsSIP.UA({
          sockets: [socket],
          uri: `sip:${cfg.username}@${cfg.domain}`,
          display_name: cfg.displayName,
          realm: cfg.domain,
          ha1: cfg.ha1,
          register: true,
          ...(cfg.authUsername ? { authorization_user: cfg.authUsername } : {}),
        });
      } catch (e) {
        // microtask : start() est appelé depuis enter(), l'événement doit
        // arriver une fois la transition vers `connecting` terminée
        queueMicrotask(() =>
          send({ type: "sip:invalidProxy", detail: e instanceof Error ? e.message : String(e) }),
        );
        return {
          stop() {},
          refresh() {
            return false;
          },
          call() {
            // jamais atteint : la machine part en reg_failed avant tout appel.
            // Message technique, non traduit : il rejoint les causes JsSIP
            // comme détail de `reason.callFailed`.
            throw new Error("SIP UA not started (invalid proxy)");
          },
        };
      }

      // Serveurs ICE du compte : JsSIP les attend par session (`pcConfig`),
      // pas sur l'UA — même configuration pour l'appel sortant et la
      // réponse à un entrant.
      const pcConfig: RTCConfiguration = { iceServers: iceServers(cfg.ice) };

      let stopped = false;
      ua.on("connected", () => send({ type: "sip:connected" }));
      ua.on("disconnected", () => {
        send({ type: "sip:disconnected" });
        // UA étend EventEmitter au runtime, mais les types JsSIP ne l'exposent pas
        if (stopped) (ua as unknown as { removeAllListeners(): void }).removeAllListeners();
      });
      ua.on("registered", () => send({ type: "sip:registered" }));
      ua.on("unregistered", () => send({ type: "sip:unregistered" }));
      ua.on(
        "registrationFailed",
        (e: { cause?: string; response?: { status_code?: number } | null }) =>
          send({
            type: "sip:registrationFailed",
            cause: e.cause ?? "cause inconnue",
            statusCode: e.response?.status_code,
          }),
      );
      // INVITE entrant : on ne fait que le signaler, la décision (répondre,
      // refuser) appartient aux machines. Les sessions sortantes passent
      // aussi par cet événement — elles sont déjà pilotées par call().
      // le listener est typé sur une union de deux formes d'événement :
      // on décrit la partie commune dont on a besoin
      ua.on(
        "newRTCSession",
        (e: {
          originator: string;
          session: Session;
          request: { body?: string | null; call_id?: string };
        }) => {
          if (e.originator !== "remote") return;
          send({
            type: "sip:incoming",
            call: wrapIncoming(e.session, e.request, pcConfig),
          });
        },
      );
      ua.start();

      return {
        stop() {
          stopped = true;
          ua.stop();
        },
        refresh() {
          if (!ua.isConnected()) return false;
          ua.register();
          return true;
        },
        call(target, media, sendCall) {
          // avant l'INVITE : le carnet adopte le dialogue du premier qui part
          const book = openCallTrace(null);
          const session = ua.call(target, {
            mediaConstraints: { audio: media.audio, video: media.video },
            pcConfig,
          });
          bindSession(session, sendCall);
          return wrapSession(session, book, mediaControl(session, sendCall));
        },
      };
    },
  };
}

type Session = ReturnType<JsSIP.UA["call"]>;

/** Seul point de traduction des événements d'une session JsSIP en événements de machine. */
function bindSession(session: Session, send: (ev: CallSipEvent) => void): void {
  // ce que le navigateur a refusé, capté avant que JsSIP ne le réduise à
  // « WebRTC Error » : le dernier échec vu accompagne la fin de session
  let failure: MediaFailure | null = null;
  bindMediaErrors(session, (f) => {
    failure = f;
  });

  session.on("progress", () => send({ type: "sip:progress" }));
  session.on("accepted", () => send({ type: "sip:accepted" }));
  session.on("confirmed", () => send({ type: "sip:confirmed" }));
  session.on("ended", (e) =>
    send({ type: "sip:ended", cause: causeOf(e), originator: originatorOf(e) }),
  );
  session.on("failed", (e) => {
    const cause = causeOf(e);
    const report = (): void =>
      send({
        type: "sip:failed",
        cause,
        statusCode: statusOf(e),
        originator: originatorOf(e),
        ...(failure ? { detail: failure.detail } : {}),
      });
    // JsSIP émet `failed` **avant** l'événement qui porte l'erreur quand
    // c'est setRemoteDescription qui a échoué (il répond 488, échoue la
    // session, puis seulement émet `peerconnection:…failed`). Les deux
    // partent du même `catch`, donc du même tick : rapporter au microtask
    // suivant suffit à ce que le motif ait son détail, et l'ordre des
    // événements vus par la machine ne change pas — rien d'autre n'est
    // émis entre-temps.
    if (mediaCause(cause)) queueMicrotask(report);
    else report();
  });
}

/** Causes JsSIP derrière lesquelles se cache un message du navigateur. */
const MEDIA_CAUSES: ReadonlySet<string> = new Set<string>([
  JsSIP.C.causes.WEBRTC_ERROR,
  JsSIP.C.causes.USER_DENIED_MEDIA_ACCESS,
  JsSIP.C.causes.BAD_MEDIA_DESCRIPTION,
  JsSIP.C.causes.INTERNAL_ERROR,
]);

function mediaCause(cause: string): boolean {
  return MEDIA_CAUSES.has(cause);
}

/**
 * Branche les échecs WebRTC de la session. Ils sont tracés sans condition
 * par `sip/mediaerror.ts` ; ce qui remonte ici est ce qui servira à dire
 * *pourquoi* l'appel a échoué. Les noms d'événements ne sont pas dans les
 * types de JsSIP, qui n'y déclare que les siens.
 */
function bindMediaErrors(session: Session, onFailure: (failure: MediaFailure) => void): void {
  const emitter = session as unknown as {
    on(event: string, listener: (error: unknown) => void): void;
  };
  for (const [event, op] of Object.entries(MEDIA_ERROR_EVENTS)) {
    emitter.on(event, (error) => onFailure(reportMediaError(op, error)));
  }
}

/** Codes SIP de refus : le reste de l'application raisonne en motifs. */
const REJECT: Record<RejectReason, { status_code: number; reason_phrase: string }> = {
  declined: { status_code: 603, reason_phrase: "Decline" },
  busy: { status_code: 486, reason_phrase: "Busy Here" },
  timeout: { status_code: 480, reason_phrase: "Temporarily Unavailable" },
};

function wrapIncoming(
  session: Session,
  request: { body?: string | null; call_id?: string },
  pcConfig: RTCConfiguration,
): IncomingCall {
  const from = session.remote_identity;
  const offered = offeredMedia(request.body ?? null);
  // né avec l'écoute, consulté par la réponse : c'est lui qui saura refuser
  // la vidéo d'une offre à laquelle on répond en audio seul
  let control: MediaControl | null = null;
  return {
    from: from.uri.toString(),
    displayName: from.display_name || null,
    offered,
    listen(send) {
      bindSession(session, send);
      control = mediaControl(session, send);
      // le carnet ne s'ouvre qu'ici, jamais à l'arrivée de l'INVITE : un
      // second appel refusé « occupé » n'est pas écouté, et n'a donc pas de
      // carnet à voler à la communication en cours. L'INVITE, lui, est déjà
      // passé — le Call-ID sert à le rattraper.
      return wrapSession(session, openCallTrace(request.call_id ?? null), control);
    },
    answer(media) {
      // répondre « audio seul » à une offre audio + vidéo se dit dans la
      // réponse SDP : sans cela le navigateur répondrait `recvonly` et
      // l'appelant continuerait d'émettre son image (§4.4)
      if (offered.video && !media.video) control?.refuseVideo();
      session.answer({ mediaConstraints: { audio: media.audio, video: media.video }, pcConfig });
    },
    reject(reason) {
      if (!session.isEnded()) session.terminate(REJECT[reason]);
    },
  };
}

function causeOf(e: unknown): string {
  const c = (e as { cause?: unknown }).cause;
  return typeof c === "string" && c !== "" ? c : "cause inconnue";
}

function originatorOf(e: unknown): SipOriginator | undefined {
  const o = (e as { originator?: unknown }).originator;
  return o === "local" || o === "remote" || o === "system" ? o : undefined;
}

/** Code SIP de la réponse finale (486, 603…) quand l'échec vient du distant. */
function statusOf(e: unknown): number | undefined {
  const m = (e as { message?: { status_code?: unknown } | null }).message;
  return typeof m?.status_code === "number" ? m.status_code : undefined;
}

// ---------------------------------------------------------------------------
// Négociation des médias en cours d'appel (docs/CONCEPTION.md §4.4)
// ---------------------------------------------------------------------------

/**
 * Ce que Trix pilote de la session au-delà des médias offerts au départ :
 * refuser la vidéo d'une offre, l'ajouter ou la retirer en cours d'appel,
 * et dire ce que l'appel transporte réellement après chaque négociation.
 *
 * Tout l'état média d'une session vit ici, dans une seule fermeture : la
 * piste vidéo que nous avons ouverte (et que nous seuls pouvons éteindre),
 * le refus en vigueur, le dernier résultat publié.
 */
interface MediaControl {
  /** Prochaine réponse SDP : vidéo déclarée `inactive`. */
  refuseVideo(): void;
  /** Re-INVITE ajoutant (ou retirant) la vidéo. */
  setVideo(on: boolean): void;
  /** Fin d'appel : la caméra que nous avons allumée s'éteint avec lui. */
  release(): void;
}

/** Le transceiver vidéo de la connexion, s'il en existe un. */
function videoTransceiver(pc: RTCPeerConnection): RTCRtpTransceiver | null {
  return (
    pc
      .getTransceivers()
      .find((tr) => (tr.receiver.track?.kind ?? tr.sender.track?.kind) === "video") ?? null
  );
}

/**
 * Ce que la connexion transporte **effectivement**, lu sur la direction
 * négociée de chaque transceiver. C'est la seule source honnête : le SDP
 * dit ce qui a été demandé, `currentDirection` dit ce qui a été conclu.
 * Un transceiver jamais négocié (`currentDirection === null`) ne compte
 * pas encore.
 */
function negotiatedMedia(pc: RTCPeerConnection): CallMedia {
  const media: CallMedia = { audio: false, video: false };
  for (const tr of pc.getTransceivers()) {
    const kind = tr.receiver.track?.kind ?? tr.sender.track?.kind;
    if (kind !== "audio" && kind !== "video") continue;
    if (tr.currentDirection && tr.currentDirection !== "inactive") media[kind] = true;
  }
  return media;
}

/**
 * Ce que JsSIP ne montre pas dans ses types mais que la conversation
 * totale exige :
 *
 * - `_sendReinvite` plutôt que `renegotiate()`, dont le gestionnaire
 *   d'échec **raccroche l'appel** (500 Media Renegotiation Failed) : un
 *   488 n'est pas une fin d'appel, c'est un non ;
 * - `_receiveReinvite` intercepté, parce que l'événement public
 *   `reinvite` ne se décide que sur-le-champ — or accepter la vidéo
 *   demande d'allumer une caméra, donc l'accord de l'utilisateur, donc du
 *   temps. La transaction serveur a déjà répondu 100 Trying : l'appelant
 *   patiente sans que rien n'expire.
 */
interface Renegotiable {
  isReadyToReOffer(): boolean;
  _sendReinvite(options: {
    eventHandlers: { succeeded(response: unknown): void; failed(response?: unknown): void };
  }): void;
  _receiveReinvite(request: InDialogRequest): void;
}

/** Le re-INVITE tel que nous avons besoin de le lire et d'y répondre. */
interface InDialogRequest {
  body?: string | null;
  reply(code: number, reason?: string | null): void;
}

function mediaControl(session: Session, send: (ev: CallSipEvent) => void): MediaControl {
  const raw = session as unknown as Session & Renegotiable;
  /** La caméra que nous avons ouverte : personne d'autre ne l'éteindra. */
  let own: MediaStreamTrack | null = null;
  /** Vidéo refusée dans la prochaine réponse SDP (réponse audio à une offre A/V). */
  let refusing = false;
  /** Dernier résultat publié — on ne signale que les changements. */
  let published: CallMedia | null = null;
  /**
   * Ce que notre re-INVITE en vol demande (`true` = ajouter la vidéo).
   * Lu à l'arrivée de la réponse : c'est la demande, et non la caméra
   * ouverte, qui dit s'il y a eu refus — la caméra, elle, a pu être
   * refermée entre-temps par l'observateur de négociation.
   */
  let asking: boolean | null = null;
  let pc: RTCPeerConnection | null = null;

  /**
   * Éteint la caméra qui alimentait l'appel — la nôtre comme celle que
   * JsSIP a ouverte pour un INVITE vidéo. Une piste laissée vivante
   * garderait le voyant de la machine allumé alors que plus personne ne
   * reçoit l'image : c'est le genre de détail sur lequel se juge un
   * logiciel de visiophonie.
   */
  const stopSending = (conn: RTCPeerConnection | null): void => {
    const tr = conn ? videoTransceiver(conn) : null;
    const track = tr?.sender.track;
    if (tr && track) {
      // la piste s'arrête dans tous les cas — c'est elle qui tient le
      // voyant de la caméra allumé. La détacher du sender, en revanche,
      // n'a de sens que sur une connexion encore ouverte : `release()` est
      // appelé sur `failed`, donc après que JsSIP a fermé la sienne, et
      // `replaceTrack` y lève un InvalidStateError qui n'apprend rien.
      track.stop();
      if (conn && conn.signalingState !== "closed") {
        void tr.sender.replaceTrack(null).catch(() => {});
      }
    }
    own?.stop();
    own = null;
  };

  /**
   * Après chaque négociation (retour à `stable`), l'appel dit ce qu'il
   * transporte. Un seul observateur pour tous les cas : établissement,
   * re-INVITE reçu, re-INVITE émis — l'événement ne dépend pas de qui a
   * pris l'initiative.
   */
  const watch = (conn: RTCPeerConnection): void => {
    pc = conn;
    conn.addEventListener("signalingstatechange", () => {
      if (conn.signalingState !== "stable") return;
      const media = negotiatedMedia(conn);
      // la vidéo est sortie de l'appel : la caméra n'a plus de raison de
      // rester allumée
      if (!media.video) stopSending(conn);
      if (published && published.audio === media.audio && published.video === media.video) return;
      published = media;
      send({ type: "sip:mediaChanged", media });
    });
  };
  if (session.connection) watch(session.connection);
  else session.on("peerconnection", (e) => watch(e.peerconnection));

  /**
   * Filet de la réponse SDP : le transceiver est déjà passé `inactive`
   * (voir `blockVideoInAnswer`), cette réécriture ne fait que garantir que
   * la réponse **partie sur le fil** le dit aussi, quelle que soit la
   * façon dont le navigateur a rédigé son answer.
   */
  session.on("sdp", (e: { originator: string; type: string; sdp: string }) => {
    if (refusing && e.originator === "local" && e.type === "answer") e.sdp = withoutVideo(e.sdp);
  });

  /**
   * Notre image rejoint l'appel : la caméra s'ouvre, la piste prend la
   * place du transceiver vidéo existant s'il y en a un (celui d'une offre
   * refusée plus tôt), sinon elle en crée un.
   */
  const openCamera = async (conn: RTCPeerConnection): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      const track = stream.getVideoTracks()[0];
      if (!track) return false;
      own = track;
      const tr = videoTransceiver(conn);
      if (tr) {
        await tr.sender.replaceTrack(track);
        tr.direction = "sendrecv";
      } else {
        conn.addTrack(track, stream);
      }
      return true;
    } catch {
      // caméra refusée par le système ou déjà prise : l'appel continue
      stopSending(conn);
      return false;
    }
  };

  /** Notre image quitte l'appel : transceiver rendu inactif, caméra éteinte. */
  const closeCamera = (conn: RTCPeerConnection): void => {
    stopSending(conn);
    const tr = videoTransceiver(conn);
    if (tr) tr.direction = "inactive";
  };

  /**
   * Notre re-INVITE. L'offre locale est déjà appliquée quand la réponse
   * arrive : un refus laisse la connexion en `have-local-offer`, d'où le
   * retour arrière — sans lui, plus aucune renégociation ne serait
   * possible de tout l'appel.
   */
  const reinvite = (): void => {
    raw._sendReinvite({
      eventHandlers: {
        succeeded: (response) => {
          const body = (response as { body?: string | null }).body;
          const wanted = asking;
          asking = null;
          // le résultat est publié par l'observateur de négociation ; ici
          // on ne rattrape que le refus poli, celui qui répond 200 OK en
          // ayant désactivé le flux
          if (wanted && !answeredMedia(body).video)
            send({ type: "sip:mediaRefused", by: "remote" });
        },
        failed: (response) => {
          asking = null;
          const conn = pc;
          if (conn) {
            if (conn.signalingState === "have-local-offer")
              void conn.setLocalDescription({ type: "rollback" }).catch(() => {});
            closeCamera(conn);
          }
          // sans réponse du tout (transport, délai), ce n'est pas un refus
          // du distant : la phrase affichée n'est pas la même
          const statusCode = statusOf(response ?? {});
          send({ type: "sip:mediaRefused", by: statusCode ? "remote" : "local", statusCode });
        },
      },
    });
  };

  /**
   * Re-INVITE reçu. Ce qui ne fait qu'ôter la vidéo, ou n'y touche pas
   * (rafraîchissement de session, mise en attente), suit le chemin normal
   * de JsSIP. Ajouter la vidéo, en revanche, allumerait une caméra : la
   * réponse attend que l'utilisateur ait tranché.
   */
  const passThrough = raw._receiveReinvite.bind(raw);
  raw._receiveReinvite = (request: InDialogRequest): void => {
    const conn = pc;
    const wanted = offeredMedia(request.body ?? null);
    if (!conn || !wanted.video || negotiatedMedia(conn).video) {
      passThrough(request);
      return;
    }
    let answered = false;
    const once = (fn: () => void): (() => void) => () => {
      if (answered || session.isEnded()) return;
      answered = true;
      fn();
    };
    send({
      type: "sip:mediaOffer",
      media: wanted,
      offer: {
        accept: once(() => {
          refusing = false;
          void openCamera(conn).then((ok) => {
            // caméra impossible à ouvrir : mieux vaut le dire au distant
            // que de lui répondre une vidéo qui n'arrivera jamais
            if (ok) passThrough(request);
            else request.reply(488, "Not Acceptable Here");
          });
        }),
        reject: once(() => {
          refusing = true;
          request.reply(488, "Not Acceptable Here");
        }),
      },
    });
  };

  return {
    refuseVideo() {
      refusing = true;
      const block = (conn: RTCPeerConnection): void => blockVideoInAnswer(conn, () => refusing);
      if (session.connection) block(session.connection);
      else session.on("peerconnection", (e) => block(e.peerconnection));
    },
    setVideo(on) {
      const conn = pc;
      if (!conn || session.isEnded()) return;
      if (!raw.isReadyToReOffer()) {
        // une négociation est déjà en vol : réessayer plus tard vaut mieux
        // que deux offres qui se croisent (RFC 3261 §14.1, « glare »)
        send({ type: "sip:mediaRefused", by: "local" });
        return;
      }
      if (!on) {
        refusing = true;
        asking = false;
        closeCamera(conn);
        reinvite();
        return;
      }
      refusing = false;
      void openCamera(conn).then((ok) => {
        if (!ok) {
          send({ type: "sip:mediaRefused", by: "local" });
          return;
        }
        asking = true;
        reinvite();
      });
    },
    release: () => stopSending(pc),
  };
}

/**
 * Répondre sans vidéo à une offre qui en propose : le transceiver que
 * l'offre distante vient de créer passe `inactive` **avant** que le
 * navigateur ne rédige sa réponse. Laissé à lui-même, il répondrait
 * `recvonly` — pas d'image envoyée, mais l'image du distant acceptée,
 * c'est-à-dire tout le contraire de ce que l'appelé a demandé.
 *
 * Le rendez-vous est `have-remote-offer` : l'offre est appliquée, les
 * transceivers existent, la réponse n'est pas encore écrite.
 */
function blockVideoInAnswer(pc: RTCPeerConnection, active: () => boolean): void {
  pc.addEventListener("signalingstatechange", () => {
    if (pc.signalingState !== "have-remote-offer" || !active()) return;
    const tr = videoTransceiver(pc);
    if (tr) tr.direction = "inactive";
  });
}

interface RtcSessionLike {
  connection: RTCPeerConnection | undefined;
  isEnded(): boolean;
  terminate(): void;
  mute(opts: { audio?: boolean; video?: boolean }): void;
  unmute(opts: { audio?: boolean; video?: boolean }): void;
  on(event: string, listener: (...args: never[]) => void): void;
}

/**
 * Échantillonne les compteurs média de la session, une fois par seconde,
 * tant qu'elle dure. C'est ici et nulle part ailleurs : la fenêtre de 10 s
 * affichée pendant l'appel et le bilan gardé par l'historique sortent des
 * **mêmes** relevés, et la connexion pair-à-pair n'est plus interrogeable
 * une fois la session terminée.
 *
 * Le réglage est consulté à chaque relevé, comme pour les paquets (§5.2) :
 * cocher la case en pleine communication fait démarrer la mesure, sans que
 * l'appel s'en aperçoive. Décochée, aucun `getStats()` n'est demandé.
 */
function collectStats(session: RtcSessionLike) {
  const media = createCallStats();
  const timer = setInterval(() => {
    if (session.isEnded()) return clearInterval(timer);
    if (!sipTraceEnabled()) return;
    // getStats() sans sélecteur : le rapport entier, celui que sip/stats.ts
    // sait réduire aux quatre sens qui nous intéressent
    void session.connection?.getStats().then(
      (report) => media.push(report),
      () => {
        // connexion fermée entre deux relevés : le suivant s'arrêtera sur
        // `isEnded()`, il n'y a rien à rattraper
      },
    );
  }, STATS_SAMPLE_MS);
  return media;
}

function wrapSession(
  session: RtcSessionLike,
  book: CallTraceHandle,
  control: MediaControl,
): CallSession {
  const media = collectStats(session);
  // la caméra que nous avons ouverte survivrait au dialogue : JsSIP ne
  // referme que le flux qu'il a demandé lui-même
  session.on("ended", control.release);
  session.on("failed", control.release);
  return {
    terminate() {
      if (!session.isEnded()) session.terminate();
    },
    trace: () => book.take(),
    mediaStats: () => media.live(),
    callStats: () => media.summary(),
    setMicMuted(muted) {
      if (session.isEnded()) return;
      if (muted) session.mute({ audio: true });
      else session.unmute({ audio: true });
    },
    setVideo(on) {
      control.setVideo(on);
    },
    attachMedia(remote, local) {
      const pc = session.connection;
      if (!pc) return;
      const sync = () => {
        const rTracks = pc
          .getReceivers()
          .map((r) => r.track)
          .filter((t): t is MediaStreamTrack => t !== null);
        if (rTracks.length) remote.srcObject = new MediaStream(rTracks);
        if (local) {
          const lTracks = pc
            .getSenders()
            .map((s) => s.track)
            .filter((t): t is MediaStreamTrack => t !== null);
          if (lTracks.length) local.srcObject = new MediaStream(lTracks);
        }
      };
      pc.addEventListener("track", sync);
      sync();
    },
  };
}
