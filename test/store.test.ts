/**
 * Round-trip du stockage chiffré sur fake-indexeddb + WebCrypto de Node,
 * et migration du compte unique vers le coffre à liste (ADR 0002).
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  capMessages,
  createBrowserStore,
  type AccountConfig,
  type CallLogEntry,
  type Contact,
  type MessageEntry,
  type StoredAccount,
} from "../src/storage/store.js";
import { NO_ICE } from "../src/sip/ice.js";

const CFG: AccountConfig = {
  proxy: "wss://sip.example.fr:8443/ws",
  domain: "example.fr",
  displayName: "Alice Martin",
  username: "alice",
  authUsername: null,
  ha1: "939e7578ed9e3c518a452acee763bce9",
  ha1Sha256: "3ba6cd94661c5ef34598040c868f13b8775df29109986be50ad35ae537dd3aa4",
  flashAlert: true,
  ice: NO_ICE,
  rtt: "websocket",
};

const ALICE: StoredAccount = { ...CFG, id: "id-alice" };
const BOB: StoredAccount = {
  ...CFG,
  id: "id-bob",
  displayName: "Bob Durand",
  username: "bob",
  ha1: "0f0e0d0c0b0a09080706050403020100",
  ha1Sha256: "0f0e0d0c0b0a09080706050403020100" + "0f0e0d0c0b0a09080706050403020100",
};

/** Un coffre d'un seul compte, actif — la forme la plus courante. */
const soloVault = (account: StoredAccount = ALICE) => ({
  accounts: [account],
  activeId: account.id,
});

/**
 * La base, ouverte pour un test. Chaque emprunt la referme : une connexion
 * laissée ouverte bloque le vidage entre deux cas, et le fichier entier
 * s'arrête là.
 */
function openTestDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("trix", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("vault");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbGet(db: IDBDatabase, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const r = db.transaction("vault", "readonly").objectStore("vault").get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function dbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const r = db.transaction("vault", "readwrite").objectStore("vault").put(value, key);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

/** L'enregistrement chiffré tel qu'il est réellement écrit dans IndexedDB. */
async function rawRecord(key: string): Promise<string | undefined> {
  const db = await openTestDb();
  try {
    const raw = await dbGet(db, key);
    return JSON.stringify(raw, (_k, v) =>
      v instanceof ArrayBuffer ? Array.from(new Uint8Array(v)).join(",") : v,
    );
  } finally {
    db.close();
  }
}

/**
 * Écrit une valeur **chiffrée** sous une clé arbitraire, en réutilisant la
 * clé AES du coffre : c'est ainsi qu'on sème ce que les versions
 * précédentes avaient laissé, pour éprouver la migration sur ce que le
 * store relira vraiment.
 */
async function seedLegacy(key: string, value: unknown): Promise<void> {
  const db = await openTestDb();
  try {
    let aes = (await dbGet(db, "aes-key")) as CryptoKey | undefined;
    if (!aes) {
      aes = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
        "encrypt",
        "decrypt",
      ]);
      await dbPut(db, "aes-key", aes);
    }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      aes,
      new TextEncoder().encode(JSON.stringify(value)),
    );
    await dbPut(db, key, { iv, cipher });
  } finally {
    db.close();
  }
}

/**
 * Vide la base entre deux cas : chacun sème ce dont il a besoin. On vide
 * le magasin plutôt que de supprimer la base — `deleteDatabase` attend que
 * toutes les connexions se ferment, et une seule oubliée fige le fichier.
 */
async function wipe(): Promise<void> {
  const db = await openTestDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const r = db.transaction("vault", "readwrite").objectStore("vault").clear();
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}

beforeEach(wipe);

