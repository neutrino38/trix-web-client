/**
 * PhoneMachine pilotée par des événements scriptés contre un port SIP
 * et un store factices (même approche que le webphone de référence de
 * fsl-typescript). L'amorçage (task loadConfig) est asynchrone : les
 * tests attendent l'état `home` avec vi.waitFor.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { machineGraphs } from "finite-state-language/diagram";
import { activeAccount, PhoneMachine, type PhoneInstance } from "../src/machines/phone.js";
import type {
  Contact,
  AccountConfig,
  CallLogEntry,
  SecureStore,
  StoredAccount,
  Vault,
  MessageEntry,
} from "../src/storage/store.js";
import type {
  CallMedia,
  MediaKind,
  CallSipEvent,
  IncomingCall,
  RejectReason,
  SipEvent,
  SipPort,
} from "../src/sip/port.js";
import { NO_MEDIA } from "../src/sip/port.js";
import { NO_PRESENCE } from "../src/sip/presence.js";
import { NO_MESSAGING } from "../src/sip/message.js";
import type { TraceLine } from "../src/sip/record.js";
import type { MediaStats } from "../src/sip/stats.js";
import type { ChatItem } from "../src/sip/transcript.js";
import { computeHa1, computeHa1Sha256 } from "../src/storage/ha1.js";
import { NO_ICE } from "../src/sip/ice.js";
import { OPEN_DEPLOYMENT, setDeployment } from "../src/deployment.js";

const CFG: AccountConfig = {
  proxy: "wss://sip.example.fr:8443/ws",
  domain: "example.fr",
  displayName: "Alice Martin",
  username: "alice",
  authUsername: null,
  ha1: computeHa1("alice", "example.fr", "secret123"),
  ha1Sha256: computeHa1Sha256("alice", "example.fr", "secret123"),
  flashAlert: true,
  ice: NO_ICE,
  rtt: "websocket",
};

/** L'identifiant du compte que `fakeStore` sème — les tests le nomment. */
const SEED_ID = "acc-seed";

/**
 * Un coffre en mémoire. `box.saved` rend le **compte actif sans son
 * identifiant** : c'est sous cette forme que les tests l'ont toujours
 * comparé, et le passage à une liste (ADR 0002) n'a pas à se lire dans
 * trente assertions qui parlent d'autre chose.
 */
/**
 * Le compte actif tel que les tests le comparent : sa configuration, sans
 * l'identifiant opaque que le coffre lui a donné.
 */
function activeCfg(phone: PhoneInstance): AccountConfig | null {
  const account = activeAccount(phone.context);
  if (!account) return null;
  // l'identifiant d'instance désigne l'appareil, pas la configuration
  const { id: _id, instanceId: _instanceId, ...cfg } = account;
  return cfg;
}

const SEED_INSTANCE = "a11ce000-0000-4000-8000-000000000001";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fakeStore(initial: AccountConfig | null = null, history: CallLogEntry[] = []) {
  const seed: StoredAccount | null = initial
    ? { ...initial, id: SEED_ID, instanceId: SEED_INSTANCE }
    : null;
  const box = {
    vault: {
      accounts: seed ? [seed] : [],
      activeId: seed?.id ?? null,
    } as Vault,
    history: new Map<string, CallLogEntry[]>(),
    contacts: new Map<string, Contact[]>(),
    /** Les historiques effacés par une suppression de compte. */
    dropped: [] as string[],
    get saved(): AccountConfig | null {
      const account = this.vault.accounts.find((a) => a.id === this.vault.activeId);
      if (!account) return null;
      const { id: _id, instanceId: _instanceId, ...cfg } = account;
      return cfg;
    },
  };
  if (seed) box.history.set(seed.id, history);
  const messages = new Map<string, MessageEntry[]>();
  const store: SecureStore = {
    load: async () => box.vault,
    save: async (vault) => {
      box.vault = vault;
    },
    clear: async () => {
      box.vault = { accounts: [], activeId: null };
    },
    loadHistory: async (id) => box.history.get(id) ?? [],
    saveHistory: async (id, entries) => {
      box.history.set(id, entries);
    },
    deleteHistory: async (id) => {
      box.dropped.push(id);
      box.history.delete(id);
    },
    loadContacts: async (id) => box.contacts.get(id) ?? [],
    saveContacts: async (id, list) => {
      box.contacts.set(id, list);
    },
    deleteContacts: async (id) => {
      box.contacts.delete(id);
    },
    loadMessages: async (id) => messages.get(id) ?? [],
    saveMessages: async (id, list) => {
      messages.set(id, list);
    },
    deleteMessages: async (id) => {
      messages.delete(id);
    },
  };
  return { store, box, messages };
}

