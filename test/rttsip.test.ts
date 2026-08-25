/**
 * Le branchement du texte sur WebSocket dans la signalisation.
 *
 * Ce qui se vérifie ici est la règle unique dont tout le reste découle :
 * **la section `m=text` est ajoutée à ce qui part, et retirée de ce qui
 * arrive** — Chrome ne doit jamais voir une description qu'il ne sait pas
 * lire. Puis les conséquences : l'URL annoncée ouvre le socket, un distant
 * qui n'en veut pas ferme le lien au lieu de le laisser espérer, et une
 * renégociation ne défait rien de ce qui marchait.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { negotiateRttOverWs, openRttFor, type SdpEvent } from "../src/sip/rttsip.js";
import type { RttState } from "../src/sip/rtt.js";
import { T140_CHANNEL } from "../src/sip/rttdc.js";

/** La connexion pair-à-pair, réduite à l'ouverture d'un canal de données. */
class FakePc {
  created: { label: string; protocol: string }[] = [];
  /**
   * L'association SCTP, telle que le navigateur la publie une fois la
   * section `m=application` négociée des deux côtés — `null` tant qu'elle
   * ne l'est pas, et si le distant l'a rejetée (port 0). C'est là-dessus,
   * et sur rien d'autre, que se lit « le texte est négocié » (ADR 0003, D1).
   */
  sctp: unknown = null;

  createDataChannel(label: string, init: { protocol?: string }): unknown {
    const dc = {
      label,
      protocol: init.protocol ?? "",
      readyState: "connecting",
      id: 0,
      onopen: null,
      onclose: null,
      onerror: null,
      onmessage: null,
      send() {},
      close() {},
    };
    this.created.push(dc);
    return dc;
  }

  addEventListener(): void {}
  removeEventListener(): void {}
}

/** Une session JsSIP réduite à ce que les deux transports lui demandent. */
class FakeSession {
  private listeners: ((e: SdpEvent) => void)[] = [];
  readonly pc = new FakePc();

  get connection(): RTCPeerConnection {
    return this.pc as unknown as RTCPeerConnection;
  }

  on(_event: "sdp" | "peerconnection", listener: (e: never) => void): void {
    this.listeners.push(listener as (e: SdpEvent) => void);
  }

  /** Combien d'écouteurs la session porte — zéro veut dire « on n'y touche pas ». */
  get watchers(): number {
    return this.listeners.length;
  }

  /** Joue un passage de SDP et rend ce que la session enverra (ou donnera à Chrome). */
  sdp(originator: "local" | "remote", type: "offer" | "answer", sdp: string): string {
    const e: SdpEvent = { originator, type, sdp };
    for (const l of this.listeners) l(e);
    return e.sdp;
  }
}

/** Le WebSocket du navigateur, réduit à ce que le fil en utilise. */
class FakeSocket {
  static readonly OPEN = 1;
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

  send(text: string): void {
    this.sent.push(text);
  }

  close(): void {
    this.readyState = 3;
  }
}

const lines = (...l: string[]): string => l.join("\r\n") + "\r\n";

/** Ce que le navigateur produit : audio et vidéo, jamais de texte. */
const LOCAL_OFFER = lines(
  "v=0",
  "o=- 1 1 IN IP4 127.0.0.1",
  "s=-",
  "m=audio 5000 UDP/TLS/RTP/SAVPF 111",
  "a=sendrecv",
  "m=video 5002 UDP/TLS/RTP/SAVPF 96",
  "a=sendrecv",
);

/** Ce que la passerelle répond : le texte accepté, avec l'URL de son socket. */
const REMOTE_ANSWER = lines(
  "v=0",
  "m=audio 5000 UDP/TLS/RTP/SAVPF 111",
  "a=sendrecv",
  "m=video 5002 UDP/TLS/RTP/SAVPF 96",
  "a=sendrecv",
  "m=text 60000 TCP/WSS t140",
  "a=wss://gw.example.fr/rtt/42",
);

/** Les sections média d'un SDP, dans l'ordre. */
const media = (sdp: string): string[] =>
  sdp
    .split(/\r?\n/)
    .filter((l) => l.startsWith("m="))
    .map((l) => l.split(/\s+/)[0]!.slice(2));

