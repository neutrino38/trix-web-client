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
import { createSipTrace, type SipTraceOptions, type TraceSink } from "../src/sip/trace.js";

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

/** Une trace neuve, et ce qu'elle écrit — ce qu'un développeur lit dans la console. */
function fakeTrace(opts: SipTraceOptions = {}) {
  const lines: string[] = [];
  const sink: TraceSink = {
    group: (label) => lines.push(`> ${label}`),
    line: (text) => lines.push(text),
    groupEnd: () => lines.push("<"),
  };
  return { trace: createSipTrace({ ...opts, sink }), lines };
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
});

describe("réglage de la trace", () => {
  it("est éteinte par défaut, et se rallume d'un appel", () => {
    const { trace } = fakeTrace();
    expect(trace.enabled()).toBe(false);
    trace.set(true);
    expect(trace.enabled()).toBe(true);
    trace.set(false);
    expect(trace.enabled()).toBe(false);
  });

  it("reste éteinte quand le déploiement l'interdit, même déjà allumée", () => {
    // `debug_activated: "no"` dans config.json : la case n'existe plus dans
    // les paramètres, et un réglage laissé allumé avant ne doit pas survivre
    fakeTrace().trace.set(true);
    const { trace, lines } = fakeTrace({ allowed: false });
    expect(trace.enabled()).toBe(false);

    const { socket, sent } = fakeSocket();
    trace.socket(socket);
    socket.send(REGISTER);
    expect(sent).toEqual([REGISTER]); // le paquet part quand même
    expect(lines).toEqual([]); // mais rien n'en est dit

    expect(fakeTrace().trace.enabled()).toBe(true);
  });

  it("une instance, un réglage : le préfixe nomme la clé (ADR 0011, D8)", () => {
    const trix = fakeTrace().trace;
    const acme = fakeTrace({ prefix: "acme" }).trace;
    acme.set(true);
    expect(localStorage.getItem("acme-siptrace")).toBe("on");
    expect(trix.enabled()).toBe(false);
    trix.set(true);
    expect(localStorage.getItem("trix-siptrace")).toBe("on");
  });

  it("une instance, des carnets : un paquet tracé ne va qu'aux siens", () => {
    const INVITE = "INVITE sip:bob@example.fr SIP/2.0\r\nCall-ID: abc\r\n\r\n";
    const mine = fakeTrace().trace;
    const other = fakeTrace({ prefix: "acme" }).trace;
    mine.set(true);
    other.set(true);
    const myBook = mine.recorder.open(null);
    const otherBook = other.recorder.open(null);
    const { socket } = fakeSocket();
    mine.socket(socket);
    socket.send(INVITE);
    other.note("ligne de l'autre instance");
    expect(myBook.take().map((l) => l.head)).toEqual(["INVITE sip:bob@example.fr SIP/2.0"]);
    expect(otherBook.take().map((l) => l.head)).toEqual(["ligne de l'autre instance"]);
  });
});

