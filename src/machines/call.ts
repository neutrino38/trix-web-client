/**
 * CallBlock — un appel, écrit comme un **service building block**
 * (`finite-state-language` §8.4, docs/CONCEPTION.md §4.2 et §4.3).
 *
 * Ce n'est pas une seconde machine : PhoneMachine l'*entre* depuis son
 * état `in_call` et se suspend là jusqu'au retour. Une seule instance,
 * un seul contexte, une seule boîte aux lettres — le bloc écrit la vue
 * de l'appel dans `ctx.call`, que l'UI lit déjà, au lieu d'en tenir un
 * miroir chez le parent.
 *
 * Ce qui lui appartient en propre vit dans sa sandbox (`fx.data`) : la
 * session JsSIP, qui a raccroché, l'état des sourdines. Rien de cela ne
 * peut entrer en collision avec une clé de l'hôte.
 *
 * Une seule définition sert les deux sens : `initial_state` aiguille
 * vers `dialing` (INVITE sortant) ou `ringing_in` (INVITE entrant, passé
 * dans `args.incoming`). Une fois établis, les deux sens partagent
 * exactement le même état `connected`.
 *
 * **Le bloc consomme tout ce qui arrive pendant l'appel**, y compris ce
 * dont la politique appartient au téléphone (perte du proxy, veille,
 * enregistrement perdu, second INVITE) : un événement qu'il laisserait
 * passer attendrait dans la file un hôte qui ne répond pas avant son
 * retour. Ce qui relève de l'hôte, il l'écrit dans le contexte partagé
 * (`ctx.lastError`, `ctx.sleepRequested`) ; ce qui relève de l'appel, il
 * le rapporte dans son outcome.
 */

import { defineSbb, goto, stay } from "finite-state-language";
import type { OnMap, SbbFx } from "finite-state-language";
import type {
  CallMedia,
  CallSession,
  IncomingCall,
  MediaOffer,
  RejectReason,
  SipHandle,
  SipOriginator,
} from "../sip/port.js";
import type { CallDirection } from "../storage/store.js";
import { msg, rawMsg, type Msg } from "../i18n/types.js";
import type { CallNotice, CallReturn, CallView, PhoneEvent, SuspectField } from "./events.js";

/**
 * Ce que le bloc exige de trouver chez son hôte — la plus petite forme
 * qui marche, et le compilateur refuse un hôte qui ne la fournit pas.
 * `handle` est l'UA sur lequel l'appel se place ; les autres champs sont
 * ce que le bloc a le droit d'influencer chez lui.
 */
export interface CallHost {
  handle: SipHandle | null;
  /** La vue de l'appel : c'est le bloc qui l'écrit, l'UI qui la lit. */
  call: CallView | null;
  lastError: Msg | null;
  lastErrorCode: string | null;
  suspectFields: SuspectField | null;
  /** Veille demandée pendant l'appel : l'hôte ira dormir au retour. */
  sleepRequested: boolean;
}

/** La sandbox du bloc : son état de travail, invisible de l'hôte. */
export interface CallData {
  /** Passés par le site d'appel. */
  target: string;
  media: CallMedia;
  direction: CallDirection;
  /** Entrant uniquement : l'INVITE en attente de décision. */
  incoming: IncomingCall | null;
  displayName: string | null;
  /** Médias proposés par l'appelant (entrant) ; = `media` pour un sortant. */
  offered: CallMedia;
  /**
   * Ce que nous avons demandé en dernier — à l'INVITE, à la réponse, ou
   * par re-INVITE. `media` dit ce que l'appel transporte ; la différence
   * entre les deux est exactement ce qui se dit à l'écran (« Bob n'a pas
   * accepté la vidéo »).
   */
  asked: CallMedia;
  session: CallSession | null;
  connectedAt: number | null;
  endedBy: "local" | "remote" | "network" | null;
  micMuted: boolean;
  selfViewHidden: boolean;
  /** Renégociation en vol : l'icône de la caméra attend son issue. */
  videoPending: boolean;
  /** Vidéo proposée par le distant, en attente de la décision de l'utilisateur. */
  videoOffer: MediaOffer | null;
  /** Dernier message fugace publié, et le numéro d'ordre qui le distingue. */
  notice: CallNotice | null;
  noticeSeq: number;
  /**
   * Décidé au moment où l'on raccroche, lu par `hangingup` au moment de
   * rapporter : c'est nous qui avons mis fin à l'appel, quoi que dise
   * l'originator ensuite.
   */
  endingAs: Ending;
  endReason: Msg;
}

