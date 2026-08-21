/**
 * PhoneMachine pilotée par des événements scriptés contre un port SIP
 * et un store factices (même approche que le webphone de référence de
 * fsl-typescript). L'amorçage (task loadConfig) est asynchrone : les
 * tests attendent l'état `home` avec vi.waitFor.
 */
import { describe, expect, it, vi } from "vitest";
import { PhoneMachine, type PhoneInstance } from "../src/machines/phone.js";
import type { AccountConfig, CallLogEntry, SecureStore } from "../src/storage/store.js";
import type {
  CallMedia,
  CallSipEvent,
  IncomingCall,
  RejectReason,
  SipEvent,
  SipPort,
} from "../src/sip/port.js";
import type { TraceLine } from "../src/sip/record.js";
import type { MediaStats } from "../src/sip/stats.js";
import { computeHa1 } from "../src/storage/ha1.js";
import { NO_ICE } from "../src/sip/ice.js";

const CFG: AccountConfig = {
  proxy: "wss://sip.example.fr:8443/ws",
  domain: "example.fr",
  displayName: "Alice Martin",
  username: "alice",
  authUsername: null,
  ha1: computeHa1("alice", "example.fr", "secret123"),
  flashAlert: true,
  ice: NO_ICE,
};

function fakeStore(initial: AccountConfig | null = null, history: CallLogEntry[] = []) {
  const box = {
    saved: initial as AccountConfig | null,
    history: new Map<string, CallLogEntry[]>(),
  };
  if (initial) box.history.set(`${initial.username}@${initial.domain}`, history);
  const store: SecureStore = {
    load: async () => box.saved,
    save: async (cfg) => {
      box.saved = cfg;
    },
    clear: async () => {
      box.saved = null;
    },
    loadHistory: async (account) => box.history.get(account) ?? [],
    saveHistory: async (account, entries) => {
      box.history.set(account, entries);
    },
  };
  return { store, box };
}

