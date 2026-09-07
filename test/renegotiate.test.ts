/**
 * La négociation des médias en cours d'appel, côté port (ADR 0003, D5).
 *
 * Trois choses s'y jouent, et aucune n'est visible depuis le bloc :
 *
 * - **la symétrie** — le micro et la caméra suivent le même chemin, au
 *   média près. Une asymétrie qui s'y installerait ramènerait le micro au
 *   rang de sourdine, ce que D6 écarte ;
 * - **le retour arrière** — un refus laisse la connexion en
 *   `have-local-offer` ; sans le rollback, plus aucune renégociation ne
 *   serait possible de tout l'appel ;
 * - **le glare** — les deux bouts renégocient en même temps, le 491 tombe,
 *   et l'on reprend **une** fois après un délai aléatoire (RFC 3261 §14.1).
 *   S'entêter au-delà ferait boucler deux clients face à face, ce que le
 *   délai seul n'empêche pas.
 *
 * Le tout avec une session et une connexion factices : ce qu'on éprouve est
 * l'enchaînement, pas la pile WebRTC.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mediaControl, wrapSession } from "../src/sip/port.js";
import type { RttChannel } from "../src/sip/rtt.js";
import type { CallSipEvent, MediaKind } from "../src/sip/port.js";

/**
 * Une piste, avec ce que la Pause en utilise : `muted` côté réception, et
 * les deux événements qui le signalent.
 */
class FakeTrack {
  muted = true; // une piste distante l'est tant que rien n'est arrivé
  stopped = false;
  /** Désactivée, une piste émet du noir et du silence — et non plus rien. */
  enabled = true;
  private listeners: Record<string, (() => void)[]> = {};

  constructor(readonly kind: string) {}

  stop(): void {
    this.stopped = true;
  }

  addEventListener(event: string, fn: () => void): void {
    (this.listeners[event] ??= []).push(fn);
  }

  /** Le flux arrive, ou se tait : c'est ainsi qu'une pause distante se voit. */
  setMuted(muted: boolean): void {
    if (this.muted === muted) return;
    this.muted = muted;
    for (const fn of this.listeners[muted ? "mute" : "unmute"] ?? []) fn();
  }
}

/** Un transceiver réduit à ce que le contrôle média lui demande. */
class FakeTransceiver {
  direction = "sendrecv";
  currentDirection: string | null = "sendrecv";
  /**
   * **L'identité de la m-section** (RFC 5888). C'est par elle, et par elle
   * seule, que le port reconnaît le partage du distant (ADR 0005, D2) —
   * ni l'ordre ni le `msid` ne survivent à une renégociation.
   */
  mid: string | null = null;
  readonly sender: {
    track: MediaStreamTrack | null;
    replaceTrack(t: MediaStreamTrack | null): Promise<void>;
  };
  readonly receiver: { track: MediaStreamTrack | null };
  /** La piste que nous émettons, telle que le test la reconnaît. */
  readonly sent: FakeTrack;
  readonly received: FakeTrack;

  constructor(
    readonly kind: MediaKind,
    mid: string | null = null,
  ) {
    this.mid = mid;
    this.sent = new FakeTrack(kind);
    this.received = new FakeTrack(kind);
    this.sender = {
      track: this.sent as unknown as MediaStreamTrack,
      replaceTrack: (t) => {
        this.sender.track = t;
        return Promise.resolve();
      },
    };
    this.receiver = { track: this.received as unknown as MediaStreamTrack };
  }
}

class FakePc {
  signalingState = "stable";
  private listeners: (() => void)[] = [];
  readonly transceivers: FakeTransceiver[] = [];
  /** Les retours arrière demandés — c'est eux qu'on compte. */
  rollbacks = 0;

  constructor(kinds: MediaKind[]) {
    for (const k of kinds) this.addTransceiver(k);
  }

  /**
   * Une m-section de plus, avec le MID suivant — comme le navigateur les
   * numérote. C'est ainsi qu'arrive un partage : en fin de liste, jamais en
   * remplacement (RFC 8829 §5.2.2).
   */
  addTransceiver(kind: MediaKind): FakeTransceiver {
    const tr = new FakeTransceiver(kind, String(this.transceivers.length));
    this.transceivers.push(tr);
    return tr;
  }

  getTransceivers(): RTCRtpTransceiver[] {
    return this.transceivers as unknown as RTCRtpTransceiver[];
  }

  getReceivers(): RTCRtpReceiver[] {
    return this.transceivers.map((t) => t.receiver) as unknown as RTCRtpReceiver[];
  }

  /** Le correspondant émet, ou se tait : les deux pistes ensemble. */
  peerSends(live: boolean): void {
    for (const t of this.transceivers) t.received.setMuted(!live);
  }

  /**
   * Les écouteurs sont rangés par type, comme sur une vraie connexion :
   * `signalingstatechange` et `track` n'ont ni la même signature ni le même
   * moment, et les confondre ferait passer au second un événement vide.
   */
  addEventListener(type: string, fn: () => void): void {
    if (type === "signalingstatechange") this.listeners.push(fn);
  }

