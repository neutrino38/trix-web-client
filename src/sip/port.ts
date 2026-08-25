/**
 * Port SIP : la seule frontière entre les machines FSL et JsSIP
 * (docs/CONCEPTION.md §2). Les machines reçoivent des événements
 * `sip:*` et ne voient jamais un type JsSIP ; les tests injectent
 * un port factice.
 */

import JsSIP from "jssip";
import type { AccountConfig } from "../storage/store.js";
import { iceServers } from "./ice.js";
import { answeredMedia, offeredMedia, unsupportedOffer, withoutMedia } from "./sdp.js";
import { traceSocket } from "./trace.js";
import { openCallTrace, type CallTraceHandle, type TraceLine } from "./record.js";
import {
  MEDIA_ERROR_EVENTS,
  reportMediaError,
  reportOfferRefused,
  type MediaFailure,
} from "./mediaerror.js";
import { createCallStats, STATS_SAMPLE_MS, type MediaStats } from "./stats.js";
import type { RttChannel } from "./rtt.js";
import { openRttFor, type RttNegotiation } from "./rttsip.js";
import { sipTraceEnabled, traceNote } from "./trace.js";

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
 * Combinaison de médias d'un appel — les **trois** de la conversation
 * totale (ADR 0003, D1). F.703 §7.2 met le texte sur la même ligne que
 * l'audio et la vidéo dans son tableau de profils : le type le fait
 * aussi, au lieu de définir l'appel texte par l'absence des deux autres.
 *
 * `text` dit que **le texte est négocié**, pas qu'il passe. L'état du lien
 * (`connecting`, `open`, `lost`, `closed`) reste porté par `RttChannel`, et
 * lui seul : sur canal de données, l'ouverture DCEP arrive après le
 * 200 OK, et un appel peut donc être `text: true` avec un canal encore
 * `connecting`. C'est normal, et c'est la nuance à ne jamais confondre.
 */
export interface CallMedia {
  audio: boolean;
  video: boolean;
  text: boolean;
}

/**
 * Les deux médias qui entrent et sortent de l'appel par re-INVITE (ADR
 * 0003, D5). Le texte n'en est pas : une fois négocié il ne se retire
 * jamais — c'est le repli d'accessibilité, et le retirer reviendrait à
 * pouvoir couper la parole à quelqu'un en un clic, sans qu'il puisse
 * répondre (D4).
 */
export type MediaKind = "audio" | "video";

/** Les deux, dans l'ordre où l'interface les présente. */
export const MEDIA_KINDS: readonly MediaKind[] = ["audio", "video"];

/** Les trois médias, tous absents — point de départ de tout calcul. */
export const NO_MEDIA: CallMedia = { audio: false, video: false, text: false };

/** Deux combinaisons portent-elles exactement les mêmes médias ? */
export function sameMedia(a: CallMedia, b: CallMedia): boolean {
  return a.audio === b.audio && a.video === b.video && a.text === b.text;
}

/**
 * Retirer ce média laisserait-il l'appel sans rien ? F.703 §5.3.1 autorise
 * l'audio à être temporairement interrompu, **pourvu qu'au moins un autre
 * média reste présent** — et un appel qui ne transporte plus rien n'est pas
 * un appel, c'est un dialogue SIP ouvert sur le vide.
 *
 * Le texte compte : c'est tout l'intérêt d'en avoir fait un média (D1).
 * Retirer l'audio d'un appel audio + texte est permis — il reste de quoi se
 * parler, et c'est même le scénario que F.703 §4.5 décrit.
 *
 * La règle est ici, et une seule fois : le bloc la vérifie avant de lancer
 * la renégociation, l'interface ne fait qu'en griser le bouton (ADR 0003,
 * D5). Écrite dans l'interface, elle serait à réécrire dans les deux
 * gabarits — et à oublier dans un.
 */
