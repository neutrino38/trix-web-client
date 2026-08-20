/**
 * CallBlock, entré par un hôte minimal — un bloc ne se démarre pas seul,
 * il n'a pas de contexte à fabriquer. L'hôte fournit ce que le bloc
 * exige (`CallHost`), capte l'outcome et s'arrête là : ce qui est
 * assuré ici est le bloc, pas PhoneMachine.
 *
 * Trois choses se lisent différemment depuis l'extérieur d'un bloc :
 * `m.state` reste celui de l'hôte, l'état du bloc est dans `m.sbb`, et
 * la vue de l'appel est dans le contexte *partagé* (`ctx.call`) — le
 * bloc y écrit directement, il ne tient pas de miroir.
 */
import { describe, expect, it, vi } from "vitest";
import { defineMachine, goto } from "finite-state-language";
import { CallBlock, type CallData, type CallHost } from "../src/machines/call.js";
import type { CallReturn, PhoneEvent } from "../src/machines/events.js";
import type {
  CallMedia,
  CallSession,
  CallSipEvent,
  IncomingCall,
  RejectReason,
  SipHandle,
} from "../src/sip/port.js";
import type { TraceLine } from "../src/sip/record.js";
import type { MediaStats } from "../src/sip/stats.js";

class FakeSession implements CallSession {
  terminated = 0;
  mic: boolean[] = [];
  cam: boolean[] = [];
  terminate(): void {
    this.terminated++;
  }
  setMicMuted(m: boolean): void {
    this.mic.push(m);
  }
  setCamMuted(m: boolean): void {
    this.cam.push(m);
  }
  attachMedia(): void {}
  /** Le bilan média que le port aurait mesuré si la trace était active. */
  statsSummary: MediaStats | null = null;
  mediaStats(): MediaStats | null {
    return this.statsSummary;
  }
  callStats(): MediaStats | null {
    return this.statsSummary;
  }
  /** Le carnet de l'appel : ce que le port aurait collecté si la trace était active. */
  traceLines: TraceLine[] = [];
  trace(): TraceLine[] {
    return this.traceLines;
  }
}

function fakeHandle(opts: { throwOnCall?: string } = {}) {
  const session = new FakeSession();
  const box = {
    session,
    calls: [] as { target: string; media: CallMedia }[],
    sendCall: (() => {}) as (ev: CallSipEvent) => void,
  };
  const handle: SipHandle = {
    stop: () => {},
    refresh: () => true,
    call(target, media, send) {
      if (opts.throwOnCall) throw new Error(opts.throwOnCall);
      box.calls.push({ target, media });
      box.sendCall = send;
      return session;
    },
  };
  return { handle, box };
}

/** INVITE entrant factice : mêmes points de contrôle que le port JsSIP. */
function fakeIncoming(offered: CallMedia = { audio: true, video: false }) {
  const session = new FakeSession();
  const box = {
    session,
    answered: [] as CallMedia[],
    rejected: [] as RejectReason[],
    sendCall: (() => {}) as (ev: CallSipEvent) => void,
  };
  const incoming: IncomingCall = {
    from: "sip:bob@example.fr",
    displayName: "Bob Martin",
    offered,
    listen(send) {
      box.sendCall = send;
      return session;
    },
    answer(media) {
      box.answered.push(media);
    },
    reject(reason) {
      box.rejected.push(reason);
    },
  };
  return { incoming, box };
}

interface HostCtx extends CallHost {
  /** Ce que le bloc a rapporté, dans l'ordre. */
  outcomes: CallReturn[];
}

/** Un hôte qui n'a rien d'autre à faire que d'entrer le bloc et de le regarder revenir. */
function hostOf(args: Partial<CallData>, handle: SipHandle | null) {
  const keep = (ev: CallReturn, ctx: HostCtx) => {
    ctx.outcomes.push(ev);
    return goto("after");
  };
  return defineMachine<HostCtx, PhoneEvent>()({
    name: "TestHost",
    context: () => ({
      handle,
      call: null,
      lastError: null,
      lastErrorCode: null,
      suspectFields: null,
      sleepRequested: false,
      outcomes: [],
    }),
    states: {
      initial_state: {
        enter(_ctx, fx) {
          fx.sbb(CallBlock, { args });
        },
        on: {
          "call:answered": keep,
          "call:dropped": keep,
          "call:rejected": keep,
          "call:canceled": keep,
          "call:missed": keep,
        },
      },
      after: {},
    },
  });
}

