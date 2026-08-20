/**
 * Round-trip du stockage chiffré sur fake-indexeddb + WebCrypto de Node.
 */
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createBrowserStore, type AccountConfig } from "../src/storage/store.js";
import { NO_ICE } from "../src/sip/ice.js";

const CFG: AccountConfig = {
  proxy: "wss://sip.example.fr:8443/ws",
  domain: "example.fr",
  displayName: "Alice Martin",
  username: "alice",
  authUsername: null,
  ha1: "939e7578ed9e3c518a452acee763bce9",
  flashAlert: true,
  ice: NO_ICE,
};

/** L'enregistrement chiffré tel qu'il est réellement écrit dans IndexedDB. */
async function rawAccount(): Promise<string> {
  const raw = await new Promise<unknown>((resolve, reject) => {
    const req = indexedDB.open("trix", 1);
    req.onsuccess = () => {
      const get = req.result.transaction("vault").objectStore("vault").get("account");
      get.onsuccess = () => resolve(get.result);
      get.onerror = () => reject(get.error);
    };
    req.onerror = () => reject(req.error);
  });
  return JSON.stringify(raw, (_k, v) =>
    v instanceof ArrayBuffer ? Array.from(new Uint8Array(v)).join(",") : v,
  );
}

describe("browserStore", () => {
  it("load sans donnée : null", async () => {
    const store = createBrowserStore();
    expect(await store.load()).toBeNull();
  });

  it("save puis load : round-trip chiffré", async () => {
    const store = createBrowserStore();
    await store.save(CFG);
    expect(await store.load()).toEqual(CFG);
  });

  it("réglage du flash conservé au round-trip", async () => {
    const store = createBrowserStore();
    await store.save({ ...CFG, flashAlert: false });
    expect((await store.load())!.flashAlert).toBe(false);
  });

  it("serveurs ICE conservés au round-trip, mot de passe TURN compris", async () => {
    const store = createBrowserStore();
    const ice = {
      stun: "stun.example.fr:3478",
      turn: { host: "turn.example.fr:5349", username: "alice", password: "relais", tls: true },
    };
    await store.save({ ...CFG, ice });
    expect((await store.load())!.ice).toEqual(ice);
  });

  it("le mot de passe TURN n'apparaît pas en clair dans la base", async () => {
    const store = createBrowserStore();
    await store.save({
      ...CFG,
      ice: {
        stun: null,
        turn: { host: "turn.example.fr", username: "alice", password: "relais-secret", tls: false },
      },
    });
    expect(await rawAccount()).not.toContain("relais-secret");
  });

  it("compte enregistré avant l'ajout des serveurs ICE : aucun serveur", async () => {
    const store = createBrowserStore();
    const legacy = { ...CFG } as Partial<AccountConfig>;
    delete legacy.ice;
    await store.save(legacy as AccountConfig);
    expect((await store.load())!.ice).toEqual({ stun: null, turn: null });
  });

  it("compte enregistré avant l'ajout du réglage : flash actif par défaut", async () => {
    const store = createBrowserStore();
    const legacy = { ...CFG } as Partial<AccountConfig>;
    delete legacy.flashAlert;
    await store.save(legacy as AccountConfig);
    expect((await store.load())!.flashAlert).toBe(true);
  });

  it("clear efface le compte", async () => {
    const store = createBrowserStore();
    await store.save(CFG);
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it("le HA1 n'apparaît pas en clair dans la base", async () => {
    const store = createBrowserStore();
    await store.save(CFG);
    const dump = await rawAccount();
    expect(dump).not.toContain(CFG.ha1);
    expect(dump).not.toContain(CFG.username);
  });
});