describe("browserStore — coffre à liste", () => {
  it("load sans donnée : coffre vide", async () => {
    expect(await createBrowserStore().load()).toEqual({ accounts: [], activeId: null });
  });

  it("save puis load : round-trip chiffré", async () => {
    const store = createBrowserStore();
    await store.save(soloVault());
    expect(await store.load()).toEqual(soloVault());
  });

  it("deux comptes, un seul actif", async () => {
    const store = createBrowserStore();
    await store.save({ accounts: [ALICE, BOB], activeId: BOB.id });
    const vault = await store.load();
    expect(vault.accounts.map((a) => a.id)).toEqual([ALICE.id, BOB.id]);
    expect(vault.activeId).toBe(BOB.id);
  });

  it("un actif qui ne désigne aucun compte est ramené à « aucun »", async () => {
    const store = createBrowserStore();
    // ce qu'un coffre à moitié écrit laisserait : la machine s'enregistrerait
    // sur rien plutôt que de retourner à l'accueil
    await store.save({ accounts: [ALICE], activeId: "id-disparu" });
    const vault = await store.load();
    expect(vault.accounts).toHaveLength(1);
    expect(vault.activeId).toBeNull();
  });

  it("réglage du flash conservé au round-trip", async () => {
    const store = createBrowserStore();
    await store.save(soloVault({ ...ALICE, flashAlert: false }));
    expect((await store.load()).accounts[0]!.flashAlert).toBe(false);
  });

  it("serveurs ICE conservés au round-trip, mot de passe TURN compris", async () => {
    const store = createBrowserStore();
    const ice = {
      stun: "stun.example.fr:3478",
      turn: { host: "turn.example.fr:5349", username: "alice", password: "relais", tls: true },
    };
    await store.save(soloVault({ ...ALICE, ice }));
    expect((await store.load()).accounts[0]!.ice).toEqual(ice);
  });

  it("le mot de passe TURN n'apparaît pas en clair dans la base", async () => {
    const store = createBrowserStore();
    await store.save(
      soloVault({
        ...ALICE,
        ice: {
          stun: null,
          turn: { host: "turn.example.fr", username: "alice", password: "relais-secret", tls: false },
        },
      }),
    );
    expect(await rawRecord("accounts")).not.toContain("relais-secret");
  });

  it("transport texte conservé au round-trip", async () => {
    const store = createBrowserStore();
    await store.save(soloVault({ ...ALICE, rtt: "datachannel" }));
    expect((await store.load()).accounts[0]!.rtt).toBe("datachannel");
  });

  it("compte écrit avant l'ajout de ces champs : les défauts les plus discrets", async () => {
    const store = createBrowserStore();
    const legacy = { ...ALICE } as Partial<StoredAccount>;
    delete legacy.ice;
    delete legacy.flashAlert;
    delete legacy.rtt;
    delete legacy.ha1Sha256;
    await store.save({ accounts: [legacy as StoredAccount], activeId: ALICE.id });
    const account = (await store.load()).accounts[0]!;
    expect(account.ice).toEqual({ stun: null, turn: null });
    // le désactiver ne peut être qu'un choix explicite
    expect(account.flashAlert).toBe(true);
    // proposer du texte modifie l'offre SDP de tous ses appels : ce
    // compte-là ne l'a jamais demandé
    expect(account.rtt).toBe("none");
    // le mot de passe n'est nulle part : cette empreinte-là ne se rattrape
    // pas, et son absence se dit plutôt qu'elle ne s'invente
    expect(account.ha1Sha256).toBe("");
    // celle qui est là n'a pas bougé : le compte s'enregistre encore
    expect(account.ha1).toBe(ALICE.ha1);
  });

  it("un compte sans identifiant est écarté, les autres restent", async () => {
    const store = createBrowserStore();
    const orphan = { ...BOB } as Partial<StoredAccount>;
    delete orphan.id;
    await store.save({ accounts: [ALICE, orphan as StoredAccount], activeId: ALICE.id });
    const vault = await store.load();
    expect(vault.accounts.map((a) => a.id)).toEqual([ALICE.id]);
  });

  it("clear efface les comptes", async () => {
    const store = createBrowserStore();
    await store.save(soloVault());
    await store.clear();
    expect((await store.load()).accounts).toEqual([]);
  });

  it("le HA1 n'apparaît pas en clair dans la base", async () => {
    const store = createBrowserStore();
    await store.save(soloVault());
    const dump = await rawRecord("accounts");
    expect(dump).not.toContain(ALICE.ha1);
    expect(dump).not.toContain(ALICE.ha1Sha256);
    expect(dump).not.toContain(ALICE.username);
  });
});