class FakeCallSession {
  terminated = 0;
  /** Les ajouts et retraits de média demandés par re-INVITE, dans l'ordre. */
  asked: { kind: MediaKind; on: boolean }[] = [];
  terminate(): void {
    this.terminated++;
  }
  tones: string[] = [];
  sendDtmf(tone: string): boolean {
    this.tones.push(tone);
    return true;
  }
  setMedia(kind: MediaKind, on: boolean): void {
    this.asked.push({ kind, on });
  }
  abandonMedia(): void {}
  /** Ce qui a été demandé pour un média donné — le raccourci des tests. */
  askedFor(kind: MediaKind): boolean[] {
    return this.asked.filter((a) => a.kind === kind).map((a) => a.on);
  }
  pauses: boolean[] = [];
  setPaused(on: boolean): void {
    this.pauses.push(on);
  }
  /** Les partages d'écran demandés, dans l'ordre : vrai = démarrer. */
  shares: boolean[] = [];
  startShare(): void {
    this.shares.push(true);
  }
  stopShare(): void {
    this.shares.push(false);
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

class FakeSip implements SipPort {
  started: StoredAccount[] = [];
  stopped = 0;
  refreshed = 0;
  /** Transport encore ouvert : pilote la valeur rendue par refresh(). */
  connected = true;
  calls: { target: string; media: CallMedia }[] = [];
  session = new FakeCallSession();
  send: (ev: SipEvent) => void = () => {};
  sendCall: (ev: CallSipEvent) => void = () => {};
  start(cfg: StoredAccount, send: (ev: SipEvent) => void) {
    this.started.push(cfg);
    this.send = send;
    return {
      stop: () => {
        this.stopped++;
      },
      presence: () => NO_PRESENCE,
      messaging: () => NO_MESSAGING,
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
  offered: CallMedia = { audio: true, video: false, text: false },
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
  /** Le fil du tchat, que l'hôte branche sur le panneau (voir `main.ts`). */
  transcript: () => ChatItem[] = () => [],
  /** Le statut Ne pas déranger, que l'hôte lit chez PresenceMachine (ADR 0007, D12). */
  doNotDisturb: () => boolean = () => false,
): Promise<{
  phone: PhoneInstance;
  sip: FakeSip;
  box: ReturnType<typeof fakeStore>["box"];
}> {
  const { store, box } = fakeStore(initial, history);
  const sip = new FakeSip();
  const phone = PhoneMachine.start({ args: { store, sip, transcript, doNotDisturb } });
  await vi.waitFor(() => expect(phone.state).toBe("home"));
  if (state === "home") return { phone, sip, box };
  // choisir un compte passe par `switching`, qui écrit le coffre et charge
  // l'historique du compte retenu avant de lancer l'UA
  phone.send({ type: "ui:useAccount", id: SEED_ID });
  await vi.waitFor(() => expect(phone.state).toBe("connecting"));
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
    expect(activeCfg(phone)).toEqual(CFG);
  });

  it("sans compte, ui:useAccount reste sur l'accueil", async () => {
    const { phone, sip } = await bootTo("home", null);
    phone.send({ type: "ui:useAccount", id: SEED_ID });
    expect(phone.state).toBe("home");
    expect(sip.started).toHaveLength(0);
  });
});

describe("PhoneMachine — coffre illisible", () => {
  it("une lecture qui échoue mène à vault_error, pas à un accueil sans compte", async () => {
    const { store, box } = fakeStore(CFG);
    store.load = async () => {
      throw new Error("IndexedDB en panne");
    };
    const phone = PhoneMachine.start({
      args: { store, sip: new FakeSip(), transcript: () => [], doNotDisturb: () => false },
    });
    await vi.waitFor(() => expect(phone.state).toBe("vault_error"));
    expect(phone.context.accounts).toEqual([]);
    expect(phone.context.lastError).not.toBeNull();
    // l'accueil n'est pas offert : rien ne peut écrire par-dessus le coffre
    phone.send({ type: "ui:configure", id: null });
    expect(phone.state).toBe("vault_error");
    expect(box.saved).toEqual(CFG);
  });

  it("Réessayer relit le coffre et retrouve les comptes", async () => {
    const { store } = fakeStore(CFG);
    const load = store.load;
    let failures = 1;
    store.load = async () => {
      if (failures-- > 0) throw new Error("lecture trop lente");
      return load();
    };
    const phone = PhoneMachine.start({
      args: { store, sip: new FakeSip(), transcript: () => [], doNotDisturb: () => false },
    });
    await vi.waitFor(() => expect(phone.state).toBe("vault_error"));
    phone.send({ type: "ui:retryVault" });
    await vi.waitFor(() => expect(phone.state).toBe("home"));
    expect(activeCfg(phone)).toEqual(CFG);
    expect(phone.context.lastError).toBeNull();
  });

  it("Effacer vide le coffre, puis l'accueil", async () => {
    const { store, box } = fakeStore(CFG);
    store.load = async () => {
      throw new Error("indéchiffrable");
    };
    const phone = PhoneMachine.start({
      args: { store, sip: new FakeSip(), transcript: () => [], doNotDisturb: () => false },
    });
    await vi.waitFor(() => expect(phone.state).toBe("vault_error"));
    phone.send({ type: "ui:resetVault" });
    await vi.waitFor(() => expect(phone.state).toBe("home"));
    expect(box.saved).toBeNull();
  });
});

describe("PhoneMachine — configuration imposée par le déploiement", () => {
  // `config.json` est un état de module : chaque cas repose l'ardoise, sans
  // quoi le suivant hériterait d'un proxy imposé qu'il n'a pas demandé
  afterEach(() => setDeployment(OPEN_DEPLOYMENT));

  const FORM = {
    proxy: "wss://saisi.example.fr/ws",
    uri: "alice@example.fr",
    displayName: CFG.displayName,
    authUsername: null,
    password: "secret123",
    stun: "stun.saisi.fr",
    turn: "",
    turnUsername: "",
    turnPassword: null,
    turnTls: false,
    rtt: "websocket",
  } as const;

  it("le compte relu prend le proxy, les serveurs ICE et le transport imposés", async () => {
    setDeployment({
      proxy: "wss://impose.example.fr/ws",
      domain: null,
      ice: { stun: "stun.impose.fr", turn: null },
      rtt: "datachannel",
      debug: true,
      presence: true,
      messaging: true,
    });
    const { phone, sip } = await bootTo("connecting", CFG);
    expect(activeCfg(phone)).toEqual({
      ...CFG,
      proxy: "wss://impose.example.fr/ws",
      ice: { stun: "stun.impose.fr", turn: null },
      rtt: "datachannel",
    });
    // et c'est bien ce compte-là que l'UA reçoit, pas celui du coffre
    expect(sip.started[0]!.proxy).toBe("wss://impose.example.fr/ws");
  });

  it("un compte d'un autre domaine que le domaine imposé est écarté", async () => {
    setDeployment({ ...OPEN_DEPLOYMENT, domain: "autre.example.fr" });
    const { phone } = await bootTo("home", CFG);
    // son HA1 a été calculé sur example.fr : le réécrire ne l'authentifierait
    // sur rien, l'accueil repart donc sur « nouveau compte »
    expect(activeCfg(phone)).toBeNull();
    expect(phone.context.history).toEqual([]);
  });

  it("une adresse hors du domaine imposé est refusée, on reste sur le formulaire", async () => {
    setDeployment({ ...OPEN_DEPLOYMENT, domain: "impose.example.fr" });
    const { phone, box } = await bootTo("home", null);
    phone.send({ type: "ui:configure", id: phone.context.accounts[0]?.id ?? null });
    phone.send({ type: "ui:saveConfig", form: { ...FORM } });
    expect(phone.state).toBe("configuring");
    expect(phone.context.lastError).toEqual({
      key: "error.wrongDomain",
      vars: { domain: "impose.example.fr" },
    });
    expect(phone.context.suspectFields).toBe("credentials");
    expect(box.saved).toBeNull();
  });

  it("ce que le formulaire dit des réglages imposés est ignoré", async () => {
    setDeployment({
      proxy: "wss://impose.example.fr/ws",
      domain: "example.fr",
      ice: { stun: "stun.impose.fr", turn: null },
      rtt: "datachannel",
      debug: true,
      presence: true,
      messaging: true,
    });
    const { phone, box } = await bootTo("home", null);
    phone.send({ type: "ui:configure", id: phone.context.accounts[0]?.id ?? null });
    // un formulaire trafiqué peut porter ces champs : la machine ne les lit pas
    phone.send({ type: "ui:saveConfig", form: { ...FORM } });
    await vi.waitFor(() => expect(phone.state).toBe("connecting"));
    expect(box.saved).toEqual({
      ...CFG,
      proxy: "wss://impose.example.fr/ws",
      ice: { stun: "stun.impose.fr", turn: null },
      rtt: "datachannel",
    });
  });
});

describe("PhoneMachine — configuration", () => {
  it("calcule le HA1 depuis l'URI, persiste sans mot de passe, puis se connecte", async () => {
    const { phone, sip, box } = await bootTo("home", null);
    phone.send({ type: "ui:configure", id: phone.context.accounts[0]?.id ?? null });
    expect(phone.state).toBe("configuring");
    phone.send({
      type: "ui:saveConfig",
      form: {
        proxy: CFG.proxy,
        uri: "alice@example.fr",
        displayName: CFG.displayName,
        authUsername: null,
        password: "secret123",
        stun: "",
        turn: "",
        turnUsername: "",
        turnPassword: null,
        turnTls: false,
        rtt: "websocket",
      },
    });
    await vi.waitFor(() => expect(phone.state).toBe("connecting"));
    expect(box.saved).toEqual(CFG); // ha1 calculé, jamais de champ password
    expect(sip.started).toHaveLength(1);
    // un compte neuf tire l'identifiant d'instance de cet appareil, et c'est
    // lui que l'UA pose en +sip.instance
    const instanceId = box.vault.accounts[0]!.instanceId;
    expect(instanceId).toMatch(UUID);
    expect(sip.started[0]!.instanceId).toBe(instanceId);
    expect(sip.started[0]!.ha1).toBe(CFG.ha1);
  });

  it("le préfixe sip: de l'URI est accepté et ignoré", async () => {
    const { phone, box } = await bootTo("home", null);
    phone.send({ type: "ui:configure", id: phone.context.accounts[0]?.id ?? null });
    phone.send({
      type: "ui:saveConfig",
      form: {
        proxy: CFG.proxy,
        uri: "sip:alice@example.fr",
        displayName: CFG.displayName,
        authUsername: null,
        password: "secret123",
        stun: "",
        turn: "",
        turnUsername: "",
        turnPassword: null,
        turnTls: false,
        rtt: "websocket",
      },
    });
    await vi.waitFor(() => expect(phone.state).toBe("connecting"));
    expect(box.saved).toEqual(CFG);
  });

  it("Adresse SIP invalide : erreur, on reste sur le formulaire", async () => {
    const { phone } = await bootTo("home", null);
    phone.send({ type: "ui:configure", id: phone.context.accounts[0]?.id ?? null });
    phone.send({
      type: "ui:saveConfig",
      form: {
        proxy: "wss://x",
        uri: "alice.example.fr", // pas de @
        displayName: "",
        authUsername: null,
        password: "secret123",
        stun: "",
        turn: "",
        turnUsername: "",
        turnPassword: null,
        turnTls: false,
        rtt: "websocket",
      },
    });
    expect(phone.state).toBe("configuring");
    expect(phone.context.lastError).toEqual({ key: "error.invalidUri" });
  });

  it("identifiant d'authentification distinct : le HA1 est calculé avec lui", async () => {
    const { phone, box } = await bootTo("home", null);
    phone.send({ type: "ui:configure", id: phone.context.accounts[0]?.id ?? null });
    phone.send({
      type: "ui:saveConfig",
      form: {
        proxy: CFG.proxy,
        uri: "alice@example.fr",
        displayName: CFG.displayName,
        authUsername: "alice-auth",
        password: "secret123",
        stun: "",
        turn: "",
        turnUsername: "",
        turnPassword: null,
        turnTls: false,
        rtt: "websocket",
      },
    });
    await vi.waitFor(() => expect(phone.state).toBe("connecting"));
    expect(box.saved!.authUsername).toBe("alice-auth");
    expect(box.saved!.username).toBe("alice");
    expect(box.saved!.ha1).toBe(computeHa1("alice-auth", "example.fr", "secret123"));
    // les deux empreintes suivent la même identité d'authentification
    expect(box.saved!.ha1Sha256).toBe(computeHa1Sha256("alice-auth", "example.fr", "secret123"));
  });

  it("mot de passe vide sans compte existant : erreur, on reste sur le formulaire", async () => {
    const { phone } = await bootTo("home", null);
    phone.send({ type: "ui:configure", id: phone.context.accounts[0]?.id ?? null });
    phone.send({
      type: "ui:saveConfig",
      form: {
        proxy: "wss://x",
        uri: "u@x.fr",
        displayName: "",
        authUsername: null,
        password: null,
        stun: "",
        turn: "",
        turnUsername: "",
        turnPassword: null,
        turnTls: false,
        rtt: "websocket",
      },
    });
    expect(phone.state).toBe("configuring");
    expect(phone.context.lastError).toEqual({ key: "error.passwordRequired" });
  });

  it("mot de passe vide avec compte existant : conserve le HA1 (même identité/domaine)", async () => {
    const { phone, box } = await bootTo("home", CFG);
    phone.send({ type: "ui:configure", id: phone.context.accounts[0]?.id ?? null });
    phone.send({
      type: "ui:saveConfig",
      form: {
        proxy: "wss://autre.example.fr/ws",
        uri: `${CFG.username}@${CFG.domain}`,
        displayName: CFG.displayName,
        authUsername: null,
        password: null,
        stun: "",
        turn: "",
        turnUsername: "",
        turnPassword: null,
        turnTls: false,
        rtt: "websocket",
      },
    });
    await vi.waitFor(() => expect(phone.state).toBe("connecting"));
    expect(box.saved!.ha1).toBe(CFG.ha1);
    expect(box.saved!.proxy).toBe("wss://autre.example.fr/ws");
  });

  it("un compte corrigé garde son identifiant d'instance : le registrar y voit le même appareil", async () => {
    const { phone, sip, box } = await bootTo("home", CFG);
    phone.send({ type: "ui:configure", id: phone.context.accounts[0]?.id ?? null });
    phone.send({
      type: "ui:saveConfig",
      form: {
        proxy: "wss://autre.example.fr/ws",
        uri: `${CFG.username}@${CFG.domain}`,
        displayName: "Alice M.",
        authUsername: null,
        password: null,
        stun: "",
        turn: "",
        turnUsername: "",
        turnPassword: null,
        turnTls: false,
        rtt: "websocket",
      },
    });
    await vi.waitFor(() => expect(phone.state).toBe("connecting"));
    expect(box.vault.accounts[0]!.instanceId).toBe(SEED_INSTANCE);
    expect(sip.started.at(-1)!.instanceId).toBe(SEED_INSTANCE);
  });

  it("changement d'identité sans nouveau mot de passe : refusé (le HA1 en dépend)", async () => {
    const { phone } = await bootTo("home", CFG);
    phone.send({ type: "ui:configure", id: phone.context.accounts[0]?.id ?? null });
    phone.send({
      type: "ui:saveConfig",
      form: {
        proxy: CFG.proxy,
        uri: `bob@${CFG.domain}`,
        displayName: CFG.displayName,
        authUsername: null,
        password: null,
        stun: "",
        turn: "",
        turnUsername: "",
        turnPassword: null,
        turnTls: false,
        rtt: "websocket",
      },
    });
    expect(phone.state).toBe("configuring");
    expect(phone.context.lastError).toEqual({ key: "error.passwordRequired" });
  });

  it("ajout d'un identifiant d'authentification sans mot de passe : refusé", async () => {
    const { phone } = await bootTo("home", CFG);
    phone.send({ type: "ui:configure", id: phone.context.accounts[0]?.id ?? null });
    phone.send({
      type: "ui:saveConfig",
      form: {
        proxy: CFG.proxy,
        uri: `${CFG.username}@${CFG.domain}`,
        displayName: CFG.displayName,
        authUsername: "alice-auth",
        password: null,
        stun: "",
        turn: "",
        turnUsername: "",
        turnPassword: null,
        turnTls: false,
        rtt: "websocket",
      },
    });
    expect(phone.state).toBe("configuring");
    expect(phone.context.lastError).toEqual({ key: "error.passwordRequired" });
  });

  it("serveurs STUN/TURN : persistés avec le compte et passés au port SIP", async () => {
    const { phone, sip, box } = await bootTo("home", CFG);
    phone.send({ type: "ui:configure", id: phone.context.accounts[0]?.id ?? null });
    phone.send({
      type: "ui:saveConfig",
      form: {
        proxy: CFG.proxy,
        uri: `${CFG.username}@${CFG.domain}`,
        displayName: CFG.displayName,
        authUsername: null,
        password: null,
        stun: "stun.example.fr:3478",
        turn: "turn.example.fr:5349",
        turnUsername: "alice",
        turnPassword: "relais",
        turnTls: true,
        rtt: "websocket",
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
    phone.send({ type: "ui:configure", id: phone.context.accounts[0]?.id ?? null });
    phone.send({
      type: "ui:saveConfig",
      form: {
        proxy: CFG.proxy,
        uri: `${CFG.username}@${CFG.domain}`,
        displayName: CFG.displayName,
        authUsername: null,
        password: null,
        stun: "stun.example.fr/ws",
        turn: "",
        turnUsername: "",
        turnPassword: null,
        turnTls: false,
        rtt: "websocket",
      },
    });
    expect(phone.state).toBe("configuring");
    expect(phone.context.lastError).toEqual({ key: "error.stunInvalid" });
    expect(phone.context.suspectFields).toBe("stun");
    expect(box.saved).toEqual(CFG); // rien n'a été enregistré
  });

  it("flash d'appel entrant désactivé : persisté sans réenregistrement", async () => {
    const { phone, box } = await bootTo("ready", CFG);
    phone.send({ type: "ui:setFlashAlert", on: false });
    expect(phone.state).toBe("ready");
    expect(activeCfg(phone)!.flashAlert).toBe(false);
    await vi.waitFor(() => expect(box.saved!.flashAlert).toBe(false));
  });

  it("flash d'appel entrant : le formulaire du compte ne le remet pas", async () => {
    const { phone, box } = await bootTo("home", { ...CFG, flashAlert: false });
    phone.send({ type: "ui:configure", id: phone.context.accounts[0]?.id ?? null });
    phone.send({
      type: "ui:saveConfig",
      form: {
        proxy: CFG.proxy,
        uri: `${CFG.username}@${CFG.domain}`,
        displayName: CFG.displayName,
        authUsername: null,
        password: null,
        stun: "",
        turn: "",
        turnUsername: "",
        turnPassword: null,
        turnTls: false,
        rtt: "websocket",
      },
    });
    await vi.waitFor(() => expect(phone.state).toBe("connecting"));
    expect(box.saved!.flashAlert).toBe(false);
  });

  it("transport du texte en temps réel : persisté avec le compte", async () => {
    const { phone, box } = await bootTo("home", CFG);
    phone.send({ type: "ui:configure", id: phone.context.accounts[0]?.id ?? null });
    phone.send({
      type: "ui:saveConfig",
      form: {
        proxy: CFG.proxy,
        uri: `${CFG.username}@${CFG.domain}`,
        displayName: CFG.displayName,
        authUsername: null,
        password: null,
        stun: "",
        turn: "",
        turnUsername: "",
        turnPassword: null,
        turnTls: false,
        rtt: "datachannel",
      },
    });
    await vi.waitFor(() => expect(phone.state).toBe("connecting"));
    expect(box.saved!.rtt).toBe("datachannel");
    expect(activeCfg(phone)!.rtt).toBe("datachannel");
  });

  it("transport inconnu : le compte retombe sur « aucun », sans échouer", async () => {
    const { phone, box } = await bootTo("home", CFG);
    phone.send({ type: "ui:configure", id: phone.context.accounts[0]?.id ?? null });
    phone.send({
      type: "ui:saveConfig",
      form: {
        proxy: CFG.proxy,
        uri: `${CFG.username}@${CFG.domain}`,
        displayName: CFG.displayName,
        authUsername: null,
        password: null,
        stun: "",
        turn: "",
        turnUsername: "",
        turnPassword: null,
        turnTls: false,
        // un choix qui n'existe pas : formulaire trafiqué, ou réglage
        // d'une version à venir relu par celle-ci
        rtt: "rtp" as unknown as "websocket",
      },
    });
    await vi.waitFor(() => expect(phone.state).toBe("connecting"));
    expect(box.saved!.rtt).toBe("none");
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

  it("défi SHA-256 sans empreinte : le motif le dit, plutôt qu'« identifiants refusés »", async () => {
    const { phone, sip } = await bootTo("registering", CFG);
    sip.send({
      type: "sip:registrationFailed",
      cause: "Unauthorized",
      statusCode: 401,
      missingSha256: true,
    });
    expect(phone.state).toBe("reg_failed");
    expect(phone.context.lastError).toEqual({ key: "error.missingSha256" });
    expect(phone.context.lastErrorCode).toBe("SHA256_MISSING");
    // ressaisir le mot de passe est le remède : c'est le formulaire qu'on désigne
    expect(phone.context.suspectFields).toBe("credentials");
  });

  it("le même défi sur un re-REGISTER sort de ready sans passer par la reconnexion", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    sip.send({
      type: "sip:registrationFailed",
      cause: "Unauthorized",
      statusCode: 401,
      missingSha256: true,
    });
    expect(phone.state).toBe("reg_failed");
    expect(phone.context.lastError).toEqual({ key: "error.missingSha256" });
    expect(phone.context.lastErrorCode).toBe("SHA256_MISSING");
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
    expect(activeCfg(phone)).toEqual(CFG); // formulaire pré-rempli
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
    phone.send({ type: "ui:configure", id: phone.context.accounts[0]?.id ?? null });
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
      phone.send({ type: "ui:useAccount", id: SEED_ID });
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
      phone.send({ type: "ui:useAccount", id: SEED_ID });
      await vi.advanceTimersByTimeAsync(0); // règle la task saveVault de `switching`
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
    phone.send({ type: "ui:call", target: "sip:bob@example.fr", media: { audio: true, video: false, text: false } });
    expect(phone.state).toBe("in_call");
    expect(sip.calls).toEqual([{ target: "sip:bob@example.fr", media: { audio: true, video: false, text: false } }]);
    expect(phone.context.call?.state).toBe("dialing");

    sip.sendCall({ type: "sip:progress", media: NO_MEDIA });
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
    phone.send({ type: "ui:call", target: "sip:bob@example.fr", media: { audio: true, video: true, text: false } });
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
    phone.send({ type: "ui:call", target: "sip:bob@example.fr", media: { audio: true, video: false, text: false } });
    sip.sendCall({ type: "sip:accepted" });
    phone.send({ type: "ui:hangup" });
    expect(sip.session.terminated).toBe(1);
    expect(phone.context.call?.state).toBe("hangingup");
    sip.sendCall({ type: "sip:ended", cause: "BYE" });
    expect(phone.state).toBe("ready");
  });

  /**
   * L'audio entre et sort de l'appel comme la vidéo (ADR 0003, D5) : le
   * bouton n'est plus une sourdine, c'est le second bouton de l'axe 1. Ce
   * qui se vérifie ici est que la demande traverse bien PhoneMachine, le
   * bloc et le port — le même chemin que la caméra, à l'identique.
   */
  it("retrait de l'audio pendant l'appel : re-INVITE relayé jusqu'à la session", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    phone.send({ type: "ui:call", target: "sip:bob@example.fr", media: { audio: true, video: true, text: false } });
    sip.sendCall({ type: "sip:accepted" });
    sip.sendCall({ type: "sip:mediaChanged", media: { audio: true, video: true, text: false } });
    phone.send({ type: "ui:toggleMedia", kind: "audio" });
    expect(sip.session.askedFor("audio")).toEqual([false]);
    expect(phone.context.call?.mediaPending).toBe(true);
    sip.sendCall({ type: "sip:mediaChanged", media: { audio: false, video: true, text: false } });
    expect(phone.context.call?.media).toEqual({ audio: false, video: true, text: false });
    expect(phone.context.call?.mediaPending).toBe(false);
  });

  it("retrait de la vidéo pendant l'appel : re-INVITE relayé jusqu'à la session", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    phone.send({ type: "ui:call", target: "sip:bob@example.fr", media: { audio: true, video: true, text: false } });
    sip.sendCall({ type: "sip:accepted" });
    sip.sendCall({ type: "sip:mediaChanged", media: { audio: true, video: true, text: false } });
    phone.send({ type: "ui:toggleMedia", kind: "video" });
    expect(sip.session.askedFor("video")).toEqual([false]);
    expect(phone.context.call?.mediaPending).toBe(true);
    sip.sendCall({ type: "sip:mediaChanged", media: { audio: true, video: false, text: false } });
    expect(phone.context.call?.media).toEqual({ audio: true, video: false, text: false });
    expect(phone.context.call?.mediaPending).toBe(false);
  });

  it("Paramètres/Déconnexion pendant l'appel : consommés sans effet", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    phone.send({ type: "ui:call", target: "sip:bob@example.fr", media: { audio: true, video: false, text: false } });
    phone.send({ type: "ui:logout" });
    phone.send({ type: "ui:backToSettings" });
    expect(phone.state).toBe("in_call");
    expect(sip.stopped).toBe(0);
  });

  it("enregistrement perdu pendant l'appel (403) : reg_failed à la fin de l'appel", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    phone.send({ type: "ui:call", target: "sip:bob@example.fr", media: { audio: true, video: false, text: false } });
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
    const { call } = fakeIncoming({ audio: true, video: true, text: false });
    sip.send({ type: "sip:incoming", call });
    expect(phone.state).toBe("in_call");
    expect(phone.context.call).toMatchObject({
      state: "ringing_in",
      direction: "incoming",
      target: "sip:bob@example.fr",
      displayName: "Bob Martin",
      offered: { audio: true, video: true, text: false },
    });
  });

  it("réponse : médias relayés à la session, puis connected", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    const { call, box } = fakeIncoming({ audio: true, video: true, text: false });
    sip.send({ type: "sip:incoming", call });
    phone.send({ type: "ui:answer", media: { audio: true, video: false, text: false } });
    expect(box.answered).toEqual([{ audio: true, video: false, text: false }]);
    box.sendCall({ type: "sip:accepted" });
    expect(phone.context.call?.state).toBe("connected");
    expect(phone.context.call?.media).toEqual({ audio: true, video: false, text: false });
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
    phone.send({ type: "ui:answer", media: { audio: true, video: false, text: false } });
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
    const { call, box } = fakeIncoming({ audio: true, video: true, text: false });
    sip.send({ type: "sip:incoming", call });
    phone.send({ type: "ui:answer", media: { audio: true, video: false, text: false } });
    box.sendCall({ type: "sip:accepted" });
    box.sendCall({ type: "sip:ended", cause: "BYE", originator: "remote" });
    expect(phone.state).toBe("ready");
    expect(phone.context.history[0]).toMatchObject({
      target: "bob@example.fr",
      direction: "incoming",
      outcome: "answered",
      endedBy: "remote",
      media: { audio: true, video: false, text: false },
    });
  });

  it("offre inétablissable : refusée sans sonner, consignée, cause affichée", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    const bad = fakeIncoming({ audio: true, video: false, text: false }, "ICE, DTLS, SRTP (RTP/AVP)");
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
    phone.send({ type: "ui:call", target: "sip:bob@example.fr", media: { audio: true, video: true, text: false } });
    sip.sendCall({ type: "sip:accepted" });
    sip.sendCall({ type: "sip:ended", cause: "BYE", originator: "remote" });
    expect(phone.state).toBe("ready");

    const [entry] = phone.context.history;
    expect(entry).toMatchObject({
      target: "bob@example.fr",
      direction: "outgoing",
      outcome: "answered",
      endedBy: "remote",
      media: { audio: true, video: true, text: false },
    });
    expect(entry!.connectedAt).not.toBeNull();
    await vi.waitFor(() =>
      expect(box.history.get(SEED_ID)).toHaveLength(1),
    );
  });