  /**
   * Asynchrone, comme la vraie : c'est ce qui décide de l'**ordre** des
   * événements vus par le bloc. Le refus part sur-le-champ ; le retour à
   * `stable` que le rollback provoque n'arrive qu'après, et republie
   * l'appel tel qu'il était resté. Un faux synchrone inverserait les deux
   * et ferait passer un test qui ment.
   */
  setLocalDescription(d: { type: string }): Promise<void> {
    if (d.type !== "rollback") return Promise.resolve();
    return Promise.resolve().then(() => {
      this.rollbacks++;
      this.settle("stable");
    });
  }

  /** Passe la connexion dans un état de signalisation et prévient l'observateur. */
  settle(state: string): void {
    this.signalingState = state;
    for (const l of this.listeners) l();
  }

  addTrack(): void {}
}

type Handlers = { succeeded(r: unknown): void; failed(r?: unknown): void };

/** Une session JsSIP réduite à ce que `mediaControl` en utilise. */
class FakeSession {
  readonly pc: FakePc;
  direction = "outgoing";
  ready = true;
  ended = false;
  /** Les re-INVITE partis, dans l'ordre : c'est le compteur du glare. */
  reinvites: Handlers[] = [];
  private sdpListeners: ((e: { originator: string; type: string; sdp: string }) => void)[] = [];

  constructor(kinds: MediaKind[] = ["audio"]) {
    this.pc = new FakePc(kinds);
  }

  get connection(): RTCPeerConnection {
    return this.pc as unknown as RTCPeerConnection;
  }

  isEnded(): boolean {
    return this.ended;
  }

  /**
   * Le dialogue tel que JsSIP le tient : tant qu'un INVITE que nous avons
   * émis y attend sa réponse finale, plus rien ne peut se renégocier
   * (RFC 3261 §14.2). C'est ce drapeau, et non un état à nous, qui décide
   * de `isReadyToReOffer()`.
   */
  readonly _dialog = { uac_pending_reply: false };

  isReadyToReOffer(): boolean {
    return this.ready && !this._dialog.uac_pending_reply;
  }

  /**
   * Les gestionnaires sont enveloppés comme JsSIP le fait : la transaction
   * se termine — donc le drapeau retombe — **avant** que le résultat ne
   * soit remis à son appelant. Une offre que rien ne conclut, elle, le
   * laisse levé : c'est tout l'objet de `abandonMedia()`.
   */
  _sendReinvite(opts: { eventHandlers: Handlers }): void {
    const h = opts.eventHandlers;
    this._dialog.uac_pending_reply = true;
    this.reinvites.push({
      succeeded: (r) => {
        this._dialog.uac_pending_reply = false;
        h.succeeded(r);
      },
      failed: (r) => {
        this._dialog.uac_pending_reply = false;
        h.failed(r);
      },
    });
    this.pc.signalingState = "have-local-offer";
  }

  /** Le re-INVITE laissé à JsSIP : le port n'a pas eu de question à poser. */
  passedThrough = false;
  /** Le code de la réponse que le port a écrite lui-même, s'il l'a fait. */
  replied: number | null = null;

  _receiveReinvite(_request: { body?: string | null; reply(code: number): void }): void {
    this.passedThrough = true;
  }

  /**
   * Le distant renégocie. Le port a remplacé `_receiveReinvite` par le
   * sien : c'est bien celui-là qui répond, et le nôtre ne sert plus que de
   * témoin du laissez-passer.
   */
  receiveReinvite(sdp: string): void {
    this._receiveReinvite({
      body: sdp,
      reply: (code: number) => {
        this.replied = code;
      },
    });
  }

  /**
   * Ce que JsSIP fait d'une transaction expirée : il raccroche (408). Le
   * drapeau sert à vérifier qu'on ne l'a **pas** laissé faire quand c'est
   * notre re-INVITE qui est resté sans réponse — et qu'on le laisse faire
   * partout ailleurs.
   */
  hungUpOnTimeout = false;

  onRequestTimeout(): void {
    this.hungUpOnTimeout = true;
    this.ended = true;
  }

  /** Le délai de la transaction expire — Timer B, RFC 3261 §17.1.1.2. */
  timeOut(): void {
    this.onRequestTimeout();
  }

  private listeners: Record<string, ((e: never) => void)[]> = {};

  on(event: string, listener: (e: never) => void): void {
    if (event === "sdp") this.sdpListeners.push(listener as never);
    (this.listeners[event] ??= []).push(listener);
  }

  /** Joue un événement de session — `accepted` est celui qui rend la parole. */
  emit(event: string): void {
    for (const l of this.listeners[event] ?? []) (l as () => void)();
  }

  /** Joue un passage de SDP et rend ce qui partira sur le fil. */
  sdp(originator: "local" | "remote", type: "offer" | "answer", sdp: string): string {
    const e = { originator, type, sdp };
    for (const l of this.sdpListeners) l(e);
    return e.sdp;
  }
}

