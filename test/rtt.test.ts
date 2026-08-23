/**
 * Le lien texte en temps réel : le tampon commun, et les deux fils.
 *
 * Ce qui se vérifie ici est ce que le typage ne dit pas — qu'une frappe
 * isolée attend, qu'une salve part tout de suite, que ce qui est tapé
 * avant l'ouverture n'est pas perdu, qu'un caractère n'est jamais coupé
 * en deux, et surtout que **les deux transports se comportent pareil** :
 * c'est toute la raison d'être de `RttChannel`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chunkText,
  openRtt,
  parseRttTransport,
  rttChannel,
  RTT_HOLD_MS,
  type RttChannel,
  type RttEvents,
  type RttState,
  type RttWire,
  type RttWireHooks,
} from "../src/sip/rtt.js";
import { withTextOverWs, wsUrlFromSdp } from "../src/sip/rttws.js";
import { T140_CHANNEL } from "../src/sip/rttdc.js";

/** Ce que le canal a fait passer sur le fil, et ce qu'il a rapporté. */
interface Recorder {
  sent: string[];
  received: string[];
  states: RttState[];
  hooks: RttWireHooks;
  events: RttEvents;
  closed: boolean;
}

function recorder(): Recorder {
  const rec: Recorder = {
    sent: [],
    received: [],
    states: [],
    closed: false,
    hooks: { text: () => {}, state: () => {} },
    events: {
      text: (chunk) => rec.received.push(chunk),
      state: (state) => rec.states.push(state),
    },
  };
  return rec;
}

/**
 * Abonne l'enregistreur au canal, en oubliant l'état initial que tout
 * abonné reçoit à l'inscription : ce qui nous intéresse est la suite.
 */
function listening(channel: RttChannel, rec: Recorder): RttChannel {
  channel.listen(rec.events);
  rec.states.length = 0;
  return channel;
}

/** Un fil de laboratoire : il note ce qu'on lui donne, et rien de plus. */
function fakeWire(rec: Recorder): (hooks: RttWireHooks) => RttWire {
  return (hooks) => {
    rec.hooks = hooks;
    return {
      send: (text) => rec.sent.push(text),
      close: () => {
        rec.closed = true;
      },
    };
  };
}

describe("parseRttTransport", () => {
  it("accepte les trois choix", () => {
    expect(parseRttTransport("none")).toBe("none");
    expect(parseRttTransport("websocket")).toBe("websocket");
    expect(parseRttTransport("datachannel")).toBe("datachannel");
  });

  it("tout le reste retombe sur « aucun » — on ne modifie pas des appels sans qu'on l'ait demandé", () => {
    expect(parseRttTransport(undefined)).toBe("none");
    expect(parseRttTransport(null)).toBe("none");
    expect(parseRttTransport("rtp")).toBe("none");
    expect(parseRttTransport(42)).toBe("none");
  });
});

describe("chunkText", () => {
  it("laisse passer ce qui tient en un message", () => {
    expect(chunkText("bonjour", 100)).toEqual(["bonjour"]);
    expect(chunkText("", 100)).toEqual([]);
  });

  it("découpe sans jamais couper un caractère en deux", () => {
    // chaque émoji vaut deux unités UTF-16 : une découpe naïve à 3 les
    // trancherait en moitiés invalides
    const chunks = chunkText("👍👍👍👍", 3);
    expect(chunks).toEqual(["👍", "👍", "👍", "👍"]);
    expect(chunks.join("")).toBe("👍👍👍👍");
  });

  it("garde un caractère combiné entier", () => {
    const family = "👩‍👩‍👧"; // une seule chose à l'écran, onze unités
    expect(chunkText(family + family, 12)).toEqual([family, family]);
  });
});

