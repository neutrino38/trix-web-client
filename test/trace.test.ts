/**
 * La trace des paquets SIP : ce qui doit paraître sur la console, ce qui
 * ne doit pas, et — surtout — ce que l'enveloppe ne doit pas casser.
 *
 * Un socket enveloppé reste un socket : JsSIP continue d'y poser son
 * `ondata`, d'y lire `via_transport` et de croire au booléen que `send`
 * lui rend. Une trace qui avalerait un paquet ou perdrait un accesseur
 * ferait bien pire que ne rien tracer du tout.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  setSipTrace,
  sipTraceEnabled,
  traceCallStates,
  traceSocket,
  type TraceSink,
} from "../src/sip/trace.js";
import { openCallTrace, resetCallTraces } from "../src/sip/record.js";

/** localStorage minimal : le réglage de la trace y vit. */
function stubStorage(): void {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => data.set(k, v),
      removeItem: (k: string) => data.delete(k),
    },
  });
}

function fakeSink() {
  const lines: string[] = [];
  const sink: TraceSink = {
    group: (label) => lines.push(`> ${label}`),
    line: (text) => lines.push(text),
    groupEnd: () => lines.push("<"),
  };
  return { sink, lines };
}

/** Un socket JsSIP en réduction : ce que le Transport touche, et rien d'autre. */
function fakeSocket() {
  const sent: unknown[] = [];
  const socket = {
    get via_transport(): string {
      return "WSS";
    },
    send(message: unknown): boolean {
      sent.push(message);
      return true;
    },
    ondata(_data: unknown): void {},
  };
  return { socket, sent };
}

const REGISTER = "REGISTER sip:example.fr SIP/2.0\r\nVia: SIP/2.0/WSS 1.2.3.4\r\n\r\n";
const UNAUTHORIZED = "SIP/2.0 401 Unauthorized\r\nCSeq: 1 REGISTER\r\n\r\n";

beforeEach(() => {
  stubStorage();
  resetCallTraces();
});

describe("réglage de la trace", () => {
  it("est éteinte par défaut, et se rallume d'un appel", () => {
    expect(sipTraceEnabled()).toBe(false);
    setSipTrace(true);
    expect(sipTraceEnabled()).toBe(true);
    setSipTrace(false);
    expect(sipTraceEnabled()).toBe(false);
  });
});

describe("socket enveloppé", () => {
  it("laisse passer les paquets et le booléen de send, trace éteinte", () => {
    const { socket, sent } = fakeSocket();
    const { sink, lines } = fakeSink();
    const received: unknown[] = [];

    traceSocket(socket, sink);
    socket.ondata = (data) => received.push(data);

    expect(socket.send(REGISTER)).toBe(true);
    socket.ondata(UNAUTHORIZED);

    expect(sent).toEqual([REGISTER]);
    expect(received).toEqual([UNAUTHORIZED]);
    expect(lines).toEqual([]);
  });

  it("garde les accesseurs du socket d'origine", () => {
    const { socket } = fakeSocket();
    const { sink } = fakeSink();
    expect(traceSocket(socket, sink)).toBe(socket);
    expect(socket.via_transport).toBe("WSS");
  });

  it("trace les deux sens, entête visible et paquet déplié", () => {
    const { socket } = fakeSocket();
    const { sink, lines } = fakeSink();
    setSipTrace(true);

    traceSocket(socket, sink);
    socket.ondata = () => {};
    socket.send(REGISTER);
    socket.ondata(UNAUTHORIZED);

    expect(lines).toEqual([
      "> [trix] SIP → REGISTER sip:example.fr SIP/2.0",
      REGISTER,
      "<",
      "> [trix] SIP ← SIP/2.0 401 Unauthorized",
      UNAUTHORIZED,
      "<",
    ]);
  });

  it("s'allume et s'éteint en cours de route, sans rouvrir le socket", () => {
    const { socket } = fakeSocket();
    const { sink, lines } = fakeSink();

    traceSocket(socket, sink);
    socket.send(REGISTER); // éteinte
    setSipTrace(true);
    socket.send(REGISTER); // allumée
    setSipTrace(false);
    socket.send(REGISTER); // éteinte de nouveau

    expect(lines.filter((l) => l.startsWith(">"))).toHaveLength(1);
  });

  it("compacte les keep-alive plutôt que d'ouvrir un groupe vide", () => {
    const { socket } = fakeSocket();
    const { sink, lines } = fakeSink();
    setSipTrace(true);

    traceSocket(socket, sink);
    socket.send("\r\n\r\n");

    expect(lines).toEqual(["[trix] SIP → keep-alive"]);
  });

  it("décode les paquets binaires — certains proxys n'envoient que cela", () => {
    const { socket } = fakeSocket();
    const { sink, lines } = fakeSink();
    setSipTrace(true);

    traceSocket(socket, sink);
    socket.ondata = () => {};
    socket.ondata(new TextEncoder().encode(UNAUTHORIZED));

    expect(lines[0]).toBe("> [trix] SIP ← SIP/2.0 401 Unauthorized");
    expect(lines[1]).toBe(UNAUTHORIZED);
  });
});

/**
 * Une machine en réduction : où elle est, et de quoi prévenir quand elle
 * bouge. `move` joue une transition telle que le moteur la notifie —
 * position déjà mise à jour, `enter()` de l'état d'arrivée pas encore
 * exécuté.
 */