class FakeCallSession {
  terminated = 0;
  mic: boolean[] = [];
  /** Les ajouts et retraits de vidéo demandés par re-INVITE. */
  video: boolean[] = [];
  terminate(): void {
    this.terminated++;
  }
  setMicMuted(m: boolean): void {
    this.mic.push(m);
  }
  setVideo(on: boolean): void {
    this.video.push(on);
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

class FakeSip implements SipPort {
  started: AccountConfig[] = [];
  stopped = 0;
  refreshed = 0;
  /** Transport encore ouvert : pilote la valeur rendue par refresh(). */
  connected = true;
  calls: { target: string; media: CallMedia }[] = [];
  session = new FakeCallSession();
  send: (ev: SipEvent) => void = () => {};
  sendCall: (ev: CallSipEvent) => void = () => {};
  start(cfg: AccountConfig, send: (ev: SipEvent) => void) {
    this.started.push(cfg);
    this.send = send;
    return {
      stop: () => {
        this.stopped++;
      },
      refresh: () => {
        this.refreshed++;
        return this.connected;
      },
      call: (target: string, media: CallMedia, sendCall: (ev: CallSipEvent) => void) => {
        this.calls.push({ target, media });
        this.sendCall = sendCall;
        this.session = new FakeCallSession();
        return this.session;
      },
    };
  }
}

/** INVITE entrant factice, tel que le port le remettrait à la machine. */
function fakeIncoming(
  offered: CallMedia = { audio: true, video: false },
  offerProblem: string | null = null,
) {
  const session = new FakeCallSession();
  const box = {
    session,
    answered: [] as CallMedia[],
    rejected: [] as RejectReason[],
    sendCall: (() => {}) as (ev: CallSipEvent) => void,
  };
  const call: IncomingCall = {
    from: "sip:bob@example.fr",
    displayName: "Bob Martin",
    offered,
    offerProblem,
    listen(send) {
      box.sendCall = send;
      return session;
    },
    answer: (media) => {
      box.answered.push(media);
    },
    reject: (reason) => {
      box.rejected.push(reason);
    },
  };
  return { call, box };
}

async function bootTo(
  state: string,
  initial: AccountConfig | null,
  history: CallLogEntry[] = [],
): Promise<{
  phone: PhoneInstance;
  sip: FakeSip;
  box: { saved: AccountConfig | null; history: Map<string, CallLogEntry[]> };
}> {
  const { store, box } = fakeStore(initial, history);
  const sip = new FakeSip();
  const phone = PhoneMachine.start({ args: { store, sip } });
  await vi.waitFor(() => expect(phone.state).toBe("home"));
  if (state === "home") return { phone, sip, box };
  phone.send({ type: "ui:useAccount" });
  if (state === "connecting") return { phone, sip, box };
  sip.send({ type: "sip:connected" });
  if (state === "registering") return { phone, sip, box };
  sip.send({ type: "sip:registered" });
  expect(phone.state).toBe("ready");
  return { phone, sip, box };
}

describe("PhoneMachine — amorçage", () => {
  it("charge la config au boot et arrive sur l'accueil", async () => {
    const { phone } = await bootTo("home", CFG);
    expect(phone.context.config).toEqual(CFG);
  });

  it("sans compte, ui:useAccount reste sur l'accueil", async () => {
    const { phone, sip } = await bootTo("home", null);
    phone.send({ type: "ui:useAccount" });
    expect(phone.state).toBe("home");
    expect(sip.started).toHaveLength(0);
  });
});

describe("PhoneMachine — configuration", () => {
  it("calcule le HA1 depuis l'URI, persiste sans mot de passe, puis se connecte", async () => {
    const { phone, sip, box } = await bootTo("home", null);
    phone.send({ type: "ui:configure" });
    expect(phone.state).toBe("configuring");
    phone.send({
      type: "ui:saveConfig",
      form: {
        proxy: CFG.proxy,
        uri: "alice@example.fr",
        displayName: CFG.displayName,
        authUsername: null,
        password: "secret123",
        flashAlert: true,
        stun: "",
        turn: "",
        turnUsername: "",
        turnPassword: null,
        turnTls: false,
      },
    });
    await vi.waitFor(() => expect(phone.state).toBe("connecting"));
    expect(box.saved).toEqual(CFG); // ha1 calculé, jamais de champ password
    expect(sip.started).toHaveLength(1);
    expect(sip.started[0]!.ha1).toBe(CFG.ha1);
  });

  it("le préfixe sip: de l'URI est accepté et ignoré", async () => {
    const { phone, box } = await bootTo("home", null);
    phone.send({ type: "ui:configure" });
    phone.send({
      type: "ui:saveConfig",
      form: {
        proxy: CFG.proxy,
        uri: "sip:alice@example.fr",
        displayName: CFG.displayName,
        authUsername: null,
        password: "secret123",
        flashAlert: true,
        stun: "",
        turn: "",
        turnUsername: "",
        turnPassword: null,
        turnTls: false,
      },
    });
    await vi.waitFor(() => expect(phone.state).toBe("connecting"));
    expect(box.saved).toEqual(CFG);
  });

  it("Adresse SIP invalide : erreur, on reste sur le formulaire", async () => {
    const { phone } = await bootTo("home", null);
    phone.send({ type: "ui:configure" });
    phone.send({
      type: "ui:saveConfig",
      form: {
        proxy: "wss://x",
        uri: "alice.example.fr", // pas de @
        displayName: "",
        authUsername: null,
        password: "secret123",
        flashAlert: true,
        stun: "",
        turn: "",
        turnUsername: "",
        turnPassword: null,
        turnTls: false,
      },
    });
    expect(phone.state).toBe("configuring");
    expect(phone.context.lastError).toEqual({ key: "error.invalidUri" });
  });

  it("identifiant d'authentification distinct : le HA1 est calculé avec lui", async () => {
    const { phone, box } = await bootTo("home", null);
    phone.send({ type: "ui:configure" });
    phone.send({
      type: "ui:saveConfig",
      form: {
        proxy: CFG.proxy,
        uri: "alice@example.fr",
        displayName: CFG.displayName,
        authUsername: "alice-auth",
        password: "secret123",
        flashAlert: true,
        stun: "",
        turn: "",
        turnUsername: "",
        turnPassword: null,
        turnTls: false,
      },
    });
    await vi.waitFor(() => expect(phone.state).toBe("connecting"));
    expect(box.saved!.authUsername).toBe("alice-auth");
    expect(box.saved!.username).toBe("alice");
    expect(box.saved!.ha1).toBe(computeHa1("alice-auth", "example.fr", "secret123"));
  });

  it("mot de passe vide sans compte existant : erreur, on reste sur le formulaire", async () => {
    const { phone } = await bootTo("home", null);
    phone.send({ type: "ui:configure" });
    phone.send({
      type: "ui:saveConfig",
      form: {
        proxy: "wss://x",
        uri: "u@x.fr",
        displayName: "",
        authUsername: null,
        password: null,
        flashAlert: true,
        stun: "",
        turn: "",
        turnUsername: "",
        turnPassword: null,
        turnTls: false,
      },
    });
    expect(phone.state).toBe("configuring");
    expect(phone.context.lastError).toEqual({ key: "error.passwordRequired" });
  });

  it("mot de passe vide avec compte existant : conserve le HA1 (même identité/domaine)", async () => {
    const { phone, box } = await bootTo("home", CFG);
    phone.send({ type: "ui:configure" });
    phone.send({
      type: "ui:saveConfig",
      form: {
        proxy: "wss://autre.example.fr/ws",
        uri: `${CFG.username}@${CFG.domain}`,
        displayName: CFG.displayName,
        authUsername: null,
        password: null,
        flashAlert: true,
        stun: "",
        turn: "",
        turnUsername: "",
        turnPassword: null,
        turnTls: false,
      },
    });
    await vi.waitFor(() => expect(phone.state).toBe("connecting"));
    expect(box.saved!.ha1).toBe(CFG.ha1);
    expect(box.saved!.proxy).toBe("wss://autre.example.fr/ws");
  });

  it("changement d'identité sans nouveau mot de passe : refusé (le HA1 en dépend)", async () => {
    const { phone } = await bootTo("home", CFG);
    phone.send({ type: "ui:configure" });
    phone.send({
      type: "ui:saveConfig",
      form: {
        proxy: CFG.proxy,
        uri: `bob@${CFG.domain}`,
        displayName: CFG.displayName,
        authUsername: null,
        password: null,
        flashAlert: true,
        stun: "",
        turn: "",
        turnUsername: "",
        turnPassword: null,
        turnTls: false,
      },
    });
    expect(phone.state).toBe("configuring");
    expect(phone.context.lastError).toEqual({ key: "error.passwordRequired" });
  });

  it("ajout d'un identifiant d'authentification sans mot de passe : refusé", async () => {
    const { phone } = await bootTo("home", CFG);
    phone.send({ type: "ui:configure" });
    phone.send({
      type: "ui:saveConfig",
      form: {
        proxy: CFG.proxy,
        uri: `${CFG.username}@${CFG.domain}`,
        displayName: CFG.displayName,
        authUsername: "alice-auth",
        password: null,
        flashAlert: true,
        stun: "",
        turn: "",
        turnUsername: "",
        turnPassword: null,
        turnTls: false,
      },
    });
    expect(phone.state).toBe("configuring");
    expect(phone.context.lastError).toEqual({ key: "error.passwordRequired" });
  });

  it("serveurs STUN/TURN : persistés avec le compte et passés au port SIP", async () => {
    const { phone, sip, box } = await bootTo("home", CFG);
    phone.send({ type: "ui:configure" });
    phone.send({
      type: "ui:saveConfig",
      form: {
        proxy: CFG.proxy,
        uri: `${CFG.username}@${CFG.domain}`,
        displayName: CFG.displayName,
        authUsername: null,
        password: null,
        flashAlert: true,
        stun: "stun.example.fr:3478",
        turn: "turn.example.fr:5349",
        turnUsername: "alice",
        turnPassword: "relais",
        turnTls: true,
      },
    });
    await vi.waitFor(() => expect(phone.state).toBe("connecting"));
    expect(box.saved!.ice).toEqual({
      stun: "stun.example.fr:3478",
      turn: { host: "turn.example.fr:5349", username: "alice", password: "relais", tls: true },
    });
    expect(sip.started[0]!.ice.turn!.tls).toBe(true);
  });

  it("serveur STUN invalide : erreur, champ désigné, on reste sur le formulaire", async () => {
    const { phone, box } = await bootTo("home", CFG);
    phone.send({ type: "ui:configure" });
    phone.send({
      type: "ui:saveConfig",
      form: {
        proxy: CFG.proxy,
        uri: `${CFG.username}@${CFG.domain}`,
        displayName: CFG.displayName,
        authUsername: null,
        password: null,
        flashAlert: true,
        stun: "stun.example.fr/ws",
        turn: "",
        turnUsername: "",
        turnPassword: null,
        turnTls: false,
      },
    });
    expect(phone.state).toBe("configuring");
    expect(phone.context.lastError).toEqual({ key: "error.stunInvalid" });
    expect(phone.context.suspectFields).toBe("stun");
    expect(box.saved).toEqual(CFG); // rien n'a été enregistré
  });

  it("flash d'appel entrant désactivé : réglage persisté avec le compte", async () => {
    const { phone, box } = await bootTo("home", CFG);
    phone.send({ type: "ui:configure" });
    phone.send({
      type: "ui:saveConfig",
      form: {
        proxy: CFG.proxy,
        uri: `${CFG.username}@${CFG.domain}`,
        displayName: CFG.displayName,
        authUsername: null,
        password: null,
        flashAlert: false,
        stun: "",
        turn: "",
        turnUsername: "",
        turnPassword: null,
        turnTls: false,
      },
    });
    await vi.waitFor(() => expect(phone.state).toBe("connecting"));
    expect(box.saved!.flashAlert).toBe(false);
    expect(phone.context.config!.flashAlert).toBe(false);
  });
});

describe("PhoneMachine — enregistrement", () => {
  it("connexion → REGISTER OK → ready", async () => {
    const { phone } = await bootTo("ready", CFG);
    expect(phone.state).toBe("ready");
  });

  it("échec d'enregistrement : reg_failed, UA arrêté, retry relance", async () => {
    const { phone, sip } = await bootTo("registering", CFG);
    sip.send({ type: "sip:registrationFailed", cause: "403 Forbidden" });
    expect(phone.state).toBe("reg_failed");
    expect(phone.context.lastError).toEqual({
      key: "error.regRefused",
      vars: { cause: "403 Forbidden" },
    });
    expect(sip.stopped).toBe(1);

    phone.send({ type: "ui:retry" });
    expect(phone.state).toBe("connecting");
    expect(sip.started).toHaveLength(2);
  });

  it("URL de proxy invalide : reg_failed avec message dédié et détail en code", async () => {
    const { phone } = await bootTo("connecting", CFG);
    const sip2 = phone.context.sip as FakeSip;
    sip2.send({ type: "sip:invalidProxy", detail: "Invalid JsSIP.UA configuration: sockets" });
    expect(phone.state).toBe("reg_failed");
    expect(phone.context.lastError).toEqual({ key: "error.invalidProxy" });
    expect(phone.context.lastErrorCode).toContain("Invalid JsSIP.UA configuration");
  });

  it("connexion WSS refusée : reg_failed avec code WSS_CONNECT", async () => {
    const { phone, sip } = await bootTo("connecting", CFG);
    sip.send({ type: "sip:disconnected" });
    expect(phone.state).toBe("reg_failed");
    expect(phone.context.lastError).toEqual({ key: "error.wssRefused" });
    expect(phone.context.lastErrorCode).toBe("WSS_CONNECT");
  });

  it("SIP 404 (login/mot de passe/domaine incorrects) : message identifiants + code SIP 404", async () => {
    const { phone, sip } = await bootTo("registering", CFG);
    sip.send({ type: "sip:registrationFailed", cause: "Not Found", statusCode: 404 });
    expect(phone.state).toBe("reg_failed");
    expect(phone.context.lastError).toEqual({ key: "error.badCredentials" });
    expect(phone.context.lastErrorCode).toBe("SIP 404");
  });

  it("reg_failed : ui:backToSettings garde l'erreur et les champs suspects sur le formulaire", async () => {
    const { phone, sip } = await bootTo("registering", CFG);
    sip.send({ type: "sip:registrationFailed", cause: "Not Found", statusCode: 404 });
    expect(phone.state).toBe("reg_failed");
    expect(phone.context.suspectFields).toBe("credentials");
    phone.send({ type: "ui:backToSettings" });
    expect(phone.state).toBe("configuring");
    expect(phone.context.lastError).toEqual({ key: "error.badCredentials" });
    expect(phone.context.lastErrorCode).toBe("SIP 404");
    expect(phone.context.suspectFields).toBe("credentials");
    expect(phone.context.config).toEqual(CFG); // formulaire pré-rempli
  });

  it("échec WSS : champ proxy suspect, effacé au relancement de la connexion", async () => {
    const { phone, sip } = await bootTo("connecting", CFG);
    sip.send({ type: "sip:disconnected" });
    expect(phone.context.suspectFields).toBe("proxy");
    phone.send({ type: "ui:retry" });
    expect(phone.context.suspectFields).toBeNull();
    expect(phone.context.lastError).toBeNull();
  });

  it("ui:configure depuis l'accueil : formulaire vierge de toute erreur passée", async () => {
    const { phone, sip } = await bootTo("registering", CFG);
    sip.send({ type: "sip:registrationFailed", cause: "Not Found", statusCode: 404 });
    phone.send({ type: "ui:logout" }); // reg_failed → home
    expect(phone.state).toBe("home");
    phone.send({ type: "ui:configure" });
    expect(phone.state).toBe("configuring");
    expect(phone.context.lastError).toBeNull();
    expect(phone.context.suspectFields).toBeNull();
  });

  it("perte de connexion en ready : boucle de reconnexion", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    sip.send({ type: "sip:disconnected" });
    expect(phone.state).toBe("reconnecting");
  });

  it("re-REGISTER périodique : ready reste ready", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    sip.send({ type: "sip:registered" });
    expect(phone.state).toBe("ready");
  });

  it("timeout WebSocket (10 s) : reg_failed", async () => {
    vi.useFakeTimers();
    try {
      const { store } = fakeStore(CFG);
      const sip = new FakeSip();
      const phone = PhoneMachine.start({ args: { store, sip } });
      await vi.advanceTimersByTimeAsync(0); // règle la task loadConfig
      expect(phone.state).toBe("home");
      phone.send({ type: "ui:useAccount" });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(phone.state).toBe("reg_failed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("registrar muet (30 s) : reg_failed", async () => {
    vi.useFakeTimers();
    try {
      const { store } = fakeStore(CFG);
      const sip = new FakeSip();
      const phone = PhoneMachine.start({ args: { store, sip } });
      await vi.advanceTimersByTimeAsync(0);
      phone.send({ type: "ui:useAccount" });
      sip.send({ type: "sip:connected" });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(phone.state).toBe("reg_failed");
      expect(phone.context.lastError).toEqual({ key: "error.registrarTimeout" });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("PhoneMachine — appel sortant (in_call + CallBlock)", () => {
  it("ui:call : entrée dans CallBlock, vue publiée dans le contexte partagé", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    phone.send({ type: "ui:call", target: "sip:bob@example.fr", media: { audio: true, video: false } });
    expect(phone.state).toBe("in_call");
    expect(sip.calls).toEqual([{ target: "sip:bob@example.fr", media: { audio: true, video: false } }]);
    expect(phone.context.call?.state).toBe("dialing");

    sip.sendCall({ type: "sip:progress" });
    expect(phone.context.call?.state).toBe("ringing");
    sip.sendCall({ type: "sip:accepted" });
    expect(phone.context.call?.state).toBe("connected");
    expect(phone.context.call?.connectedAt).not.toBeNull();

    sip.sendCall({ type: "sip:ended", cause: "BYE" });
    expect(phone.state).toBe("ready");
    expect(phone.context.call).toBeNull();
    expect(phone.context.callError).toBeNull();
  });

  it("appel refusé : retour en ready avec callError (cause + code SIP)", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    phone.send({ type: "ui:call", target: "sip:bob@example.fr", media: { audio: true, video: true } });
    expect(sip.calls[0]!.media.video).toBe(true);
    sip.sendCall({ type: "sip:failed", cause: "Busy", statusCode: 486 });
    expect(phone.state).toBe("ready");
    expect(phone.context.callError).toEqual({
      key: "reason.sip",
      vars: { cause: "Busy", code: 486 },
    });
  });

  it("raccrocher : consommé par le bloc, session terminée, retour ready", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    phone.send({ type: "ui:call", target: "sip:bob@example.fr", media: { audio: true, video: false } });
    sip.sendCall({ type: "sip:accepted" });
    phone.send({ type: "ui:hangup" });
    expect(sip.session.terminated).toBe(1);
    expect(phone.context.call?.state).toBe("hangingup");
    sip.sendCall({ type: "sip:ended", cause: "BYE" });
    expect(phone.state).toBe("ready");
  });

  it("sourdine micro : relayée, reflétée dans la vue", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    phone.send({ type: "ui:call", target: "sip:bob@example.fr", media: { audio: true, video: true } });
    sip.sendCall({ type: "sip:accepted" });
    phone.send({ type: "ui:muteMic" });
    expect(sip.session.mic).toEqual([true]);
    expect(phone.context.call?.micMuted).toBe(true);
    phone.send({ type: "ui:muteMic" });
    expect(sip.session.mic).toEqual([true, false]);
  });

  it("retrait de la vidéo pendant l'appel : re-INVITE relayé jusqu'à la session", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    phone.send({ type: "ui:call", target: "sip:bob@example.fr", media: { audio: true, video: true } });
    sip.sendCall({ type: "sip:accepted" });
    sip.sendCall({ type: "sip:mediaChanged", media: { audio: true, video: true } });
    phone.send({ type: "ui:toggleVideo" });
    expect(sip.session.video).toEqual([false]);
    expect(phone.context.call?.videoPending).toBe(true);
    sip.sendCall({ type: "sip:mediaChanged", media: { audio: true, video: false } });
    expect(phone.context.call?.media).toEqual({ audio: true, video: false });
    expect(phone.context.call?.videoPending).toBe(false);
  });

  it("Paramètres/Déconnexion pendant l'appel : consommés sans effet", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    phone.send({ type: "ui:call", target: "sip:bob@example.fr", media: { audio: true, video: false } });
    phone.send({ type: "ui:logout" });
    phone.send({ type: "ui:backToSettings" });
    expect(phone.state).toBe("in_call");
    expect(sip.stopped).toBe(0);
  });

  it("enregistrement perdu pendant l'appel (403) : reg_failed à la fin de l'appel", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    phone.send({ type: "ui:call", target: "sip:bob@example.fr", media: { audio: true, video: false } });
    sip.sendCall({ type: "sip:accepted" });
    sip.send({ type: "sip:registrationFailed", cause: "Forbidden", statusCode: 403 });
    expect(phone.state).toBe("in_call"); // l'appel continue
    sip.sendCall({ type: "sip:ended", cause: "BYE", originator: "remote" });
    expect(phone.state).toBe("reg_failed");
    expect(phone.context.lastErrorCode).toBe("SIP 403");
  });
});