  it("appel raccroché localement : endedBy = local", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    phone.send({ type: "ui:call", target: "sip:bob@example.fr", media: { audio: true, video: false, text: false } });
    sip.sendCall({ type: "sip:accepted" });
    phone.send({ type: "ui:hangup" });
    sip.sendCall({ type: "sip:ended", cause: "BYE", originator: "local" });
    expect(phone.context.history[0]).toMatchObject({ outcome: "answered", endedBy: "local" });
  });

  it("appel refusé : outcome failed, pas de endedBy (jamais établi)", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    phone.send({ type: "ui:call", target: "sip:bob@example.fr", media: { audio: true, video: false, text: false } });
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
    phone.send({ type: "ui:call", target: "sip:bob@example.fr", media: { audio: true, video: false, text: false } });
    // le port ouvre le carnet en plaçant l'appel : la session en cours est la sienne
    sip.session.traceLines = [
      { at: 1, kind: "sip", way: "out", head: "INVITE sip:bob@example.fr SIP/2.0", body: "…" },
    ];
    sip.sendCall({ type: "sip:accepted" });
    sip.sendCall({ type: "sip:ended", cause: "BYE", originator: "remote" });
    expect(phone.context.history[0]!.trace).toHaveLength(1);

    // trace éteinte : le carnet est vide, et la ligne ne porte rien — c'est
    // ce qui décide de l'icône parchemin dans l'historique
    phone.send({ type: "ui:call", target: "sip:carol@example.fr", media: { audio: true, video: false, text: false } });
    sip.sendCall({ type: "sip:accepted" });
    sip.sendCall({ type: "sip:ended", cause: "BYE", originator: "remote" });
    expect(phone.context.history[0]!.trace).toBeUndefined();
  });

  it("le bilan média suit le même chemin que le carnet — et manque avec lui", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    phone.send({ type: "ui:call", target: "sip:bob@example.fr", media: { audio: true, video: false, text: false } });
    sip.session.statsSummary = {
      audio: {
        recv: { codec: "opus", clockRate: 48000, kbps: 32, loss: 0.01 },
        sent: { codec: "opus", clockRate: 48000, kbps: 31, loss: 0.02 },
      },
      video: null,
      share: null,
      text: null,
      rttMs: 42,
      syncMs: null,
      spanMs: 133_000,
    };
    sip.sendCall({ type: "sip:accepted" });
    sip.sendCall({ type: "sip:ended", cause: "BYE", originator: "remote" });
    expect(phone.context.history[0]!.stats).toMatchObject({ rttMs: 42, spanMs: 133_000 });

    // rien mesuré (trace éteinte, ou appel sans média) : la ligne ne porte
    // rien — c'est ce qui décide de l'icône loupe dans l'historique
    phone.send({ type: "ui:call", target: "sip:carol@example.fr", media: { audio: true, video: false, text: false } });
    sip.session.statsSummary = null;
    sip.sendCall({ type: "sip:accepted" });
    sip.sendCall({ type: "sip:ended", cause: "BYE", originator: "remote" });
    expect(phone.context.history[0]!.stats).toBeUndefined();
  });

  it("la conversation est consignée avec la ligne — et absente si personne n'a écrit", async () => {
    let thread: ChatItem[] = [
      {
        kind: "bubble",
        id: 1,
        side: "them",
        runs: [{ text: "je vous entends mal", attrs: {} }],
        startedAt: 1,
        endedAt: 2,
      },
    ];
    const { phone, sip } = await bootTo("ready", CFG, [], () => thread);
    phone.send({ type: "ui:call", target: "sip:bob@example.fr", media: { audio: false, video: false, text: false } });
    sip.sendCall({ type: "sip:accepted" });
    sip.sendCall({ type: "sip:ended", cause: "BYE", originator: "remote" });
    expect(phone.context.history[0]!.chat).toHaveLength(1);

    // appel sans texte, ou personne n'a rien écrit : la ligne ne porte rien
    // — c'est ce qui décide de la bulle « T » dans l'historique
    thread = [];
    phone.send({ type: "ui:call", target: "sip:carol@example.fr", media: { audio: true, video: false, text: false } });
    sip.sendCall({ type: "sip:accepted" });
    sip.sendCall({ type: "sip:ended", cause: "BYE", originator: "remote" });
    expect(phone.context.history[0]!.chat).toBeUndefined();
  });

  it("ui:clearHistory vide la liste et la persistance", async () => {
    const { phone, sip, box } = await bootTo("ready", CFG);
    phone.send({ type: "ui:call", target: "sip:bob@example.fr", media: { audio: true, video: false, text: false } });
    sip.sendCall({ type: "sip:accepted" });
    sip.sendCall({ type: "sip:ended", cause: "BYE", originator: "remote" });
    expect(phone.context.history).toHaveLength(1);
    phone.send({ type: "ui:clearHistory" });
    expect(phone.context.history).toHaveLength(0);
    await vi.waitFor(() => expect(box.history.get(SEED_ID)).toEqual([]));
  });

  it("ui:clearHistory avec une clé n'efface que les appels de ce correspondant", async () => {
    const { phone, sip, box } = await bootTo("ready", CFG);
    for (const target of ["sip:bob@example.fr", "sip:carol@example.fr", "sip:bob@example.fr"]) {
      phone.send({ type: "ui:call", target, media: { audio: true, video: false, text: false } });
      sip.sendCall({ type: "sip:accepted" });
      sip.sendCall({ type: "sip:ended", cause: "BYE", originator: "remote" });
    }
    expect(phone.context.history).toHaveLength(3);
    phone.send({ type: "ui:clearHistory", key: "bob@example.fr" });
    expect(phone.context.history.map((e) => e.target)).toEqual(["carol@example.fr"]);
    await vi.waitFor(() => expect(box.history.get(SEED_ID)).toHaveLength(1));
  });

  it("l'historique du compte est rechargé au boot", async () => {
    const past: CallLogEntry = {
      target: "carol@example.fr",
      direction: "outgoing",
      outcome: "answered",
      media: { audio: true, video: false, text: false },
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
      media: { audio: true, video: false, text: false },
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
      media: { audio: true, video: false, text: false },
      startedAt: 50 - i,
      connectedAt: 50 - i,
      endedAt: 50 - i,
      endedBy: "local",
      reason: null,
    }));
    const { phone, sip } = await bootTo("ready", CFG, full);
    phone.send({ type: "ui:call", target: "sip:carol@example.fr", media: { audio: true, video: false, text: false } });
    sip.sendCall({ type: "sip:accepted" });
    sip.sendCall({ type: "sip:ended", cause: "BYE", originator: "remote" });

    expect(phone.context.history).toHaveLength(50);
    expect(phone.context.history[0]!.target).toBe("carol@example.fr");
    expect(phone.context.history.some((e) => e.target === "bob49@example.fr")).toBe(false);
  });
});

