/**
 * Deux comptes SIP, un seul enregistré à la fois (ADR 0002) : ajout,
 * bascule, suppression, et l'étanchéité que tout cela doit tenir — un
 * compte ne voit jamais les appels ni les identifiants de l'autre.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { activeAccount, PhoneMachine, type PhoneInstance } from "../src/machines/phone.js";
import type { ConfigForm } from "../src/machines/events.js";
import type {
  AccountConfig,
  CallLogEntry,
  SecureStore,
  StoredAccount,
  Vault,
} from "../src/storage/store.js";
import type { CallMedia, SipEvent, SipPort } from "../src/sip/port.js";
import { computeHa1 } from "../src/storage/ha1.js";
import { NO_ICE } from "../src/sip/ice.js";
import { MAX_ACCOUNTS } from "../src/accounts.js";
import { OPEN_DEPLOYMENT, setDeployment } from "../src/deployment.js";

const ALICE: StoredAccount = {
  id: "id-alice",
  proxy: "wss://sip.example.fr:8443/ws",
  domain: "example.fr",
  displayName: "Alice Martin",
  username: "alice",
  authUsername: null,
  ha1: computeHa1("alice", "example.fr", "secret-alice"),
  flashAlert: true,
  ice: NO_ICE,
  rtt: "websocket",
};

const BOB: StoredAccount = {
  ...ALICE,
  id: "id-bob",
  displayName: "Bob Durand",
  username: "bob",
  ha1: computeHa1("bob", "example.fr", "secret-bob"),
};

/** Le formulaire tel que l'écran l'envoie, mot de passe laissé vide. */
function form(over: Partial<ConfigForm> = {}): ConfigForm {
  return {
    proxy: ALICE.proxy,
    uri: "alice@example.fr",
    displayName: ALICE.displayName,
    authUsername: null,
    password: null,
    flashAlert: true,
    stun: "",
    turn: "",
    turnUsername: "",
    turnPassword: null,
    turnTls: false,
    rtt: "websocket",
    ...over,
  };
}