describe("socket enveloppé", () => {
  it("laisse passer les paquets et le booléen de send, trace éteinte", () => {
    const { socket, sent } = fakeSocket();
    const { trace, lines } = fakeTrace();
    const received: unknown[] = [];

    trace.socket(socket);
    socket.ondata = (data) => received.push(data);

    expect(socket.send(REGISTER)).toBe(true);
    socket.ondata(UNAUTHORIZED);

    expect(sent).toEqual([REGISTER]);
    expect(received).toEqual([UNAUTHORIZED]);
    expect(lines).toEqual([]);
  });

  it("garde les accesseurs du socket d'origine", () => {
    const { socket } = fakeSocket();
    const { trace } = fakeTrace();
    expect(trace.socket(socket)).toBe(socket);
    expect(socket.via_transport).toBe("WSS");
  });

  it("trace les deux sens, entête visible et paquet déplié", () => {
    const { socket } = fakeSocket();
    const { trace, lines } = fakeTrace();
    trace.set(true);

    trace.socket(socket);
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
    const { trace, lines } = fakeTrace();

    trace.socket(socket);
    socket.send(REGISTER); // éteinte
    trace.set(true);
    socket.send(REGISTER); // allumée
    trace.set(false);
    socket.send(REGISTER); // éteinte de nouveau

    expect(lines.filter((l) => l.startsWith(">"))).toHaveLength(1);
  });

  it("compacte les keep-alive plutôt que d'ouvrir un groupe vide", () => {
    const { socket } = fakeSocket();
    const { trace, lines } = fakeTrace();
    trace.set(true);

    trace.socket(socket);
    socket.send("\r\n\r\n");

    expect(lines).toEqual(["[trix] SIP → keep-alive"]);
  });

  it("décode les paquets binaires — certains proxys n'envoient que cela", () => {
    const { socket } = fakeSocket();
    const { trace, lines } = fakeTrace();
    trace.set(true);

    trace.socket(socket);
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
    const { trace, lines } = fakeTrace();
    trace.set(true);

    trace.callStates(m);
    move({ state: "connecting" }, { event: { type: "ui:save" }, desc: "compte saisi" });
    move({ state: "ready" }, { event: { type: "sip:registered" } });

    expect(lines).toEqual([]);
  });

  it("trace l'entrée dans le bloc, ses transitions, et son retour à l'hôte", () => {
    const { m, move } = fakeMachine("ready");
    const { trace, lines } = fakeTrace();
    trace.set(true);

    trace.callStates(m);
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
    const { trace, lines } = fakeTrace();
    trace.set(true);

    trace.callStates(m);
    move({ sbb: CALL("connected") }, { event: { type: "sip:accepted" }, desc: "200 OK" });
    move({ sbb: CALL("connected") }, { event: { type: "ui:muteMic" }, desc: "micro coupé" });

    expect(lines[1]).toBe(
      '[trix] FSM ui:muteMic: (CallBlock/connected) → (CallBlock/connected) "micro coupé"',
    );
  });

  it("suit le même réglage que les paquets, consulté à chaque transition", () => {
    const { m, move } = fakeMachine("in_call");
    const { trace, lines } = fakeTrace();

    trace.callStates(m);
    move({ sbb: CALL("dialing") }, { desc: "INVITE sortant" }); // éteinte
    trace.set(true);
    move({ sbb: CALL("ringing") }, { event: { type: "sip:progress" }, desc: "180/183" });

    expect(lines).toEqual([
      '[trix] FSM sip:progress: (CallBlock/dialing) → (CallBlock/ringing) "180/183"',
    ]);
  });

  it("se débranche sur demande", () => {
    const { m, move } = fakeMachine("in_call");
    const { trace, lines } = fakeTrace();
    trace.set(true);

    const off = trace.callStates(m);
    off();
    move({ sbb: CALL("dialing") }, { desc: "INVITE sortant" });

    expect(lines).toEqual([]);
  });
});

describe("carnet de l'appel", () => {
  it("ne reçoit rien quand la case est décochée, et tout dès qu'elle est cochée", () => {
    const { socket } = fakeSocket();
    const { trace } = fakeTrace();
    const INVITE = "INVITE sip:bob@example.fr SIP/2.0\r\nCall-ID: abc\r\n\r\n";
    const OK = "SIP/2.0 200 OK\r\nCSeq: 1 INVITE\r\nCall-ID: abc\r\n\r\n";

    trace.socket(socket);
    socket.ondata = () => {};
    const book = trace.recorder.open(null);

    socket.send(INVITE); // trace éteinte : rien n'est gardé
    trace.set(true);
    socket.send(INVITE);
    socket.ondata(OK);

    expect(book.take().map((l) => l.head)).toEqual([
      "INVITE sip:bob@example.fr SIP/2.0",
      "SIP/2.0 200 OK",
    ]);
  });

  it("y verse aussi les transitions de la machine d'appel", () => {
    const { m, move } = fakeMachine("in_call");
    const { trace } = fakeTrace();
    trace.set(true);

    const book = trace.recorder.open("abc");
    trace.callStates(m);
    move({ sbb: CALL("ringing") }, { event: { type: "sip:progress" }, desc: "180/183" });

    expect(book.take()).toEqual([
      expect.objectContaining({
        kind: "fsm",
        head: 'sip:progress: (in_call) → (CallBlock/ringing) "180/183"',
      }),
    ]);
  });
});