/** Le contrôle média branché sur une session factice, et ce qu'il émet. */
function control(kinds: MediaKind[] = ["audio"], textNegotiated = false) {
  const session = new FakeSession(kinds);
  const events: CallSipEvent[] = [];
  const ctl = mediaControl(
    session as never,
    (ev) => events.push(ev),
    () => textNegotiated,
  );
  return { session, events, ctl };
}

/** Le capteur s'ouvre sans qu'aucun navigateur ne soit là pour le fournir. */
function stubUserMedia(ok = true): void {
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: (c: Record<string, boolean>) => {
        if (!ok) return Promise.reject(new Error("NotAllowedError"));
        const kind = Object.keys(c)[0]!;
        return Promise.resolve({
          getTracks: () => [{ kind, stop: () => {} }],
        });
      },
    },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  stubUserMedia();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("les deux médias suivent le même chemin", () => {
  for (const kind of ["audio", "video"] as const) {
    it(`retirer ${kind} : le transceiver passe inactive et le re-INVITE part`, () => {
      const { session, ctl } = control(["audio", "video"]);
      ctl.setMedia(kind, false);
      expect(session.reinvites).toHaveLength(1);
      expect(session.pc.transceivers.find((t) => t.kind === kind)!.direction).toBe("inactive");
    });

    it(`ajouter ${kind} : le capteur s'ouvre avant que l'offre ne parte`, async () => {
      const { session, ctl } = control(["audio", "video"]);
      ctl.setMedia(kind, true);
      // le capteur s'ouvre de façon asynchrone : rien n'est parti avant
      expect(session.reinvites).toHaveLength(0);
      await vi.runAllTimersAsync();
      expect(session.reinvites).toHaveLength(1);
      expect(session.pc.transceivers.find((t) => t.kind === kind)!.direction).toBe("sendrecv");
    });

    it(`ajouter ${kind} avec un capteur refusé : rien ne part, et l'écran le dit`, async () => {
      stubUserMedia(false);
      const { session, events, ctl } = control(["audio", "video"]);
      ctl.setMedia(kind, true);
      await vi.runAllTimersAsync();
      expect(session.reinvites).toHaveLength(0);
      expect(events).toEqual([{ type: "sip:mediaRefused", by: "local" }]);
    });
  }

  it("une renégociation déjà en vol est refusée sur place, sans seconde offre", () => {
    const { session, events, ctl } = control(["audio", "video"]);
    session.ready = false;
    ctl.setMedia("video", false);
    expect(session.reinvites).toHaveLength(0);
    expect(events).toEqual([{ type: "sip:mediaRefused", by: "local" }]);
  });
});

describe("le refus du distant", () => {
  it("488 : le refus part d'abord, le retour arrière republie ensuite", async () => {
    const { session, events, ctl } = control(["audio", "video"]);
    ctl.setMedia("video", false);
    session.reinvites[0]!.failed({ message: { status_code: 488 } });

    // l'ordre compte : le bloc quitte `renegotiating` sur le refus, et le
    // `mediaChanged` du retour arrière ne fait plus que confirmer ce que
    // l'appel transportait déjà
    expect(events).toEqual([{ type: "sip:mediaRefused", by: "remote", statusCode: 488 }]);
    await vi.runAllTimersAsync();
    expect(session.pc.rollbacks).toBe(1);
    expect(events[1]).toEqual({
      type: "sip:mediaChanged",
      media: { audio: true, video: true, text: false },
    });
  });

  /**
   * Le refus poli : 200 OK, mais la réponse SDP désactive le flux. Sans ce
   * rattrapage, l'écran dirait que la vidéo a été ajoutée alors que rien
   * n'arrive.
   */
  it("200 OK dont la réponse désactive le flux : c'est un non, et il se dit", async () => {
    const { session, events, ctl } = control(["audio", "video"]);
    ctl.setMedia("video", true);
    await vi.runAllTimersAsync();
    session.reinvites[0]!.succeeded({
      body: ["v=0", "m=audio 5000 RTP/SAVPF 111", "m=video 5002 RTP/SAVPF 96", "a=inactive"].join(
        "\r\n",
      ),
    });
    expect(events).toEqual([{ type: "sip:mediaRefused", by: "remote" }]);
  });

  it("sans réponse du tout, ce n'est pas un refus du distant", async () => {
    const { session, events, ctl } = control(["audio", "video"]);
    ctl.setMedia("video", false);
    session.reinvites[0]!.failed(undefined);
    expect(events).toEqual([{ type: "sip:mediaRefused", by: "local", statusCode: undefined }]);
    // et le retour arrière n'y ajoute aucun refus de plus
    await vi.runAllTimersAsync();
    expect(events.filter((e) => e.type === "sip:mediaRefused")).toHaveLength(1);
  });
});