describe("PhoneMachine — appel entrant", () => {
  it("sip:incoming en ready : in_call, le bloc en sonnerie entrante", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    const { call } = fakeIncoming({ audio: true, video: true });
    sip.send({ type: "sip:incoming", call });
    expect(phone.state).toBe("in_call");
    expect(phone.context.call).toMatchObject({
      state: "ringing_in",
      direction: "incoming",
      target: "sip:bob@example.fr",
      displayName: "Bob Martin",
      offered: { audio: true, video: true },
    });
  });

  it("réponse : médias relayés à la session, puis connected", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    const { call, box } = fakeIncoming({ audio: true, video: true });
    sip.send({ type: "sip:incoming", call });
    phone.send({ type: "ui:answer", media: { audio: true, video: false } });
    expect(box.answered).toEqual([{ audio: true, video: false }]);
    box.sendCall({ type: "sip:accepted" });
    expect(phone.context.call?.state).toBe("connected");
    expect(phone.context.call?.media).toEqual({ audio: true, video: false });
  });

  it("refus : retour en ready sans erreur affichée", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    const { call, box } = fakeIncoming();
    sip.send({ type: "sip:incoming", call });
    phone.send({ type: "ui:reject" });
    expect(box.rejected).toEqual(["declined"]);
    expect(phone.state).toBe("ready");
    expect(phone.context.callError).toBeNull();
  });

  it("deuxième INVITE pendant un appel : refusé occupé, appel en cours intact", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    const first = fakeIncoming();
    sip.send({ type: "sip:incoming", call: first.call });
    phone.send({ type: "ui:answer", media: { audio: true, video: false } });
    first.box.sendCall({ type: "sip:accepted" });

    const second = fakeIncoming();
    sip.send({ type: "sip:incoming", call: second.call });
    expect(second.box.rejected).toEqual(["busy"]);
    expect(phone.state).toBe("in_call");
    expect(phone.context.call?.state).toBe("connected");
  });

  it("INVITE hors ready (reconnexion en cours) : décliné sans changer d'état", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    sip.send({ type: "sip:disconnected" });
    expect(phone.state).toBe("reconnecting");
    const { call, box } = fakeIncoming();
    sip.send({ type: "sip:incoming", call });
    expect(box.rejected).toEqual(["timeout"]);
    expect(phone.state).toBe("reconnecting");
  });

  it("historique : entrant répondu, avec les médias acceptés", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    const { call, box } = fakeIncoming({ audio: true, video: true });
    sip.send({ type: "sip:incoming", call });
    phone.send({ type: "ui:answer", media: { audio: true, video: false } });
    box.sendCall({ type: "sip:accepted" });
    box.sendCall({ type: "sip:ended", cause: "BYE", originator: "remote" });
    expect(phone.state).toBe("ready");
    expect(phone.context.history[0]).toMatchObject({
      target: "bob@example.fr",
      direction: "incoming",
      outcome: "answered",
      endedBy: "remote",
      media: { audio: true, video: false },
    });
  });

  it("offre inétablissable : refusée sans sonner, consignée, cause affichée", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    const bad = fakeIncoming({ audio: true, video: false }, "ICE, DTLS, SRTP (RTP/AVP)");
    sip.send({ type: "sip:incoming", call: bad.call });

    // l'écran n'a jamais montré d'appel : on est resté disponible
    expect(phone.state).toBe("ready");
    expect(phone.context.call).toBeNull();
    expect(bad.box.rejected).toEqual(["incompatible"]);
    // la cause s'affiche, et la ligne d'historique la garde
    expect(phone.context.callError).toEqual({
      key: "reason.offerUnsupported",
      vars: { detail: "ICE, DTLS, SRTP (RTP/AVP)" },
    });
    expect(phone.context.history[0]).toMatchObject({
      direction: "incoming",
      outcome: "missed",
      connectedAt: null,
      reason: { key: "reason.offerUnsupported" },
    });
  });

  it("historique : entrant refusé et entrant annulé sont des appels manqués", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    const refused = fakeIncoming();
    sip.send({ type: "sip:incoming", call: refused.call });
    phone.send({ type: "ui:reject" });
    expect(phone.context.history[0]).toMatchObject({
      direction: "incoming",
      outcome: "missed",
      connectedAt: null,
      endedBy: null,
      reason: { key: "reason.declined" },
    });

    const missed = fakeIncoming();
    sip.send({ type: "sip:incoming", call: missed.call });
    missed.box.sendCall({ type: "sip:failed", cause: "Canceled", originator: "remote" });
    expect(phone.context.history[0]).toMatchObject({
      outcome: "missed",
      reason: { key: "reason.missed" },
    });
    expect(phone.context.history).toHaveLength(2);
  });
});