describe("browserStore — historique par compte", () => {
  const ENTRY: CallLogEntry = {
    target: "bob@example.fr",
    direction: "outgoing",
    outcome: "failed",
    media: { audio: true, video: false, text: false },
    startedAt: 1_700_000_000_000,
    connectedAt: null,
    endedAt: 1_700_000_010_000,
    endedBy: null,
    reason: { key: "reason.sip", vars: { cause: "Busy", code: 486 } },
  };

  it("round-trip du motif traduisible, sous l'identifiant du compte", async () => {
    const store = createBrowserStore();
    await store.saveHistory(ALICE.id, [ENTRY]);
    expect(await store.loadHistory(ALICE.id)).toEqual([ENTRY]);
  });

  it("chaque compte a le sien", async () => {
    const store = createBrowserStore();
    await store.saveHistory(ALICE.id, [ENTRY]);
    expect(await store.loadHistory(BOB.id)).toEqual([]);
  });

  it("deleteHistory efface celui d'un compte, et lui seul", async () => {
    const store = createBrowserStore();
    await store.saveHistory(ALICE.id, [ENTRY]);
    await store.saveHistory(BOB.id, [ENTRY]);
    await store.deleteHistory(ALICE.id);
    expect(await store.loadHistory(ALICE.id)).toEqual([]);
    expect(await store.loadHistory(BOB.id)).toHaveLength(1);
  });

  it("historique enregistré avant l'i18n : le motif figé n'est pas perdu", async () => {
    const store = createBrowserStore();
    // ce que la version précédente écrivait : une phrase, pas une clé
    const legacy = { ...ENTRY, reason: "Busy (SIP 486)" };
    await store.saveHistory(ALICE.id, [legacy as unknown as CallLogEntry]);
    const [loaded] = await store.loadHistory(ALICE.id);
    expect(loaded!.reason).toEqual({ key: "misc.raw", vars: { text: "Busy (SIP 486)" } });
  });
});

describe("browserStore — messages par compte (ADR 0008, D6)", () => {
  const message = (over: Partial<MessageEntry> = {}): MessageEntry => ({
    id: "m1",
    key: "carol@example.fr",
    uri: "sip:carol@example.fr",
    direction: "incoming",
    text: "Bonjour",
    at: 1_700_000_000_000,
    state: "received",
    reason: null,
    read: false,
    ...over,
  });

  it("round-trip, sous l'identifiant du compte, et à part des autres", async () => {
    const store = createBrowserStore();
    const sent = message({
      id: "m2",
      direction: "outgoing",
      state: "failed",
      reason: { key: "misc.raw", vars: { text: "404" } },
      read: true,
    });
    await store.saveMessages(ALICE.id, [message(), sent]);
    expect(await store.loadMessages(ALICE.id)).toEqual([message(), sent]);
    expect(await store.loadMessages(BOB.id)).toEqual([]);
    expect(await store.loadHistory(ALICE.id)).toEqual([]);
  });

  it("deleteMessages efface ceux d'un compte, et eux seuls", async () => {
    const store = createBrowserStore();
    await store.saveMessages(ALICE.id, [message()]);
    await store.saveMessages(BOB.id, [message({ id: "m9" })]);
    await store.deleteMessages(ALICE.id);
    expect(await store.loadMessages(ALICE.id)).toEqual([]);
    expect(await store.loadMessages(BOB.id)).toHaveLength(1);
  });

  it("un enregistrement abîmé ne coûte pas les autres", async () => {
    const store = createBrowserStore();
    const broken = [message(), { id: "m2", text: 3 }, null, { ...message({ id: "m3" }), state: "lost" }];
    await store.saveMessages(ALICE.id, broken as unknown as MessageEntry[]);
    expect(await store.loadMessages(ALICE.id)).toEqual([message()]);
  });
});

describe("capMessages", () => {
  const at = (key: string, n: number, state: MessageEntry["state"] = "received"): MessageEntry => ({
    id: `${key}${n}`,
    key,
    uri: `sip:${key}`,
    direction: "incoming",
    text: String(n),
    at: n,
    state,
    reason: null,
    read: true,
  });

  it("drops each correspondent's oldest past the cap, and no one else's", () => {
    const list = [at("a", 3), at("b", 1), at("a", 1), at("a", 2)];
    expect(capMessages(list, 2).map((m) => m.id)).toEqual(["a3", "b1", "a2"]);
  });

  it("never drops a message still pending", () => {
    const list = [at("a", 1, "pending"), at("a", 2), at("a", 3)];
    expect(capMessages(list, 1).map((m) => m.id)).toEqual(["a1", "a3"]);
  });

  it("leaves a list under the cap untouched", () => {
    const list = [at("a", 1), at("a", 2)];
    expect(capMessages(list, 2)).toBe(list);
  });
});