export function isLastMedia(media: CallMedia, kind: MediaKind): boolean {
  if (!media[kind]) return false; // il n'y est pas : rien à retirer
  return !MEDIA_KINDS.some((k) => k !== kind && media[k]) && !media.text;
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
  | { type: "sip:mediaOffer"; media: CallMedia; offer: MediaOffer }
  /**
   * Le correspondant s'est mis en pause, ou en est revenu. Rien n'est passé
   * par SIP : ses pistes ont cessé d'émettre, et les nôtres sont passées
   * `muted` en réception. C'est exactement l'*avis explicite* que F.703
   * §6.2.4 réclame pour une vidéo suspendue, rendu par le récepteur — un
   * client tiers, lui, verra une image gelée, dégradation acceptable
   * (§8.3.5) et non un refus.
   */
  | { type: "sip:peerPaused"; paused: boolean };

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
  /**
   * Ajoute ou retire un média de l'appel en cours par re-INVITE
   * (docs/CONCEPTION.md §4.4) — il n'y a pas de « couper sa caméra » ni de
   * « couper son micro » en conversation totale : ne plus émettre un flux,
   * c'est le retirer de l'appel, et le distant doit le savoir.
   *
   * **Les deux médias y sont symétriques** (ADR 0003, D5) : F.703 §5.3.1
   * prévoit que l'audio soit temporairement interrompu, pourvu qu'un autre
   * média reste. Se taire un instant sans rien changer à l'appel est un
   * autre geste — la Pause, qui ne passe par aucune signalisation.
   *
   * Ne rend rien : l'issue arrive par événement, `sip:mediaChanged` si le
   * distant a suivi, `sip:mediaRefused` s'il a dit non.
   */
  setMedia(kind: MediaKind, on: boolean): void;
  /**
   * **La Pause** (ADR 0003, D6 et D7) : tout ce que j'émets s'arrête d'un
   * coup — micro et image ensemble, comme F.703 §6.2.4 les groupe.
   *
   * **Sur le fil : rien.** `replaceTrack(null)` sur les deux émetteurs.
   * Aucune négociation, aucun aller-retour, aucun 488, aucun 491 — donc
   * **aucun échec possible**, ce qui est toute la valeur du geste :
   * quelqu'un dont on sonne à la porte n'a pas le temps d'un aller-retour
   * SIP. La reprise rattache les mêmes pistes, sans rien rouvrir.
   *
   * **Le texte n'est jamais coupé**, dans aucun sens : c'est la même raison
   * qu'en D4 — une pause qui couperait le texte reviendrait, pour un usager
   * sourd, à raccrocher sans le dire, alors que c'est justement le média qui
   * permet d'écrire « deux minutes ».
   *
   * **Le correspondant continue de vivre** : il parle, il est vu, il écrit,
   * et il reçoit tout cela de son côté. Une mise en attente `sendonly`
   * l'aurait suspendu lui aussi, pour rien — le besoin est de me retirer,
   * moi.
   */
  setPaused(on: boolean): void;
  /**
   * Envoie une tonalité DTMF (RFC 4733) dans le flux audio de l'appel :
   * `0-9`, `*`, `#`, `A-D`. Rend `false` si elle n'a pas pu partir — appel
   * pas encore établi, tonalité inconnue, ou pas de piste audio émise, le
   * seul chemin qu'un événement RTP `telephone-event` puisse emprunter.
   *
   * Rendre un booléen plutôt que d'émettre un événement est délibéré :
   * l'insertion dans le flux est synchrone et personne n'accuse réception
   * d'un DTMF. Il n'y a donc rien à attendre — ou c'est parti, ou non.
   */
  sendDtmf(tone: string): boolean;
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
  /**
   * Le lien texte en temps réel de l'appel (§4.9), ou `null` quand le
   * compte n'en demande pas. Il existe **dès le début de l'appel** et ne
   * change pas : c'est son état qui dit si le distant a suivi. Ce qui est
   * tapé avant l'ouverture attend dans son tampon.
   */
  rtt(): RttChannel | null;
}

/**
 * Motif de refus d'un appel entrant. Le port seul connaît les codes SIP
 * correspondants — les machines raisonnent en intentions.
 * `incompatible` est le refus qui ne passe pas par l'utilisateur : l'offre
 * ne peut pas être établie ici, le 488 part avant la sonnerie (§4.3).
 */