describe("PhoneMachine — historique d'appels", () => {
  it("appel répondu : consigné avec durée et qui a raccroché (distant)", async () => {
    const { phone, sip, box } = await bootTo("ready", CFG);
    phone.send({ type: "ui:call", target: "sip:bob@example.fr", media: { audio: true, video: true } });
    sip.sendCall({ type: "sip:accepted" });
    sip.sendCall({ type: "sip:ended", cause: "BYE", originator: "remote" });
    expect(phone.state).toBe("ready");

    const [entry] = phone.context.history;
    expect(entry).toMatchObject({
      target: "bob@example.fr",
      direction: "outgoing",
      outcome: "answered",
      endedBy: "remote",
      media: { audio: true, video: true },
    });
    expect(entry!.connectedAt).not.toBeNull();
    await vi.waitFor(() =>
      expect(box.history.get("alice@example.fr")).toHaveLength(1),
    );
  });

  it("appel raccroché localement : endedBy = local", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    phone.send({ type: "ui:call", target: "sip:bob@example.fr", media: { audio: true, video: false } });
    sip.sendCall({ type: "sip:accepted" });
    phone.send({ type: "ui:hangup" });
    sip.sendCall({ type: "sip:ended", cause: "BYE", originator: "local" });
    expect(phone.context.history[0]).toMatchObject({ outcome: "answered", endedBy: "local" });
  });

  it("appel refusé : outcome failed, pas de endedBy (jamais établi)", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    phone.send({ type: "ui:call", target: "sip:bob@example.fr", media: { audio: true, video: false } });
    sip.sendCall({ type: "sip:failed", cause: "Busy", statusCode: 486, originator: "remote" });
    expect(phone.context.history[0]).toMatchObject({
      outcome: "failed",
      endedBy: null,
      reason: { key: "reason.sip", vars: { cause: "Busy", code: 486 } },
      connectedAt: null,
    });
  });

  it("le carnet de l'appel est consigné avec la ligne — et absent s'il est vide", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    phone.send({ type: "ui:call", target: "sip:bob@example.fr", media: { audio: true, video: false } });
    // le port ouvre le carnet en plaçant l'appel : la session en cours est la sienne
    sip.session.traceLines = [
      { at: 1, kind: "sip", way: "out", head: "INVITE sip:bob@example.fr SIP/2.0", body: "…" },
    ];
    sip.sendCall({ type: "sip:accepted" });
    sip.sendCall({ type: "sip:ended", cause: "BYE", originator: "remote" });
    expect(phone.context.history[0]!.trace).toHaveLength(1);

    // trace éteinte : le carnet est vide, et la ligne ne porte rien — c'est
    // ce qui décide de l'icône parchemin dans l'historique
    phone.send({ type: "ui:call", target: "sip:carol@example.fr", media: { audio: true, video: false } });
    sip.sendCall({ type: "sip:accepted" });
    sip.sendCall({ type: "sip:ended", cause: "BYE", originator: "remote" });
    expect(phone.context.history[0]!.trace).toBeUndefined();
  });

  it("le bilan média suit le même chemin que le carnet — et manque avec lui", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    phone.send({ type: "ui:call", target: "sip:bob@example.fr", media: { audio: true, video: false } });
    sip.session.statsSummary = {
      audio: {
        recv: { codec: "opus", clockRate: 48000, kbps: 32, loss: 0.01 },
        sent: { codec: "opus", clockRate: 48000, kbps: 31, loss: 0.02 },
      },
      video: null,
      rttMs: 42,
      spanMs: 133_000,
    };
    sip.sendCall({ type: "sip:accepted" });
    sip.sendCall({ type: "sip:ended", cause: "BYE", originator: "remote" });
    expect(phone.context.history[0]!.stats).toMatchObject({ rttMs: 42, spanMs: 133_000 });

    // rien mesuré (trace éteinte, ou appel sans média) : la ligne ne porte
    // rien — c'est ce qui décide de l'icône loupe dans l'historique
    phone.send({ type: "ui:call", target: "sip:carol@example.fr", media: { audio: true, video: false } });
    sip.session.statsSummary = null;
    sip.sendCall({ type: "sip:accepted" });
    sip.sendCall({ type: "sip:ended", cause: "BYE", originator: "remote" });
    expect(phone.context.history[0]!.stats).toBeUndefined();
  });

  it("ui:clearHistory vide la liste et la persistance", async () => {
    const { phone, sip, box } = await bootTo("ready", CFG);
    phone.send({ type: "ui:call", target: "sip:bob@example.fr", media: { audio: true, video: false } });
    sip.sendCall({ type: "sip:accepted" });
    sip.sendCall({ type: "sip:ended", cause: "BYE", originator: "remote" });
    expect(phone.context.history).toHaveLength(1);
    phone.send({ type: "ui:clearHistory" });
    expect(phone.context.history).toHaveLength(0);
    await vi.waitFor(() => expect(box.history.get("alice@example.fr")).toEqual([]));
  });

  it("l'historique du compte est rechargé au boot", async () => {
    const past: CallLogEntry = {
      target: "carol@example.fr",
      direction: "outgoing",
      outcome: "answered",
      media: { audio: true, video: false },
      startedAt: 1,
      connectedAt: 2,
      endedAt: 3,
      endedBy: "local",
      reason: null,
    };
    const { store } = fakeStore(CFG, [past]);
    const phone = PhoneMachine.start({ args: { store, sip: new FakeSip() } });
    await vi.waitFor(() => expect(phone.state).toBe("home"));
    expect(phone.context.history).toEqual([past]);
  });

  it("garde les 50 derniers appels, même relu plus long qu'aujourd'hui", async () => {
    // un historique persisté sous une borne plus généreuse : il est ramené
    // à la borne courante dès la relecture, les plus récents en tête
    const long: CallLogEntry[] = Array.from({ length: 60 }, (_, i) => ({
      target: `bob${i}@example.fr`,
      direction: "outgoing",
      outcome: "answered",
      media: { audio: true, video: false },
      startedAt: 60 - i,
      connectedAt: 60 - i,
      endedAt: 60 - i,
      endedBy: "local",
      reason: null,
    }));
    const { store } = fakeStore(CFG, long);
    const phone = PhoneMachine.start({ args: { store, sip: new FakeSip() } });
    await vi.waitFor(() => expect(phone.state).toBe("home"));
    expect(phone.context.history).toHaveLength(50);
    expect(phone.context.history[0]!.target).toBe("bob0@example.fr");
    expect(phone.context.history[49]!.target).toBe("bob49@example.fr");
  });

  it("un nouvel appel chasse le plus ancien une fois la liste pleine", async () => {
    const full: CallLogEntry[] = Array.from({ length: 50 }, (_, i) => ({
      target: `bob${i}@example.fr`,
      direction: "outgoing",
      outcome: "answered",
      media: { audio: true, video: false },
      startedAt: 50 - i,
      connectedAt: 50 - i,
      endedAt: 50 - i,
      endedBy: "local",
      reason: null,
    }));
    const { phone, sip } = await bootTo("ready", CFG, full);
    phone.send({ type: "ui:call", target: "sip:carol@example.fr", media: { audio: true, video: false } });
    sip.sendCall({ type: "sip:accepted" });
    sip.sendCall({ type: "sip:ended", cause: "BYE", originator: "remote" });

    expect(phone.context.history).toHaveLength(50);
    expect(phone.context.history[0]!.target).toBe("carol@example.fr");
    expect(phone.context.history.some((e) => e.target === "bob49@example.fr")).toBe(false);
  });
});