describe("PhoneMachine — carnet de contacts (ADR 0007, D7)", () => {
  it("ajout : adresse normalisée, persistée sous le compte actif", async () => {
    const { phone, box } = await bootTo("ready", CFG);
    phone.send({ type: "ui:addContact", name: " Bob Martin ", uri: "bob" });
    expect(phone.context.contacts).toMatchObject([{ name: "Bob Martin", uri: "sip:bob@example.fr" }]);
    await vi.waitFor(() => expect(box.contacts.get(SEED_ID)).toHaveLength(1));
  });

  it("sans nom, le contact prend la partie utilisateur", async () => {
    const { phone } = await bootTo("ready", CFG);
    phone.send({ type: "ui:addContact", name: "", uri: "sip:carol@example.fr" });
    expect(phone.context.contacts[0]!.name).toBe("carol");
  });

  it("une adresse invalide est refusée et le dit", async () => {
    const { phone } = await bootTo("ready", CFG);
    phone.send({ type: "ui:addContact", name: "X", uri: "not an address" });
    expect(phone.context.contacts).toEqual([]);
    expect(phone.context.contactError).toEqual({ key: "error.invalidUri" });
    // l'erreur tombe au geste suivant qui réussit
    phone.send({ type: "ui:addContact", name: "Bob", uri: "bob@example.fr" });
    expect(phone.context.contactError).toBeNull();
  });

  it("la même adresse n'entre pas deux fois, quelle que soit sa forme", async () => {
    const { phone } = await bootTo("ready", CFG);
    phone.send({ type: "ui:addContact", name: "Bob", uri: "bob@example.fr" });
    phone.send({ type: "ui:addContact", name: "Bobby", uri: "sip:bob@EXAMPLE.fr" });
    expect(phone.context.contacts).toHaveLength(1);
  });

  it("renommer et retirer", async () => {
    const { phone, box } = await bootTo("ready", CFG);
    phone.send({ type: "ui:addContact", name: "Bob", uri: "bob" });
    const id = phone.context.contacts[0]!.id;
    phone.send({ type: "ui:renameContact", id, name: "Robert" });
    expect(phone.context.contacts[0]!.name).toBe("Robert");
    phone.send({ type: "ui:renameContact", id, name: "  " });
    expect(phone.context.contacts[0]!.name).toBe("Robert");
    phone.send({ type: "ui:removeContact", id });
    expect(phone.context.contacts).toEqual([]);
    await vi.waitFor(() => expect(box.contacts.get(SEED_ID)).toEqual([]));
  });

  it("le carnet est relu avec le compte, et ne suit pas une bascule", async () => {
    const { store, box } = fakeStore(CFG);
    const other: StoredAccount = { ...CFG, id: "acc-other", instanceId: "b0b00000-0000-4000-8000-000000000002", username: "zoe" };
    box.vault = { accounts: [...box.vault.accounts, other], activeId: SEED_ID };
    const bob: Contact = { id: "c1", name: "Bob", uri: "sip:bob@example.fr", addedAt: 1, blocked: false };
    box.contacts.set(SEED_ID, [bob]);
    const sip = new FakeSip();
    const phone = PhoneMachine.start({ args: { store, sip } });
    await vi.waitFor(() => expect(phone.state).toBe("home"));
    expect(phone.context.contacts).toEqual([bob]);
    phone.send({ type: "ui:useAccount", id: "acc-other" });
    await vi.waitFor(() => expect(phone.state).toBe("connecting"));
    expect(phone.context.contacts).toEqual([]);
  });

  it("supprimer le compte efface son carnet", async () => {
    const { phone, box } = await bootTo("home", CFG);
    box.contacts.set(SEED_ID, [{ id: "c1", name: "Bob", uri: "sip:bob@example.fr", addedAt: 1, blocked: false }]);
    phone.send({ type: "ui:configure", id: SEED_ID });
    phone.send({ type: "ui:deleteAccount" });
    await vi.waitFor(() => expect(phone.state).toBe("home"));
    expect(box.contacts.has(SEED_ID)).toBe(false);
  });
});

