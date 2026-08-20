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
  RejectReason,
  SipHandle,
  SipOriginator,
} from "../sip/port.js";
import type { CallDirection } from "../storage/store.js";
import type { CallReturn, CallView, PhoneEvent, SuspectField } from "./events.js";

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
  lastError: string | null;
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
  session: CallSession | null;
  connectedAt: number | null;
  endedBy: "local" | "remote" | "network" | null;
  micMuted: boolean;
  camMuted: boolean;
  selfViewHidden: boolean;
  /**
   * Décidé au moment où l'on raccroche, lu par `hangingup` au moment de
   * rapporter : c'est nous qui avons mis fin à l'appel, quoi que dise
   * l'originator ensuite.
   */
  endingAs: Ending;
  endReason: string;
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
    camMuted: data.camMuted,
    selfViewHidden: data.selfViewHidden,
    connectedAt: data.connectedAt,
    endedBy: data.endedBy,
    session: data.session,
  };
}

function failReason(ev: { cause: string; statusCode?: number }): string {
  return ev.statusCode ? `${ev.cause} (SIP ${ev.statusCode})` : ev.cause;
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
function hangUp(fx: CallFx, ending: Ending, reason: string, desc: string) {
  fx.data.session?.terminate();
  fx.data.endingAs = ending;
  fx.data.endReason = reason;
  return goto("hangingup", desc);
}

/**
 * Fin d'un appel entrant jamais décroché. `reason` devient le motif de
 * la ligne d'historique (« manqué » vs « refusé »).
 */
function refuse(ctx: CallHost, fx: CallFx, how: RejectReason, reason: string): void {
  fx.data.incoming?.reject(how);
  fx.data.endedBy = "local";
  publish("ringing_in", ctx, fx.data);
  fx.sbbReturn("missed", { reason, failed: false });
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
      ctx.lastError = "Connexion au proxy perdue pendant l'appel";
      ctx.lastErrorCode = "WSS_LOST";
      ctx.suspectFields = "proxy";
      return hangUp(fx, "dropped", "Connexion au proxy perdue pendant l'appel", "proxy perdu");
    },
    // veille : on raccroche, et l'hôte saura au retour qu'il doit dormir
    "sys:sleep": (_ev, ctx, fx) => {
      ctx.sleepRequested = true;
      return hangUp(fx, ending, "Mise en veille", "veille");
    },
    // l'enregistrement tombe pendant l'appel : l'appel continue, mais
    // l'hôte doit le savoir pour choisir où revenir
    "sip:registrationFailed": (ev, ctx) => {
      ctx.lastError = `Enregistrement perdu : ${ev.cause}`;
      ctx.lastErrorCode = ev.statusCode ? `SIP ${ev.statusCode}` : ev.cause;
      ctx.suspectFields = "credentials";
      return undefined;
    },
    // deuxième INVITE pendant un appel : occupé (pas de double appel)
    "sip:incoming": (ev) => {
      ev.call.reject("busy");
    },
    // désactivés à l'écran pendant l'appel : consommés pour qu'un clic ne
    // reste pas en attente et ne s'exécute pas après coup
    "ui:backToSettings": () => undefined,
    "ui:logout": () => undefined,
    "ui:call": () => undefined,
    "ui:clearHistory": () => undefined,
    "sip:registered": () => undefined,
    "sip:connected": () => undefined,
    "sys:wake": () => undefined,
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
    session: null,
    connectedAt: null,
    endedBy: null,
    micMuted: false,
    camMuted: false,
    selfViewHidden: false,
    endingAs: "canceled",
    endReason: "raccroché",
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
     */
    initial_state: {
      enter(_ctx, fx) {
        const d = fx.data;
        if (!d.incoming) return goto("dialing", "INVITE sortant");
        d.direction = "incoming";
        d.target = d.incoming.from;
        d.displayName = d.incoming.displayName;
        d.offered = d.incoming.offered;
        d.media = d.incoming.offered; // avant décision, l'affichage montre l'offre
        d.session = d.incoming.listen((ev) => fx.send(ev));
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
            reason: e instanceof Error ? e.message : String(e),
          });
          return;
        }
        d.offered = d.media;
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
          fx.sbbReturn("canceled", { reason: ev.cause });
        },
        "ui:hangup": (_ev, _ctx, fx) => hangUp(fx, "canceled", "raccroché", "CANCEL"),
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
          fx.sbbReturn("canceled", { reason: ev.cause });
        },
        "ui:hangup": (_ev, _ctx, fx) => hangUp(fx, "canceled", "raccroché", "CANCEL"),
      },
      after: {
        delay: 90_000,
        then: (ctx, fx) => {
          fx.data.session?.terminate();
          sealed("ringing", "local", ctx, fx);
          fx.sbbReturn("rejected", { reason: "Pas de réponse" });
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
          fx.data.incoming!.answer(ev.media);
          return goto("answering", "200 OK");
        },
        "ui:reject": (_ev, ctx, fx) => refuse(ctx, fx, "declined", "Appel refusé"),
        // le bouton rouge de la vue mobile pendant la sonnerie = refuser
        "ui:hangup": (_ev, ctx, fx) => refuse(ctx, fx, "declined", "Appel refusé"),
        // l'appelant a renoncé (CANCEL) : appel manqué, pas un échec
        "sip:failed": (ev, ctx, fx) => {
          sealed("ringing_in", endedBy(ev.originator), ctx, fx);
          fx.sbbReturn("missed", { reason: "Appel manqué", failed: false });
        },
        "sip:ended": (ev, ctx, fx) => {
          sealed("ringing_in", endedBy(ev.originator), ctx, fx);
          fx.sbbReturn("missed", { reason: "Appel manqué", failed: false });
        },
      },
      after: {
        delay: 60_000,
        then: (ctx, fx) => refuse(ctx, fx, "timeout", "Appel manqué (sans réponse)"),
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
          fx.sbbReturn("missed", { reason: ev.cause, failed: true });
        },
        "ui:hangup": (_ev, _ctx, fx) => hangUp(fx, "missed", "Appel refusé", "BYE"),
      },
      after: {
        // média refusé par l'OS, ACK jamais reçu… : ne pas rester bloqué
        delay: 30_000,
        then: (ctx, fx) => {
          fx.data.session?.terminate();
          sealed("answering", "local", ctx, fx);
          fx.sbbReturn("missed", {
            reason: "Établissement de l'appel impossible",
            failed: true,
          });
        },
      },
      meta: { callState: "answering" },
    },

    connected: {
      enter(ctx, fx) {
        fx.data.connectedAt = Date.now();
        publish("connected", ctx, fx.data);
      },
      on: {
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
              reason: ev.cause,
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
        "ui:hangup": (_ev, _ctx, fx) => hangUp(fx, "answered", "raccroché", "BYE"),
        "ui:muteMic": (_ev, ctx, fx) => {
          fx.data.micMuted = !fx.data.micMuted;
          fx.data.session?.setMicMuted(fx.data.micMuted);
          publish("connected", ctx, fx.data);
          return stay(fx.data.micMuted ? "micro coupé" : "micro rétabli");
        },
        "ui:muteCam": (_ev, ctx, fx) => {
          fx.data.camMuted = !fx.data.camMuted;
          fx.data.session?.setCamMuted(fx.data.camMuted);
          publish("connected", ctx, fx.data);
          return stay(fx.data.camMuted ? "caméra coupée" : "caméra rétablie");
        },
        "ui:toggleSelfView": (_ev, ctx, fx) => {
          fx.data.selfViewHidden = !fx.data.selfViewHidden;
          publish("connected", ctx, fx.data);
          return stay("self-view");
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
          ctx.lastError = "Connexion au proxy perdue pendant l'appel";
          ctx.lastErrorCode = "WSS_LOST";
          ctx.suspectFields = "proxy";
          fx.data.endingAs = "dropped";
          fx.data.endReason = "Connexion au proxy perdue pendant l'appel";
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