describe("rttChannel — tampon d'émission", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("une frappe isolée attend, une salve part tout de suite", () => {
    const rec = recorder();
    const ch = listening(rttChannel("websocket", fakeWire(rec)), rec);
    rec.hooks.state("open");

    ch.send("a");
    expect(rec.sent).toEqual([]); // rien encore : trois lettres de plus, ou 300 ms

    vi.advanceTimersByTime(RTT_HOLD_MS);
    expect(rec.sent).toEqual(["a"]);

    ch.send("bcde");
    expect(rec.sent).toEqual(["a", "bcde"]); // la salve n'attend pas
  });

  it("flush envoie sans attendre — fin de ligne, collage, raccrochage", () => {
    const rec = recorder();
    const ch = listening(rttChannel("websocket", fakeWire(rec)), rec);
    rec.hooks.state("open");

    ch.send("a");
    ch.flush();
    expect(rec.sent).toEqual(["a"]);

    // le temporisateur a bien été désarmé : rien ne repart tout seul
    vi.advanceTimersByTime(RTT_HOLD_MS * 2);
    expect(rec.sent).toEqual(["a"]);
  });

  it("ce qui est tapé avant l'ouverture part à l'ouverture", () => {
    const rec = recorder();
    const ch = listening(rttChannel("websocket", fakeWire(rec)), rec);

    ch.send("bonjour");
    vi.advanceTimersByTime(RTT_HOLD_MS * 2);
    expect(rec.sent).toEqual([]); // le fil n'est pas ouvert

    rec.hooks.state("open");
    expect(rec.sent).toEqual(["bonjour"]);
  });

  it("une rupture met en attente, la reprise vide la file", () => {
    const rec = recorder();
    const ch = listening(rttChannel("websocket", fakeWire(rec)), rec);
    rec.hooks.state("open");
    rec.hooks.state("lost");

    ch.send("perdu ?");
    vi.advanceTimersByTime(RTT_HOLD_MS * 2);
    expect(rec.sent).toEqual([]);

    rec.hooks.state("open");
    expect(rec.sent).toEqual(["perdu ?"]);
    expect(rec.states).toEqual(["open", "lost", "open"]);
  });

  it("un long collage est découpé, et rien ne se perd", () => {
    const rec = recorder();
    const ch = listening(rttChannel("websocket", fakeWire(rec)), rec);
    rec.hooks.state("open");

    const paste = "x".repeat(2500);
    ch.send(paste);
    expect(rec.sent.length).toBe(3);
    expect(rec.sent.join("")).toBe(paste);
  });

  it("fermer envoie le reste, puis plus rien ne part", () => {
    const rec = recorder();
    const ch = listening(rttChannel("websocket", fakeWire(rec)), rec);
    rec.hooks.state("open");

    ch.send("au");
    ch.close();
    expect(rec.sent).toEqual(["au"]);
    expect(rec.closed).toBe(true);
    expect(ch.state()).toBe("closed");
    expect(rec.states.at(-1)).toBe("closed");

    ch.send("revoir");
    vi.advanceTimersByTime(RTT_HOLD_MS * 2);
    expect(rec.sent).toEqual(["au"]);
  });

  it("un fil qui s'éteint après la fermeture ne ressuscite pas le canal", () => {
    const rec = recorder();
    const ch = listening(rttChannel("websocket", fakeWire(rec)), rec);
    rec.hooks.state("open");
    ch.close();

    rec.hooks.state("open");
    expect(ch.state()).toBe("closed");
    expect(rec.states).toEqual(["open", "closed"]);
  });

  it("l'abonné reçoit l'état courant, puis ce qui a manqué avant lui", () => {
    const rec = recorder();
    const ch = rttChannel("websocket", fakeWire(rec));
    rec.hooks.state("open");
    rec.hooks.text("bon"); // personne n'écoute encore : rien n'est perdu

    const seen: string[] = [];
    const states: RttState[] = [];
    const off = ch.listen({ text: (t) => seen.push(t), state: (s) => states.push(s) });
    expect(states).toEqual(["open"]);
    expect(seen).toEqual(["bon"]);

    rec.hooks.text("jour");
    expect(seen.join("")).toBe("bonjour");

    off();
    rec.hooks.text("!");
    expect(seen.join("")).toBe("bonjour");
  });

  it("le texte reçu remonte tel quel, commandes comprises", () => {
    const rec = recorder();
    listening(rttChannel("datachannel", fakeWire(rec)), rec);
    rec.hooks.text("bonsoir ");
    rec.hooks.text(""); // un message vide ne fait pas d'événement
    expect(rec.received).toEqual(["bonsoir "]);
  });
});

// ---------------------------------------------------------------------
// Le fil WebSocket
// ---------------------------------------------------------------------