/**
 * **Le re-INVITE resté sans réponse.** Le distant ne conclut rien — un
 * client qui ne sait pas répondre à une offre en cours d'appel, un
 * correspondant parti sans trancher la question posée à son écran. JsSIP
 * en tire un 408 et **raccroche** ; or personne n'a mis fin à l'appel, qui
 * doit continuer sans le média demandé.
 */
describe("le silence du distant ne coupe pas l'appel", () => {
  it("ajout resté sans réponse : la communication tient, le capteur se referme", async () => {
    const { session, events, ctl } = control(["audio", "video"]);
    ctl.setMedia("video", true);
    await vi.runAllTimersAsync();
    expect(session.reinvites).toHaveLength(1);

    session.timeOut();

    expect(session.hungUpOnTimeout).toBe(false);
    expect(session.ended).toBe(false);
    expect(events).toEqual([{ type: "sip:mediaRefused", by: "local", statusCode: undefined }]);
    await vi.runAllTimersAsync();
    expect(session.pc.rollbacks).toBe(1);
    expect(session.pc.transceivers.find((t) => t.kind === "video")!.direction).toBe("inactive");
  });

  /**
   * Sans le retour arrière, la connexion resterait en `have-local-offer` et
   * plus rien ne se négocierait de tout l'appel : le silence du distant
   * coûterait les médias pour de bon, faute de couper la communication.
   */
  it("et la renégociation suivante part quand même", async () => {
    const { session, ctl } = control(["audio", "video"]);
    ctl.setMedia("video", true);
    await vi.runAllTimersAsync();
    session.timeOut();
    await vi.runAllTimersAsync();

    ctl.setMedia("video", true);
    await vi.runAllTimersAsync();
    expect(session.reinvites).toHaveLength(2);
  });

  it("un délai qui n'est pas celui de notre offre garde son effet", () => {
    const { session } = control(["audio", "video"]);
    session.timeOut();
    expect(session.hungUpOnTimeout).toBe(true);
  });
});

/**
 * **Le distant qui accuse réception puis se tait.** La transaction serveur
 * répond 100 Trying toute seule ; ce 1xx rend le Timer B du demandeur
 * inerte (il ne tranche qu'en `Calling`), et plus rien côté SIP ne conclura
 * l'offre. C'est le délai **côté utilisateur** qui tranche, et il n'a qu'un
 * mot à dire au port : `abandonMedia()`.
 */
describe("l'offre retirée par le délai côté utilisateur", () => {
  it("retour arrière, capteur refermé, et le dialogue rendu disponible", async () => {
    const { session, events, ctl } = control(["audio", "video"]);
    ctl.setMedia("video", true);
    await vi.runAllTimersAsync();
    // l'offre est en vol : rien ne se renégocierait tant qu'elle y reste
    expect(session._dialog.uac_pending_reply).toBe(true);
    expect(session.isReadyToReOffer()).toBe(false);

    ctl.abandonMedia();

    expect(events).toEqual([{ type: "sip:mediaRefused", by: "local", statusCode: undefined }]);
    expect(session._dialog.uac_pending_reply).toBe(false);
    expect(session.isReadyToReOffer()).toBe(true);
    await vi.runAllTimersAsync();
    expect(session.pc.rollbacks).toBe(1);
    expect(session.pc.transceivers.find((t) => t.kind === "video")!.direction).toBe("inactive");
  });

  it("et la vidéo peut être redemandée juste après", async () => {
    const { session, ctl } = control(["audio", "video"]);
    ctl.setMedia("video", true);
    await vi.runAllTimersAsync();
    ctl.abandonMedia();
    await vi.runAllTimersAsync();

    ctl.setMedia("video", true);
    await vi.runAllTimersAsync();
    expect(session.reinvites).toHaveLength(2);
  });

  /**
   * Le délai peut tomber pendant l'attente d'une reprise après 491. Celle-ci
   * gardait le capteur ouvert pour le réoffrir : il n'y a plus rien à
   * réoffrir, et personne d'autre ne l'éteindra.
   */
  it("pendant l'attente d'une reprise après 491 : la reprise ne part pas", async () => {
    const { session, events, ctl } = control(["audio", "video"]);
    ctl.setMedia("video", true);
    await vi.runAllTimersAsync();
    session.reinvites[0]!.failed({ message: { status_code: 491 } });

    ctl.abandonMedia();
    vi.advanceTimersByTime(10_000);

    expect(session.reinvites).toHaveLength(1);
    expect(events).toEqual([{ type: "sip:mediaRefused", by: "local", statusCode: undefined }]);
    await vi.runAllTimersAsync();
    expect(session.pc.transceivers.find((t) => t.kind === "video")!.direction).toBe("inactive");
  });

  it("sans offre en vol, il n'y a rien à retirer", () => {
    const { session, events, ctl } = control(["audio", "video"]);
    ctl.abandonMedia();
    expect(events).toEqual([]);
    expect(session.pc.rollbacks).toBe(0);
  });
});

