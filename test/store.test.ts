/**
 * Round-trip du stockage chiffré sur fake-indexeddb + WebCrypto de Node.
 */
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createBrowserStore, type AccountConfig } from "../src/storage/store.js";

const CFG: AccountConfig = {
  proxy: "wss://sip.example.fr:8443/ws",
  domain: "example.fr",
  displayName: "Alice Martin",
  username: "alice",
  authUsername: null,
  ha1: "939e7578ed9e3c518a452acee763bce9",
  flashAlert: true,
};

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
    const raw = await new Promise<unknown>((resolve, reject) => {
      const req = indexedDB.open("stauri-communicator", 1);
      req.onsuccess = () => {
        const get = req.result.transaction("vault").objectStore("vault").get("account");
        get.onsuccess = () => resolve(get.result);
        get.onerror = () => reject(get.error);
      };
      req.onerror = () => reject(req.error);
    });
    const dump = JSON.stringify(raw, (_k, v) =>
      v instanceof ArrayBuffer ? Array.from(new Uint8Array(v)).join(",") : v,
    );
    expect(dump).not.toContain(CFG.ha1);
    expect(dump).not.toContain(CFG.username);
  });
});