/**
 * Comment un raccrochage **de notre fait** sera rapporté, décidé au
 * moment où l'on envoie le CANCEL/BYE et lu par `hangingup`. Les issues
 * subies (`rejected`) sont rapportées sur place par l'état qui les voit.
 */
type Ending = "answered" | "canceled" | "missed" | "dropped";

type CallFx = SbbFx<PhoneEvent, CallHost, CallData, CallReturn>;
type CallStateName =
  | "initial_state"
  | "dialing"
  | "ringing"
  | "ringing_in"
  | "answering"
  | "connected"
  | "renegotiating"
  | "video_offer"
  | "hangingup";
type CallOn = OnMap<CallHost, PhoneEvent, CallStateName, CallFx>;

/** Publie l'état courant de l'appel dans le contexte de l'hôte. */
function publish(state: CallView["state"], ctx: CallHost, data: CallData): void {
  ctx.call = {
    state,
    direction: data.direction,
    target: data.target,
    displayName: data.displayName,
    offered: data.offered,
    media: data.media,
    micMuted: data.micMuted,
    selfViewHidden: data.selfViewHidden,
    videoPending: data.videoPending,
    videoAsked: data.videoOffer !== null,
    notice: data.notice,
    connectedAt: data.connectedAt,
    endedBy: data.endedBy,
    session: data.session,
  };
}

/**
 * Le correspondant tel qu'on le nomme dans une phrase — son nom affiché
 * s'il en porte un, son adresse sinon, débarrassée du `sip:` que
 * personne ne lit à voix haute.
 */
function peerName(data: CallData): string {
  return data.displayName ?? data.target.replace(/^sips?:/i, "");
}

/**
 * Prépare un message fugace : le numéro d'ordre est ce qui permet à
 * l'écran de reconnaître un **nouveau** message d'un simple re-rendu, y
 * compris quand c'est deux fois la même phrase. Il partira avec la
 * prochaine publication de la vue — c'est ce qu'il faut avant que l'appel
 * soit établi, où l'état publié n'est pas encore `connected`.
 */
function noteNotice(fx: CallFx, message: Msg): void {
  fx.data.noticeSeq += 1;
  fx.data.notice = { seq: fx.data.noticeSeq, message };
}

/** Le même message, publié sur-le-champ : l'appel est en communication. */
function notify(ctx: CallHost, fx: CallFx, message: Msg): void {
  noteNotice(fx, message);
  publish("connected", ctx, fx.data);
}

function failReason(ev: { cause: string; statusCode?: number; detail?: string }): Msg {
  // la cause vient de JsSIP, le code du protocole et le détail du
  // navigateur : aucun des trois ne se traduit — seul leur assemblage est
  // une phrase. Le détail n'existe que pour un échec média, et c'est lui
  // qui dit ce que « WebRTC Error » cache (docs/CONCEPTION.md §5.5).
  const cause = ev.detail ? `${ev.cause} — ${ev.detail}` : ev.cause;
  return ev.statusCode ? msg("reason.sip", { cause, code: ev.statusCode }) : rawMsg(cause);
}

/** Traduit l'originator JsSIP en responsable de la fin d'appel (`system` = incident réseau). */
function endedBy(originator: SipOriginator | undefined): "local" | "remote" | "network" {
  return originator === "local" ? "local" : originator === "system" ? "network" : "remote";
}

/**
 * Fin de session subie : on note qui l'a provoquée et on publie une
 * dernière vue avant de rapporter. Le `sbbReturn` reste sur le site
 * d'appel — c'est ce qui garde le diagramme extrait honnête, une arête
 * par issue réellement atteignable depuis cet état.
 */
function sealed(
  from: CallView["state"],
  by: "local" | "remote" | "network",
  ctx: CallHost,
  fx: CallFx,
): void {
  fx.data.endedBy = by;
  publish(from, ctx, fx.data);
}

/**
 * Raccrochage de notre fait : on envoie le CANCEL/BYE et on attend la
 * confirmation dans `hangingup`, qui rapportera `ending`.
 */
