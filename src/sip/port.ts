/**
 * Port SIP : la seule frontière entre les machines FSL et JsSIP
 * (docs/CONCEPTION.md §2). Les machines reçoivent des événements
 * `sip:*` et ne voient jamais un type JsSIP ; les tests injectent
 * un port factice.
 */

import JsSIP from "jssip";
import type { AccountConfig } from "../storage/store.js";
import { iceServers } from "./ice.js";
import { offeredMedia } from "./sdp.js";

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
  | { type: "sip:failed"; cause: string; statusCode?: number; originator?: SipOriginator };

/**
 * Session d'appel côté machine/UI : la frontière média. `attachMedia`
 * est le seul point où l'UI touche aux flux WebRTC — jamais à JsSIP.
 */
export interface CallSession {
  /** CANCEL / BYE selon l'état ; sans effet si la session est déjà terminée. */
  terminate(): void;
  setMicMuted(muted: boolean): void;
  setCamMuted(muted: boolean): void;
  attachMedia(remote: HTMLVideoElement, local: HTMLVideoElement | null): void;
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
        const socket = new JsSIP.WebSocketInterface(cfg.proxy);
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
        (e: { originator: string; session: Session; request: { body?: string | null } }) => {
          if (e.originator !== "remote") return;
          send({
            type: "sip:incoming",
            call: wrapIncoming(e.session, e.request.body ?? null, pcConfig),
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
          const session = ua.call(target, {
            mediaConstraints: { audio: media.audio, video: media.video },
            pcConfig,
          });
          bindSession(session, sendCall);
          return wrapSession(session);
        },
      };
    },
  };
}

type Session = ReturnType<JsSIP.UA["call"]>;

/** Seul point de traduction des événements d'une session JsSIP en événements de machine. */
function bindSession(session: Session, send: (ev: CallSipEvent) => void): void {
  session.on("progress", () => send({ type: "sip:progress" }));
  session.on("accepted", () => send({ type: "sip:accepted" }));
  session.on("confirmed", () => send({ type: "sip:confirmed" }));
  session.on("ended", (e) =>
    send({ type: "sip:ended", cause: causeOf(e), originator: originatorOf(e) }),
  );
  session.on("failed", (e) =>
    send({
      type: "sip:failed",
      cause: causeOf(e),
      statusCode: statusOf(e),
      originator: originatorOf(e),
    }),
  );
}

/** Codes SIP de refus : le reste de l'application raisonne en motifs. */
const REJECT: Record<RejectReason, { status_code: number; reason_phrase: string }> = {
  declined: { status_code: 603, reason_phrase: "Decline" },
  busy: { status_code: 486, reason_phrase: "Busy Here" },
  timeout: { status_code: 480, reason_phrase: "Temporarily Unavailable" },
};

function wrapIncoming(
  session: Session,
  sdp: string | null,
  pcConfig: RTCConfiguration,
): IncomingCall {
  const from = session.remote_identity;
  return {
    from: from.uri.toString(),
    displayName: from.display_name || null,
    offered: offeredMedia(sdp),
    listen(send) {
      bindSession(session, send);
      return wrapSession(session);
    },
    answer(media) {
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

interface RtcSessionLike {
  connection: RTCPeerConnection | undefined;
  isEnded(): boolean;
  terminate(): void;
  mute(opts: { audio?: boolean; video?: boolean }): void;
  unmute(opts: { audio?: boolean; video?: boolean }): void;
}

function wrapSession(session: RtcSessionLike): CallSession {
  return {
    terminate() {
      if (!session.isEnded()) session.terminate();
    },
    setMicMuted(muted) {
      if (session.isEnded()) return;
      if (muted) session.mute({ audio: true });
      else session.unmute({ audio: true });
    },
    setCamMuted(muted) {
      if (session.isEnded()) return;
      if (muted) session.mute({ video: true });
      else session.unmute({ video: true });
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