describe("PhoneMachine — Ne pas déranger (ADR 0007, D6)", () => {
  it("l'INVITE est refusé en 486 sans sonner, et consigné comme refusé", async () => {
    const { phone, sip, box } = await bootTo("ready", CFG, [], () => [], () => true);
    const { call, box: incoming } = fakeIncoming({ audio: true, video: true, text: false });
    sip.send({ type: "sip:incoming", call });
    expect(phone.state).toBe("ready");
    expect(incoming.rejected).toEqual(["busy"]);
    expect(phone.context.history[0]).toMatchObject({
      target: "bob@example.fr",
      direction: "incoming",
      outcome: "declined",
      media: { audio: true, video: true, text: false },
      connectedAt: null,
      endedBy: null,
    });
    await vi.waitFor(() => expect(box.history.get(SEED_ID)).toHaveLength(1));
  });

  it("le statut est relu à chaque INVITE", async () => {
    let dnd = true;
    const { phone, sip } = await bootTo("ready", CFG, [], () => [], () => dnd);
    sip.send({ type: "sip:incoming", call: fakeIncoming().call });
    expect(phone.state).toBe("ready");
    dnd = false;
    sip.send({ type: "sip:incoming", call: fakeIncoming().call });
    expect(phone.state).toBe("in_call");
  });
});