function hangUp(fx: CallFx, ending: Ending, reason: Msg, desc: string) {
  fx.data.session?.terminate();
  fx.data.endingAs = ending;
  fx.data.endReason = reason;
  return goto("hangingup", desc);
}

/**
 * Fin d'un appel entrant jamais décroché. `reason` devient le motif de
 * la ligne d'historique (« manqué » vs « refusé »), et `failed` sépare ce
 * que l'écran doit signaler (un refus technique) de ce qu'il doit taire
 * (un appel simplement manqué).
 *
 * La vue est publiée avant de rapporter : elle porte la session, donc le
 * carnet et le bilan média que l'hôte attache à la ligne d'historique
 * (§5.3). Elle n'est jamais rendue — le rendu vient une microtask plus
 * tard, quand le bloc a déjà rendu la main.
 */
function refuse(
  ctx: CallHost,
  fx: CallFx,
  how: RejectReason,
  reason: Msg,
  failed = false,
): void {
  fx.data.incoming?.reject(how);
  fx.data.endedBy = "local";
  publish("ringing_in", ctx, fx.data);
  fx.sbbReturn("missed", { reason, failed });
}

/**
 * Le retour de `hangingup`, seul endroit où l'issue est décidée
 * ailleurs qu'ici : c'est nous qui avons raccroché, et `endingAs` dit
 * pourquoi. Les quatre branches sont les quatre façons dont un
 * raccrochage de notre fait se lit dans l'historique.
 */
function report(fx: CallFx): void {
  const d = fx.data;
  const reason = d.endReason;
  switch (d.endingAs) {
    case "answered":
      fx.sbbReturn("answered", {
        connectedAt: d.connectedAt ?? Date.now(),
        media: d.media,
        endedBy: d.endedBy === "remote" ? "remote" : "local",
      });
      return;
    case "dropped":
      fx.sbbReturn("dropped", { connectedAt: d.connectedAt, media: d.media, reason });
      return;
    case "missed":
      // report() ne sert qu'aux raccrochages de notre fait : jamais un échec
      fx.sbbReturn("missed", { reason, failed: false });
      return;
    case "canceled":
      fx.sbbReturn("canceled", { reason });
  }
}

/**
 * Ce que tout état du bloc doit consommer parce que personne d'autre ne
 * peut : l'hôte est suspendu, et un événement laissé dans la file y
 * attendrait un bloc qui ne revient pas (invariant 7 de DESIGN-SBB).
 *
 * `ending` est ce que l'appel deviendra si l'état courant est
 * interrompu — la seule chose qui varie d'un état à l'autre.
 */
function interruptions(ending: Ending): CallOn {
  return {
    // proxy perdu : l'appel ne survivra pas, on raccroche et on rapporte
    // `dropped` — l'hôte lit l'erreur qu'on lui laisse pour reconnecter.
    "sip:disconnected": (_ev, ctx, fx) => {
      ctx.lastError = msg("error.proxyLostDuringCall");
      ctx.lastErrorCode = "WSS_LOST";
      ctx.suspectFields = "proxy";
      return hangUp(fx, "dropped", msg("error.proxyLostDuringCall"), "proxy perdu");
    },
    // veille : on raccroche, et l'hôte saura au retour qu'il doit dormir
    "sys:sleep": (_ev, ctx, fx) => {
      ctx.sleepRequested = true;
      return hangUp(fx, ending, msg("reason.sleep"), "veille");
    },
    // l'enregistrement tombe pendant l'appel : l'appel continue, mais
    // l'hôte doit le savoir pour choisir où revenir
    "sip:registrationFailed": (ev, ctx) => {
      ctx.lastError = msg("error.regLost", { cause: ev.cause });
      ctx.lastErrorCode = ev.statusCode ? `SIP ${ev.statusCode}` : ev.cause;
      ctx.suspectFields = "credentials";
      return undefined;
    },
    // deuxième INVITE pendant un appel : occupé (pas de double appel)
    "sip:incoming": (ev) => {
      ev.call.reject("busy");
    },
    /**
     * Média négocié avant que l'appel ne soit établi (la réponse SDP
     * arrive avant le 200 OK côté JsSIP) : on retient ce que l'appel
     * transporte réellement, l'écran le dira une fois en communication.
     */
    "sip:mediaChanged": (ev, _ctx, fx) => {
      const media = ev.media;
      // la vidéo demandée n'a pas été acceptée : c'est le décroché audio
      // d'un appel passé en vidéo, et l'appelant doit le savoir
      if (fx.data.asked.video && !media.video)
        noteNotice(fx, msg("notice.videoDeclined", { peer: peerName(fx.data) }));
      fx.data.media = media;
      return undefined;
    },
    "sip:mediaRefused": () => undefined,
    // hors communication, il n'y a rien à ajouter à un appel qui n'existe
    // pas encore : le distant est éconduit tout de suite
    "sip:mediaOffer": (ev) => {
      ev.offer.reject();
    },
    // désactivés à l'écran pendant l'appel : consommés pour qu'un clic ne
    // reste pas en attente et ne s'exécute pas après coup
    "ui:toggleVideo": () => undefined,
    "ui:acceptVideo": () => undefined,
    "ui:rejectVideo": () => undefined,
    "ui:backToSettings": () => undefined,
    "ui:logout": () => undefined,
    "ui:call": () => undefined,
    "ui:clearHistory": () => undefined,
    "sip:registered": () => undefined,
    "sip:connected": () => undefined,
    "sys:wake": () => undefined,
  };
}