describe("négociation du texte sur WebSocket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeSocket);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("appelant : la section part dans l'offre, et ne revient pas jusqu'à Chrome", () => {
    const session = new FakeSession();
    const { channel } = negotiateRttOverWs(session);

    const offer = session.sdp("local", "offer", LOCAL_OFFER);
    expect(media(offer)).toEqual(["audio", "video", "text"]);
    expect(offer).toContain("m=text 60000 TCP/WSS t140");

    // ce que JsSIP donnera à setRemoteDescription : le texte n'y est plus,
    // et la réponse compte donc autant de sections que l'offre du navigateur
    const answer = session.sdp("remote", "answer", REMOTE_ANSWER);
    expect(media(answer)).toEqual(["audio", "video"]);
    expect(answer).not.toContain("t140");

    // l'URL annoncée a ouvert le socket
    expect(FakeSocket.instances[0]?.url).toBe("wss://gw.example.fr/rtt/42");
    expect(channel.state()).toBe("connecting");
    FakeSocket.instances[0]!.open();
    expect(channel.state()).toBe("open");
  });

  it("le texte tapé pendant la sonnerie part à l'ouverture du socket", () => {
    const session = new FakeSession();
    const { channel } = negotiateRttOverWs(session);
    session.sdp("local", "offer", LOCAL_OFFER);

    channel.send("bonjour");
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.instances.length).toBe(0); // pas encore de socket

    session.sdp("remote", "answer", REMOTE_ANSWER);
    FakeSocket.instances[0]!.open();
    expect(FakeSocket.instances[0]!.sent).toEqual(["bonjour"]);
  });

  it("appelé : la section est retirée de l'offre, et rendue à sa place dans la réponse", () => {
    const session = new FakeSession();
    negotiateRttOverWs(session);

    // l'INVITE entrant propose le texte **entre** l'audio et la vidéo
    const remoteOffer = lines(
      "v=0",
      "m=audio 5000 UDP/TLS/RTP/SAVPF 111",
      "m=text 60000 TCP/WSS t140",
      "a=wss://gw.example.fr/rtt/7",
      "m=video 5002 UDP/TLS/RTP/SAVPF 96",
    );
    expect(media(session.sdp("remote", "offer", remoteOffer))).toEqual(["audio", "video"]);
    expect(FakeSocket.instances[0]?.url).toBe("wss://gw.example.fr/rtt/7");

    // la réponse du navigateur n'a que deux sections : le texte reprend le
    // rang qu'il occupait dans l'offre, comme l'exige RFC 3264
    const localAnswer = lines(
      "v=0",
      "m=audio 5000 UDP/TLS/RTP/SAVPF 111",
      "m=video 5002 UDP/TLS/RTP/SAVPF 96",
    );
    expect(media(session.sdp("local", "answer", localAnswer))).toEqual(["audio", "text", "video"]);
  });

  it("appelé sans texte dans l'offre : on n'en propose pas dans la réponse", () => {
    const session = new FakeSession();
    const { channel } = negotiateRttOverWs(session);

    const remoteOffer = lines("v=0", "m=audio 5000 UDP/TLS/RTP/SAVPF 111");
    session.sdp("remote", "offer", remoteOffer);
    const localAnswer = lines("v=0", "m=audio 5000 UDP/TLS/RTP/SAVPF 111");
    expect(media(session.sdp("local", "answer", localAnswer))).toEqual(["audio"]);
    // rien à espérer : le lien est clos, l'interface peut le dire
    expect(channel.state()).toBe("closed");
    expect(FakeSocket.instances.length).toBe(0);
  });

  it("distant qui refuse le texte : le lien se ferme au lieu d'attendre", () => {
    const session = new FakeSession();
    const { channel } = negotiateRttOverWs(session);
    session.sdp("local", "offer", LOCAL_OFFER);

    const states: RttState[] = [];
    channel.listen({ text: () => {}, state: (s) => states.push(s) });

    // RFC 3264 : un média refusé revient avec un port nul
    const refused = lines(
      "v=0",
      "m=audio 5000 UDP/TLS/RTP/SAVPF 111",
      "m=video 5002 UDP/TLS/RTP/SAVPF 96",
      "m=text 0 TCP/WSS t140",
    );
    expect(media(session.sdp("remote", "answer", refused))).toEqual(["audio", "video"]);
    expect(channel.state()).toBe("closed");
    expect(states).toEqual(["connecting", "closed"]);
    expect(FakeSocket.instances.length).toBe(0);
  });

  it("re-INVITE : ni deuxième section, ni deuxième socket, ni lien perdu", () => {
    const session = new FakeSession();
    const { channel } = negotiateRttOverWs(session);
    session.sdp("local", "offer", LOCAL_OFFER);
    session.sdp("remote", "answer", REMOTE_ANSWER);
    FakeSocket.instances[0]!.open();

    // notre re-INVITE (ajout de la vidéo) : une seule section texte
    const again = session.sdp("local", "offer", LOCAL_OFFER);
    expect(media(again).filter((m) => m === "text").length).toBe(1);

    // la passerelle répond cette fois sans parler du texte : le socket
    // ouvert n'a aucune raison de se refermer
    const quiet = lines("v=0", "m=audio 5000 UDP/TLS/RTP/SAVPF 111", "m=video 5002 UDP/TLS/RTP/SAVPF 96");
    session.sdp("remote", "answer", quiet);
    expect(channel.state()).toBe("open");
    expect(FakeSocket.instances.length).toBe(1);
  });

  it("« aucun » ne touche à rien : ni lien, ni écouteur, ni SDP modifié", () => {
    const session = new FakeSession();
    expect(openRttFor("none", session, "offer")).toBeNull();
    expect(session.watchers).toBe(0);
    // le SDP sort tel qu'il est entré : l'appel se négocie comme avant
    expect(session.sdp("local", "offer", LOCAL_OFFER)).toBe(LOCAL_OFFER);
  });

  it("le canal de données ne touche pas au SDP : il ouvre son canal, et c'est tout", () => {
    const session = new FakeSession();
    const nego = openRttFor("datachannel", session, "offer");

    expect(nego).not.toBeNull();
    // aucun écouteur `sdp` : l'offre part telle que le navigateur l'a écrite
    expect(session.watchers).toBe(0);
    expect(session.pc.created.map((dc) => [dc.label, dc.protocol])).toEqual([
      [T140_CHANNEL, T140_CHANNEL],
    ]);
  });

  it("le canal de données côté répondant ne crée rien et n'écrit rien", () => {
    const session = new FakeSession();
    openRttFor("datachannel", session, "answer");
    expect(session.watchers).toBe(0);
    expect(session.pc.created).toEqual([]);
  });

  it("le texte reçu remonte au canal, et la fin d'appel ferme le socket", () => {
    const session = new FakeSession();
    const nego = negotiateRttOverWs(session);
    session.sdp("local", "offer", LOCAL_OFFER);
    session.sdp("remote", "answer", REMOTE_ANSWER);
    const socket = FakeSocket.instances[0]!;
    socket.open();

    // arrivé avant que le panneau ne s'abonne : rien ne se perd
    socket.onmessage?.({ data: "bon" });
    const seen: string[] = [];
    nego.channel.listen({ text: (t) => seen.push(t), state: () => {} });
    socket.onmessage?.({ data: "jour" });
    expect(seen.join("")).toBe("bonjour");

    nego.close();
    expect(socket.readyState).toBe(3);
    expect(nego.channel.state()).toBe("closed");
  });
});

