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

/**
 * Le compteur de texte manquant (T.140 §5.3.2.3, ADR 0003 §4) : la seule
 * mesure de qualité que ce niveau puisse produire honnêtement. Ce qui se
 * vérifie ici est qu'il compte **tout** ce qui arrive — les marqueurs
 * insérés par le fil à la reprise d'un canal comme ceux que le distant
 * envoie pour ses propres trous —, et qu'il les compte même quand personne
 * n'écoute encore : le canal vit avec l'appel, le panneau de tchat non.
 */
/**
 * **Avant le décrochage, on lit mais on n'écrit pas.** Le canal peut être
 * grand ouvert bien avant que quiconque ait répondu : en média précoce
 * (RFC 3960), la connexion pair-à-pair s'établit sur la réponse provisoire,
 * et un serveur peut déjà envoyer les sous-titres de l'annonce qu'il joue.
 * Ce qui arrive s'affiche ; ce qu'on écrirait n'a pas de destinataire, et
 * ne doit surtout pas attendre en tampon — il partirait d'un bloc au
 * décrochage.
 */
describe("émission suspendue", () => {
  it("ce qui est tapé est jeté, pas mis en attente", () => {
    const rec = recorder();
    const channel = listening(rttChannel("websocket", fakeWire(rec)), rec);
    rec.hooks.state("open");
    channel.setSending(false);
    channel.send("bonjour");
    channel.backspace();
    channel.flush();
    expect(rec.sent).toEqual([]);
    // décrochage : ce qui suit part, ce qui précède est perdu pour de bon
    channel.setSending(true);
    channel.send("bonsoir");
    channel.flush();
    expect(rec.sent).toEqual(["bonsoir"]);
  });

  it("ne touche pas à ce qui arrive : l'annonce précoce s'affiche", () => {
    const rec = recorder();
    const channel = listening(rttChannel("websocket", fakeWire(rec)), rec);
    channel.setSending(false);
    rec.hooks.state("open");
    rec.hooks.text("Bienvenue au service d'urgence");
    expect(rec.received).toEqual(["Bienvenue au service d'urgence"]);
    expect(channel.state()).toBe("open");
  });

  it("ce qui attendait déjà ne part pas non plus au décrochage", () => {
    const rec = recorder();
    const channel = listening(rttChannel("websocket", fakeWire(rec)), rec);
    // fil pas encore ouvert : le texte tombe dans le tampon
    channel.send("tapé trop tôt");
    channel.setSending(false);
    rec.hooks.state("open");
    channel.flush();
    expect(rec.sent).toEqual([]);
  });
});