export type RejectReason = "declined" | "busy" | "timeout" | "incompatible";

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
  /**
   * Ce qui, dans l'offre, met l'appel hors de portée du navigateur —
   * « ICE, DTLS, SRTP (RTP/AVP) » — ou `null` si rien ne s'y oppose. Lu
   * avant toute décision : un appel qui ne peut pas aboutir ne sonne pas
   * (§4.3). Le port constate, la machine décide.
   */
  offerProblem: string | null;
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
            call: wrapIncoming(e.session, e.request, pcConfig, cfg),
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
          // le contrôle média naît avant le lien texte — son écouteur `sdp`
          // doit passer avant celui du texte — mais il a besoin de savoir si
          // le texte est négocié : d'où la fonction, résolue plus tard
          let rtt: RttNegotiation | null = null;
          const control = mediaControl(session, sendCall, () => rtt?.negotiated() ?? false);
          // le texte se greffe avant que le premier SDP ne soit rédigé :
          // `ua.call()` a lancé la négociation, elle n'est pas encore
          // arrivée à l'offre (getUserMedia d'abord). C'est nous qui
          // offrons, donc nous qui créons le canal de données (RFC 8865 §5)
          rtt = openRttFor(cfg.rtt, session, "offer");
          return wrapSession(session, book, control, rtt);
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
  incompatible: { status_code: 488, reason_phrase: "Not Acceptable Here" },
};