/**
 * **Le glare** — RFC 3261 §14.1. Les deux bouts ont renégocié en même
 * temps ; le 491 arrive ; on reprend une fois, après un délai aléatoire
 * dont les bornes sont disjointes selon le rôle.
 */
describe("le 491 et sa reprise unique", () => {
  it("reprend une fois, après un délai, et ne prévient l'écran de rien", async () => {
    const { session, events, ctl } = control(["audio", "video"]);
    ctl.setMedia("video", false);
    session.reinvites[0]!.failed({ message: { status_code: 491 } });

    // rien n'est encore reparti, et l'écran n'a pas été dérangé : l'appel
    // n'a pas changé, il est seulement en train d'attendre
    expect(session.reinvites).toHaveLength(1);
    expect(events).toEqual([]);
    await Promise.resolve();
    expect(session.pc.rollbacks).toBe(1);

    vi.advanceTimersByTime(4000);
    expect(session.reinvites).toHaveLength(2);
    expect(events).toEqual([]);
  });

  /**
   * Le retour arrière ramène la connexion à `stable` : sans précaution,
   * l'observateur y verrait un appel qui vient de perdre son média et
   * l'annoncerait — un changement qui n'a pas eu lieu.
   */
  it("le retour arrière de la reprise n'annonce aucun changement de média", async () => {
    const { session, events, ctl } = control(["audio", "video"]);
    ctl.setMedia("video", true);
    await vi.runAllTimersAsync();
    session.reinvites[0]!.failed({ message: { status_code: 491 } });
    // le rollback ramène la connexion à `stable`, et l'observateur y verrait
    // un appel qui vient de perdre son média : `resuming` l'en empêche
    await Promise.resolve();
    expect(events).toEqual([]);
  });

  it("un second 491 met fin aux tentatives : on ne boucle pas face à face", () => {
    const { session, events, ctl } = control(["audio", "video"]);
    ctl.setMedia("video", false);
    session.reinvites[0]!.failed({ message: { status_code: 491 } });
    vi.advanceTimersByTime(4000);
    session.reinvites[1]!.failed({ message: { status_code: 491 } });
    vi.advanceTimersByTime(10_000);

    expect(session.reinvites).toHaveLength(2);
    expect(events).toEqual([{ type: "sip:mediaRefused", by: "remote", statusCode: 491 }]);
  });

  it("le distant a repris la main entre-temps : on renonce au lieu de le bousculer", () => {
    const { session, events, ctl } = control(["audio", "video"]);
    ctl.setMedia("video", false);
    session.reinvites[0]!.failed({ message: { status_code: 491 } });
    // sa négociation à lui a abouti pendant notre attente
    session.ready = false;
    vi.advanceTimersByTime(4000);

    expect(session.reinvites).toHaveLength(1);
    expect(events).toEqual([{ type: "sip:mediaRefused", by: "local" }]);
  });

  it("l'appel raccroché pendant l'attente : la reprise ne part pas", () => {
    const { session, events, ctl } = control(["audio", "video"]);
    ctl.setMedia("video", false);
    session.reinvites[0]!.failed({ message: { status_code: 491 } });
    session.ended = true;
    vi.advanceTimersByTime(4000);

    expect(session.reinvites).toHaveLength(1);
    expect(events).toEqual([]);
  });

  /**
   * Les deux bornes de RFC 3261 §14.1 sont **disjointes** — 0 à 2 s pour
   * l'UAC, 2,1 à 4 s pour l'UAS — et c'est cela seul qui empêche les deux
   * bouts de se recroiser à l'identique.
   */
  it("les bornes du délai dépendent du rôle dans le dialogue", () => {
    for (const [direction, min, max] of [
      ["outgoing", 0, 2000],
      ["incoming", 2100, 4000],
    ] as const) {
      const { session, ctl } = control(["audio", "video"]);
      session.direction = direction;
      ctl.setMedia("video", false);
      session.reinvites[0]!.failed({ message: { status_code: 491 } });

      // juste avant la borne basse, rien n'est reparti
      if (min > 0) {
        vi.advanceTimersByTime(min - 1);
        expect(session.reinvites).toHaveLength(1);
      }
      vi.advanceTimersByTime(max - Math.max(0, min - 1));
      expect(session.reinvites).toHaveLength(2);
    }
  });
});

/**
 * La réponse SDP qui retranche un média de l'offre. C'est ce qui permet de
 * répondre « texte seul » à une offre audio + texte sans laisser l'appelant
 * parler dans le vide (ADR 0003, D3).
 */
