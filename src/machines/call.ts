/**
 * CallMachine — un appel sortant, une instance (docs/CONCEPTION.md §4.2).
 * Spawnée par PhoneMachine (`fx.spawn(..., { as: "call" })`) ; elle ne
 * parle qu'au parent : vue publiée par notifyParent après chaque
 * changement significatif, commandes UI reçues en `parent:msg` et
 * réinjectées dans sa propre boucle d'événements.
 *
 * Terminaison par success()/failure() → le parent reçoit `child:exit`
 * et revient en `ready` (ou `reg_failed` si l'enregistrement est tombé
 * pendant l'appel).
 */

import { defineMachine, failure, goto, stay, success } from "finite-state-language";
import type { Fx, ParentMsg } from "finite-state-language";
import type { CallMedia, CallSession, SipHandle, SipOriginator } from "../sip/port.js";
import type { CallEvent, CallView } from "./events.js";

export interface CallCtx {
  /** Injectés via spawn({ args }) — jamais recréés par la machine. */
  handle: SipHandle;
  target: string;
  media: CallMedia;
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
    target: ctx.target,
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

export const CallMachine = defineMachine<CallCtx, CallEvent>()({
  name: "CallMachine",

  context: () => ({
    handle: null as unknown as SipHandle,
    target: "",
    media: { audio: true, video: false },
    session: null,
    connectedAt: null,
    endedBy: null,
    micMuted: false,
    camMuted: false,
    selfViewHidden: false,
  }),

  states: {
    // dialing : INVITE envoyé, en attente de réponse provisoire ou finale
    initial_state: {
      enter(ctx, fx) {
        try {
          ctx.session = ctx.handle.call(ctx.target, ctx.media, (ev) => fx.send(ev));
        } catch (e) {
          return failure(e instanceof Error ? e.message : String(e));
        }
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
