/**
 * CallMachine — un appel, une instance (docs/CONCEPTION.md §4.2 et §4.3).
 * Spawnée par PhoneMachine (`fx.spawn(..., { as: "call" })`) ; elle ne
 * parle qu'au parent : vue publiée par notifyParent après chaque
 * changement significatif, commandes UI reçues en `parent:msg` et
 * réinjectées dans sa propre boucle d'événements.
 *
 * Une seule machine sert les deux sens : `initial_state` aiguille vers
 * `dialing` (INVITE sortant) ou `ringing_in` (INVITE entrant, injecté par
 * le parent dans `args.incoming`). Une fois établis, les deux sens
 * partagent exactement le même état `connected`.
 *
 * Terminaison par success()/failure() → le parent reçoit `child:exit`
 * et revient en `ready` (ou `reg_failed` si l'enregistrement est tombé
 * pendant l'appel).
 */

import { defineMachine, failure, goto, stay, success } from "finite-state-language";
import type { Fx, ParentMsg } from "finite-state-language";
import type {
  CallMedia,
  CallSession,
  IncomingCall,
  RejectReason,
  SipHandle,
  SipOriginator,
} from "../sip/port.js";
import type { CallDirection } from "../storage/store.js";
import type { CallEvent, CallView } from "./events.js";

export interface CallCtx {
  /** Injectés via spawn({ args }) — jamais recréés par la machine. */
  handle: SipHandle;
  target: string;
  media: CallMedia;
  /** Entrant uniquement : l'INVITE en attente de décision. */
  incoming: IncomingCall | null;
  direction: CallDirection;
  displayName: string | null;
  /** Médias proposés par l'appelant (entrant) ; = `media` pour un sortant. */
  offered: CallMedia;
  session: CallSession | null;
  connectedAt: number | null;
  /** Qui a raccroché : renseigné au moment où l'appel se termine. */
  endedBy: "local" | "remote" | "network" | null;
  micMuted: boolean;
  camMuted: boolean;
  selfViewHidden: boolean;
}

function report(state: CallView["state"], ctx: CallCtx, fx: Fx<CallEvent>): void {
  const view: CallView = {
    state,
    direction: ctx.direction,
    target: ctx.target,
    displayName: ctx.displayName,
    offered: ctx.offered,
    media: ctx.media,
    micMuted: ctx.micMuted,
    camMuted: ctx.camMuted,
    selfViewHidden: ctx.selfViewHidden,
    connectedAt: ctx.connectedAt,
    endedBy: ctx.endedBy,
    session: ctx.session,
  };
  fx.notifyParent(view);
}

/** Les commandes UI arrivent enveloppées par le parent : on les rejoue telles quelles. */
function replay(ev: ParentMsg, _ctx: CallCtx, fx: Fx<CallEvent>): void {
  fx.send(ev.payload as CallEvent);
}

function failReason(ev: { cause: string; statusCode?: number }): string {
  return ev.statusCode ? `${ev.cause} (SIP ${ev.statusCode})` : ev.cause;
}

/** Traduit l'originator JsSIP en responsable de la fin d'appel (`system` = incident réseau). */
function endedBy(originator: SipOriginator | undefined): "local" | "remote" | "network" {
  return originator === "local" ? "local" : originator === "system" ? "network" : "remote";
}

/**
 * Note qui a raccroché et publie une dernière vue au parent avant la
 * transition terminale : c'est ce que PhoneMachine consigne dans
 * l'historique au `child:exit` qui suit immédiatement.
 */
function sealed(
  state: CallView["state"],
  by: "local" | "remote" | "network",
  ctx: CallCtx,
  fx: Fx<CallEvent>,
): void {
  ctx.endedBy = by;
  report(state, ctx, fx);
}

/**
 * Fin d'un appel entrant jamais décroché. `reason` part dans `child:exit`
 * et devient le motif de la ligne d'historique (« manqué » vs « refusé »).
 */
function refuse(ctx: CallCtx, fx: Fx<CallEvent>, how: RejectReason, reason: string) {
  ctx.incoming?.reject(how);
  sealed("ringing_in", "local", ctx, fx);
  return success(reason);
}