describe("SDP du texte sur WebSocket", () => {
  const OFFER = ["v=0", "o=- 1 1 IN IP4 127.0.0.1", "s=-", "m=audio 5000 RTP/SAVPF 111", ""].join(
    "\r\n",
  );

  it("ajoute une section m=text à l'offre", () => {
    const out = withTextOverWs(OFFER);
    expect(out).toContain("m=text 60000 TCP/WSS t140");
    expect(out).toContain("a=setup:active");
    expect(out).toContain("a=connection:new");
    expect(out.endsWith("\r\n")).toBe(true);
    expect(out).not.toContain("\r\n\r\n");
  });

  it("n'en ajoute pas une deuxième à la renégociation", () => {
    const once = withTextOverWs(OFFER);
    expect(withTextOverWs(once)).toBe(once);
  });

  it("lit l'URL du socket dans un SDP distant, quelle que soit sa forme", () => {
    const answer = (attr: string): string =>
      ["v=0", "m=audio 5000 RTP/SAVPF 111", "m=text 60000 TCP/WSS t140", attr, ""].join("\r\n");

    expect(wsUrlFromSdp(answer("a=wss://gw.example.fr/rtt/42"))).toBe(
      "wss://gw.example.fr/rtt/42",
    );
    expect(wsUrlFromSdp(answer("a=wss:gw.example.fr/rtt/42"))).toBe("wss://gw.example.fr/rtt/42");
    // le socket est toujours pris en TLS, même annoncé en clair : la page
    // est servie en HTTPS, le navigateur refuserait l'autre
    expect(wsUrlFromSdp(answer("a=ws://gw.example.fr/rtt/42"))).toBe(
      "wss://gw.example.fr/rtt/42",
    );
  });

  it("pas de texte : la réponse n'en dit rien, ou le refuse", () => {
    const noSection = ["v=0", "m=audio 5000 RTP/SAVPF 111", ""].join("\r\n");
    expect(wsUrlFromSdp(noSection)).toBeNull();

    const refused = ["v=0", "m=text 0 TCP/WSS t140", "a=wss://gw.example.fr/rtt/42", ""].join(
      "\r\n",
    );
    expect(wsUrlFromSdp(refused)).toBeNull();

    const silent = ["v=0", "m=text 60000 TCP/WSS t140", "a=sendrecv", ""].join("\r\n");
    expect(wsUrlFromSdp(silent)).toBeNull();
  });
});

/** Le WebSocket du navigateur, réduit à ce que le fil en utilise. */
class FakeSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeSocket[] = [];

  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }

  drop(): void {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }

  send(text: string): void {
    this.sent.push(text);
  }

  close(): void {
    this.readyState = FakeSocket.CLOSED;
  }
}

describe("fil WebSocket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeSocket);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("ouvre le socket annoncé, et le texte y passe tel quel", () => {
    const rec = recorder();
    const ch = listening(openRtt({ transport: "websocket", url: "wss://gw.example.fr/rtt/42" }), rec);
    const socket = FakeSocket.instances[0]!;
    expect(socket.url).toBe("wss://gw.example.fr/rtt/42");
    expect(ch.transport).toBe("websocket");

    socket.open();
    expect(ch.state()).toBe("open");

    ch.send("bonjour");
    expect(socket.sent).toEqual(["bonjour"]);

    socket.onmessage?.({ data: "bonsoir" });
    expect(rec.received).toEqual(["bonsoir"]);
  });

  it("une coupure se reprend, et la perte se voit dans le fil", () => {
    const rec = recorder();
    const ch = listening(openRtt({ transport: "websocket", url: "wss://gw.example.fr/rtt/42" }), rec);
    FakeSocket.instances[0]!.open();

    FakeSocket.instances[0]!.drop();
    expect(ch.state()).toBe("lost");

    vi.advanceTimersByTime(1000);
    expect(FakeSocket.instances.length).toBe(2);
    FakeSocket.instances[1]!.open();

    expect(ch.state()).toBe("open");
    // du texte distant a très probablement manqué : la norme veut que cela se voie
    expect(rec.received).toEqual(["�"]);
  });

  it("une coupure qui dure ferme le lien pour de bon", () => {
    const rec = recorder();
    const ch = listening(openRtt({ transport: "websocket", url: "wss://gw.example.fr/rtt/42" }), rec);
    FakeSocket.instances[0]!.open();

    for (let i = 0; i < 11; i++) {
      FakeSocket.instances.at(-1)!.drop();
      vi.advanceTimersByTime(1000);
    }
    expect(ch.state()).toBe("closed");
  });

  it("fermer le canal ne relance aucune reprise", () => {
    const rec = recorder();
    const ch = listening(openRtt({ transport: "websocket", url: "wss://gw.example.fr/rtt/42" }), rec);
    FakeSocket.instances[0]!.open();

    ch.close();
    FakeSocket.instances[0]!.drop();
    vi.advanceTimersByTime(5000);
    expect(FakeSocket.instances.length).toBe(1);
    expect(ch.state()).toBe("closed");
  });
});