describe("PhoneMachine — contacts bloqués (ADR 0008, D7)", () => {
  it("bloquer une adresse hors carnet crée un contact bloqué ; débloquer le garde", async () => {
    const { phone, box } = await bootTo("ready", CFG);
    phone.send({ type: "ui:blockContact", uri: "mallory", name: "" });
    const [mallory] = phone.context.contacts;
    expect(mallory).toMatchObject({ name: "mallory@example.fr", uri: "sip:mallory@example.fr", blocked: true });
    phone.send({ type: "ui:unblockContact", id: mallory!.id });
    expect(phone.context.contacts).toEqual([{ ...mallory, blocked: false }]);
    await vi.waitFor(() => expect(box.contacts.get(SEED_ID)?.[0]?.blocked).toBe(false));
  });

  it("bloquer un contact du carnet le marque, sans le dupliquer", async () => {
    const { phone } = await bootTo("ready", CFG);
    phone.send({ type: "ui:addContact", name: "Bob", uri: "bob" });
    phone.send({ type: "ui:blockContact", uri: "sip:bob@example.fr", name: "autre nom" });
    expect(phone.context.contacts).toEqual([expect.objectContaining({ name: "Bob", blocked: true })]);
  });

  it("son INVITE reçoit 603, avant Ne pas déranger, sans sonner ni historique", async () => {
    const { phone, sip } = await bootTo("ready", CFG, [], () => [], () => true);
    phone.send({ type: "ui:blockContact", uri: "bob", name: "" });
    const { call, box: incoming } = fakeIncoming();
    sip.send({ type: "sip:incoming", call });
    expect(incoming.rejected).toEqual(["declined"]);
    expect(phone.state).toBe("ready");
    expect(phone.context.history).toEqual([]);
  });

  it("pendant un appel, son second INVITE reçoit 603 et non 486", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    phone.send({ type: "ui:blockContact", uri: "bob", name: "" });
    const first = fakeIncoming();
    first.call.from = "sip:carol@example.fr";
    sip.send({ type: "sip:incoming", call: first.call });
    expect(phone.state).toBe("in_call");
    const second = fakeIncoming();
    sip.send({ type: "sip:incoming", call: second.call });
    expect(second.box.rejected).toEqual(["declined"]);
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
      phone.send({ type: "ui:useAccount", id: SEED_ID });
      await vi.advanceTimersByTimeAsync(0); // règle la task saveVault de `switching`
      sip.send({ type: "sip:connected" });
      sip.send({ type: "sip:registered" });
      expect(phone.state).toBe("ready");

      sip.send({ type: "sip:disconnected" });
      expect(phone.state).toBe("reconnecting");
      expect(phone.context.lastErrorCode).toBe("WSS_LOST");

      // appeler est refusé dans cet état (l'UI grise le bouton)
      phone.send({ type: "ui:call", target: "sip:bob@example.fr", media: { audio: true, video: false, text: false } });
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
    phone.send({ type: "ui:call", target: "sip:bob@example.fr", media: { audio: true, video: false, text: false } });
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
    phone.send({ type: "ui:call", target: "sip:bob@example.fr", media: { audio: true, video: false, text: false } });
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
      phone.send({ type: "ui:useAccount", id: SEED_ID });
      await vi.advanceTimersByTimeAsync(0); // règle la task saveVault de `switching`
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
    expect(activeCfg(phone)).toEqual(CFG);
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
        stun: "",
        turn: "",
        turnUsername: "",
        turnPassword: null,
        turnTls: false,
        rtt: "websocket",
      },
    });
    await vi.waitFor(() => expect(phone.state).toBe("connecting"));
    expect(box.saved!.proxy).toBe("wss://autre.example.fr/ws");
    expect(sip.started).toHaveLength(2);
  });

  it("Annuler depuis la config ouverte à l'accueil : retour à l'accueil", async () => {
    const { phone, sip } = await bootTo("home", CFG);
    phone.send({ type: "ui:configure", id: phone.context.accounts[0]?.id ?? null });
    phone.send({ type: "ui:cancelConfig" });
    expect(phone.state).toBe("home");
    expect(sip.started).toHaveLength(0);
  });
});

