/**
 * Persistance du compte SIP, chiffrée au repos (docs/CONCEPTION.md §6) :
 * clé AES-GCM 256 non-extractible (WebCrypto) + configuration chiffrée,
 * toutes deux dans IndexedDB. `SecureStore` est le point d'abstraction
 * pour une future implémentation Tauri (trousseau OS).
 */

export interface AccountConfig {
  proxy: string; // wss://…
  domain: string;
  displayName: string;
  username: string; // userpart de l'URI SIP
  authUsername: string | null; // identifiant d'authentification, si différent de username
  ha1: string; // jamais le mot de passe
}

export interface SecureStore {
  load(): Promise<AccountConfig | null>;
  save(cfg: AccountConfig): Promise<void>;
  clear(): Promise<void>;
}

const DB_NAME = "stauri-communicator";
const STORE = "vault";
const KEY_ID = "aes-key";
const DATA_ID = "account";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(db: IDBDatabase, id: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, id: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readwrite").objectStore(STORE).put(value, id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbDelete(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readwrite").objectStore(STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function getOrCreateKey(db: IDBDatabase): Promise<CryptoKey> {
  const existing = (await idbGet(db, KEY_ID)) as CryptoKey | undefined;
  if (existing) return existing;
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false, // non-extractible : la clé ne quitte jamais le profil navigateur
    ["encrypt", "decrypt"],
  );
  await idbPut(db, KEY_ID, key);
  return key;
}

interface VaultRecord {
  iv: Uint8Array;
  cipher: ArrayBuffer;
}

export function createBrowserStore(): SecureStore {
  return {
    async save(cfg: AccountConfig): Promise<void> {
      const db = await openDb();
      try {
        const key = await getOrCreateKey(db);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const plain = new TextEncoder().encode(JSON.stringify(cfg));
        const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
        const record: VaultRecord = { iv, cipher };
        await idbPut(db, DATA_ID, record);
      } finally {
        db.close();
      }
    },

    async load(): Promise<AccountConfig | null> {
      const db = await openDb();
      try {
        const record = (await idbGet(db, DATA_ID)) as VaultRecord | undefined;
        if (!record) return null;
        const key = (await idbGet(db, KEY_ID)) as CryptoKey | undefined;
        if (!key) return null;
        const plain = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: new Uint8Array(record.iv) },
          key,
          record.cipher,
        );
        const cfg = JSON.parse(new TextDecoder().decode(plain)) as AccountConfig;
        // comptes enregistrés avant l'ajout du champ : pas d'identifiant séparé
        return { ...cfg, authUsername: cfg.authUsername ?? null };
      } catch {
        return null; // enregistrement corrompu ou clé perdue : repartir sans compte
      } finally {
        db.close();
      }
    },

    async clear(): Promise<void> {
      const db = await openDb();
      try {
        await idbDelete(db, DATA_ID);
      } finally {
        db.close();
      }
    },
  };
}