/**
 * Ce que les trois états de la communication partagent — `connected` et
 * les deux temps d'une renégociation. L'appel ne change pas de nature
 * parce qu'une offre est en vol : on raccroche, on coupe son micro et on
 * masque son self-view exactement pareil.
 */
function inCall(): CallOn {
  return {
    ...interruptions("answered"),
    "sip:confirmed": () => undefined, // ACK
    "sip:accepted": () => undefined,
    "sip:progress": () => undefined,
    "sip:ended": (ev, ctx, fx) => {
      const by = endedBy(ev.originator);
      sealed("connected", by, ctx, fx);
      // un incident réseau n'est pas un raccrochage : la ligne
      // d'historique n'est pas la même, et c'est le bloc qui le sait
      if (by === "network") {
        fx.sbbReturn("dropped", {
          connectedAt: fx.data.connectedAt,
          media: fx.data.media,
          reason: rawMsg(ev.cause),
        });
        return;
      }
      fx.sbbReturn("answered", {
        connectedAt: fx.data.connectedAt ?? Date.now(),
        media: fx.data.media,
        endedBy: by,
      });
    },
    "sip:failed": (ev, ctx, fx) => {
      sealed("connected", endedBy(ev.originator), ctx, fx);
      fx.sbbReturn("dropped", {
        connectedAt: fx.data.connectedAt,
        media: fx.data.media,
        reason: failReason(ev),
      });
    },
    "ui:hangup": (_ev, _ctx, fx) => hangUp(fx, "answered", msg("reason.hungUp"), "BYE"),
    "ui:muteMic": (_ev, ctx, fx) => {
      fx.data.micMuted = !fx.data.micMuted;
      fx.data.session?.setMicMuted(fx.data.micMuted);
      publish("connected", ctx, fx.data);
      return stay(fx.data.micMuted ? "micro coupé" : "micro rétabli");
    },
    "ui:toggleSelfView": (_ev, ctx, fx) => {
      fx.data.selfViewHidden = !fx.data.selfViewHidden;
      publish("connected", ctx, fx.data);
      return stay("self-view");
    },
  };
}