describe("texte manquant", () => {
  const LOST = "\uFFFD";

  it("part de zéro et compte les marqueurs reçus", () => {
    const rec = recorder();
    const channel = listening(rttChannel("websocket", fakeWire(rec)), rec);
    expect(channel.missingText()).toBe(0);
    rec.hooks.text(`bonjour${LOST}`);
    expect(channel.missingText()).toBe(1);
    rec.hooks.text(`${LOST}au rev${LOST}oir`);
    expect(channel.missingText()).toBe(3);
  });

  it("compte avant tout abonné : le trou d'avant l'ouverture du panneau est un trou", () => {
    const rec = recorder();
    const channel = rttChannel("websocket", fakeWire(rec));
    rec.hooks.text(`${LOST}salut`);
    expect(channel.missingText()).toBe(1);
  });

  it("ne compte pas ce qui part d'ici", () => {
    const rec = recorder();
    const channel = listening(rttChannel("websocket", fakeWire(rec)), rec);
    rec.hooks.state("open");
    channel.send(LOST); // rien n'interdit de taper le caractère : il n'est pas reçu
    channel.flush();
    expect(channel.missingText()).toBe(0);
  });
});

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

  it("effacer ce qui est encore en tampon n'envoie aucun retour arrière", () => {
    const rec = recorder();
    const ch = listening(rttChannel("websocket", fakeWire(rec)), rec);
    rec.hooks.state("open");

    ch.send("abc");
    ch.backspace();
    ch.flush();
    // le « c » n'est jamais parti : envoyer un U+0008 effacerait le « b »
    // chez le correspondant
    expect(rec.sent).toEqual(["ab"]);
  });

  it("effacer ce qui est déjà parti envoie un retour arrière", () => {
    const rec = recorder();
    const ch = listening(rttChannel("websocket", fakeWire(rec)), rec);
    rec.hooks.state("open");

    ch.send("abc");
    ch.flush();
    ch.backspace();
    ch.flush();
    expect(rec.sent).toEqual(["abc", "\u0008"]);

    // deux effacements de suite valent deux retours arrière : le premier
    // n'est pas rattrapable non plus
    ch.backspace(2);
    ch.flush();
    expect(rec.sent).toEqual(["abc", "\u0008", "\u0008\u0008"]);
  });

  it("un caractère composé s'efface d'un seul coup", () => {
    const rec = recorder();
    const ch = listening(rttChannel("websocket", fakeWire(rec)), rec);

    // fil pas encore ouvert : tout attend, donc tout reste rattrapable
    ch.send("a👩‍👩‍👧");
    ch.backspace();
    rec.hooks.state("open");
    ch.flush();
    // la famille part entière, pas une moitié de paire de substitution
    expect(rec.sent).toEqual(["a"]);
  });

  it("effacer plus que ce qui attend part en retours arrière pour le reste", () => {
    const rec = recorder();
    const ch = listening(rttChannel("websocket", fakeWire(rec)), rec);
    rec.hooks.state("open");

    ch.send("bonjour");
    ch.flush();
    ch.send("ab");
    ch.backspace(4);
    ch.flush();
    // « ab » n'était pas parti, les deux effacements restants oui
    expect(rec.sent).toEqual(["bonjour", "\u0008\u0008"]);
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
    // la signature de session part la première : elle ouvre le flux (T.140)
    // et, du même coup, le chemin retour de la passerelle
    expect(socket.sent).toEqual(["\uFEFF"]);

    ch.send("bonjour");
    expect(socket.sent).toEqual(["\uFEFF", "bonjour"]);

    socket.onmessage?.({ data: "bonsoir" });
    expect(rec.received).toEqual(["bonsoir"]);
  });

  it("la signature repart sur un socket rouvert : la passerelle a pu perdre l'association", () => {
    const rec = recorder();
    listening(openRtt({ transport: "websocket", url: "wss://gw.example.fr/rtt/42" }), rec);
    FakeSocket.instances[0]!.open();
    FakeSocket.instances[0]!.drop();
    vi.advanceTimersByTime(1000);
    FakeSocket.instances[1]!.open();
    expect(FakeSocket.instances[1]!.sent).toEqual(["\uFEFF"]);
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
    /** Attribué par SCTP : pair pour le client DTLS, impair pour le serveur. */
    readonly id: number | null = null,
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
    this.readyState = "closed";
    this.onclose?.();
  }

  /** Le canal tombe — le distant l'a fermé, ou le transport a lâché. */
  drop(): void {
    this.readyState = "closed";
    this.onclose?.();
  }
}

/** Une connexion pair-à-pair réduite à ce que le fil en utilise. */
class FakeConnection {
  created: FakeChannel[] = [];
  lastInit: { ordered?: boolean; protocol?: string } = {};
  connectionState = "connected";
  /** L'identifiant du prochain canal créé ici. */
  nextId = 0;

  private channelWatchers: ((ev: { channel: FakeChannel }) => void)[] = [];
  private stateWatchers: (() => void)[] = [];

  createDataChannel(label: string, init: { ordered?: boolean; protocol?: string }): FakeChannel {
    const dc = new FakeChannel(label, init.protocol ?? "", this.nextId);
    this.nextId += 2;
    this.created.push(dc);
    this.lastInit = init;
    return dc;
  }

  addEventListener(type: string, fn: (ev: never) => void): void {
    if (type === "datachannel") this.channelWatchers.push(fn as (ev: { channel: FakeChannel }) => void);
    else this.stateWatchers.push(fn as () => void);
  }

  removeEventListener(type: string, fn: (ev: never) => void): void {
    if (type === "datachannel") this.channelWatchers = this.channelWatchers.filter((l) => l !== fn);
    else this.stateWatchers = this.stateWatchers.filter((l) => l !== fn);
  }

  /** Combien d'écouteurs la connexion porte — zéro veut dire « on l'a lâchée ». */
  get watchers(): number {
    return this.channelWatchers.length + this.stateWatchers.length;
  }

  /** Le distant ouvre un canal de son côté. */
  incoming(dc: FakeChannel): void {
    for (const fn of this.channelWatchers) fn({ channel: dc });
  }

  /** La connexion change d'état — perte du réseau, reprise, raccrochage. */
  becomes(state: string): void {
    this.connectionState = state;
    for (const fn of this.stateWatchers) fn();
  }
}

const asPc = (pc: FakeConnection): RTCPeerConnection => pc as unknown as RTCPeerConnection;

/** Le canal de données de l'appel, du côté demandé. */
function dcChannel(pc: FakeConnection, role: "offer" | "answer", rec: Recorder): RttChannel {
  return listening(openRtt({ transport: "datachannel", connection: asPc(pc), role }), rec);
}

