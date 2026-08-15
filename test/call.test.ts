/**
 * CallMachine standalone (sans parent : notifyParent est un no-op FSL),
 * pilotée contre une SipHandle factice — timeouts inclus (fake timers).
 */
import { describe, expect, it, vi } from "vitest";
import { CallMachine } from "../src/machines/call.js";
import type { CallMedia, CallSession, CallSipEvent, SipHandle } from "../src/sip/port.js";

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
    call(target, media, send) {
      if (opts.throwOnCall) throw new Error(opts.throwOnCall);
      box.calls.push({ target, media });
      box.sendCall = send;
      return session;
    },
  };
  return { handle, box };
}

function startCall(handle: SipHandle, video = false) {
  return CallMachine.start({
    args: { handle, target: "sip:bob@example.fr", media: { audio: true, video } },
  });
}

describe("CallMachine — appel sortant", () => {
  it("dialing → ringing → connected → ended : success", async () => {
    const { handle, box } = fakeHandle();
    const call = startCall(handle);
    expect(box.calls).toEqual([
      { target: "sip:bob@example.fr", media: { audio: true, video: false } },
    ]);
    expect(call.state).toBe("initial_state"); // dialing

    box.sendCall({ type: "sip:progress" });
    expect(call.state).toBe("ringing");
    box.sendCall({ type: "sip:accepted" });
    expect(call.state).toBe("connected");
    expect(call.context.connectedAt).not.toBeNull();

    box.sendCall({ type: "sip:ended", cause: "BYE" });
    expect(await call.done).toEqual({ outcome: "success", reason: "BYE" });
  });

  it("réponse directe 200 OK sans 180 : dialing → connected", () => {
    const { handle, box } = fakeHandle();
    const call = startCall(handle);
    box.sendCall({ type: "sip:accepted" });
    expect(call.state).toBe("connected");
  });

  it("échec en sonnerie : failure avec cause et code SIP", async () => {
    const { handle, box } = fakeHandle();
    const call = startCall(handle);
    box.sendCall({ type: "sip:progress" });
    box.sendCall({ type: "sip:failed", cause: "Rejected", statusCode: 603 });
    expect(await call.done).toEqual({ outcome: "failure", reason: "Rejected (SIP 603)" });
  });

  it("cible rejetée par JsSIP (throw) : failure immédiate", async () => {
    const { handle } = fakeHandle({ throwOnCall: "INVALID_TARGET" });
    const call = startCall(handle);
    expect(await call.done).toEqual({ outcome: "failure", reason: "INVALID_TARGET" });
  });

  it("pas de réponse après 90 s de sonnerie : terminate + failure", async () => {
    vi.useFakeTimers();
    try {
      const { handle, box } = fakeHandle();
      const call = startCall(handle);
      box.sendCall({ type: "sip:progress" });
      await vi.advanceTimersByTimeAsync(90_000);
      expect(box.session.terminated).toBeGreaterThanOrEqual(1);
      expect(await call.done).toEqual({ outcome: "failure", reason: "Pas de réponse" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("raccrochage sans confirmation JsSIP : success forcé après 2 s", async () => {
    vi.useFakeTimers();
    try {
      const { handle, box } = fakeHandle();
      const call = startCall(handle);
      box.sendCall({ type: "sip:accepted" });
      call.send({ type: "ui:hangup" });
      expect(call.state).toBe("hangingup");
      expect(box.session.terminated).toBe(1);
      await vi.advanceTimersByTimeAsync(2000);
      expect(await call.done).toEqual({ outcome: "success", reason: "raccroché (forcé)" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("mutes en communication : mutation contexte + action session, état inchangé", () => {
    const { handle, box } = fakeHandle();
    const call = startCall(handle, true);
    box.sendCall({ type: "sip:accepted" });
    call.send({ type: "ui:muteMic" });
    call.send({ type: "ui:muteCam" });
    call.send({ type: "ui:toggleSelfView" });
    expect(call.state).toBe("connected");
    expect(call.context.micMuted).toBe(true);
    expect(call.context.camMuted).toBe(true);
    expect(call.context.selfViewHidden).toBe(true);
    expect(box.session.mic).toEqual([true]);
    expect(box.session.cam).toEqual([true]);
  });

  it("annulation pendant dialing : CANCEL puis success au sip:failed", async () => {
    const { handle, box } = fakeHandle();
    const call = startCall(handle);
    call.send({ type: "ui:hangup" });
    expect(call.state).toBe("hangingup");
    expect(box.session.terminated).toBe(1);
    box.sendCall({ type: "sip:failed", cause: "Canceled" });
    expect(await call.done).toEqual({ outcome: "success", reason: "raccroché" });
  });
});