function fakeStore(vault: Vault, histories: Record<string, CallLogEntry[]> = {}) {
  const box = {
    vault,
    history: new Map<string, CallLogEntry[]>(Object.entries(histories)),
    dropped: [] as string[],
  };
  const store: SecureStore = {
    load: async () => box.vault,
    save: async (v) => {
      box.vault = v;
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
  };
  return { store, box };
}

class FakeSip implements SipPort {
  started: AccountConfig[] = [];
  stopped = 0;
  send: (ev: SipEvent) => void = () => {};
  calls: { target: string; media: CallMedia }[] = [];
  start(cfg: AccountConfig, send: (ev: SipEvent) => void) {
    this.started.push(cfg);
    this.send = send;
    return {
      stop: () => {
        this.stopped++;
      },
      refresh: () => true,
      call: (target: string, media: CallMedia) => {
        this.calls.push({ target, media });
        return {
          terminate: () => {},
          setMedia: () => {},
          abandonMedia: () => {},
            setPaused: () => {},
            startShare: () => {},
            stopShare: () => {},
          sendDtmf: () => true,
          
          attachMedia: () => {},
          rtt: () => null,
          mediaStats: () => null,
          callStats: () => null,
          trace: () => [],
        };
      },
    };
  }
}

/** Démarre la machine et attend l'accueil. */
async function boot(vault: Vault, histories: Record<string, CallLogEntry[]> = {}) {
  const { store, box } = fakeStore(vault, histories);
  const sip = new FakeSip();
  const phone = PhoneMachine.start({ args: { store, sip, transcript: () => [] } });
  await vi.waitFor(() => expect(phone.state).toBe("home"));
  return { phone, sip, box };
}

/** Amène la machine en `ready` sur le compte demandé. */
async function ready(phone: PhoneInstance, sip: FakeSip, id: string): Promise<void> {
  phone.send({ type: "ui:useAccount", id });
  await vi.waitFor(() => expect(phone.state).toBe("connecting"));
  sip.send({ type: "sip:connected" });
  sip.send({ type: "sip:registered" });
  expect(phone.state).toBe("ready");
}

const solo = (account: StoredAccount = ALICE): Vault => ({
  accounts: [account],
  activeId: account.id,
});

afterEach(() => setDeployment(OPEN_DEPLOYMENT));

describe("deux comptes — ajout", () => {
  it("un second compte s'ajoute sans toucher au premier", async () => {
    const { phone, box } = await boot(solo());
    phone.send({ type: "ui:configure", id: null });
    phone.send({
      type: "ui:saveConfig",
      form: form({ uri: "bob@example.fr", displayName: "Bob Durand", password: "secret-bob" }),
    });
    await vi.waitFor(() => expect(phone.state).toBe("connecting"));
    expect(box.vault.accounts.map((a) => a.username)).toEqual(["alice", "bob"]);
    // le nouveau porte un identifiant à lui, et devient l'actif
    const added = box.vault.accounts[1]!;
    expect(added.id).not.toBe(ALICE.id);
    expect(box.vault.activeId).toBe(added.id);
    expect(added.ha1).toBe(computeHa1("bob", "example.fr", "secret-bob"));
  });

  it("la même adresse deux fois est refusée", async () => {
    const { phone, box } = await boot(solo());
    phone.send({ type: "ui:configure", id: null });
    phone.send({ type: "ui:saveConfig", form: form({ password: "secret-alice" }) });
    expect(phone.state).toBe("configuring");
    expect(phone.context.lastError).toEqual({
      key: "error.duplicateAccount",
      vars: { address: "alice@example.fr" },
    });
    expect(box.vault.accounts).toHaveLength(1);
  });

  it("la comparaison des adresses ignore la casse du domaine", async () => {
    const { phone } = await boot(solo());
    phone.send({ type: "ui:configure", id: null });
    phone.send({
      type: "ui:saveConfig",
      form: form({ uri: "alice@EXAMPLE.FR", password: "secret-alice" }),
    });
    expect(phone.context.lastError?.key).toBe("error.duplicateAccount");
  });

  it("modifier un compte sans changer son adresse ne se heurte pas à lui-même", async () => {
    const { phone, box } = await boot(solo());
    phone.send({ type: "ui:configure", id: ALICE.id });
    phone.send({ type: "ui:saveConfig", form: form({ displayName: "Alice M." }) });
    await vi.waitFor(() => expect(phone.state).toBe("connecting"));
    expect(box.vault.accounts).toHaveLength(1);
    expect(box.vault.accounts[0]!.displayName).toBe("Alice M.");
    // même identifiant, donc même historique
    expect(box.vault.accounts[0]!.id).toBe(ALICE.id);
  });

  it("l'interface s'arrête à deux comptes", () => {
    expect(MAX_ACCOUNTS).toBe(2);
  });
});

describe("deux comptes — le HA1 ne fuit pas de l'un vers l'autre", () => {
  /**
   * Le vrai risque du portage : la conservation du mot de passe se fait par
   * comparaison avec le compte enregistré, et cette comparaison portait sur
   * le compte **actif**. Modifier le compte au repos pendant que l'autre est
   * enregistré lui aurait attribué le HA1 de l'autre — silencieusement.
   */
  it("modifier le compte au repos conserve SON empreinte, pas celle de l'actif", async () => {
    // Alice est l'actif ; c'est Bob que l'accueil propose de modifier
    const { phone, box } = await boot({ accounts: [ALICE, BOB], activeId: ALICE.id });
    expect(phone.context.activeId).toBe(ALICE.id);
    phone.send({ type: "ui:configure", id: BOB.id });
    phone.send({
      type: "ui:saveConfig",
      form: form({ uri: "bob@example.fr", displayName: "Bob D.", password: null }),
    });
    await vi.waitFor(() => expect(phone.state).toBe("connecting"));
    const bob = box.vault.accounts.find((a) => a.id === BOB.id)!;
    expect(bob.ha1).toBe(BOB.ha1);
    expect(bob.ha1).not.toBe(ALICE.ha1);
  });

  it("le mot de passe laissé vide sur un compte neuf est refusé", async () => {
    const { phone } = await boot(solo());
    phone.send({ type: "ui:configure", id: null });
    phone.send({ type: "ui:saveConfig", form: form({ uri: "bob@example.fr" }) });
    expect(phone.state).toBe("configuring");
    expect(phone.context.lastError?.key).toBe("error.passwordRequired");
  });
});

describe("deux comptes — bascule", () => {
  it("l'UA est arrêté, puis relancé sur l'autre compte", async () => {
    const { phone, sip, box } = await boot({ accounts: [ALICE, BOB], activeId: ALICE.id });
    await ready(phone, sip, ALICE.id);
    expect(sip.started).toHaveLength(1);

    phone.send({ type: "ui:switchAccount", id: BOB.id });
    await vi.waitFor(() => expect(phone.state).toBe("connecting"));
    expect(sip.stopped).toBeGreaterThan(0);
    expect(sip.started[1]!.username).toBe("bob");
    expect(box.vault.activeId).toBe(BOB.id);
    expect(activeAccount(phone.context)!.id).toBe(BOB.id);
  });

  it("l'historique bascule avec le compte", async () => {
    const past: CallLogEntry = {
      target: "carol@example.fr",
      direction: "incoming",
      outcome: "missed",
      media: { audio: true, video: false, text: false },
      startedAt: 1,
      connectedAt: null,
      endedAt: 2,
      endedBy: null,
      reason: null,
    };
    const { phone, sip } = await boot({ accounts: [ALICE, BOB], activeId: ALICE.id }, {
      [ALICE.id]: [past],
      [BOB.id]: [],
    });
    await ready(phone, sip, ALICE.id);
    expect(phone.context.history).toHaveLength(1);

    phone.send({ type: "ui:switchAccount", id: BOB.id });
    await vi.waitFor(() => expect(phone.state).toBe("connecting"));
    // les appels d'Alice n'apparaissent pas chez Bob
    expect(phone.context.history).toEqual([]);
  });

  it("basculer sur le compte déjà actif ne fait rien", async () => {
    const { phone, sip } = await boot({ accounts: [ALICE, BOB], activeId: ALICE.id });
    await ready(phone, sip, ALICE.id);
    phone.send({ type: "ui:switchAccount", id: ALICE.id });
    expect(phone.state).toBe("ready");
    expect(sip.started).toHaveLength(1);
  });

  it("un identifiant inconnu ne déloge pas le compte en place", async () => {
    const { phone, sip } = await boot(solo());
    await ready(phone, sip, ALICE.id);
    phone.send({ type: "ui:switchAccount", id: "id-fantome" });
    expect(phone.state).toBe("ready");
    expect(activeAccount(phone.context)!.id).toBe(ALICE.id);
  });

  it("interdite dès la première sonnerie, et pas seulement en communication", async () => {
    const { phone, sip } = await boot({ accounts: [ALICE, BOB], activeId: ALICE.id });
    await ready(phone, sip, ALICE.id);
    phone.send({ type: "ui:call", target: "sip:carol@example.fr", media: { audio: true, video: false, text: false } });
    expect(phone.state).toBe("in_call");

    // le bloc consomme l'événement sans effet : la garantie ne repose pas
    // sur l'état d'un bouton
    phone.send({ type: "ui:switchAccount", id: BOB.id });
    expect(phone.state).toBe("in_call");
    expect(activeAccount(phone.context)!.id).toBe(ALICE.id);
  });
});

describe("deux comptes — suppression", () => {
  it("le compte et son historique disparaissent, l'autre reste", async () => {
    const { phone, box } = await boot({ accounts: [ALICE, BOB], activeId: ALICE.id });
    phone.send({ type: "ui:configure", id: BOB.id });
    phone.send({ type: "ui:deleteAccount" });
    await vi.waitFor(() => expect(phone.state).toBe("home"));
    expect(box.vault.accounts.map((a) => a.id)).toEqual([ALICE.id]);
    expect(box.dropped).toEqual([BOB.id]);
    // l'actif n'était pas celui-là : il ne bouge pas
    expect(box.vault.activeId).toBe(ALICE.id);
  });

  it("supprimer l'actif ne promeut pas l'autre : retour à l'accueil", async () => {
    const { phone, sip, box } = await boot({ accounts: [ALICE, BOB], activeId: ALICE.id });
    await ready(phone, sip, ALICE.id);
    phone.send({ type: "ui:backToSettings" });
    expect(phone.state).toBe("reconfiguring");
    phone.send({ type: "ui:deleteAccount" });
    await vi.waitFor(() => expect(phone.state).toBe("home"));
    expect(box.vault.accounts.map((a) => a.id)).toEqual([BOB.id]);
    // se réenregistrer ailleurs sans qu'on l'ait demandé serait une décision
    // prise à la place de quelqu'un
    expect(box.vault.activeId).toBeNull();
    expect(phone.context.history).toEqual([]);
  });

  it("le dernier compte supprimé laisse un coffre vide", async () => {
    const { phone, box } = await boot(solo());
    phone.send({ type: "ui:configure", id: ALICE.id });
    phone.send({ type: "ui:deleteAccount" });
    await vi.waitFor(() => expect(phone.state).toBe("home"));
    expect(box.vault.accounts).toEqual([]);
    expect(box.vault.activeId).toBeNull();
  });

  it("rien à supprimer sur un formulaire de création", async () => {
    const { phone, box } = await boot(solo());
    phone.send({ type: "ui:configure", id: null });
    phone.send({ type: "ui:deleteAccount" });
    expect(phone.state).toBe("configuring");
    expect(box.vault.accounts).toHaveLength(1);
  });
});

describe("deux comptes — déploiement", () => {
  it("le domaine imposé écarte les comptes d'ailleurs, l'accueil garde le reste", async () => {
    setDeployment({ ...OPEN_DEPLOYMENT, domain: "example.fr" });
    const ailleurs: StoredAccount = { ...BOB, id: "id-ailleurs", domain: "autre.fr" };
    const { phone } = await boot({ accounts: [ALICE, ailleurs], activeId: ailleurs.id });
    expect(phone.context.accounts.map((a) => a.id)).toEqual([ALICE.id]);
    // l'actif a disparu : on repart sur ce qui reste, sans le choisir à sa place
    expect(phone.context.activeId).toBeNull();
  });

  it("le proxy imposé s'applique à chaque compte relu", async () => {
    setDeployment({ ...OPEN_DEPLOYMENT, proxy: "wss://impose.example.fr/ws" });
    const { phone } = await boot({ accounts: [ALICE, BOB], activeId: ALICE.id });
    expect(phone.context.accounts.map((a) => a.proxy)).toEqual([
      "wss://impose.example.fr/ws",
      "wss://impose.example.fr/ws",
    ]);
  });
});