describe("refuser un média dans la réponse", () => {
  it("réécrit la réponse locale, et elle seule", () => {
    const { session, ctl } = control(["audio", "video"]);
    ctl.refuseMedia(["audio"]);
    const sdp = ["v=0", "m=audio 5000 RTP/SAVPF 111", "a=sendrecv", ""].join("\r\n");

    expect(session.sdp("local", "answer", sdp)).toContain("a=inactive");
    // l'offre locale et tout ce qui vient du distant traversent inchangés
    expect(session.sdp("local", "offer", sdp)).toContain("a=sendrecv");
    expect(session.sdp("remote", "answer", sdp)).toContain("a=sendrecv");
  });

  it("les deux médias peuvent être retranchés ensemble", () => {
    const { session, ctl } = control(["audio", "video"]);
    ctl.refuseMedia(["audio", "video"]);
    const sdp = [
      "v=0",
      "m=audio 5000 RTP/SAVPF 111",
      "a=sendrecv",
      "m=video 5002 RTP/SAVPF 96",
      "a=sendrecv",
      "",
    ].join("\r\n");
    expect(session.sdp("local", "answer", sdp).match(/a=inactive/g)).toHaveLength(2);
  });
});

/**
 * **La Pause** (ADR 0003, D6 et D7). Ce qui s'y vérifie tient en une
 * phrase : *rien ne part sur le fil*. C'est de là que vient toute sa
 * valeur — pas de négociation, donc pas d'échec possible, donc un geste
 * qu'on peut faire quand on sonne à la porte.
 */
describe("la Pause", () => {
  it("lâche les deux émetteurs, et n'envoie rien du tout", () => {
    const { session, events, ctl } = control(["audio", "video"]);
    ctl.setPaused(true);

    for (const tr of session.pc.transceivers) expect(tr.sender.track).toBeNull();
    // ni re-INVITE, ni événement : l'appel n'a pas changé
    expect(session.reinvites).toEqual([]);
    expect(events).toEqual([]);
  });

  /**
   * Les pistes ne sont **pas** arrêtées : la reprise doit être instantanée,
   * et rouvrir un capteur prendrait du temps — voire échouerait, ce qu'un
   * geste sans échec ne peut pas se permettre.
   */
  it("la reprise rattache les mêmes pistes, sans rien rouvrir", () => {
    const { session, ctl } = control(["audio", "video"]);
    const before = session.pc.transceivers.map((t) => t.sender.track);
    ctl.setPaused(true);
    ctl.setPaused(false);

    expect(session.pc.transceivers.map((t) => t.sender.track)).toEqual(before);
    for (const tr of session.pc.transceivers) expect(tr.sent.stopped).toBe(false);
    expect(session.reinvites).toEqual([]);
  });

  it("mise en pause deux fois : la seconde ne perd pas les pistes tenues", () => {
    const { session, ctl } = control(["audio", "video"]);
    const before = session.pc.transceivers.map((t) => t.sender.track);
    ctl.setPaused(true);
    ctl.setPaused(true);
    ctl.setPaused(false);
    expect(session.pc.transceivers.map((t) => t.sender.track)).toEqual(before);
  });

  /**
   * Un média peut quitter l'appel pendant la pause : sa piste ne doit pas
   * survivre à la reprise — elle tiendrait le voyant du capteur allumé
   * alors que plus personne ne la reçoit.
   */
  it("un média retiré pendant la pause ne revient pas à la reprise", () => {
    const { session, ctl } = control(["audio", "video"]);
    ctl.setPaused(true);
    ctl.setMedia("video", false);
    ctl.setPaused(false);

    const video = session.pc.transceivers.find((t) => t.kind === "video")!;
    expect(video.sender.track).toBeNull();
    expect(video.sent.stopped).toBe(true);
    // l'audio, lui, revient comme si de rien n'était
    const audio = session.pc.transceivers.find((t) => t.kind === "audio")!;
    expect(audio.sender.track).toBe(audio.sent);
  });

  it("l'appel raccroché : la pause n'a plus d'objet", () => {
    const { session, ctl } = control(["audio", "video"]);
    session.ended = true;
    ctl.setPaused(true);
    for (const tr of session.pc.transceivers) expect(tr.sender.track).not.toBeNull();
  });
});

/**
 * **La pause du correspondant**, lue là où elle se voit : ses pistes se
 * taisent, les nôtres passent `muted` en réception. Rien n'est passé par
 * SIP, et c'est bien le principe — un client tiers, lui, verra une image
 * gelée : dégradation acceptable (F.703 §8.3.5), pas un refus.
 */