/**
 * La reprise de l'enregistrement au chargement (ADR 0006, D4).
 *
 * Le coffre dit *quel* compte est choisi ; le marqueur, hors coffre, dit
 * que ce compte **doit** être enregistré. C'est lui qui fait repartir Trix
 * en `connecting` au lieu de s'arrêter sur l'accueil — quel que soit le
 * motif du chargement, y compris un onglet déchargé par l'Économiseur de
 * mémoire, qui ne prévient de rien.
 */
describe("PhoneMachine — reprise de l'enregistrement (ADR 0006, D4)", () => {
  let data: Map<string, string>;

  beforeEach(() => {
    data = new Map();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => data.set(k, v),
        removeItem: (k: string) => data.delete(k),
      },
    });
  });

  // le marqueur est un état de module du navigateur : sans cette remise à
  // zéro, les tests qui suivent hériteraient d'une session à reprendre
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "localStorage");
  });

  /** Amorçage nu : ni `ui:useAccount`, ni aucun autre événement d'interface. */
  function boot(initial: AccountConfig | null = CFG) {
    const { store, box } = fakeStore(initial);
    const sip = new FakeSip();
    const phone = PhoneMachine.start({ args: { store, sip, transcript: () => [] } });
    return { phone, sip, box };
  }

  it("coffre + marqueur : connecting, sans aucun événement d'interface", async () => {
    data.set("trix-resume", SEED_ID);
    const { phone, sip } = boot();
    await vi.waitFor(() => expect(phone.state).toBe("connecting"));
    expect(sip.started).toHaveLength(1);
    expect(activeCfg(phone)).toEqual(CFG);
  });

  it("sans marqueur, l'amorçage s'arrête sur l'accueil", async () => {
    const { phone, sip } = boot();
    await vi.waitFor(() => expect(phone.state).toBe("home"));
    expect(sip.started).toHaveLength(0);
  });

  it("un marqueur qui désigne un compte absent du coffre ne reprend rien", async () => {
    data.set("trix-resume", "acc-disparu");
    const { phone, sip } = boot();
    await vi.waitFor(() => expect(phone.state).toBe("home"));
    expect(sip.started).toHaveLength(0);
  });

  it("l'enregistrement réussi pose le marqueur", async () => {
    const { phone, sip } = boot();
    await vi.waitFor(() => expect(phone.state).toBe("home"));
    phone.send({ type: "ui:useAccount", id: SEED_ID });
    await vi.waitFor(() => expect(phone.state).toBe("connecting"));
    expect(data.get("trix-resume")).toBeUndefined(); // rien tant que rien n'a abouti
    sip.send({ type: "sip:connected" });
    sip.send({ type: "sip:registered" });
    expect(phone.state).toBe("ready");
    expect(data.get("trix-resume")).toBe(SEED_ID);
  });

  it("« Déconnexion » efface le marqueur, la veille ne l'efface pas", async () => {
    data.set("trix-resume", SEED_ID);
    const { phone, sip } = boot();
    await vi.waitFor(() => expect(phone.state).toBe("connecting"));
    sip.send({ type: "sip:connected" });
    sip.send({ type: "sip:registered" });
    // s'endormir n'est pas une décision de l'utilisateur : le compte reste
    // à reprendre, et le prochain chargement s'enregistrera tout seul
    phone.send({ type: "sys:sleep" });
    expect(phone.state).toBe("sleeping");
    expect(data.get("trix-resume")).toBe(SEED_ID);
    phone.send({ type: "ui:logout" });
    expect(phone.state).toBe("home");
    expect(data.get("trix-resume")).toBeUndefined();
  });
});

