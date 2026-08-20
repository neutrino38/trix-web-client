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
import { setSipTrace, sipTraceEnabled, traceSocket, type TraceSink } from "../src/sip/trace.js";

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