function wrapIncoming(
  session: Session,
  request: { body?: string | null; call_id?: string },
  pcConfig: RTCConfiguration,
  cfg: AccountConfig,
): IncomingCall {
  const from = session.remote_identity;
  const offer = request.body ?? null;
  // le transport du compte fait partie de la question : une offre texte
  // d'une forme que ce poste ne sait pas ouvrir n'offre pas de texte (§4.9)
  const offered = offeredMedia(offer, cfg.rtt);
  // constaté à l'arrivée, avant que quoi que ce soit ne parte : c'est ce
  // qui permet de répondre 488 sans qu'un 180 ait été envoyé. Le transport
  // texte du compte en fait partie : lui seul dit si une offre texte seul
  // est un appel ici (§4.9)
  const problem = unsupportedOffer(offer, cfg.rtt);
  // né avec l'écoute, consulté par la réponse : c'est lui qui saura refuser
  // la vidéo d'une offre à laquelle on répond en audio seul
  let control: MediaControl | null = null;
  return {
    from: from.uri.toString(),
    displayName: from.display_name || null,
    offered,
    offerProblem: problem,
    listen(send) {
      bindSession(session, send);
      let rtt: RttNegotiation | null = null;
      control = mediaControl(session, send, () => rtt?.negotiated() ?? false);
      // le texte se greffe avant `answer()` : c'est là que JsSIP présente
      // l'offre distante, dont il faut retirer la section texte avant que
      // le navigateur ne la voie — et c'est là que naît la connexion
      // pair-à-pair, sur laquelle le canal de données du distant arrivera
      rtt = openRttFor(cfg.rtt, session, "answer");
      // le carnet ne s'ouvre qu'ici, jamais à l'arrivée de l'INVITE : un
      // second appel refusé « occupé » n'est pas écouté, et n'a donc pas de
      // carnet à voler à la communication en cours. L'INVITE, lui, est déjà
      // passé — le Call-ID sert à le rattraper.
      return wrapSession(session, openCallTrace(request.call_id ?? null), control, rtt);
    },
    answer(media) {
      // répondre « audio seul » à une offre audio + vidéo — ou « texte
      // seul » à une offre audio + texte — se dit dans la réponse SDP :
      // sans cela le navigateur répondrait `recvonly`, et l'appelant
      // continuerait d'émettre un flux que personne n'a demandé (§4.4)
      const refused = MEDIA_KINDS.filter((k) => offered[k] && !media[k]);
      if (refused.length > 0) control?.refuseMedia(refused);
      session.answer({ mediaConstraints: { audio: media.audio, video: media.video }, pcConfig });
    },
    reject(reason) {
      // le carnet est ouvert depuis `listen()` : la ligne d'erreur et le
      // 488 qui la suit y tombent ensemble, dans cet ordre
      if (reason === "incompatible" && problem) reportOfferRefused(problem, offer);
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
 * refuser un flux d'une offre, l'ajouter ou le retirer en cours d'appel, et
 * dire ce que l'appel transporte réellement après chaque négociation.
 *
 * **Les deux médias y sont strictement symétriques** (ADR 0003, D5) : F.703
 * §5.3.1 prévoit noir sur blanc que l'audio soit temporairement interrompu,
 * pourvu qu'un autre média reste. Il n'y a donc pas un chemin pour la
 * caméra et un autre pour le micro — il y en a un seul, paramétré par le
 * média.
 *
 * Tout l'état média d'une session vit ici, dans une seule fermeture : les
 * pistes que nous avons ouvertes (et que nous seuls pouvons éteindre), les
 * refus en vigueur, la renégociation en vol, le dernier résultat publié.
 */
interface MediaControl {
  /** Prochaine réponse SDP : ces médias déclarés `inactive`. */
  refuseMedia(kinds: readonly MediaKind[]): void;
  /** Re-INVITE ajoutant (ou retirant) un média de l'appel. */
  setMedia(kind: MediaKind, on: boolean): void;
  /**
   * **La Pause** (ADR 0003, D6 et D7) : tout ce que j'émets s'arrête d'un
   * coup — micro et image ensemble, comme F.703 §6.2.4 les groupe.
   *
   * **Sur le fil : rien.** `replaceTrack(null)` sur les deux émetteurs.
   * Aucune négociation, aucun aller-retour, aucun 488, aucun 491 — donc
   * **aucun échec possible**, ce qui est toute la valeur du geste :
   * quelqu'un dont on sonne à la porte n'a pas le temps d'un aller-retour
   * SIP. La reprise rattache les mêmes pistes, sans rien rouvrir.
   *
   * **Le texte n'est jamais coupé**, dans aucun sens : c'est la même raison
   * qu'en D4 — une pause qui couperait le texte reviendrait, pour un usager
   * sourd, à raccrocher sans le dire, alors que c'est justement le média qui
   * permet d'écrire « deux minutes ».
   *
   * **Le correspondant continue de vivre** : il parle, il est vu, il écrit,
   * et il reçoit tout cela de son côté. Une mise en attente `sendonly`
   * l'aurait suspendu lui aussi, pour rien — le besoin est de me retirer,
   * moi.
   */
  setPaused(on: boolean): void;
  /** Pause : tout ce que j'émets s'arrête, sans que rien ne parte sur le fil. */
  setPaused(on: boolean): void;
  /** Fin d'appel : les capteurs que nous avons allumés s'éteignent avec lui. */
  release(): void;
}

/** Le transceiver d'un média sur la connexion, s'il en existe un. */
function transceiverOf(pc: RTCPeerConnection, kind: MediaKind): RTCRtpTransceiver | null {
  return (
    pc
      .getTransceivers()
      .find((tr) => (tr.receiver.track?.kind ?? tr.sender.track?.kind) === kind) ?? null
  );
}

/**
 * Ce que la connexion transporte **effectivement**, lu sur la direction
 * négociée de chaque transceiver. C'est la seule source honnête : le SDP
 * dit ce qui a été demandé, `currentDirection` dit ce qui a été conclu.
 * Un transceiver jamais négocié (`currentDirection === null`) ne compte
 * pas encore.
 */
function negotiatedMedia(pc: RTCPeerConnection, text: boolean): CallMedia {
  const media: CallMedia = { ...NO_MEDIA, text };
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
  /**
   * Le rôle dans le dialogue — `"outgoing"` pour l'UAC. Il ne sert qu'à une
   * chose, et elle compte : choisir la borne du délai de reprise après un
   * 491 (RFC 3261 §14.1). Les deux bornes sont disjointes, et c'est cela
   * seul qui empêche les deux bouts de se recroiser.
   */
  direction: string;
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

/**
 * Exporté pour les tests seuls : la reprise après 491 et la symétrie des
 * deux médias sont exactement ce qui casse en silence, et la seule façon
 * de les éprouver sans navigateur est d'injecter une session factice —
 * comme `sip/rttsip.ts` le fait déjà pour ses deux transports.
 */
export function mediaControl(
  session: Session,
  send: (ev: CallSipEvent) => void,
  /**
   * Le texte est-il négocié ? Le port ne le lit pas sur la connexion
   * pair-à-pair : c'est `sip/rttsip.ts` qui le sait, chacun de ses deux
   * transports à sa façon. Une fonction, et non un booléen, parce que la
   * réponse change au fil de la négociation — et qu'elle est posée à
   * chaque retour à `stable`.
   */
  textNegotiated: () => boolean,
): MediaControl {
  const raw = session as unknown as Session & Renegotiable;
  /** Les capteurs que nous avons ouverts : personne d'autre ne les éteindra. */
  const own: Partial<Record<MediaKind, MediaStreamTrack>> = {};
  /** Médias refusés dans la prochaine réponse SDP (réponse audio à une offre A/V). */
  const refusing = new Set<MediaKind>();
  /** Dernier résultat publié — on ne signale que les changements. */
  let published: CallMedia | null = null;
  /**
   * Ce que notre re-INVITE en vol demande. Lu à l'arrivée de la réponse :
   * c'est la demande, et non le capteur ouvert, qui dit s'il y a eu refus —
   * le capteur, lui, a pu être refermé entre-temps par l'observateur de
   * négociation.
   */
  let asking: { kind: MediaKind; on: boolean } | null = null;
  /**
   * Une reprise après 491 est en cours. Le retour arrière qui la précède
   * ramène la connexion à `stable`, et l'observateur y verrait un appel qui
   * vient de perdre le média demandé : il éteindrait le capteur qu'on
   * s'apprête à réoffrir, et annoncerait un changement qui n'a pas eu lieu.
   * Tant que ce drapeau est levé, il ne fait ni l'un ni l'autre.
   */
  let resuming = false;
  /** Une seule reprise par renégociation : deux clients face à face boucleraient. */
  let retried = false;
  /**
   * Les pistes mises de côté le temps d'une pause (D7). Elles ne sont **pas**
   * arrêtées : la reprise doit être instantanée, et rouvrir un capteur
   * prendrait du temps — voire échouerait, ce qu'un geste sans échec ne peut
   * pas se permettre. Le voyant de la caméra reste donc allumé pendant la
   * pause ; c'est le prix d'une reprise qui ne demande rien à personne, et
   * le bandeau plein écran dit assez clairement ce qui se passe.
   */
  const held: Partial<Record<MediaKind, MediaStreamTrack>> = {};
  let paused = false;
  let pc: RTCPeerConnection | null = null;

  /**
   * Éteint le capteur qui alimentait l'appel — le nôtre comme celui que
   * JsSIP a ouvert pour l'INVITE initial. Une piste laissée vivante
   * garderait le voyant de la machine allumé alors que plus personne ne
   * reçoit le flux : c'est le genre de détail sur lequel se juge un
   * logiciel de conversation totale.
   */
  const stopSending = (conn: RTCPeerConnection | null, kind: MediaKind): void => {
    const tr = conn ? transceiverOf(conn, kind) : null;
    const track = tr?.sender.track;
    if (tr && track) {
      // la piste s'arrête dans tous les cas — c'est elle qui tient le
      // voyant du capteur allumé. La détacher du sender, en revanche,
      // n'a de sens que sur une connexion encore ouverte : `release()` est
      // appelé sur `failed`, donc après que JsSIP a fermé la sienne, et
      // `replaceTrack` y lève un InvalidStateError qui n'apprend rien.
      track.stop();
      if (conn && conn.signalingState !== "closed") {
        void tr.sender.replaceTrack(null).catch(() => {});
      }
    }
    own[kind]?.stop();
    delete own[kind];
    // une pause en cours tient une piste hors du sender : elle ne doit pas
    // survivre au média qui vient de quitter l'appel
    held[kind]?.stop();
    delete held[kind];
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
      if (conn.signalingState !== "stable" || resuming) return;
      const media = negotiatedMedia(conn, textNegotiated());
      // un média est sorti de l'appel : son capteur n'a plus de raison de
      // rester allumé
      for (const kind of MEDIA_KINDS) if (!media[kind]) stopSending(conn, kind);
      if (published && sameMedia(published, media)) return;
      published = media;
      send({ type: "sip:mediaChanged", media });
    });
  };
  /**
   * La pause **du correspondant**, lue là où elle se voit : ses pistes
   * cessent d'émettre, et les nôtres passent `muted` en réception. Rien
   * n'est passé par SIP — c'est bien le principe (D7).
   *
   * Une piste distante est `muted` **avant** d'avoir jamais rien reçu : au
   * décroché, toutes le sont. On ne conclut donc à une pause qu'après avoir
   * vu au moins un `unmute` sur cette connexion — sans quoi tout appel
   * s'ouvrirait sur « le correspondant est en pause ».
   */
  const watchPeer = (conn: RTCPeerConnection): void => {
    let seenLive = false;
    let reported = false;
    const report = (): void => {
      const tracks = conn
        .getReceivers()
        .map((r) => r.track)
        .filter((t): t is MediaStreamTrack => t !== null && (t.kind === "audio" || t.kind === "video"));
      if (tracks.length === 0) return;
      if (tracks.some((t) => !t.muted)) seenLive = true;
      // tout ce qu'il nous envoyait s'est tu d'un coup : c'est une pause.
      // Un seul flux muet sur deux serait un incident réseau, pas un geste
      const next = seenLive && tracks.every((t) => t.muted);
      if (next === reported) return;
      reported = next;
      send({ type: "sip:peerPaused", paused: next });
    };
    const follow = (track: MediaStreamTrack): void => {
      track.addEventListener("mute", report);
      track.addEventListener("unmute", report);
    };
    conn.addEventListener("track", (e) => {
      follow((e as RTCTrackEvent).track);
      report();
    });
    for (const r of conn.getReceivers()) if (r.track) follow(r.track);
  };

  if (session.connection) {
    watch(session.connection);
    watchPeer(session.connection);
  } else {
    session.on("peerconnection", (e) => {
      watch(e.peerconnection);
      watchPeer(e.peerconnection);
    });
  }

  /**
   * Filet de la réponse SDP : le transceiver est déjà passé `inactive`
   * (voir `blockInAnswer`), cette réécriture ne fait que garantir que la
   * réponse **partie sur le fil** le dit aussi, quelle que soit la façon
   * dont le navigateur a rédigé son answer.
   */
  session.on("sdp", (e: { originator: string; type: string; sdp: string }) => {
    if (refusing.size === 0 || e.originator !== "local" || e.type !== "answer") return;
    e.sdp = withoutMedia(e.sdp, [...refusing]);
  });

  /**
   * Notre flux rejoint l'appel : le capteur s'ouvre, la piste prend la
   * place du transceiver existant s'il y en a un (celui d'une offre refusée
   * plus tôt), sinon elle en crée un.
   */
  const openTrack = async (conn: RTCPeerConnection, kind: MediaKind): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ [kind]: true });
      const track = stream.getTracks().find((t) => t.kind === kind);
      if (!track) return false;
      own[kind] = track;
      const tr = transceiverOf(conn, kind);
      if (tr) {
        await tr.sender.replaceTrack(track);
        tr.direction = "sendrecv";
      } else {
        conn.addTrack(track, stream);
      }
      return true;
    } catch {
      // capteur refusé par le système ou déjà pris : l'appel continue
      stopSending(conn, kind);
      return false;
    }
  };

  /** Notre flux quitte l'appel : transceiver rendu inactif, capteur éteint. */
  const closeTrack = (conn: RTCPeerConnection, kind: MediaKind): void => {
    stopSending(conn, kind);
    const tr = transceiverOf(conn, kind);
    if (tr) tr.direction = "inactive";
  };

  /** Le retour arrière d'une offre restée sans conclusion. */
  const rollback = (conn: RTCPeerConnection): void => {
    if (conn.signalingState === "have-local-offer")
      void conn.setLocalDescription({ type: "rollback" }).catch(() => {});
  };

  /**
   * Le délai avant de rejouer une offre qui s'est croisée avec celle du
   * distant — RFC 3261 §14.1. Les deux bornes sont disjointes selon le
   * rôle **dans le dialogue**, et c'est tout ce qui empêche les deux bouts
   * de se recroiser indéfiniment : 0 à 2 s pour l'UAC, 2,1 à 4 s pour l'UAS.
   */
  const glareDelay = (): number =>
    session.direction === "outgoing" ? Math.random() * 2000 : 2100 + Math.random() * 1900;

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
          retried = false;
          // le résultat est publié par l'observateur de négociation ; ici
          // on ne rattrape que le refus poli, celui qui répond 200 OK en
          // ayant désactivé le flux
          if (wanted?.on === true && !answeredMedia(body)[wanted.kind])
            send({ type: "sip:mediaRefused", by: "remote" });
        },
        failed: (response) => {
          const conn = pc;
          const statusCode = statusOf(response ?? {});
          const wanted = asking;
          asking = null;

          // Glare (RFC 3261 §14.1) : les deux bouts ont renégocié en même
          // temps. On reprend **une** fois, après un délai aléatoire — et le
          // capteur qu'on vient d'ouvrir reste ouvert, puisqu'on va le
          // réoffrir. S'entêter au-delà ferait boucler deux clients face à
          // face, ce que le délai seul n'empêche pas.
          if (statusCode === 491 && wanted !== null && !retried && conn !== null) {
            retried = true;
            resuming = true;
            rollback(conn);
            setTimeout(() => {
              resuming = false;
              if (session.isEnded()) return;
              if (!raw.isReadyToReOffer()) {
                // le distant a repris la main entre-temps : sa négociation à
                // lui a abouti, et la nôtre n'a plus lieu d'être rejouée
                if (!wanted.on) closeTrack(conn, wanted.kind);
                send({ type: "sip:mediaRefused", by: "local" });
                return;
              }
              asking = wanted;
              reinvite();
            }, glareDelay());
            return;
          }

          retried = false;
          if (conn) {
            rollback(conn);
            if (wanted) closeTrack(conn, wanted.kind);
          }
          // sans réponse du tout (transport, délai), ce n'est pas un refus
          // du distant : la phrase affichée n'est pas la même
          send({ type: "sip:mediaRefused", by: statusCode ? "remote" : "local", statusCode });
        },
      },
    });
  };

  /**
   * Re-INVITE reçu. Ce qui ne fait qu'ôter un média, ou n'y touche pas
   * (rafraîchissement de session), suit le chemin normal de JsSIP. **Ajouter
   * un média, en revanche, allumerait un capteur** : la réponse attend que
   * l'utilisateur ait tranché. La question vaut pour le micro comme pour la
   * caméra — allumer l'un ou l'autre demande l'accord de son propriétaire
   * (ADR 0003, D5).
   */
  const passThrough = raw._receiveReinvite.bind(raw);
  raw._receiveReinvite = (request: InDialogRequest): void => {
    const conn = pc;
    const wanted = offeredMedia(request.body ?? null);
    const here = conn ? negotiatedMedia(conn, false) : null;
    // le texte ne pèse pas dans cette question-là : il ne s'ajoute pas par
    // re-INVITE tant que CT-6 n'existe pas, et il ne se retire jamais (D4)
    const added = conn && here ? MEDIA_KINDS.filter((k) => wanted[k] && !here[k]) : [];
    if (!conn || added.length === 0) {
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
          for (const kind of added) refusing.delete(kind);
          void Promise.all(added.map((kind) => openTrack(conn, kind))).then((oks) => {
            // capteur impossible à ouvrir : mieux vaut le dire au distant
            // que de lui répondre un flux qui n'arrivera jamais
            if (oks.every(Boolean)) passThrough(request);
            else request.reply(488, "Not Acceptable Here");
          });
        }),
        reject: once(() => {
          for (const kind of added) refusing.add(kind);
          request.reply(488, "Not Acceptable Here");
        }),
      },
    });
  };

  return {
    refuseMedia(kinds) {
      for (const kind of kinds) refusing.add(kind);
      const block = (conn: RTCPeerConnection): void =>
        blockInAnswer(conn, kinds, (k) => refusing.has(k));
      if (session.connection) block(session.connection);
      else session.on("peerconnection", (e) => block(e.peerconnection));
    },
    setMedia(kind, on) {
      const conn = pc;
      if (!conn || session.isEnded()) return;
      if (!raw.isReadyToReOffer()) {
        // une négociation est déjà en vol : réessayer plus tard vaut mieux
        // que deux offres qui se croisent (RFC 3261 §14.1, « glare »)
        send({ type: "sip:mediaRefused", by: "local" });
        return;
      }
      retried = false;
      if (!on) {
        refusing.add(kind);
        asking = { kind, on: false };
        closeTrack(conn, kind);
        reinvite();
        return;
      }
      refusing.delete(kind);
      void openTrack(conn, kind).then((ok) => {
        if (!ok) {
          send({ type: "sip:mediaRefused", by: "local" });
          return;
        }
        asking = { kind, on: true };
        reinvite();
      });
    },
    /**
     * **Rien ne part sur le fil.** Les deux émetteurs lâchent leur piste, et
     * c'est tout : pas de re-INVITE, pas de `sendonly`, pas de réponse à
     * attendre — donc pas d'échec possible. La reprise rattache les mêmes
     * pistes, qui n'ont jamais cessé de tourner.
     *
     * Le texte n'apparaît pas ici, et c'est délibéré : il vit hors de la
     * connexion pair-à-pair (§4.9), et rien de ce que fait cette fonction ne
     * peut l'atteindre. C'est la meilleure garantie qu'il continue de passer
     * dans les deux sens pendant toute la pause.
     */
    setPaused(on) {
      const conn = pc;
      if (!conn || paused === on || session.isEnded()) return;
      paused = on;
      for (const kind of MEDIA_KINDS) {
        const tr = transceiverOf(conn, kind);
        if (!tr) continue;
        if (on) {
          const track = tr.sender.track;
          if (!track) continue;
          held[kind] = track;
          void tr.sender.replaceTrack(null).catch(() => {});
        } else {
          const track = held[kind];
          delete held[kind];
          // la piste a pu disparaître entre-temps — le média a quitté
          // l'appel pendant la pause : il n'y a plus rien à rattacher
          if (track) void tr.sender.replaceTrack(track).catch(() => {});
        }
      }
    },
    release() {
      for (const kind of MEDIA_KINDS) stopSending(pc, kind);
    },
  };
}