describe("la pause du correspondant", () => {
  it("toutes ses pistes se taisent d'un coup : c'est une pause, et elle se dit", () => {
    const { session, events } = control(["audio", "video"]);
    session.pc.peerSends(true); // l'appel s'établit, le flux arrive
    session.pc.peerSends(false);

    expect(events).toEqual([{ type: "sip:peerPaused", paused: true }]);
    session.pc.peerSends(true);
    expect(events).toEqual([
      { type: "sip:peerPaused", paused: true },
      { type: "sip:peerPaused", paused: false },
    ]);
  });

  /**
   * Une piste distante est `muted` **avant** d'avoir jamais rien reçu : au
   * décroché, toutes le sont. Sans cette précaution, tout appel s'ouvrirait
   * sur « le correspondant est en pause ».
   */
  it("le silence d'avant le premier flux n'est pas une pause", () => {
    const { session, events } = control(["audio", "video"]);
    // les pistes existent et sont muettes, mais rien n'est encore arrivé
    for (const tr of session.pc.transceivers) tr.received.setMuted(true);
    expect(events).toEqual([]);
  });

  /**
   * Un seul flux muet sur deux est un incident réseau, pas un geste : le
   * correspondant qui se retire coupe tout ce qu'il émet d'un coup, puisque
   * c'est un seul bouton (D6).
   */
  it("un seul flux muet n'est pas une pause", () => {
    const { session, events } = control(["audio", "video"]);
    session.pc.peerSends(true);
    session.pc.transceivers[0]!.received.setMuted(true);
    expect(events).toEqual([]);
  });

  it("ne répète pas ce qu'elle a déjà dit", () => {
    const { session, events } = control(["audio", "video"]);
    session.pc.peerSends(true);
    session.pc.peerSends(false);
    session.pc.transceivers[0]!.received.setMuted(true);
    expect(events).toHaveLength(1);
  });
});

/**
 * **Le silence d'avant le décrochage** (ADR 0003, CT-5). Une réponse
 * provisoire porteuse d'un SDP établit la connexion pair-à-pair aussi
 * sûrement qu'un 200 OK : sans précaution, un serveur qui joue une annonce
 * entendrait la pièce et verrait son occupant pendant qu'elle passe.
 *
 * Ce qui se vérifie ici est la nuance qui fait tout : on **désactive** les
 * pistes, on ne les détache pas. Une piste désactivée émet du noir et du
 * silence — le flux tient, donc le NAT reste ouvert, donc l'annonce a un
 * chemin pour revenir. `replaceTrack(null)`, la Pause, couperait ce chemin.
 */
describe("silence avant le décrochage", () => {
  it("désactive les pistes émises sans les détacher", () => {
    const { session, ctl } = control(["audio", "video"]);
    ctl.setSilent(true);
    for (const tr of session.pc.transceivers) {
      expect(tr.sent.enabled).toBe(false);
      // la piste reste attachée : c'est elle qui produit le noir et le
      // silence, et qui entretient le chemin du retour
      expect(tr.sender.track).not.toBeNull();
      expect(tr.sent.stopped).toBe(false);
    }
  });

  it("le décrochage rend la parole et l'image", () => {
    const { session, ctl } = control(["audio", "video"]);
    ctl.setSilent(true);
    ctl.setSilent(false);
    for (const tr of session.pc.transceivers) expect(tr.sent.enabled).toBe(true);
  });

  it("rattrape une piste apparue après coup : l'offre vient bien après l'appel", () => {
    const { session, ctl } = control(["audio"]);
    ctl.setSilent(true);
    // la caméra rejoint la connexion pendant que ça sonne encore
    const late = session.pc.transceivers[0]!;
    late.sent.enabled = true;
    session.pc.settle("have-local-offer");
    expect(late.sent.enabled).toBe(false);
  });
});

/**
 * **La régression la plus silencieuse possible** : un appel qui s'établit —
 * signalisation parfaite, chrono qui tourne — et où rien ne passe, parce que
 * le silence posé avant le décrochage n'a pas été levé. Elle est arrivée une
 * fois, en perdant l'écouteur qui le lève ; ce test est là pour qu'elle ne
 * revienne pas.
 *
 * Les deux restrictions se lèvent ensemble : les pistes réémettent, et le
 * texte tapé repart.
 */
describe("le décrochage rend la parole", () => {
  const fakeRtt = () => {
    const sending: boolean[] = [];
    const channel = {
      setSending: (on: boolean) => sending.push(on),
      missingText: () => 0,
    } as unknown as RttChannel;
    return { sending, negotiation: { channel, negotiated: () => true, close: () => {} } };
  };

  it("pose le silence à l'ouverture, le lève sur `accepted`", () => {
    const session = new FakeSession(["audio", "video"]);
    const ctl = mediaControl(session as never, () => {}, () => false);
    const rtt = fakeRtt();
    wrapSession(session as never, { take: () => [] }, ctl, rtt.negotiation as never);

    // avant le décrochage : noir, silence, et rien de tapé ne part
    for (const tr of session.pc.transceivers) expect(tr.sent.enabled).toBe(false);
    expect(rtt.sending).toEqual([false]);

    session.emit("accepted");

    // après : tout repart, et ensemble
    for (const tr of session.pc.transceivers) expect(tr.sent.enabled).toBe(true);
    expect(rtt.sending).toEqual([false, true]);
  });

  it("l'ACK rattrape si le décrochage n'a pas été vu", () => {
    const session = new FakeSession(["audio"]);
    const ctl = mediaControl(session as never, () => {}, () => false);
    const rtt = fakeRtt();
    wrapSession(session as never, { take: () => [] }, ctl, rtt.negotiation as never);
    session.emit("confirmed");
    expect(session.pc.transceivers[0]!.sent.enabled).toBe(true);
    expect(rtt.sending).toEqual([false, true]);
  });

  it("un appel sans texte se comporte pareil du côté des pistes", () => {
    const session = new FakeSession(["audio"]);
    const ctl = mediaControl(session as never, () => {}, () => false);
    wrapSession(session as never, { take: () => [] }, ctl, null);
    expect(session.pc.transceivers[0]!.sent.enabled).toBe(false);
    session.emit("accepted");
    expect(session.pc.transceivers[0]!.sent.enabled).toBe(true);
  });
});