describe("fil canal de données", () => {
  /**
   * **Le battement qui tient le NAT ouvert.** SCTP roule sur DTLS, donc sur
   * UDP : une association de NAT ne survit qu'au trafic qui la traverse. Un
   * appel qui sonne — ou une annonce précoce, c'est-à-dire exactement le
   * moment où une passerelle a du texte à nous envoyer — peut ne rien
   * écrire pendant des minutes, et les sous-titres arriveraient alors
   * devant une porte fermée.
   *
   * Ce qu'on envoie est la signature de session, seul caractère de T.140
   * qui ne veut rien dire : le décodeur le consomme sans rien afficher, où
   * qu'il apparaisse dans le flux.
   */
  describe("battement de maintien", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("répète la signature toutes les 5 s tant que rien d'autre ne part", () => {
      const rec = recorder();
      const pc = new FakeConnection();
      dcChannel(pc, "offer", rec);
      const dc = pc.created[0]!;
      dc.open();
      expect(dc.sent).toEqual(["\uFEFF"]);

      vi.advanceTimersByTime(5000);
      expect(dc.sent).toEqual(["\uFEFF", "\uFEFF"]);
      vi.advanceTimersByTime(5000);
      expect(dc.sent).toHaveLength(3);
    });

    it("se tait quand la conversation entretient elle-même le chemin", () => {
      const rec = recorder();
      const pc = new FakeConnection();
      const ch = dcChannel(pc, "offer", rec);
      const dc = pc.created[0]!;
      dc.open();

      vi.advanceTimersByTime(4000);
      ch.send("bonjour");
      ch.flush();
      expect(dc.sent).toEqual(["\uFEFF", "bonjour"]);
      // le battement suivant tombe moins de 5 s après la frappe : rien
      vi.advanceTimersByTime(1500);
      expect(dc.sent).toEqual(["\uFEFF", "bonjour"]);
      // cinq secondes de silence plus tard, il reprend
      vi.advanceTimersByTime(5000);
      expect(dc.sent).toEqual(["\uFEFF", "bonjour", "\uFEFF"]);
    });

    it("bat même émission suspendue : c'est le chemin qu'il tient, pas la conversation", () => {
      const rec = recorder();
      const pc = new FakeConnection();
      const ch = dcChannel(pc, "offer", rec);
      const dc = pc.created[0]!;
      dc.open();
      ch.setSending(false);

      ch.send("rien ne doit partir");
      ch.flush();
      vi.advanceTimersByTime(5000);
      expect(dc.sent).toEqual(["\uFEFF", "\uFEFF"]);
    });

    it("s'arrête avec le canal", () => {
      const rec = recorder();
      const pc = new FakeConnection();
      const ch = dcChannel(pc, "offer", rec);
      const dc = pc.created[0]!;
      dc.open();
      ch.close();
      const after = dc.sent.length;
      vi.advanceTimersByTime(20_000);
      expect(dc.sent).toHaveLength(after);
    });
  });

  it("l'offrant crée un canal t140 fiable et ordonné, et signe la session", () => {
    const rec = recorder();
    const pc = new FakeConnection();
    const ch = dcChannel(pc, "offer", rec);

    const dc = pc.created[0]!;
    expect(dc.label).toBe(T140_CHANNEL);
    expect(dc.protocol).toBe(T140_CHANNEL);
    expect(pc.lastInit.ordered).toBe(true);
    // ni maxRetransmits ni maxPacketLifeTime : RFC 8865 §4.1 les interdit
    expect(pc.lastInit).not.toHaveProperty("maxRetransmits");
    expect(pc.lastInit).not.toHaveProperty("maxPacketLifeTime");
    expect(pc.lastInit).not.toHaveProperty("id");
    expect(pc.lastInit).not.toHaveProperty("negotiated");

    dc.open();
    expect(dc.sent).toEqual(["\uFEFF"]); // la signature ouvre le flux
    expect(ch.state()).toBe("open");

    ch.send("bonjour");
    expect(dc.sent).toEqual(["\uFEFF", "bonjour"]);
  });

  it("le répondant adopte le canal du distant, et ignore les autres", () => {
    const rec = recorder();
    const pc = new FakeConnection();
    const ch = dcChannel(pc, "answer", rec);
    expect(pc.created).toEqual([]);

    pc.incoming(new FakeChannel("fichiers", "bindl", 1));
    expect(ch.state()).toBe("connecting");

    const dc = new FakeChannel(T140_CHANNEL, T140_CHANNEL, 3);
    pc.incoming(dc);
    dc.open();
    expect(ch.state()).toBe("open");

    dc.onmessage?.({ data: "bonsoir" });
    expect(rec.received).toEqual(["bonsoir"]);
  });

  it("collision : le plus petit identifiant gagne, et le texte en vol ne se perd pas", () => {
    const rec = recorder();
    const pc = new FakeConnection();
    pc.nextId = 2;
    const ch = dcChannel(pc, "offer", rec);
    const mine = pc.created[0]!;
    mine.open();
    ch.send("déjà parti");
    ch.flush();

    // le distant a créé le sien : les deux extrémités voient les deux
    // identifiants, et retiennent le même canal
    const theirs = new FakeChannel(T140_CHANNEL, T140_CHANNEL, 1);
    pc.incoming(theirs);
    expect(mine.closed).toBe(true);

    // ce que le distant avait écrit sur le canal perdant arrive encore
    mine.onmessage?.({ data: "en vol" });
    expect(rec.received).toEqual(["en vol"]);

    theirs.open();
    ch.send("la suite");
    ch.flush();
    // rien n'est retransmis sur le canal retenu : la signature, puis la suite
    expect(theirs.sent).toEqual(["\uFEFF", "la suite"]);
    expect(pc.created.length).toBe(1);
  });

  it("collision : notre canal l'emporte quand son identifiant est le plus petit", () => {
    const rec = recorder();
    const pc = new FakeConnection();
    const ch = dcChannel(pc, "offer", rec);
    const mine = pc.created[0]!;
    mine.open();

    const theirs = new FakeChannel(T140_CHANNEL, T140_CHANNEL, 1);
    pc.incoming(theirs);
    expect(theirs.closed).toBe(true);
    expect(mine.closed).toBe(false);

    ch.send("bonjour");
    ch.flush();
    expect(mine.sent).toEqual(["\uFEFF", "bonjour"]);
    expect(ch.state()).toBe("open");
  });

  it("un canal perdu est rouvert par l'offrant, et rien n'est retransmis", () => {
    const rec = recorder();
    const pc = new FakeConnection();
    const ch = dcChannel(pc, "offer", rec);
    const first = pc.created[0]!;
    first.open();
    ch.send("avant la coupure");
    ch.flush();

    first.drop();
    expect(rec.states).toContain("lost");
    expect(pc.created.length).toBe(2);

    // ce qui est tapé pendant la coupure attend : il n'est jamais parti
    ch.send("pendant");
    const second = pc.created[1]!;
    second.open();
    ch.flush();

    expect(ch.state()).toBe("open");
    expect(second.sent).toEqual(["\uFEFF", "pendant"]);
    // le distant a écrit dans le vide : le fil le montre (T.140)
    expect(rec.received).toEqual(["\uFFFD"]);
  });

  it("le répondant ne recrée jamais rien : il attend le canal du distant", () => {
    const rec = recorder();
    const pc = new FakeConnection();
    const ch = dcChannel(pc, "answer", rec);
    const dc = new FakeChannel(T140_CHANNEL, T140_CHANNEL, 1);
    pc.incoming(dc);
    dc.open();

    dc.drop();
    expect(pc.created).toEqual([]);
    expect(ch.state()).toBe("lost");

    // le distant rouvre : le lien reprend, marqueur de perte à l'appui
    const again = new FakeChannel(T140_CHANNEL, T140_CHANNEL, 3);
    pc.incoming(again);
    again.open();
    expect(ch.state()).toBe("open");
    expect(rec.received).toEqual(["\uFFFD"]);
  });

  it("une connexion rompue puis rétablie retrouve son canal", () => {
    const rec = recorder();
    const pc = new FakeConnection();
    const ch = dcChannel(pc, "offer", rec);
    pc.created[0]!.open();

    // l'association SCTP est détruite : rien à rouvrir tant que la
    // connexion n'est pas revenue
    pc.becomes("failed");
    expect(ch.state()).toBe("lost");
    expect(pc.created.length).toBe(1);

    pc.becomes("connected");
    expect(pc.created.length).toBe(2);
    pc.created[1]!.open();
    expect(ch.state()).toBe("open");
  });

  it("une connexion fermée ferme le lien pour de bon", () => {
    const rec = recorder();
    const pc = new FakeConnection();
    const ch = dcChannel(pc, "offer", rec);
    pc.created[0]!.open();

    pc.becomes("closed");
    expect(ch.state()).toBe("closed");
    expect(pc.created.length).toBe(1);
  });

  it("fermer le canal détache l'écoute et ferme le fil", () => {
    const rec = recorder();
    const pc = new FakeConnection();
    const ch = dcChannel(pc, "answer", rec);
    expect(pc.watchers).toBe(2); // le canal du distant, et l'état de la connexion

    ch.close();
    expect(pc.watchers).toBe(0);
    expect(ch.state()).toBe("closed");
  });
});