describe("PhoneMachine — perte du proxy et veille", () => {
  it("proxy perdu hors appel : reconnecting, appel impossible, retry auto après 10 s", async () => {
    vi.useFakeTimers();
    try {
      const { store } = fakeStore(CFG);
      const sip = new FakeSip();
      const phone = PhoneMachine.start({ args: { store, sip } });
      await vi.advanceTimersByTimeAsync(0);
      phone.send({ type: "ui:useAccount" });
      sip.send({ type: "sip:connected" });
      sip.send({ type: "sip:registered" });
      expect(phone.state).toBe("ready");

      sip.send({ type: "sip:disconnected" });
      expect(phone.state).toBe("reconnecting");
      expect(phone.context.lastErrorCode).toBe("WSS_LOST");

      // appeler est refusé dans cet état (l'UI grise le bouton)
      phone.send({ type: "ui:call", target: "sip:bob@example.fr", media: { audio: true, video: false } });
      expect(phone.state).toBe("reconnecting");

      await vi.advanceTimersByTimeAsync(10_000);
      expect(phone.state).toBe("connecting");
      expect(sip.started).toHaveLength(2);

      // nouvel échec : on repart en boucle, pas en reg_failed
      sip.send({ type: "sip:disconnected" });
      expect(phone.state).toBe("reconnecting");
      await vi.advanceTimersByTimeAsync(10_000);
      expect(phone.state).toBe("connecting");
      sip.send({ type: "sip:connected" });
      sip.send({ type: "sip:registered" });
      expect(phone.state).toBe("ready");
    } finally {
      vi.useRealTimers();
    }
  });

  it("les paramètres restent accessibles pendant la reconnexion", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    sip.send({ type: "sip:disconnected" });
    expect(phone.state).toBe("reconnecting");
    phone.send({ type: "ui:backToSettings" });
    expect(phone.state).toBe("reconfiguring");
  });

  it("identifiants refusés : reg_failed (pas de boucle de reconnexion inutile)", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    sip.send({ type: "sip:disconnected" });
    expect(phone.state).toBe("reconnecting");
    phone.send({ type: "ui:retry" });
    sip.send({ type: "sip:connected" });
    sip.send({ type: "sip:registrationFailed", cause: "Forbidden", statusCode: 403 });
    expect(phone.state).toBe("reg_failed");
  });

  it("proxy perdu en appel : appel raccroché, consigné 'dropped', puis reconnexion", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    phone.send({ type: "ui:call", target: "sip:bob@example.fr", media: { audio: true, video: false } });
    sip.sendCall({ type: "sip:accepted" });
    sip.send({ type: "sip:disconnected" });
    expect(sip.session.terminated).toBe(1); // raccrochage fait par le bloc
    sip.sendCall({ type: "sip:ended", cause: "Connection Error", originator: "system" });

    expect(phone.state).toBe("reconnecting");
    expect(phone.context.callError).toEqual({ key: "error.callDropped" });
    expect(phone.context.history[0]).toMatchObject({
      outcome: "dropped",
      endedBy: "network",
      reason: { key: "error.proxyLostDuringCall" },
    });
  });

  it("veille hors appel : sleeping, UA arrêté ; réveil : réenregistrement", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    phone.send({ type: "sys:sleep" });
    expect(phone.state).toBe("sleeping");
    expect(sip.stopped).toBe(1);
    phone.send({ type: "sys:wake" });
    expect(phone.state).toBe("connecting");
    expect(sip.started).toHaveLength(2);
  });

  it("réveil enregistré : REGISTER rafraîchi sur le transport existant", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    phone.send({ type: "sys:wake" });
    expect(phone.state).toBe("ready");
    expect(sip.refreshed).toBe(1);
    expect(sip.stopped).toBe(0);
    expect(sip.started).toHaveLength(1); // pas de nouvel UA, donc pas de nouveau contact
  });

  it("réveil avec transport fermé : nouvel UA", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    sip.connected = false;
    phone.send({ type: "sys:wake" });
    expect(phone.state).toBe("connecting");
    expect(sip.stopped).toBe(1);
    expect(sip.started).toHaveLength(2);
  });

  it("REGISTER sans réponse : reconnexion, pas d'accusation des identifiants", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    sip.send({ type: "sip:registrationFailed", cause: "Request Timeout" });
    expect(phone.state).toBe("reconnecting");
    expect(phone.context.suspectFields).toBe("proxy");
  });

  it("veille en appel : l'appel est raccroché puis on dort", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    phone.send({ type: "ui:call", target: "sip:bob@example.fr", media: { audio: true, video: false } });
    sip.sendCall({ type: "sip:accepted" });
    phone.send({ type: "sys:sleep" });
    expect(sip.session.terminated).toBe(1);
    expect(phone.state).toBe("in_call"); // on attend le retour du bloc
    sip.sendCall({ type: "sip:ended", cause: "BYE", originator: "local" });
    expect(phone.state).toBe("sleeping");
    expect(phone.context.history[0]).toMatchObject({ outcome: "answered", endedBy: "local" });
  });
});