// ---------------------------------------------------------------------
// Le fil canal de données
// ---------------------------------------------------------------------

/** Un canal de données réduit à ce que le fil en utilise. */
class FakeChannel {
  readyState = "connecting";
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  closed = false;

  constructor(
    readonly label: string,
    readonly protocol: string,
  ) {}

  open(): void {
    this.readyState = "open";
    this.onopen?.();
  }

  send(text: string): void {
    this.sent.push(text);
  }

  close(): void {
    this.closed = true;
  }
}

/** Une connexion pair-à-pair réduite à l'ouverture d'un canal. */
class FakeConnection {
  created: FakeChannel[] = [];
  listeners: ((ev: { channel: FakeChannel }) => void)[] = [];

  createDataChannel(label: string, init: { ordered?: boolean; protocol?: string }): FakeChannel {
    const dc = new FakeChannel(label, init.protocol ?? "");
    this.created.push(dc);
    this.lastInit = init;
    return dc;
  }

  lastInit: { ordered?: boolean; protocol?: string } = {};

  addEventListener(_type: string, fn: (ev: { channel: FakeChannel }) => void): void {
    this.listeners.push(fn);
  }

  removeEventListener(_type: string, fn: (ev: { channel: FakeChannel }) => void): void {
    this.listeners = this.listeners.filter((l) => l !== fn);
  }

  /** Le distant ouvre un canal de son côté. */
  incoming(dc: FakeChannel): void {
    for (const fn of this.listeners) fn({ channel: dc });
  }
}

const asPc = (pc: FakeConnection): RTCPeerConnection => pc as unknown as RTCPeerConnection;

describe("fil canal de données", () => {
  it("l'offrant crée un canal t140 fiable et ordonné, et signe la session", () => {
    const rec = recorder();
    const pc = new FakeConnection();
    const ch = listening(openRtt({ transport: "datachannel", connection: asPc(pc), role: "offer" }), rec);

    const dc = pc.created[0]!;
    expect(dc.label).toBe(T140_CHANNEL);
    expect(dc.protocol).toBe(T140_CHANNEL);
    expect(pc.lastInit.ordered).toBe(true);
    // ni maxRetransmits ni maxPacketLifeTime : le canal doit rester fiable
    expect(pc.lastInit).not.toHaveProperty("maxRetransmits");
    expect(pc.lastInit).not.toHaveProperty("maxPacketLifeTime");

    dc.open();
    expect(dc.sent).toEqual(["﻿"]); // la signature ouvre le flux
    expect(ch.state()).toBe("open");

    ch.send("bonjour");
    expect(dc.sent).toEqual(["﻿", "bonjour"]);
  });

  it("le répondant adopte le canal du distant, et ignore les autres", () => {
    const rec = recorder();
    const pc = new FakeConnection();
    const ch = listening(openRtt({ transport: "datachannel", connection: asPc(pc), role: "answer" }), rec);
    expect(pc.created).toEqual([]);

    pc.incoming(new FakeChannel("fichiers", "bindl"));
    expect(ch.state()).toBe("connecting");

    const dc = new FakeChannel(T140_CHANNEL, T140_CHANNEL);
    pc.incoming(dc);
    dc.open();
    expect(ch.state()).toBe("open");

    dc.onmessage?.({ data: "bonsoir" });
    expect(rec.received).toEqual(["bonsoir"]);
  });

  it("un canal fermé par le distant ne se reprend pas : SCTP ne perd rien en route", () => {
    const rec = recorder();
    const pc = new FakeConnection();
    const ch = listening(openRtt({ transport: "datachannel", connection: asPc(pc), role: "offer" }), rec);
    const dc = pc.created[0]!;
    dc.open();

    dc.onclose?.();
    expect(ch.state()).toBe("closed");
    expect(pc.created.length).toBe(1);
  });

  it("fermer le canal détache l'écoute et ferme le fil", () => {
    const rec = recorder();
    const pc = new FakeConnection();
    const ch = listening(openRtt({ transport: "datachannel", connection: asPc(pc), role: "answer" }), rec);
    expect(pc.listeners.length).toBe(1);

    ch.close();
    expect(pc.listeners).toEqual([]);
    expect(ch.state()).toBe("closed");
  });
});