export const CallBlock = defineSbb<CallHost, PhoneEvent, CallData, CallReturn>()({
  name: "CallBlock",
  namespace: "call",
  returns: {
    answered: "l'appel a été établi puis raccroché — {connectedAt, media, endedBy}",
    dropped: "l'appel a été coupé par le réseau — {connectedAt, media, reason}",
    rejected: "l'appel sortant a été refusé ou n'a pas pu être placé — {reason}",
    canceled: "l'appelant a renoncé avant toute réponse — {reason}",
    missed: "l'appel entrant n'a jamais été décroché — {reason, failed}",
  },

  // Un appel n'a pas de borne globale : il finit quand le dialogue finit.
  // Ce sont les états qui portent les délais (sonnerie, établissement,
  // raccrochage), comme le `bridge` du dialecte Elixir.
  timeout: { delay: "infinity" },

  data: () => ({
    target: "",
    media: { audio: true, video: false },
    direction: "outgoing" as CallDirection,
    incoming: null,
    displayName: null,
    offered: { audio: true, video: false },
    asked: { audio: true, video: false },
    session: null,
    connectedAt: null,
    endedBy: null,
    micMuted: false,
    selfViewHidden: false,
    videoPending: false,
    videoOffer: null,
    notice: null,
    noticeSeq: 0,
    endingAs: "canceled",
    endReason: msg("reason.hungUp"),
  }),

  /**
   * Le bloc est arraché sans retourner — terminaison de la machine ou
   * arrêt coopératif. La session est à lui, et lui seul sait qu'elle
   * existe : il la referme avant que le déroulement ne poursuive.
   */
  cleanup(ctx, data) {
    data.session?.terminate();
    ctx.call = null;
  },

  states: {
    /**
     * Aiguillage : traversé sans attendre d'événement. Pour un entrant,
     * on s'abonne d'abord à la session (sinon une annulation immédiate de
     * l'appelant passerait inaperçue), puis on part en `ringing_in`.
     *
     * Sauf si l'offre est hors de portée du navigateur : le téléphone ne
     * sonne alors pas du tout. Faire sonner reviendrait à promettre un
     * appel que le décrochage ferait échouer — et le 488 doit partir
     * **avant** le 180, sans quoi l'appelant a entendu une sonnerie qui
     * n'existait pas. C'est possible parce que tout ce chemin est
     * synchrone : JsSIP n'envoie son 180 qu'au retour de l'événement qui
     * nous a livré l'INVITE (§4.3).
     */
    initial_state: {
      enter(ctx, fx) {
        const d = fx.data;
        if (!d.incoming) return goto("dialing", "INVITE sortant");
        d.direction = "incoming";
        d.target = d.incoming.from;
        d.displayName = d.incoming.displayName;
        d.offered = d.incoming.offered;
        d.media = d.incoming.offered; // avant décision, l'affichage montre l'offre
        d.asked = d.incoming.offered;
        // avant le refus comme avant la sonnerie : c'est `listen()` qui
        // ouvre le carnet, et l'appel refusé doit garder le sien
        d.session = d.incoming.listen((ev) => fx.send(ev));
        const problem = d.incoming.offerProblem;
        if (problem) {
          refuse(ctx, fx, "incompatible", msg("reason.offerUnsupported", { detail: problem }), true);
          return;
        }
        return goto("ringing_in", "INVITE entrant");
      },
      meta: { callState: "start" },
    },

    // INVITE envoyé, en attente de réponse provisoire ou finale
    dialing: {
      enter(ctx, fx) {
        const d = fx.data;
        try {
          d.session = ctx.handle!.call(d.target, d.media, (ev) => fx.send(ev));
        } catch (e) {
          fx.sbbReturn("rejected", {
            reason: msg("reason.callFailed", {
              detail: e instanceof Error ? e.message : String(e),
            }),
          });
          return;
        }
        d.offered = d.media;
        d.asked = d.media;
        publish("dialing", ctx, d);
      },
      on: {
        ...interruptions("canceled"),
        "sip:progress": () => goto("ringing", "180/183"),
        "sip:accepted": () => goto("connected", "200 OK"),
        "sip:failed": (ev, ctx, fx) => {
          sealed("dialing", endedBy(ev.originator), ctx, fx);
          fx.sbbReturn("rejected", { reason: failReason(ev) });
        },
        "sip:ended": (ev, ctx, fx) => {
          sealed("dialing", endedBy(ev.originator), ctx, fx);
          fx.sbbReturn("canceled", { reason: rawMsg(ev.cause) });
        },
        "ui:hangup": (_ev, _ctx, fx) => hangUp(fx, "canceled", msg("reason.hungUp"), "CANCEL"),
      },
      meta: { callState: "dialing" },
    },

    ringing: {
      enter(ctx, fx) {
        publish("ringing", ctx, fx.data);
      },
      on: {
        ...interruptions("canceled"),
        "sip:progress": () => undefined, // 180 répétés
        "sip:accepted": () => goto("connected", "200 OK"),
        "sip:failed": (ev, ctx, fx) => {
          sealed("ringing", endedBy(ev.originator), ctx, fx);
          fx.sbbReturn("rejected", { reason: failReason(ev) });
        },
        "sip:ended": (ev, ctx, fx) => {
          sealed("ringing", endedBy(ev.originator), ctx, fx);
          fx.sbbReturn("canceled", { reason: rawMsg(ev.cause) });
        },
        "ui:hangup": (_ev, _ctx, fx) => hangUp(fx, "canceled", msg("reason.hungUp"), "CANCEL"),
      },
      after: {
        delay: 90_000,
        then: (ctx, fx) => {
          fx.data.session?.terminate();
          sealed("ringing", "local", ctx, fx);
          fx.sbbReturn("rejected", { reason: msg("reason.noAnswer") });
        },
      },
      meta: { callState: "ringing" },
    },

    /**
     * Le téléphone sonne : l'UI propose les réponses compatibles avec
     * l'offre (`offered`) et le refus. Un appel entrant non décroché
     * n'est pas une erreur — il ressort en `missed` avec le motif exact,
     * que l'hôte consigne tel quel dans l'historique.
     */
    ringing_in: {
      enter(ctx, fx) {
        publish("ringing_in", ctx, fx.data);
      },
      on: {
        ...interruptions("missed"),
        "ui:answer": (ev, _ctx, fx) => {
          fx.data.media = ev.media;
          fx.data.asked = ev.media;
          fx.data.incoming!.answer(ev.media);
          return goto("answering", "200 OK");
        },
        "ui:reject": (_ev, ctx, fx) => refuse(ctx, fx, "declined", msg("reason.declined")),
        // le bouton rouge de la vue mobile pendant la sonnerie = refuser
        "ui:hangup": (_ev, ctx, fx) => refuse(ctx, fx, "declined", msg("reason.declined")),
        // l'appelant a renoncé (CANCEL) : appel manqué, pas un échec
        "sip:failed": (ev, ctx, fx) => {
          sealed("ringing_in", endedBy(ev.originator), ctx, fx);
          fx.sbbReturn("missed", { reason: msg("reason.missed"), failed: false });
        },
        "sip:ended": (ev, ctx, fx) => {
          sealed("ringing_in", endedBy(ev.originator), ctx, fx);
          fx.sbbReturn("missed", { reason: msg("reason.missed"), failed: false });
        },
      },
      after: {
        delay: 60_000,
        then: (ctx, fx) => refuse(ctx, fx, "timeout", msg("reason.missedNoAnswer")),
      },
      meta: { callState: "ringing_in" },
    },

    /** 200 OK envoyé : on attend la confirmation de la session par JsSIP. */
    answering: {
      enter(ctx, fx) {
        publish("answering", ctx, fx.data);
      },
      on: {
        ...interruptions("missed"),
        "sip:accepted": () => goto("connected", "200 OK"),
        "sip:confirmed": () => goto("connected", "ACK"),
        "sip:progress": () => undefined,
        "sip:failed": (ev, ctx, fx) => {
          sealed("answering", endedBy(ev.originator), ctx, fx);
          fx.sbbReturn("missed", { reason: failReason(ev), failed: true });
        },
        "sip:ended": (ev, ctx, fx) => {
          sealed("answering", endedBy(ev.originator), ctx, fx);
          fx.sbbReturn("missed", { reason: rawMsg(ev.cause), failed: true });
        },
        "ui:hangup": (_ev, _ctx, fx) => hangUp(fx, "missed", msg("reason.declined"), "BYE"),
      },
      after: {
        // média refusé par l'OS, ACK jamais reçu… : ne pas rester bloqué
        delay: 30_000,
        then: (ctx, fx) => {
          fx.data.session?.terminate();
          sealed("answering", "local", ctx, fx);
          fx.sbbReturn("missed", {
            reason: msg("reason.setupFailed"),
            failed: true,
          });
        },
      },
      meta: { callState: "answering" },
    },

    connected: {
      enter(ctx, fx) {
        // `??=` et non `=` : la communication repasse par cet état après
        // chaque renégociation, le chronomètre ne repart pas de zéro
        fx.data.connectedAt ??= Date.now();
        fx.data.videoPending = false;
        publish("connected", ctx, fx.data);
      },
      on: {
        ...inCall(),
        /**
         * L'icône de la caméra : elle ajoute la vidéo à l'appel, ou l'en
         * retire. Le re-INVITE part, son issue arrivera en
         * `sip:mediaChanged` ou `sip:mediaRefused`.
         */
        "ui:toggleVideo": (_ev, _ctx, fx) => {
          const on = !fx.data.media.video;
          fx.data.asked = { ...fx.data.media, video: on };
          fx.data.session?.setVideo(on);
          return goto("renegotiating", on ? "ajout de la vidéo" : "retrait de la vidéo");
        },
        /**
         * Changement venu du distant : personne ne l'a demandé ici, donc
         * l'écran le signale — c'est la seule façon de comprendre que
         * l'image vient d'apparaître ou de disparaître.
         */
        "sip:mediaChanged": (ev, ctx, fx) => {
          const before = fx.data.media;
          fx.data.media = ev.media;
          fx.data.asked = ev.media;
          if (before.video === ev.media.video) {
            publish("connected", ctx, fx.data);
            return stay("média inchangé");
          }
          notify(
            ctx,
            fx,
            msg(ev.media.video ? "notice.videoAdded" : "notice.videoRemoved", {
              peer: peerName(fx.data),
            }),
          );
          return stay(ev.media.video ? "vidéo ajoutée par le distant" : "vidéo retirée par le distant");
        },
        "sip:mediaOffer": (ev, ctx, fx) => {
          fx.data.videoOffer = ev.offer;
          return goto("video_offer", "le distant propose la vidéo");
        },
      },
      meta: { callState: "connected" },
    },

    /**
     * Notre re-INVITE est parti : l'appel continue exactement comme
     * avant, seule l'icône de la caméra attend. L'issue est l'un des
     * trois événements du port — le média a changé, le distant a dit non,
     * ou personne ne répond et le délai tranche.
     */
    renegotiating: {
      enter(ctx, fx) {
        fx.data.videoPending = true;
        publish("connected", ctx, fx.data);
      },
      on: {
        ...inCall(),
        // une renégociation à la fois : le second clic est sans effet
        "ui:toggleVideo": () => undefined,
        "sip:mediaChanged": (ev, ctx, fx) => {
          const refused = fx.data.asked.video && !ev.media.video;
          fx.data.media = ev.media;
          fx.data.videoPending = false;
          if (refused) {
            notify(ctx, fx, msg("notice.videoRefused", { peer: peerName(fx.data) }));
            return goto("connected", "vidéo refusée");
          }
          publish("connected", ctx, fx.data);
          return goto("connected", ev.media.video ? "vidéo ajoutée" : "vidéo retirée");
        },
        "sip:mediaRefused": (ev, ctx, fx) => {
          fx.data.asked = fx.data.media;
          fx.data.videoPending = false;
          // le distant a dit non, ou la demande n'a jamais pu partir d'ici
          // (caméra prise ailleurs) : ce n'est pas la même phrase
          notify(
            ctx,
            fx,
            ev.by === "remote"
              ? msg("notice.videoRefused", { peer: peerName(fx.data) })
              : msg("notice.videoUnavailable"),
          );
          return goto("connected", "refus");
        },
        // les deux offres se croisent (RFC 3261 §14.1) : la nôtre est déjà
        // partie, celle du distant attendra son tour
        "sip:mediaOffer": (ev) => {
          ev.offer.reject();
        },
      },
      after: {
        // le distant n'a jamais conclu : l'appel, lui, continue
        delay: 20_000,
        then: (ctx, fx) => {
          fx.data.asked = fx.data.media;
          fx.data.videoPending = false;
          notify(ctx, fx, msg("notice.videoUnavailable"));
          return goto("connected", "sans réponse");
        },
      },
      meta: { callState: "connected" },
    },

    /**
     * Le distant veut ajouter la vidéo. Accepter allumerait la caméra :
     * cela ne se décide pas sans l'utilisateur, et le re-INVITE reste sans
     * réponse finale tant qu'il n'a pas tranché — l'appelant patiente sur
     * le 100 Trying déjà envoyé (docs/CONCEPTION.md §4.4).
     */
    video_offer: {
      enter(ctx, fx) {
        publish("connected", ctx, fx.data);
      },
      on: {
        ...inCall(),
        "ui:acceptVideo": (_ev, _ctx, fx) => {
          const offer = fx.data.videoOffer;
          fx.data.videoOffer = null;
          fx.data.asked = { ...fx.data.media, video: true };
          offer?.accept();
          return goto("renegotiating", "vidéo acceptée");
        },
        "ui:rejectVideo": (_ev, ctx, fx) => {
          const offer = fx.data.videoOffer;
          fx.data.videoOffer = null;
          offer?.reject();
          notify(ctx, fx, msg("notice.videoDeclinedHere"));
          return goto("connected", "488");
        },
        // l'icône de la caméra ne répond pas à la question posée : c'est la
        // popup qui le fait
        "ui:toggleVideo": () => undefined,
        // raccrocher pendant la question : le re-INVITE mérite sa réponse
        // avant le BYE, sinon l'appelant reste sur une offre en suspens
        "ui:hangup": (_ev, _ctx, fx) => {
          const offer = fx.data.videoOffer;
          fx.data.videoOffer = null;
          offer?.reject();
          return hangUp(fx, "answered", msg("reason.hungUp"), "BYE");
        },
        "sip:mediaOffer": (ev) => {
          ev.offer.reject();
        },
        // le distant a renoncé de lui-même (nouvelle négociation, mise en
        // attente) : la question n'a plus d'objet
        "sip:mediaChanged": (ev, ctx, fx) => {
          fx.data.media = ev.media;
          fx.data.videoOffer = null;
          publish("connected", ctx, fx.data);
          return goto("connected", "offre caduque");
        },
      },
      after: {
        // sans réponse, on ne fait pas patienter l'appelant indéfiniment
        delay: 25_000,
        then: (ctx, fx) => {
          const offer = fx.data.videoOffer;
          fx.data.videoOffer = null;
          offer?.reject();
          notify(ctx, fx, msg("notice.videoDeclinedHere"));
          return goto("connected", "sans réponse");
        },
      },
      meta: { callState: "connected" },
    },

    /**
     * CANCEL/BYE parti : on attend la confirmation JsSIP avant de sortir.
     * L'issue a été décidée au moment où l'on a raccroché (`endingAs`) —
     * c'est nous qui avons mis fin à l'appel, quoi que dise l'originator.
     */
    hangingup: {
      enter(ctx, fx) {
        if (fx.data.endingAs !== "dropped") fx.data.endedBy = "local";
        else fx.data.endedBy = "network";
        publish("hangingup", ctx, fx.data);
      },
      on: {
        "sip:ended": (_ev, _ctx, fx) => report(fx),
        "sip:failed": (_ev, _ctx, fx) => report(fx),
        "sip:progress": () => undefined,
        "sip:accepted": () => undefined,
        "sip:confirmed": () => undefined,
        // le transport est mort : aucune confirmation n'arrivera
        "sip:disconnected": (_ev, ctx, fx) => {
          ctx.lastError = msg("error.proxyLostDuringCall");
          ctx.lastErrorCode = "WSS_LOST";
          ctx.suspectFields = "proxy";
          fx.data.endingAs = "dropped";
          fx.data.endReason = msg("error.proxyLostDuringCall");
          report(fx);
        },
        // on raccroche déjà : la veille n'a plus qu'à être notée
        "sys:sleep": (_ev, ctx) => {
          ctx.sleepRequested = true;
          return undefined;
        },
        "sip:incoming": (ev) => {
          ev.call.reject("busy");
        },
        // le média n'a plus d'intérêt : l'appel se referme. Une offre en
        // vol, elle, mérite encore sa réponse — sans quoi l'appelant
        // attendrait un 200 OK que ce dialogue ne donnera jamais
        "sip:mediaChanged": () => undefined,
        "sip:mediaRefused": () => undefined,
        "sip:mediaOffer": (ev) => {
          ev.offer.reject();
        },
        "ui:toggleVideo": () => undefined,
        "ui:acceptVideo": () => undefined,
        "ui:rejectVideo": () => undefined,
        "sip:registrationFailed": () => undefined,
        "sip:registered": () => undefined,
        "sip:connected": () => undefined,
        "sys:wake": () => undefined,
        "ui:hangup": () => undefined,
        "ui:backToSettings": () => undefined,
        "ui:logout": () => undefined,
        "ui:call": () => undefined,
        "ui:clearHistory": () => undefined,
      },
      after: {
        delay: 2000,
        then: (_ctx, fx) => report(fx),
      },
      meta: { callState: "hangingup" },
    },
  },
});
