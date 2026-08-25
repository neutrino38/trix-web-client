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
  MediaKind,
  RejectReason,
  SipHandle,
} from "../src/sip/port.js";
import { MEDIA_KINDS } from "../src/sip/port.js";
import type { TraceLine } from "../src/sip/record.js";
import type { MediaStats } from "../src/sip/stats.js";

class FakeSession implements CallSession {
  terminated = 0;
  /** Les ajouts et retraits de média demandés par re-INVITE, dans l'ordre. */
  asked: { kind: MediaKind; on: boolean }[] = [];
  terminate(): void {
    this.terminated++;
  }
  setMedia(kind: MediaKind, on: boolean): void {
    this.asked.push({ kind, on });
  }
  /** Ce qui a été demandé pour un média donné — le raccourci des tests. */
  askedFor(kind: MediaKind): boolean[] {
    return this.asked.filter((a) => a.kind === kind).map((a) => a.on);
  }
  /** Les pauses demandées, dans l'ordre : rien ne part sur le fil pour elles. */
  pauses: boolean[] = [];
  setPaused(on: boolean): void {
    this.pauses.push(on);
  }
  /** Les tonalités reçues par le port, et ce qu'il en fait (cf. `dtmfFails`). */
  tones: string[] = [];
  /** Le port refuse d'émettre : pas de piste audio, session en train de finir. */
  dtmfFails = false;
  sendDtmf(tone: string): boolean {
    if (this.dtmfFails) return false;
    this.tones.push(tone);
    return true;
  }
  attachMedia(): void {}
  /** Le lien texte : hors sujet pour ces tests, la session n'en ouvre pas. */
  rtt(): null {
    return null;
  }
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
function fakeIncoming(
  offered: CallMedia = { audio: true, video: false, text: false },
  offerProblem: string | null = null,
) {
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
    offerProblem,
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
    { target: "sip:bob@example.fr", media: { audio: true, video, text: false }, direction: "outgoing" },
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
      { target: "sip:bob@example.fr", media: { audio: true, video: false, text: false } },
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
      data: { endedBy: "remote", media: { audio: true, video: false, text: false } },
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

  it("self-view en communication : vue publiée, état inchangé", () => {
    const { handle, box } = fakeHandle();
    const call = startCall(handle, true);
    box.sendCall({ type: "sip:accepted" });
    call.send({ type: "ui:toggleSelfView" });
    expect(call.sbb?.state).toBe("connected");
    expect(call.context.call?.selfViewHidden).toBe(true);
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
    const { incoming } = fakeIncoming({ audio: true, video: true, text: false });
    const call = startIncoming(incoming);
    expect(call.sbb?.state).toBe("ringing_in");
    const view = call.context.call!;
    expect(view.direction).toBe("incoming");
    expect(view.target).toBe("sip:bob@example.fr");
    expect(view.displayName).toBe("Bob Martin");
    expect(view.offered).toEqual({ audio: true, video: true, text: false });
  });

  it("réponse A/V : 200 OK avec les médias choisis, puis connected", () => {
    const { incoming, box } = fakeIncoming({ audio: true, video: true, text: false });
    const call = startIncoming(incoming);
    call.send({ type: "ui:answer", media: { audio: true, video: true, text: false } });
    expect(box.answered).toEqual([{ audio: true, video: true, text: false }]);
    expect(call.sbb?.state).toBe("answering");
    box.sendCall({ type: "sip:accepted" });
    expect(call.sbb?.state).toBe("connected");
    expect(call.context.call?.connectedAt).not.toBeNull();
  });

  it("réponse audio seul à une offre vidéo : la vidéo n'est pas acceptée", () => {
    const { incoming, box } = fakeIncoming({ audio: true, video: true, text: false });
    const call = startIncoming(incoming);
    call.send({ type: "ui:answer", media: { audio: true, video: false, text: false } });
    expect(box.answered).toEqual([{ audio: true, video: false, text: false }]);
    expect(call.context.call?.media).toEqual({ audio: true, video: false, text: false });
  });

  it("ACK sans accepted préalable : connected quand même", () => {
    const { incoming, box } = fakeIncoming();
    const call = startIncoming(incoming);
    call.send({ type: "ui:answer", media: { audio: true, video: false, text: false } });
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

  it("offre inétablissable : 488 sans sonnerie, et l'échec part en historique", () => {
    const { incoming, box } = fakeIncoming({ audio: true, video: true, text: false }, "ICE, DTLS, SRTP (RTP/AVP)");
    const call = startIncoming(incoming);
    // le téléphone n'a jamais sonné : le bloc rend la main depuis l'aiguillage
    expect(box.rejected).toEqual(["incompatible"]);
    expect(outcome(call)).toEqual({
      type: "call:missed",
      data: {
        reason: {
          key: "reason.offerUnsupported",
          vars: { detail: "ICE, DTLS, SRTP (RTP/AVP)" },
        },
        failed: true,
      },
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
    call.send({ type: "ui:answer", media: { audio: true, video: false, text: false } });
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

  it("488 après décrochage : le motif porte ce que le navigateur a refusé", () => {
    const { incoming, box } = fakeIncoming();
    const call = startIncoming(incoming);
    call.send({ type: "ui:answer", media: { audio: true, video: false, text: false } });
    box.sendCall({
      type: "sip:failed",
      cause: "WebRTC Error",
      statusCode: 488,
      originator: "system",
      detail: "setRemoteDescription : OperationError: SDP sans ice-ufrag",
    });
    // « WebRTC Error (SIP 488) » ne dit rien de réparable : c'est le détail
    // du navigateur qui nomme la vraie cause, et il part dans l'historique
    expect(outcome(call)).toEqual({
      type: "call:missed",
      data: {
        reason: {
          key: "reason.sip",
          vars: {
            cause: "WebRTC Error — setRemoteDescription : OperationError: SDP sans ice-ufrag",
            code: 488,
          },
        },
        failed: true,
      },
    });
  });

  it("raccrochage en communication depuis un entrant : BYE puis answered", () => {
    const { incoming, box } = fakeIncoming();
    const call = startIncoming(incoming);
    call.send({ type: "ui:answer", media: { audio: true, video: false, text: false } });
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

/**
 * Négociation de la vidéo (docs/CONCEPTION.md §4.4). En conversation totale, la
 * vidéo n'est pas une sourdine locale : elle entre dans l'appel ou en sort,
 * et les deux correspondants voient la même chose.
 */
describe("CallBlock — les médias entrent et sortent de l'appel", () => {
  /** Un appel établi, avec les médias que le port dit avoir négociés. */
  function connectedCall(asked: boolean, negotiated = asked) {
    const { handle, box } = fakeHandle();
    const call = startCall(handle, asked);
    box.sendCall({ type: "sip:mediaChanged", media: { audio: true, video: negotiated, text: false } });
    box.sendCall({ type: "sip:accepted" });
    return { call, box };
  }

  it("appel vidéo décroché en audio : la vue repasse en audio et le dit", () => {
    const { call } = connectedCall(true, false);
    expect(call.sbb?.state).toBe("connected");
    const view = call.context.call!;
    expect(view.media).toEqual({ audio: true, video: false, text: false });
    expect(view.notice?.message).toEqual({
      key: "notice.videoDeclined",
      vars: { peer: "bob@example.fr" },
    });
  });

  it("appel vidéo décroché en vidéo : rien à signaler", () => {
    const { call } = connectedCall(true);
    expect(call.context.call?.media).toEqual({ audio: true, video: true, text: false });
    expect(call.context.call?.notice).toBeNull();
  });

  it("ajout de la vidéo : re-INVITE, attente, puis vue à jour", () => {
    const { call, box } = connectedCall(false);
    call.send({ type: "ui:toggleMedia", kind: "video" });
    expect(box.session.askedFor("video")).toEqual([true]);
    expect(call.sbb?.state).toBe("renegotiating");
    expect(call.context.call?.mediaPending).toBe(true);

    box.sendCall({ type: "sip:mediaChanged", media: { audio: true, video: true, text: false } });
    expect(call.sbb?.state).toBe("connected");
    expect(call.context.call?.media).toEqual({ audio: true, video: true, text: false });
    expect(call.context.call?.mediaPending).toBe(false);
  });

  it("retrait de la vidéo : re-INVITE dans l'autre sens", () => {
    const { call, box } = connectedCall(true);
    call.send({ type: "ui:toggleMedia", kind: "video" });
    expect(box.session.askedFor("video")).toEqual([false]);
    box.sendCall({ type: "sip:mediaChanged", media: { audio: true, video: false, text: false } });
    expect(call.context.call?.media).toEqual({ audio: true, video: false, text: false });
  });

  it("488 du distant : message, appel intact, vidéo toujours absente", () => {
    const { call, box } = connectedCall(false);
    call.send({ type: "ui:toggleMedia", kind: "video" });
    box.sendCall({ type: "sip:mediaRefused", by: "remote", statusCode: 488 });
    expect(call.sbb?.state).toBe("connected");
    expect(call.context.call?.media).toEqual({ audio: true, video: false, text: false });
    expect(call.context.call?.notice?.message).toEqual({
      key: "notice.videoRefused",
      vars: { peer: "bob@example.fr" },
    });
  });

  it("refus local (caméra indisponible) : message local", () => {
    const { call, box } = connectedCall(false);
    call.send({ type: "ui:toggleMedia", kind: "video" });
    box.sendCall({ type: "sip:mediaRefused", by: "local" });
    expect(call.context.call?.notice?.message).toEqual({ key: "notice.videoUnavailable" });
  });

  it("un second clic pendant la renégociation ne part pas", () => {
    const { call, box } = connectedCall(false);
    call.send({ type: "ui:toggleMedia", kind: "video" });
    call.send({ type: "ui:toggleMedia", kind: "video" });
    expect(box.session.askedFor("video")).toEqual([true]);
  });

  it("renégociation sans réponse : l'appel continue au bout de 30 s", async () => {
    vi.useFakeTimers();
    try {
      const { call } = connectedCall(false);
      call.send({ type: "ui:toggleMedia", kind: "video" });
      // le délai couvre la reprise après un 491, qui peut demander jusqu'à
      // 4 s avant même de repartir (RFC 3261 §14.1)
      await vi.advanceTimersByTimeAsync(30_000);
      expect(call.sbb?.state).toBe("connected");
      expect(call.context.call?.mediaPending).toBe(false);
      expect(call.context.call?.notice?.message).toEqual({ key: "notice.videoUnavailable" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("raccrocher pendant une renégociation reste possible", () => {
    const { call, box } = connectedCall(false);
    call.send({ type: "ui:toggleMedia", kind: "video" });
    call.send({ type: "ui:hangup" });
    expect(call.sbb?.state).toBe("hangingup");
    expect(box.session.terminated).toBe(1);
  });

  /**
   * ADR 0003, D1. Le texte se déclare négocié quand la signalisation le
   * conclut — plus tard que l'audio sur canal de données, où l'association
   * SCTP est confirmée après le 200 OK. Ce n'est **pas** un changement
   * dont le correspondant est l'auteur : rien n'apparaît ni ne disparaît
   * sous les yeux de l'utilisateur, et l'écran n'a donc rien à annoncer.
   */
  it("le texte qui se déclare négocié rejoint la vue sans message fugace", () => {
    const { call, box } = connectedCall(false);
    expect(call.context.call?.media).toEqual({ audio: true, video: false, text: false });

    box.sendCall({ type: "sip:mediaChanged", media: { audio: true, video: false, text: true } });
    expect(call.sbb?.state).toBe("connected");
    expect(call.context.call?.media).toEqual({ audio: true, video: false, text: true });
    expect(call.context.call?.notice).toBeNull();
  });

  /**
   * L'ajout de la vidéo, lui, se dit — et le texte déjà là le reste : une
   * renégociation qui porte l'image ne touche pas au lien texte (D4, le
   * retrait du texte est interdit).
   */
  it("la vidéo entre dans un appel qui porte le texte sans l'en chasser", () => {
    const { handle, box } = fakeHandle();
    const call = startCall(handle, false);
    box.sendCall({ type: "sip:mediaChanged", media: { audio: true, video: false, text: true } });
    box.sendCall({ type: "sip:accepted" });

    call.send({ type: "ui:toggleMedia", kind: "video" });
    expect(box.session.askedFor("video")).toEqual([true]);
    box.sendCall({ type: "sip:mediaChanged", media: { audio: true, video: true, text: true } });
    expect(call.context.call?.media).toEqual({ audio: true, video: true, text: true });
  });
});

/**
 * **La matrice de D5**, le critère de sortie de CT-3 : l'ajout et le
 * retrait passent pour toutes les combinaisons de médias — A, V, T, AV, AT,
 * VT, AVT — refus et 491 compris.
 *
 * Ce n'est pas de la redondance avec les tests ci-dessus : ceux-là décrivent
 * le chemin d'un média, celle-ci vérifie qu'il n'y a **qu'un seul** chemin,
 * et qu'aucune combinaison n'en sort. L'asymétrie qui s'installerait entre
 * le micro et la caméra ne se verrait nulle part ailleurs.
 */
/**
 * **La Pause** (ADR 0003, D6 et D7) — l'axe 2, vu du bloc.
 *
 * Ce n'est pas un contrôle média : elle ne change rien à ce que l'appel
 * transporte, rien ne part sur le fil, et elle ne peut pas échouer. Trois
 * choses s'y vérifient, et ce sont les trois du critère de sortie de CT-4.
 */
describe("CallBlock — la Pause", () => {
  function connected(m: CallMedia = { audio: true, video: true, text: true }) {
    const { handle, box } = fakeHandle();
    const call = hostOf(
      { target: "sip:bob@example.fr", media: m, direction: "outgoing" },
      handle,
    ).start();
    box.sendCall({ type: "sip:mediaChanged", media: m });
    box.sendCall({ type: "sip:accepted" });
    return { call, box };
  }

  it("se pose et se lève sans quitter `connected` : rien ne se négocie", () => {
    const { call, box } = connected();
    call.send({ type: "ui:togglePause" });
    expect(call.sbb?.state).toBe("connected");
    expect(call.context.call?.paused).toBe(true);
    expect(box.session.pauses).toEqual([true]);

    call.send({ type: "ui:togglePause" });
    expect(call.context.call?.paused).toBe(false);
    expect(box.session.pauses).toEqual([true, false]);
    // et pas un seul re-INVITE dans tout cela
    expect(box.session.asked).toEqual([]);
  });

  /**
   * D7 : « la reprise rétablit les deux médias sans renégociation ». Ce que
   * l'appel transporte n'a pas bougé d'un iota pendant la pause — c'est
   * précisément ce qui la distingue d'un retrait de média.
   */
  it("l'appel transporte exactement la même chose pendant et après", () => {
    const full: CallMedia = { audio: true, video: true, text: true };
    const { call } = connected(full);
    call.send({ type: "ui:togglePause" });
    expect(call.context.call?.media).toEqual(full);
    call.send({ type: "ui:togglePause" });
    expect(call.context.call?.media).toEqual(full);
  });

  /**
   * D7 : « le texte passe dans les deux sens pendant toute la pause ». Le
   * bloc n'a rien à faire pour cela, et c'est la garantie : la Pause ne
   * touche qu'aux deux émetteurs de la connexion pair-à-pair, et le lien
   * texte vit ailleurs (§4.9). Ce que le test tient, c'est qu'on n'ait
   * jamais l'idée de l'y ajouter.
   */
  it("ne touche pas au lien texte, et `media.text` reste vrai", () => {
    const { call, box } = connected({ audio: true, video: false, text: true });
    call.send({ type: "ui:togglePause" });
    expect(call.context.call?.media.text).toBe(true);
    // le port n'a reçu qu'un ordre de pause, jamais rien sur le texte
    expect(box.session.pauses).toEqual([true]);
  });

  it("vaut aussi pendant une renégociation : se retirer n'attend pas un 200 OK", () => {
    const { call, box } = connected();
    call.send({ type: "ui:toggleMedia", kind: "video" });
    expect(call.sbb?.state).toBe("renegotiating");
    call.send({ type: "ui:togglePause" });
    expect(box.session.pauses).toEqual([true]);
    expect(call.context.call?.paused).toBe(true);
    // la renégociation suit son cours, sans que la pause l'ait dérangée
    expect(call.sbb?.state).toBe("renegotiating");
  });

  it("hors communication, il n'y a rien à suspendre", () => {
    const { handle, box } = fakeHandle();
    const call = startCall(handle);
    call.send({ type: "ui:togglePause" });
    expect(box.session.pauses).toEqual([]);
    expect(call.context.call?.paused).toBe(false);
  });

  describe("la pause du correspondant", () => {
    it("se publie dans la vue, sans que l'appel change de nature", () => {
      const { call, box } = connected();
      box.sendCall({ type: "sip:peerPaused", paused: true });
      expect(call.context.call?.peerPaused).toBe(true);
      expect(call.sbb?.state).toBe("connected");
      expect(call.context.call?.media).toEqual({ audio: true, video: true, text: true });

      box.sendCall({ type: "sip:peerPaused", paused: false });
      expect(call.context.call?.peerPaused).toBe(false);
    });

    it("ne suspend rien de ce que nous émettons : c'est lui qui s'est retiré", () => {
      const { call, box } = connected();
      box.sendCall({ type: "sip:peerPaused", paused: true });
      expect(call.context.call?.paused).toBe(false);
      expect(box.session.pauses).toEqual([]);
    });

    it("répétée, elle ne republie rien", () => {
      const { call, box } = connected();
      box.sendCall({ type: "sip:peerPaused", paused: true });
      const seq = call.context.call?.notice?.seq ?? 0;
      box.sendCall({ type: "sip:peerPaused", paused: true });
      expect(call.context.call?.notice?.seq ?? 0).toBe(seq);
    });
  });
});

describe("CallBlock — la matrice des ajouts et des retraits", () => {
  const media = (audio: boolean, video: boolean, text: boolean): CallMedia => ({
    audio,
    video,
    text,
  });

  /** Un appel établi transportant exactement ces médias. */
  function callWith(m: CallMedia) {
    const { handle, box } = fakeHandle();
    const call = hostOf(
      { target: "sip:bob@example.fr", media: m, direction: "outgoing" },
      handle,
    ).start();
    box.sendCall({ type: "sip:mediaChanged", media: m });
    box.sendCall({ type: "sip:accepted" });
    return { call, box };
  }

  /** Les sept combinaisons que Trix sait porter, nommées comme dans D3. */
  const PROFILES: [string, CallMedia][] = [
    ["A", media(true, false, false)],
    ["V", media(false, true, false)],
    ["T", media(false, false, true)],
    ["AV", media(true, true, false)],
    ["AT", media(true, false, true)],
    ["VT", media(false, true, true)],
    ["AVT", media(true, true, true)],
  ];

  describe("le retrait", () => {
    for (const [name, m] of PROFILES) {
      for (const kind of ["audio", "video"] as const) {
        if (!m[kind]) continue;
        const alone = !MEDIA_KINDS.some((k) => k !== kind && m[k]) && !m.text;
        it(`${name} : retirer ${kind} ${alone ? "est refusé — il ne resterait rien" : "part en re-INVITE"}`, () => {
          const { call, box } = callWith(m);
          call.send({ type: "ui:toggleMedia", kind });
          if (alone) {
            // l'invariant du bloc, et non un bouton grisé : l'événement
            // qui passerait quand même est refusé au même endroit
            expect(box.session.asked).toEqual([]);
            expect(call.sbb?.state).toBe("connected");
            expect(call.context.call?.media).toEqual(m);
            return;
          }
          expect(box.session.asked).toEqual([{ kind, on: false }]);
          expect(call.sbb?.state).toBe("renegotiating");
          box.sendCall({ type: "sip:mediaChanged", media: { ...m, [kind]: false } });
          expect(call.sbb?.state).toBe("connected");
          expect(call.context.call?.media).toEqual({ ...m, [kind]: false });
        });
      }
    }
  });

  describe("l'ajout", () => {
    for (const [name, m] of PROFILES) {
      for (const kind of ["audio", "video"] as const) {
        if (m[kind]) continue;
        it(`${name} : ajouter ${kind} part en re-INVITE et aboutit`, () => {
          const { call, box } = callWith(m);
          call.send({ type: "ui:toggleMedia", kind });
          expect(box.session.asked).toEqual([{ kind, on: true }]);
          box.sendCall({ type: "sip:mediaChanged", media: { ...m, [kind]: true } });
          expect(call.sbb?.state).toBe("connected");
          expect(call.context.call?.media).toEqual({ ...m, [kind]: true });
        });

        it(`${name} : ajouter ${kind} refusé par le distant laisse l'appel intact`, () => {
          const { call, box } = callWith(m);
          call.send({ type: "ui:toggleMedia", kind });
          box.sendCall({ type: "sip:mediaRefused", by: "remote", statusCode: 488 });
          expect(call.sbb?.state).toBe("connected");
          expect(call.context.call?.media).toEqual(m);
          expect(call.context.call?.notice?.message).toEqual({
            key: kind === "audio" ? "notice.audioRefused" : "notice.videoRefused",
            vars: { peer: "bob@example.fr" },
          });
        });
      }
    }
  });

  /**
   * Le 491 est absorbé **dans le port** : il y reprend une fois, après un
   * délai aléatoire (RFC 3261 §14.1). Du point de vue du bloc, il n'existe
   * donc pas — soit la reprise aboutit et le média change, soit elle échoue
   * et un `sip:mediaRefused` arrive. Ce que le bloc doit garantir, c'est
   * qu'il **attend** pendant tout ce temps, sans laisser partir une seconde
   * offre : un seul verrou, quel que soit le média (D5).
   */
  describe("le glare", () => {
    it("la reprise qui aboutit : le média change, et rien n'est parti deux fois", () => {
      const { call, box } = callWith(media(true, false, true));
      call.send({ type: "ui:toggleMedia", kind: "video" });
      // pendant la reprise, l'utilisateur s'impatiente sur les deux boutons
      call.send({ type: "ui:toggleMedia", kind: "video" });
      call.send({ type: "ui:toggleMedia", kind: "audio" });
      expect(box.session.asked).toEqual([{ kind: "video", on: true }]);
      expect(call.context.call?.mediaPending).toBe(true);

      box.sendCall({ type: "sip:mediaChanged", media: media(true, true, true) });
      expect(call.sbb?.state).toBe("connected");
      expect(call.context.call?.mediaPending).toBe(false);
    });

    it("la reprise qui échoue : l'appel continue, et le message le dit", () => {
      const { call, box } = callWith(media(true, false, true));
      call.send({ type: "ui:toggleMedia", kind: "audio" });
      expect(box.session.asked).toEqual([{ kind: "audio", on: false }]);
      // le port a repris une fois, puis renoncé
      box.sendCall({ type: "sip:mediaRefused", by: "local" });
      expect(call.sbb?.state).toBe("connected");
      expect(call.context.call?.media).toEqual(media(true, false, true));
      expect(call.context.call?.notice?.message).toEqual({ key: "notice.audioUnavailable" });
    });

    /**
     * Le distant renégocie pendant que notre offre est en vol : c'est
     * exactement la situation qui produit le 491 en sens inverse. Sa
     * demande est éconduite — la nôtre est déjà partie, la sienne
     * attendra son tour.
     */
    it("l'offre du distant qui croise la nôtre est éconduite, pas mise en attente", () => {
      const { call, box } = callWith(media(true, false, true));
      call.send({ type: "ui:toggleMedia", kind: "video" });
      const decisions: string[] = [];
      box.sendCall({
        type: "sip:mediaOffer",
        media: media(true, true, true),
        offer: {
          accept: () => decisions.push("accept"),
          reject: () => decisions.push("reject"),
        },
      });
      expect(decisions).toEqual(["reject"]);
      expect(call.sbb?.state).toBe("renegotiating");
    });
  });

  /**
   * D5 encore : le distant qui ajoute l'**audio** pose la même question que
   * celui qui ajoute la vidéo. Allumer un micro demande l'accord de son
   * propriétaire, et `video_offer` est devenu `media_offer` pour cela.
   */
  it("l'audio proposé par le distant passe par la même question que la vidéo", () => {
    const { call, box } = callWith(media(false, false, true));
    const decisions: string[] = [];
    box.sendCall({
      type: "sip:mediaOffer",
      media: media(true, false, true),
      offer: {
        accept: () => decisions.push("accept"),
        reject: () => decisions.push("reject"),
      },
    });
    expect(call.sbb?.state).toBe("media_offer");
    expect(call.context.call?.mediaAsked).toEqual(["audio"]);
    call.send({ type: "ui:acceptMedia" });
    expect(decisions).toEqual(["accept"]);
    expect(call.sbb?.state).toBe("renegotiating");
  });
});

describe("CallBlock — vidéo proposée par le distant", () => {
  /** Un appel audio établi et l'offre vidéo que le distant vient d'envoyer. */
  function offered() {
    const { handle, box } = fakeHandle();
    const call = startCall(handle);
    box.sendCall({ type: "sip:accepted" });
    const decisions: string[] = [];
    box.sendCall({
      type: "sip:mediaOffer",
      media: { audio: true, video: true, text: false },
      offer: {
        accept: () => decisions.push("accept"),
        reject: () => decisions.push("reject"),
      },
    });
    return { call, box, decisions };
  }

  it("la question est posée à l'écran, l'appel continue derrière", () => {
    const { call } = offered();
    expect(call.sbb?.state).toBe("media_offer");
    expect(call.context.call?.mediaAsked).toEqual(["video"]);
    expect(call.context.call?.state).toBe("connected");
  });

  it("acceptée : 200 OK puis attente du média négocié", () => {
    const { call, decisions } = offered();
    call.send({ type: "ui:acceptMedia" });
    expect(decisions).toEqual(["accept"]);
    expect(call.sbb?.state).toBe("renegotiating");
    expect(call.context.call?.mediaAsked).toBeNull();
  });

  it("refusée : 488 et message, l'appel reste en audio", () => {
    const { call, decisions } = offered();
    call.send({ type: "ui:rejectMedia" });
    expect(decisions).toEqual(["reject"]);
    expect(call.sbb?.state).toBe("connected");
    expect(call.context.call?.media).toEqual({ audio: true, video: false, text: false });
    expect(call.context.call?.notice?.message).toEqual({ key: "notice.videoDeclinedHere" });
  });

  it("sans réponse au bout de 25 s : refusée pour ne pas faire attendre l'appelant", async () => {
    vi.useFakeTimers();
    try {
      const { call, decisions } = offered();
      await vi.advanceTimersByTimeAsync(25_000);
      expect(decisions).toEqual(["reject"]);
      expect(call.sbb?.state).toBe("connected");
    } finally {
      vi.useRealTimers();
    }
  });

  it("une offre reçue hors communication est éconduite sur-le-champ", () => {
    const { handle, box } = fakeHandle();
    const call = startCall(handle);
    const decisions: string[] = [];
    box.sendCall({
      type: "sip:mediaOffer",
      media: { audio: true, video: true, text: false },
      offer: { accept: () => decisions.push("accept"), reject: () => decisions.push("reject") },
    });
    expect(decisions).toEqual(["reject"]);
    expect(call.sbb?.state).toBe("dialing");
  });
});

describe("CallBlock — raccrocher pendant une question de vidéo", () => {
  it("l'offre en suspens reçoit sa réponse avant le BYE", () => {
    const { handle, box } = fakeHandle();
    const call = startCall(handle);
    box.sendCall({ type: "sip:accepted" });
    const decisions: string[] = [];
    box.sendCall({
      type: "sip:mediaOffer",
      media: { audio: true, video: true, text: false },
      offer: { accept: () => decisions.push("accept"), reject: () => decisions.push("reject") },
    });
    call.send({ type: "ui:hangup" });
    expect(decisions).toEqual(["reject"]);
    expect(call.sbb?.state).toBe("hangingup");
  });
});

describe("CallBlock — DTMF", () => {
  /** Un appel établi, prêt à composer. */
  function connected() {
    const { handle, box } = fakeHandle();
    const call = startCall(handle);
    box.sendCall({ type: "sip:accepted" });
    return { call, box };
  }

  it("en communication : la tonalité part et rejoint l'écho de la vue", () => {
    const { call, box } = connected();
    call.send({ type: "ui:dtmf", tone: "4" });
    call.send({ type: "ui:dtmf", tone: "*" });
    expect(box.session.tones).toEqual(["4", "*"]);
    expect(call.context.call?.dtmfSent).toBe("4*");
    // composer ne fait pas bouger l'appel
    expect(call.sbb?.state).toBe("connected");
  });

  it("tonalité perdue : rien dans l'écho, un message le dit", () => {
    const { call, box } = connected();
    box.session.dtmfFails = true;
    call.send({ type: "ui:dtmf", tone: "7" });
    expect(box.session.tones).toEqual([]);
    expect(call.context.call?.dtmfSent).toBe("");
    expect(call.context.call?.notice?.message).toEqual({
      key: "notice.dtmfFailed",
      vars: { tone: "7" },
    });
  });

  it("l'écho ne garde que les dernières tonalités", () => {
    const { call } = connected();
    for (const tone of "0123456789") call.send({ type: "ui:dtmf", tone });
    for (const tone of "0123456789") call.send({ type: "ui:dtmf", tone });
    for (const tone of "0123456789") call.send({ type: "ui:dtmf", tone });
    for (const tone of "01") call.send({ type: "ui:dtmf", tone });
    const sent = call.context.call?.dtmfSent ?? "";
    expect(sent).toHaveLength(32);
    expect(sent.endsWith("678901")).toBe(true);
  });

  it("une renégociation en vol n'empêche pas de composer", () => {
    const { call, box } = connected();
    call.send({ type: "ui:toggleMedia", kind: "video" });
    expect(call.sbb?.state).toBe("renegotiating");
    call.send({ type: "ui:dtmf", tone: "1" });
    expect(box.session.tones).toEqual(["1"]);
    expect(call.sbb?.state).toBe("renegotiating");
  });

  it("hors communication : la touche est consommée, rien n'est émis", () => {
    const { handle, box } = fakeHandle();
    const call = startCall(handle);
    box.sendCall({ type: "sip:progress" });
    call.send({ type: "ui:dtmf", tone: "5" });
    expect(box.session.tones).toEqual([]);
    expect(call.sbb?.state).toBe("ringing");
  });
});