export const CallMachine = defineMachine<CallCtx, CallEvent>()({
  name: "CallMachine",

  context: () => ({
    handle: null as unknown as SipHandle,
    target: "",
    media: { audio: true, video: false },
    incoming: null,
    direction: "outgoing" as CallDirection,
    displayName: null,
    offered: { audio: true, video: false },
    session: null,
    connectedAt: null,
    endedBy: null,
    micMuted: false,
    camMuted: false,
    selfViewHidden: false,
  }),

  states: {
    /**
     * Aiguillage : traversé sans attendre d'événement. Pour un entrant,
     * on s'abonne d'abord à la session (sinon une annulation immédiate de
     * l'appelant passerait inaperçue), puis on part en `ringing_in`.
     */
    initial_state: {
      enter(ctx, fx) {
        if (!ctx.incoming) return goto("dialing", "INVITE sortant");
        ctx.direction = "incoming";
        ctx.target = ctx.incoming.from;
        ctx.displayName = ctx.incoming.displayName;
        ctx.offered = ctx.incoming.offered;
        ctx.media = ctx.incoming.offered; // avant décision, l'affichage montre l'offre
        ctx.session = ctx.incoming.listen((ev) => fx.send(ev));
        return goto("ringing_in", "INVITE entrant");
      },
      meta: { callState: "start" },
    },

    // INVITE envoyé, en attente de réponse provisoire ou finale
    dialing: {
      enter(ctx, fx) {
        try {
          ctx.session = ctx.handle.call(ctx.target, ctx.media, (ev) => fx.send(ev));
        } catch (e) {
          return failure(e instanceof Error ? e.message : String(e));
        }
        ctx.offered = ctx.media;
        report("dialing", ctx, fx);
      },
      on: {
        "sip:progress": () => goto("ringing", "180/183"),
        "sip:accepted": () => goto("connected", "200 OK"),
        "sip:failed": (ev, ctx, fx) => {
          sealed("dialing", endedBy(ev.originator), ctx, fx);
          return failure(failReason(ev));
        },
        "sip:ended": (ev, ctx, fx) => {
          sealed("dialing", endedBy(ev.originator), ctx, fx);
          return success(ev.cause);
        },
        "ui:hangup": (_ev, ctx) => {
          ctx.session?.terminate();
          return goto("hangingup", "CANCEL");
        },
        "parent:msg": replay,
      },
      meta: { callState: "dialing" },
    },

    ringing: {
      enter(ctx, fx) {
        report("ringing", ctx, fx);
      },
      on: {
        "sip:progress": () => undefined, // 180 répétés
        "sip:accepted": () => goto("connected", "200 OK"),
        "sip:failed": (ev, ctx, fx) => {
          sealed("ringing", endedBy(ev.originator), ctx, fx);
          return failure(failReason(ev));
        },
        "sip:ended": (ev, ctx, fx) => {
          sealed("ringing", endedBy(ev.originator), ctx, fx);
          return success(ev.cause);
        },
        "ui:hangup": (_ev, ctx) => {
          ctx.session?.terminate();
          return goto("hangingup", "CANCEL");
        },
        "parent:msg": replay,
      },
      after: {
        delay: 90_000,
        then: (ctx, fx) => {
          ctx.session?.terminate();
          sealed("ringing", "local", ctx, fx);
          return failure("Pas de réponse");
        },
      },
      meta: { callState: "ringing" },
    },

    /**
     * Le téléphone sonne : l'UI propose les réponses compatibles avec
     * l'offre (`ctx.offered`) et le refus. Un appel entrant non décroché
     * n'est pas une erreur — il se termine en success avec un motif que
     * le parent consigne dans l'historique.
     */
    ringing_in: {
      enter(ctx, fx) {
        report("ringing_in", ctx, fx);
      },
      on: {
        "ui:answer": (ev, ctx) => {
          ctx.media = ev.media;
          ctx.incoming!.answer(ev.media);
          return goto("answering", "200 OK");
        },
        "ui:reject": (_ev, ctx, fx) => refuse(ctx, fx, "declined", "Appel refusé"),
        // le bouton rouge de la vue mobile pendant la sonnerie = refuser
        "ui:hangup": (_ev, ctx, fx) => refuse(ctx, fx, "declined", "Appel refusé"),
        // l'appelant a renoncé (CANCEL) : appel manqué, pas un échec
        "sip:failed": (ev, ctx, fx) => {
          sealed("ringing_in", endedBy(ev.originator), ctx, fx);
          return success("Appel manqué");
        },
        "sip:ended": (ev, ctx, fx) => {
          sealed("ringing_in", endedBy(ev.originator), ctx, fx);
          return success("Appel manqué");
        },
        "parent:msg": replay,
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
        report("answering", ctx, fx);
      },
      on: {
        "sip:accepted": () => goto("connected", "200 OK"),
        "sip:confirmed": () => goto("connected", "ACK"),
        "sip:progress": () => undefined,
        "sip:failed": (ev, ctx, fx) => {
          sealed("answering", endedBy(ev.originator), ctx, fx);
          return failure(failReason(ev));
        },
        "sip:ended": (ev, ctx, fx) => {
          sealed("answering", endedBy(ev.originator), ctx, fx);
          return success(ev.cause);
        },
        "ui:hangup": (_ev, ctx) => {
          ctx.session?.terminate();
          return goto("hangingup", "BYE");
        },
        "parent:msg": replay,
      },
      after: {
        // média refusé par l'OS, ACK jamais reçu… : ne pas rester bloqué
        delay: 30_000,
        then: (ctx, fx) => {
          ctx.session?.terminate();
          sealed("answering", "local", ctx, fx);
          return failure("Établissement de l'appel impossible");
        },
      },
      meta: { callState: "answering" },
    },

    connected: {
      enter(ctx, fx) {
        ctx.connectedAt = Date.now();
        report("connected", ctx, fx);
      },
      on: {
        "sip:confirmed": () => undefined, // ACK
        "sip:accepted": () => undefined,
        "sip:progress": () => undefined,
        "sip:ended": (ev, ctx, fx) => {
          sealed("connected", endedBy(ev.originator), ctx, fx);
          return success(ev.cause);
        },
        "sip:failed": (ev, ctx, fx) => {
          sealed("connected", endedBy(ev.originator), ctx, fx);
          return failure(failReason(ev));
        },
        "ui:hangup": (_ev, ctx) => {
          ctx.session?.terminate();
          return goto("hangingup", "BYE");
        },
        "ui:muteMic": (_ev, ctx, fx) => {
          ctx.micMuted = !ctx.micMuted;
          ctx.session?.setMicMuted(ctx.micMuted);
          report("connected", ctx, fx);
          return stay(ctx.micMuted ? "micro coupé" : "micro rétabli");
        },
        "ui:muteCam": (_ev, ctx, fx) => {
          ctx.camMuted = !ctx.camMuted;
          ctx.session?.setCamMuted(ctx.camMuted);
          report("connected", ctx, fx);
          return stay(ctx.camMuted ? "caméra coupée" : "caméra rétablie");
        },
        "ui:toggleSelfView": (_ev, ctx, fx) => {
          ctx.selfViewHidden = !ctx.selfViewHidden;
          report("connected", ctx, fx);
          return stay("self-view");
        },
        "parent:msg": replay,
      },
      meta: { callState: "connected" },
    },

    // CANCEL/BYE parti : on attend la confirmation JsSIP avant de sortir.
    // C'est nous qui avons raccroché, quoi que dise l'originator ensuite.
    hangingup: {
      enter(ctx, fx) {
        ctx.endedBy = "local";
        report("hangingup", ctx, fx);
      },
      on: {
        "sip:ended": () => success("raccroché"),
        "sip:failed": () => success("raccroché"),
        "sip:progress": () => undefined,
        "sip:accepted": () => undefined,
        "sip:confirmed": () => undefined,
        "parent:msg": replay,
      },
      after: {
        delay: 2000,
        then: () => success("raccroché (forcé)"),
      },
      meta: { callState: "hangingup" },
    },
  },

  cleanup(ctx) {
    ctx.session?.terminate();
  },
});

export type CallInstance = ReturnType<typeof CallMachine.start>;