/**
 * Aucun état ne reste sourd à l'endormissement (ADR 0006, D3 et D5).
 *
 * Un `sys:sleep` non consommé est un trou : il s'annonce en console, et
 * surtout il laisse un contact vivant chez un registrar qui n'a plus
 * personne au bout du fil. La garantie est **structurelle** et se lit sur
 * la source plutôt qu'en pilotant quatorze fois la machine jusqu'à chaque
 * état — un état ajouté demain sans ces deux lignes échouera ici.
 *
 * `in_call` est la seule exception, et c'est une délégation, pas un
 * oubli : il a passé la main à `CallBlock`, qui les traite tous les deux
 * (raccrocher, puis laisser `sleepRequested` derrière lui).
 */
describe("PhoneMachine — l'endormissement atteint chaque état", () => {
  it("tous les états traitent sys:sleep et sys:wake", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../src/machines/phone.ts", import.meta.url)),
      "utf8",
    );
    const graph = machineGraphs(source, "phone.ts")[0]!;
    const handled = (state: string): string[] => [
      ...graph.edges.filter((e) => e.from === state).flatMap((e) => e.labels),
      ...(graph.consumed.find((c) => c.state === state)?.events ?? []),
    ];
    for (const state of graph.states) {
      if (state === "in_call") continue; // le bloc tient la boîte aux lettres
      // les libellés portent le motif de la transition entre parenthèses
      const events = handled(state).map((label) => label.replace(/ \(.*\)$/, ""));
      expect(events, `état ${state}`).toContain("sys:sleep");
      expect(events, `état ${state}`).toContain("sys:wake");
    }
  });
});