function startCall(handle: SipHandle, video = false) {
  return hostOf(
    { target: "sip:bob@example.fr", media: { audio: true, video }, direction: "outgoing" },
    handle,
  ).start();
}

function startIncoming(incoming: IncomingCall) {
  return hostOf({ incoming, direction: "incoming" }, null).start();
}

/** L'outcome unique attendu du bloc, `type` et `data` réunis. */
function outcome(m: { context: HostCtx }): CallReturn {
  expect(m.context.outcomes).toHaveLength(1);
  return m.context.outcomes[0] as CallReturn;
}

describe("CallBlock — appel sortant", () => {
  it("dialing → ringing → connected → ended : answered", async () => {
    const { handle, box } = fakeHandle();
    const call = startCall(handle);
    expect(box.calls).toEqual([
      { target: "sip:bob@example.fr", media: { audio: true, video: false } },
    ]);
    // l'hôte n'a pas bougé : c'est un appel de sous-routine, pas un état
    expect(call.state).toBe("initial_state");
    expect(call.sbb?.block).toBe("CallBlock");
    expect(call.sbb?.state).toBe("dialing");

    box.sendCall({ type: "sip:progress" });
    expect(call.sbb?.state).toBe("ringing");
    box.sendCall({ type: "sip:accepted" });
    expect(call.sbb?.state).toBe("connected");
    // la vue vit dans le contexte de l'hôte, écrite par le bloc
    expect(call.context.call?.connectedAt).not.toBeNull();

    box.sendCall({ type: "sip:ended", cause: "BYE" });
    expect(call.state).toBe("after");
    expect(call.sbb).toBeUndefined();
    expect(outcome(call)).toMatchObject({
      type: "call:answered",
      data: { endedBy: "remote", media: { audio: true, video: false } },
    });
    await Promise.resolve();
  });

  it("réponse directe 200 OK sans 180 : dialing → connected", () => {
    const { handle, box } = fakeHandle();
    const call = startCall(handle);
    box.sendCall({ type: "sip:accepted" });
    expect(call.sbb?.state).toBe("connected");
  });

  it("échec en sonnerie : rejected avec cause et code SIP", () => {
    const { handle, box } = fakeHandle();
    const call = startCall(handle);
    box.sendCall({ type: "sip:progress" });
    box.sendCall({ type: "sip:failed", cause: "Rejected", statusCode: 603 });
    expect(outcome(call)).toEqual({
      type: "call:rejected",
      data: { reason: { key: "reason.sip", vars: { cause: "Rejected", code: 603 } } },
    });
  });

  it("cible rejetée par JsSIP (throw) : rejected immédiat", () => {
    const { handle } = fakeHandle({ throwOnCall: "INVALID_TARGET" });
    const call = startCall(handle);
    expect(outcome(call)).toEqual({
      type: "call:rejected",
      data: { reason: { key: "reason.callFailed", vars: { detail: "INVALID_TARGET" } } },
    });
  });

  it("pas de réponse après 90 s de sonnerie : terminate + rejected", async () => {
    vi.useFakeTimers();
    try {
      const { handle, box } = fakeHandle();
      const call = startCall(handle);
      box.sendCall({ type: "sip:progress" });
      await vi.advanceTimersByTimeAsync(90_000);
      expect(box.session.terminated).toBeGreaterThanOrEqual(1);
      expect(outcome(call)).toEqual({
        type: "call:rejected",
        data: { reason: { key: "reason.noAnswer" } },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("raccrochage sans confirmation JsSIP : answered forcé après 2 s", async () => {
    vi.useFakeTimers();
    try {
      const { handle, box } = fakeHandle();
      const call = startCall(handle);
      box.sendCall({ type: "sip:accepted" });
      call.send({ type: "ui:hangup" });
      expect(call.sbb?.state).toBe("hangingup");
      expect(box.session.terminated).toBe(1);
      await vi.advanceTimersByTimeAsync(2000);
      expect(outcome(call)).toMatchObject({
        type: "call:answered",
        data: { endedBy: "local" },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("mutes en communication : vue publiée + action session, état inchangé", () => {
    const { handle, box } = fakeHandle();
    const call = startCall(handle, true);
    box.sendCall({ type: "sip:accepted" });
    call.send({ type: "ui:muteMic" });
    call.send({ type: "ui:muteCam" });
    call.send({ type: "ui:toggleSelfView" });
    expect(call.sbb?.state).toBe("connected");
    expect(call.context.call?.micMuted).toBe(true);
    expect(call.context.call?.camMuted).toBe(true);
    expect(call.context.call?.selfViewHidden).toBe(true);
    expect(box.session.mic).toEqual([true]);
    expect(box.session.cam).toEqual([true]);
  });

  it("annulation pendant dialing : CANCEL puis canceled au sip:failed", () => {
    const { handle, box } = fakeHandle();
    const call = startCall(handle);
    call.send({ type: "ui:hangup" });
    expect(call.sbb?.state).toBe("hangingup");
    expect(box.session.terminated).toBe(1);
    box.sendCall({ type: "sip:failed", cause: "Canceled" });
    expect(outcome(call)).toEqual({
      type: "call:canceled",
      data: { reason: { key: "reason.hungUp" } },
    });
  });
});

describe("CallBlock — appel entrant", () => {
  it("démarre en sonnerie avec l'identité et les médias proposés", () => {
    const { incoming } = fakeIncoming({ audio: true, video: true });
    const call = startIncoming(incoming);
    expect(call.sbb?.state).toBe("ringing_in");
    const view = call.context.call!;
    expect(view.direction).toBe("incoming");
    expect(view.target).toBe("sip:bob@example.fr");
    expect(view.displayName).toBe("Bob Martin");
    expect(view.offered).toEqual({ audio: true, video: true });
  });

  it("réponse A/V : 200 OK avec les médias choisis, puis connected", () => {
    const { incoming, box } = fakeIncoming({ audio: true, video: true });
    const call = startIncoming(incoming);
    call.send({ type: "ui:answer", media: { audio: true, video: true } });
    expect(box.answered).toEqual([{ audio: true, video: true }]);
    expect(call.sbb?.state).toBe("answering");
    box.sendCall({ type: "sip:accepted" });
    expect(call.sbb?.state).toBe("connected");
    expect(call.context.call?.connectedAt).not.toBeNull();
  });

  it("réponse audio seul à une offre vidéo : la vidéo n'est pas acceptée", () => {
    const { incoming, box } = fakeIncoming({ audio: true, video: true });
    const call = startIncoming(incoming);
    call.send({ type: "ui:answer", media: { audio: true, video: false } });
    expect(box.answered).toEqual([{ audio: true, video: false }]);
    expect(call.context.call?.media).toEqual({ audio: true, video: false });
  });

  it("ACK sans accepted préalable : connected quand même", () => {
    const { incoming, box } = fakeIncoming();
    const call = startIncoming(incoming);
    call.send({ type: "ui:answer", media: { audio: true, video: false } });
    box.sendCall({ type: "sip:confirmed" });
    expect(call.sbb?.state).toBe("connected");
  });

  it("refus : 603 Decline et sortie en missed (refusé, pas un échec)", () => {
    const { incoming, box } = fakeIncoming();
    const call = startIncoming(incoming);
    call.send({ type: "ui:reject" });
    expect(box.rejected).toEqual(["declined"]);
    expect(outcome(call)).toEqual({
      type: "call:missed",
      data: { reason: { key: "reason.declined" }, failed: false },
    });
  });

  it("annulation par l'appelant : appel manqué, sans refus émis", () => {
    const { incoming, box } = fakeIncoming();
    const call = startIncoming(incoming);
    box.sendCall({ type: "sip:failed", cause: "Canceled", originator: "remote" });
    expect(box.rejected).toEqual([]);
    expect(outcome(call)).toEqual({
      type: "call:missed",
      data: { reason: { key: "reason.missed" }, failed: false },
    });
  });

  it("sans réponse après 60 s : 480 et appel manqué", async () => {
    vi.useFakeTimers();
    try {
      const { incoming, box } = fakeIncoming();
      const call = startIncoming(incoming);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(box.rejected).toEqual(["timeout"]);
      expect(outcome(call)).toEqual({
        type: "call:missed",
        data: { reason: { key: "reason.missedNoAnswer" }, failed: false },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("échec après réponse (média refusé) : manqué avec la cause", () => {
    const { incoming, box } = fakeIncoming();
    const call = startIncoming(incoming);
    call.send({ type: "ui:answer", media: { audio: true, video: false } });
    box.sendCall({ type: "sip:failed", cause: "User Denied Media Access", originator: "local" });
    // un échec technique après décrochage : la même ligne d'historique
    // qu'un manqué, mais l'écran doit en montrer la cause
    expect(outcome(call)).toEqual({
      type: "call:missed",
      data: {
        reason: { key: "misc.raw", vars: { text: "User Denied Media Access" } },
        failed: true,
      },
    });
  });

  it("raccrochage en communication depuis un entrant : BYE puis answered", () => {
    const { incoming, box } = fakeIncoming();
    const call = startIncoming(incoming);
    call.send({ type: "ui:answer", media: { audio: true, video: false } });
    box.sendCall({ type: "sip:accepted" });
    call.send({ type: "ui:hangup" });
    expect(call.sbb?.state).toBe("hangingup");
    expect(box.session.terminated).toBe(1);
    box.sendCall({ type: "sip:ended", cause: "BYE" });
    expect(outcome(call)).toMatchObject({ type: "call:answered", data: { endedBy: "local" } });
  });
});

describe("CallBlock — ce que le bloc consomme pour son hôte", () => {
  it("perte du proxy : raccroche, laisse l'erreur dans le contexte, rapporte dropped", () => {
    const { handle, box } = fakeHandle();
    const call = startCall(handle);
    box.sendCall({ type: "sip:accepted" });
    call.send({ type: "sip:disconnected" });
    expect(box.session.terminated).toBe(1);
    // l'hôte est suspendu : c'est le bloc qui a écrit dans son contexte
    expect(call.context.lastError).toEqual({ key: "error.proxyLostDuringCall" });
    expect(call.context.suspectFields).toBe("proxy");
    box.sendCall({ type: "sip:ended", cause: "BYE" });
    expect(outcome(call)).toMatchObject({ type: "call:dropped" });
  });

  it("veille : raccroche et pose sleepRequested chez l'hôte", () => {
    const { handle, box } = fakeHandle();
    const call = startCall(handle);
    box.sendCall({ type: "sip:accepted" });
    call.send({ type: "sys:sleep" });
    expect(call.context.sleepRequested).toBe(true);
    box.sendCall({ type: "sip:ended", cause: "BYE" });
    expect(outcome(call)).toMatchObject({ type: "call:answered" });
  });

  it("enregistrement perdu pendant l'appel : noté chez l'hôte, l'appel continue", () => {
    const { handle, box } = fakeHandle();
    const call = startCall(handle);
    box.sendCall({ type: "sip:accepted" });
    call.send({ type: "sip:registrationFailed", cause: "Timeout", statusCode: 408 });
    expect(call.context.lastError).toEqual({
      key: "error.regLost",
      vars: { cause: "Timeout" },
    });
    expect(call.sbb?.state).toBe("connected");
    expect(call.pending).toEqual([]); // rien n'est resté en attente
  });

  it("second INVITE pendant l'appel : occupé", () => {
    const { handle, box } = fakeHandle();
    const call = startCall(handle);
    box.sendCall({ type: "sip:accepted" });
    const { incoming, box: second } = fakeIncoming();
    call.send({ type: "sip:incoming", call: incoming });
    expect(second.rejected).toEqual(["busy"]);
    expect(call.sbb?.state).toBe("connected");
  });

  it("un arrêt coopératif referme la session : le cleanup du bloc", async () => {
    const { handle, box } = fakeHandle();
    const call = startCall(handle);
    box.sendCall({ type: "sip:accepted" });
    await call.shutdown("test");
    expect(box.session.terminated).toBe(1);
    expect(call.context.call).toBeNull();
  });
});