/**
 * **« Négocié » n'est pas « ouvert »** — ADR 0003, D1. C'est la nuance que
 * `CallMedia.text` porte et que `RttChannel.state` ne porte pas : les deux
 * bouts peuvent être convenus du texte alors que le lien n'est pas encore
 * là. Sur canal de données, c'est même le cas normal — DCEP ouvre le canal
 * après le 200 OK. Confondre les deux ferait clignoter l'écran d'appel à
 * chaque seconde de latence du réseau.
 */
describe("le texte négocié, et le lien ouvert", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeSocket);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("WebSocket : rien n'est négocié avant que le distant ait annoncé son socket", () => {
    const session = new FakeSession();
    const nego = negotiateRttOverWs(session);
    expect(nego.negotiated()).toBe(false);

    // notre offre porte le texte, mais offrir n'est pas convenir
    session.sdp("local", "offer", LOCAL_OFFER);
    expect(nego.negotiated()).toBe(false);

    session.sdp("remote", "answer", REMOTE_ANSWER);
    expect(nego.negotiated()).toBe(true);
    // et le lien, lui, n'est pas encore ouvert : c'est toute la nuance
    expect(nego.channel.state()).toBe("connecting");

    FakeSocket.instances[0]!.open();
    expect(nego.channel.state()).toBe("open");
    expect(nego.negotiated()).toBe(true);
  });

  it("WebSocket : un distant qui refuse le texte ne le fait jamais passer négocié", () => {
    const session = new FakeSession();
    const nego = negotiateRttOverWs(session);
    session.sdp("local", "offer", LOCAL_OFFER);
    session.sdp("remote", "answer", LOCAL_OFFER); // sans section texte
    expect(nego.negotiated()).toBe(false);
    expect(nego.channel.state()).toBe("closed");
  });

  it("canal de données : négocié à l'association SCTP, ouvert bien plus tard", () => {
    const session = new FakeSession();
    const nego = openRttFor("datachannel", session, "offer")!;
    // le canal est créé avant la première offre : il existe, il n'est
    // convenu de rien
    expect(session.pc.created).toHaveLength(1);
    expect(nego.negotiated()).toBe(false);

    session.pc.sctp = { state: "connected" };
    expect(nego.negotiated()).toBe(true);
    // DCEP n'a pas encore ouvert le canal `t140` : `text: true` avec un
    // lien `connecting` est un état normal, et non une incohérence
    expect(nego.channel.state()).toBe("connecting");
  });

  it("canal de données rejeté par le distant : pas de SCTP, pas de texte", () => {
    const session = new FakeSession();
    const nego = openRttFor("datachannel", session, "offer")!;
    expect(nego.negotiated()).toBe(false);
  });
});