function fakeMachine(state: string) {
  let sbb: { block: string; state: string } | undefined;
  const listeners: ((n: unknown) => void)[] = [];
  const m = {
    get state() {
      return state;
    },
    get sbb() {
      return sbb;
    },
    subscribe(fn: (n: never) => void) {
      listeners.push(fn as (n: unknown) => void);
      return () => listeners.splice(listeners.indexOf(fn as (n: unknown) => void), 1);
    },
  };
  const move = (
    to: { state?: string; sbb?: { block: string; state: string } },
    n: { event?: { type: string }; desc?: string } = {},
  ): void => {
    if (to.state !== undefined) state = to.state;
    sbb = to.sbb;
    for (const fn of [...listeners]) fn({ state, sbb, ...n });
  };
  return { m, move };
}

const CALL = (name: string) => ({ block: "CallBlock", state: name });

describe("trace de la FSM d'appel", () => {
  it("ne dit rien des transitions du téléphone : elles ne sont pas un échange SIP", () => {
    const { m, move } = fakeMachine("home");
    const { sink, lines } = fakeSink();
    setSipTrace(true);

    traceCallStates(m, sink);
    move({ state: "connecting" }, { event: { type: "ui:save" }, desc: "compte saisi" });
    move({ state: "ready" }, { event: { type: "sip:registered" } });

    expect(lines).toEqual([]);
  });

  it("trace l'entrée dans le bloc, ses transitions, et son retour à l'hôte", () => {
    const { m, move } = fakeMachine("ready");
    const { sink, lines } = fakeSink();
    setSipTrace(true);

    traceCallStates(m, sink);
    move({ state: "in_call", sbb: CALL("initial_state") }, { desc: "sbb CallBlock" });
    move({ sbb: CALL("dialing") }, { desc: "INVITE sortant" });
    move({ sbb: CALL("ringing") }, { event: { type: "sip:progress" }, desc: "180/183" });
    move({ sbb: CALL("connected") }, { event: { type: "sip:accepted" }, desc: "200 OK" });
    move({ sbb: CALL("hangingup") }, { event: { type: "ui:hangup" }, desc: "BYE" });
    move({ state: "ready" }, { desc: "sbb return call:answered" });

    expect(lines).toEqual([
      '[trix] FSM (ready) → (CallBlock/initial_state) "sbb CallBlock"',
      '[trix] FSM (CallBlock/initial_state) → (CallBlock/dialing) "INVITE sortant"',
      '[trix] FSM sip:progress: (CallBlock/dialing) → (CallBlock/ringing) "180/183"',
      '[trix] FSM sip:accepted: (CallBlock/ringing) → (CallBlock/connected) "200 OK"',
      '[trix] FSM ui:hangup: (CallBlock/connected) → (CallBlock/hangingup) "BYE"',
      '[trix] FSM (CallBlock/hangingup) → (ready) "sbb return call:answered"',
    ]);
  });

  it("garde les transitions sur place — micro coupé, self-view", () => {
    const { m, move } = fakeMachine("in_call");
    const { sink, lines } = fakeSink();
    setSipTrace(true);

    traceCallStates(m, sink);
    move({ sbb: CALL("connected") }, { event: { type: "sip:accepted" }, desc: "200 OK" });
    move({ sbb: CALL("connected") }, { event: { type: "ui:muteMic" }, desc: "micro coupé" });

    expect(lines[1]).toBe(
      '[trix] FSM ui:muteMic: (CallBlock/connected) → (CallBlock/connected) "micro coupé"',
    );
  });

  it("suit le même réglage que les paquets, consulté à chaque transition", () => {
    const { m, move } = fakeMachine("in_call");
    const { sink, lines } = fakeSink();

    traceCallStates(m, sink);
    move({ sbb: CALL("dialing") }, { desc: "INVITE sortant" }); // éteinte
    setSipTrace(true);
    move({ sbb: CALL("ringing") }, { event: { type: "sip:progress" }, desc: "180/183" });

    expect(lines).toEqual([
      '[trix] FSM sip:progress: (CallBlock/dialing) → (CallBlock/ringing) "180/183"',
    ]);
  });

  it("se débranche sur demande", () => {
    const { m, move } = fakeMachine("in_call");
    const { sink, lines } = fakeSink();
    setSipTrace(true);

    const off = traceCallStates(m, sink);
    off();
    move({ sbb: CALL("dialing") }, { desc: "INVITE sortant" });

    expect(lines).toEqual([]);
  });
});

describe("carnet de l'appel", () => {
  it("ne reçoit rien quand la case est décochée, et tout dès qu'elle est cochée", () => {
    const { socket } = fakeSocket();
    const { sink } = fakeSink();
    const INVITE = "INVITE sip:bob@example.fr SIP/2.0\r\nCall-ID: abc\r\n\r\n";
    const OK = "SIP/2.0 200 OK\r\nCSeq: 1 INVITE\r\nCall-ID: abc\r\n\r\n";

    traceSocket(socket, sink);
    socket.ondata = () => {};
    const book = openCallTrace(null);

    socket.send(INVITE); // trace éteinte : rien n'est gardé
    setSipTrace(true);
    socket.send(INVITE);
    socket.ondata(OK);

    expect(book.take().map((l) => l.head)).toEqual([
      "INVITE sip:bob@example.fr SIP/2.0",
      "SIP/2.0 200 OK",
    ]);
  });

  it("y verse aussi les transitions de la machine d'appel", () => {
    const { m, move } = fakeMachine("in_call");
    const { sink } = fakeSink();
    setSipTrace(true);

    const book = openCallTrace("abc");
    traceCallStates(m, sink);
    move({ sbb: CALL("ringing") }, { event: { type: "sip:progress" }, desc: "180/183" });

    expect(book.take()).toEqual([
      expect.objectContaining({
        kind: "fsm",
        head: 'sip:progress: (in_call) → (CallBlock/ringing) "180/183"',
      }),
    ]);
  });
});