describe("browserStore — carnet de contacts par compte (ADR 0007, D7)", () => {
  const CAROL: Contact = { id: "c1", name: "Carol", uri: "sip:carol@example.fr", addedAt: 1_700_000_000_000, blocked: false };
  const DAVE: Contact = { id: "c2", name: "Dave", uri: "sip:dave@example.fr", addedAt: 1_700_000_100_000, blocked: false };

  it("round-trip, dans l'ordre, sous l'identifiant du compte", async () => {
    const store = createBrowserStore();
    await store.saveContacts(ALICE.id, [CAROL, DAVE]);
    expect(await store.loadContacts(ALICE.id)).toEqual([CAROL, DAVE]);
  });

  it("chaque compte a le sien, et un compte sans carnet en a un vide", async () => {
    const store = createBrowserStore();
    await store.saveContacts(ALICE.id, [CAROL]);
    expect(await store.loadContacts(BOB.id)).toEqual([]);
  });

  it("deleteContacts efface celui d'un compte, et lui seul", async () => {
    const store = createBrowserStore();
    await store.saveContacts(ALICE.id, [CAROL]);
    await store.saveContacts(BOB.id, [DAVE]);
    await store.deleteContacts(ALICE.id);
    expect(await store.loadContacts(ALICE.id)).toEqual([]);
    expect(await store.loadContacts(BOB.id)).toEqual([DAVE]);
  });

  it("un carnet d'avant l'ADR 0008 se relit sans contact bloqué", async () => {
    const store = createBrowserStore();
    const { blocked: _, ...old } = CAROL;
    await store.saveContacts(ALICE.id, [old as Contact, { ...DAVE, blocked: true }]);
    expect(await store.loadContacts(ALICE.id)).toEqual([CAROL, { ...DAVE, blocked: true }]);
  });

  it("un enregistrement abîmé ne coûte pas les autres", async () => {
    const store = createBrowserStore();
    const broken = [CAROL, { id: "c3", name: 42 }, null, DAVE] as unknown as Contact[];
    await store.saveContacts(ALICE.id, broken);
    expect(await store.loadContacts(ALICE.id)).toEqual([CAROL, DAVE]);
  });

  it("le carnet et l'historique ne se mélangent pas", async () => {
    const store = createBrowserStore();
    await store.saveContacts(ALICE.id, [CAROL]);
    expect(await store.loadHistory(ALICE.id)).toEqual([]);
    await store.deleteHistory(ALICE.id);
    expect(await store.loadContacts(ALICE.id)).toEqual([CAROL]);
  });
});

describe("browserStore — migration du compte unique (ADR 0002)", () => {
  it("le compte enregistré devient le premier de la liste, et l'actif", async () => {
    await seedLegacy("account", CFG);
    const vault = await createBrowserStore().load();
    expect(vault.accounts).toHaveLength(1);
    expect(vault.accounts[0]).toMatchObject(CFG);
    expect(vault.activeId).toBe(vault.accounts[0]!.id);
    expect(vault.accounts[0]!.id).toBeTruthy();
  });

  it("son historique suit, sous le nouvel identifiant", async () => {
    await seedLegacy("account", CFG);
    await seedLegacy("history:alice@example.fr", [
      {
        target: "carol@example.fr",
        direction: "incoming",
        outcome: "missed",
        media: { audio: true, video: false, text: false },
        startedAt: 1,
        connectedAt: null,
        endedAt: 2,
        endedBy: null,
        reason: null,
      },
    ]);
    const store = createBrowserStore();
    const vault = await store.load();
    expect(await store.loadHistory(vault.accounts[0]!.id)).toHaveLength(1);
  });

  it("les anciennes clés sont effacées : plus de HA1 sous une clé que nul ne lit", async () => {
    await seedLegacy("account", CFG);
    await seedLegacy("history:alice@example.fr", []);
    await createBrowserStore().load();
    expect(await rawRecord("account")).toBeUndefined();
    expect(await rawRecord("history:alice@example.fr")).toBeUndefined();
  });

  it("idempotente : relire ne recrée pas un second compte", async () => {
    await seedLegacy("account", CFG);
    const store = createBrowserStore();
    const first = await store.load();
    const second = await store.load();
    expect(second.accounts).toHaveLength(1);
    expect(second.accounts[0]!.id).toBe(first.accounts[0]!.id);
  });

  it("un compte ancien amputé de ses champs récents reçoit les mêmes défauts", async () => {
    const legacy = { ...CFG } as Partial<AccountConfig>;
    delete legacy.ice;
    delete legacy.rtt;
    delete legacy.flashAlert;
    delete legacy.ha1Sha256;
    await seedLegacy("account", legacy);
    const account = (await createBrowserStore().load()).accounts[0]!;
    expect(account.ice).toEqual({ stun: null, turn: null });
    expect(account.rtt).toBe("none");
    expect(account.flashAlert).toBe(true);
    expect(account.ha1Sha256).toBe("");
  });

  it("le coffre à liste l'emporte : l'ancienne clé n'est plus regardée", async () => {
    const store = createBrowserStore();
    await store.save(soloVault(BOB));
    await seedLegacy("account", CFG);
    const vault = await store.load();
    expect(vault.accounts.map((a) => a.username)).toEqual(["bob"]);
  });
});