describe("PhoneMachine — sorties", () => {
  it("déconnexion : unregistering → home quand le transport se ferme", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    phone.send({ type: "ui:logout" });
    expect(phone.state).toBe("unregistering");
    expect(sip.stopped).toBe(1);
    sip.send({ type: "sip:unregistered" });
    sip.send({ type: "sip:disconnected" });
    expect(phone.state).toBe("home");
  });

  it("déconnexion forcée après 5 s sans réponse du transport", async () => {
    vi.useFakeTimers();
    try {
      const { store } = fakeStore(CFG);
      const sip = new FakeSip();
      const phone = PhoneMachine.start({ args: { store, sip } });
      await vi.advanceTimersByTimeAsync(0);
      phone.send({ type: "ui:useAccount" });
      sip.send({ type: "sip:connected" });
      sip.send({ type: "sip:registered" });
      phone.send({ type: "ui:logout" });
      await vi.advanceTimersByTimeAsync(5000);
      expect(phone.state).toBe("home");
    } finally {
      vi.useRealTimers();
    }
  });

  it("retour paramètres depuis ready : UA arrêté, formulaire pré-rempli", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    phone.send({ type: "ui:backToSettings" });
    expect(phone.state).toBe("reconfiguring");
    expect(sip.stopped).toBe(1);
    expect(phone.context.config).toEqual(CFG);
  });

  it("paramètres ouverts depuis ready puis Annuler : reconnexion vers l'écran d'appel", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    phone.send({ type: "ui:backToSettings" });
    expect(phone.state).toBe("reconfiguring");
    phone.send({ type: "ui:cancelConfig" });
    expect(phone.state).toBe("connecting");
    expect(sip.started).toHaveLength(2); // l'UA est relancé avec la config inchangée
    sip.send({ type: "sip:connected" });
    sip.send({ type: "sip:registered" });
    expect(phone.state).toBe("ready");
  });

  it("paramètres ouverts depuis ready puis Enregistrer : sauvegarde et reconnexion", async () => {
    const { phone, sip, box } = await bootTo("ready", CFG);
    phone.send({ type: "ui:backToSettings" });
    phone.send({
      type: "ui:saveConfig",
      form: {
        proxy: "wss://autre.example.fr/ws",
        uri: `${CFG.username}@${CFG.domain}`,
        displayName: CFG.displayName,
        authUsername: null,
        password: null,
        flashAlert: true,
        stun: "",
        turn: "",
        turnUsername: "",
        turnPassword: null,
        turnTls: false,
      },
    });
    await vi.waitFor(() => expect(phone.state).toBe("connecting"));
    expect(box.saved!.proxy).toBe("wss://autre.example.fr/ws");
    expect(sip.started).toHaveLength(2);
  });

  it("Annuler depuis la config ouverte à l'accueil : retour à l'accueil", async () => {
    const { phone, sip } = await bootTo("home", CFG);
    phone.send({ type: "ui:configure" });
    phone.send({ type: "ui:cancelConfig" });
    expect(phone.state).toBe("home");
    expect(sip.started).toHaveLength(0);
  });
});