/**
 * Répondre sans un média à une offre qui le propose : le transceiver que
 * l'offre distante vient de créer passe `inactive` **avant** que le
 * navigateur ne rédige sa réponse. Laissé à lui-même, il répondrait
 * `recvonly` — rien d'envoyé, mais le flux du distant accepté, c'est-à-dire
 * tout le contraire de ce que l'appelé a demandé.
 *
 * Le rendez-vous est `have-remote-offer` : l'offre est appliquée, les
 * transceivers existent, la réponse n'est pas encore écrite.
 */
function blockInAnswer(
  pc: RTCPeerConnection,
  kinds: readonly MediaKind[],
  active: (kind: MediaKind) => boolean,
): void {
  pc.addEventListener("signalingstatechange", () => {
    if (pc.signalingState !== "have-remote-offer") return;
    for (const kind of kinds) {
      if (!active(kind)) continue;
      const tr = transceiverOf(pc, kind);
      if (tr) tr.direction = "inactive";
    }
  });
}

interface RtcSessionLike {
  connection: RTCPeerConnection | undefined;
  isEnded(): boolean;
  terminate(): void;
  sendDTMF(tone: string, options?: { transportType?: string }): void;
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

/** Les tonalités qu'un clavier téléphonique peut produire (RFC 4733 §3.10). */
const DTMF_TONE = /^[0-9A-D*#]$/i;

/**
 * L'émetteur de tonalités de la piste audio sortante, s'il y en a une :
 * c'est lui qui insère les événements `telephone-event` dans le flux RTP.
 * Absent, il n'y a pas de RFC 4733 possible — un appel sans audio émis, ou
 * une connexion déjà refermée.
 */
function dtmfSender(pc: RTCPeerConnection | undefined): RTCDTMFSender | null {
  const sender = pc?.getSenders().find((s) => s.track?.kind === "audio");
  return sender?.dtmf ?? null;
}

function wrapSession(
  session: RtcSessionLike,
  book: CallTraceHandle,
  control: MediaControl,
  rtt: RttNegotiation | null,
): CallSession {
  const media = collectStats(session);
  // la caméra que nous avons ouverte survivrait au dialogue : JsSIP ne
  // referme que le flux qu'il a demandé lui-même
  session.on("ended", control.release);
  session.on("failed", control.release);
  // le socket texte est hors de la connexion pair-à-pair : rien ne le
  // refermerait avec l'appel, et il se reconnecterait tout seul
  const closeRtt = (): void => rtt?.close();
  session.on("ended", closeRtt);
  session.on("failed", closeRtt);
  return {
    rtt: () => rtt?.channel ?? null,
    terminate() {
      if (!session.isEnded()) session.terminate();
    },
    trace: () => book.take(),
    mediaStats: () => media.live(),
    callStats: () => media.summary(),
    setMedia(kind, on) {
      control.setMedia(kind, on);
    },
    setPaused(on) {
      control.setPaused(on);
    },
    sendDtmf(tone) {
      if (session.isEnded() || !DTMF_TONE.test(tone)) return false;
      // JsSIP enverrait des INFO par défaut : le transport se demande
      // explicitement (docs/CONCEPTION.md §5.6). Sans piste audio émise, il
      // se contenterait d'un avertissement dans la console et la tonalité
      // serait perdue sans que personne ne le sache — on constate d'abord.
      if (!dtmfSender(session.connection)) return false;
      try {
        session.sendDTMF(tone, { transportType: "RFC2833" });
      } catch {
        // état de session refusé par JsSIP (dialogue en train de se fermer)
        return false;
      }
      traceNote(`DTMF « ${tone} » → RFC 4733`);
      return true;
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