/**
 * **Le garde-fou du partage d'écran** (ADR 0005, phase SC-1).
 *
 * Rien dans l'interface ne sait encore afficher un second flux vidéo. Ce
 * qui est éprouvé ici n'est donc pas le partage : c'est que le poste ne
 * s'égare pas devant lui. Une seconde `m=video` reçue est répondue
 * `inactive`, elle n'est jamais prise pour la caméra du correspondant, et
 * **l'appel continue** — dégrader, jamais refuser (F.703 §8.3.5).
 *
 * Les trois façons de se tromper sont toutes silencieuses, et c'est ce qui
 * les rend chères : accepter un flux que personne ne verra, croire que le
 * distant a allumé sa caméra alors qu'il partage un document, ou poser à
 * l'utilisateur une question qui n'a pas lieu d'être.
 */
describe("une seconde m=video reçue", () => {
  const head = ["v=0", "o=- 1 1 IN IP4 192.0.2.1", "s=-", "c=IN IP4 192.0.2.1", "t=0 0"];
  const AUDIO = ["m=audio 49170 RTP/AVP 0", "a=mid:0", "a=sendrecv"];
  const CAMERA = ["m=video 51372 RTP/AVP 96", "a=mid:1", "a=sendrecv"];
  const ECRAN = ["m=video 51374 RTP/AVP 96", "a=mid:2", "a=content:slides", "a=sendonly"];
  const offre = (...media: string[]): string => [...head, ...media].join("\r\n");

  /** Un appel audio + vidéo auquel le distant vient d'ajouter un écran. */
  function partageRecu() {
    const fait = control(["audio", "video"]);
    const ecran = fait.session.pc.addTransceiver("video");
    fait.session.sdp("remote", "offer", offre(...AUDIO, ...CAMERA, ...ECRAN));
    return { ...fait, ecran };
  }

  it("est répondue inactive, et la caméra n'y touche pas", () => {
    const { session, ecran } = partageRecu();
    session.pc.settle("have-remote-offer");

    expect(ecran.direction).toBe("inactive");
    expect(session.pc.transceivers.find((t) => t.mid === "1")!.direction).toBe("sendrecv");
  });

  it("n'est pas comptée dans ce que l'appel transporte", () => {
    const { session, events, ecran } = partageRecu();
    // le distant a retiré sa caméra en même temps qu'il partage : il ne
    // reste que du son et un écran — et un écran n'est pas une conversation
    session.pc.transceivers.find((t) => t.mid === "1")!.currentDirection = "inactive";
    ecran.currentDirection = "recvonly";
    session.pc.settle("stable");

    expect(events).toEqual([
      { type: "sip:mediaChanged", media: { audio: true, video: false, text: false } },
    ]);
  });

  it("la caméra reste la caméra quand les deux sont là", () => {
    const { session, events, ecran } = partageRecu();
    ecran.currentDirection = "recvonly";
    session.pc.settle("stable");

    expect(events).toEqual([
      { type: "sip:mediaChanged", media: { audio: true, video: true, text: false } },
    ]);
  });

  /**
   * L'écran n'ajoute aucun média à l'appel (D3) : il n'y a donc **rien à
   * demander** à l'utilisateur, et le re-INVITE suit le chemin ordinaire de
   * JsSIP. Sans l'exclusion de la m-section du partage, un appel audio se
   * verrait poser « votre correspondant souhaite ajouter la vidéo » pour un
   * document qu'il fait défiler.
   */
  it("un re-INVITE qui n'apporte qu'un écran ne pose aucune question", () => {
    const { session, events } = control(["audio"]);
    // le re-INVITE est intercepté **avant** que l'offre ne soit appliquée :
    // la m-section de l'écran n'existe pas encore sur la connexion
    const ecran = ["m=video 51374 RTP/AVP 96", "a=mid:1", "a=content:slides", "a=sendonly"];
    session.receiveReinvite(offre(...AUDIO, ...ecran));

    expect(events).toEqual([]);
    expect(session.passedThrough).toBe(true);
    expect(session.replied).toBeNull();
  });

  it("mais une caméra qui s'ajoute à côté d'un écran, si", () => {
    const { session, events } = control(["audio"]);
    session.receiveReinvite(offre(...AUDIO, ...CAMERA, ...ECRAN));

    expect(events.map((e) => e.type)).toEqual(["sip:mediaOffer"]);
  });
});
