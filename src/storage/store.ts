/**
 * Persistance du compte SIP, chiffrée au repos (docs/CONCEPTION.md §6) :
 * clé AES-GCM 256 non-extractible (WebCrypto) + configuration chiffrée,
 * toutes deux dans IndexedDB. `SecureStore` est le point d'abstraction
 * pour une future implémentation Tauri (trousseau OS).
 */

import type { CallMedia } from "../sip/port.js";

export interface AccountConfig {
  proxy: string; // wss://…
  domain: string;
  displayName: string;
  username: string; // userpart de l'URI SIP
  authUsername: string | null; // identifiant d'authentification, si différent de username
  ha1: string; // jamais le mot de passe
  /**
   * Flash visuel à l'appel entrant (accessibilité sourds — `ui/alert.ts`).
   * Réglage du compte, donc persisté chiffré avec lui : il suit l'utilisateur
   * et non le navigateur. Actif par défaut, y compris pour les comptes
   * enregistrés avant son introduction.
   */
  flashAlert: boolean;
}

export type CallDirection = "outgoing" | "incoming";
/**
 * `missed` : entrant non répondu (phase 3) ; `canceled` : sortant abandonné
 * avant réponse ; `dropped` : incident réseau (proxy perdu pendant l'appel).
 */
export type CallOutcome = "answered" | "missed" | "failed" | "canceled" | "dropped";

/** Qui a mis fin à un appel établi. */
export type CallEndedBy = "local" | "remote" | "network";

/** Une ligne de l'historique d'appels, persistée chiffrée par compte. */
export interface CallLogEntry {
  target: string; // user@domaine, sans préfixe sip:
  direction: CallDirection;
  outcome: CallOutcome;
  media: CallMedia;
  startedAt: number; // epoch ms
  connectedAt: number | null;
  endedAt: number;
  /** Renseigné pour les appels établis : qui a raccroché. */
  endedBy: CallEndedBy | null;
  reason: string | null; // cause SIP en cas d'échec
}

export interface SecureStore {
  load(): Promise<AccountConfig | null>;
  save(cfg: AccountConfig): Promise<void>;
  clear(): Promise<void>;
  /** Historique du compte (clé `user@domaine`), chiffré comme la configuration. */
  loadHistory(account: string): Promise<CallLogEntry[]>;
  saveHistory(account: string, entries: CallLogEntry[]): Promise<void>;
}

const DB_NAME = "trix";
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

async function encryptPut(db: IDBDatabase, id: string, value: unknown): Promise<void> {
  const key = await getOrCreateKey(db);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
  const record: VaultRecord = { iv, cipher };
  await idbPut(db, id, record);
}

/** null si l'enregistrement est absent, corrompu ou que la clé est perdue. */
async function decryptGet(db: IDBDatabase, id: string): Promise<unknown> {
  try {
    const record = (await idbGet(db, id)) as VaultRecord | undefined;
    if (!record) return null;
    const key = (await idbGet(db, KEY_ID)) as CryptoKey | undefined;
    if (!key) return null;
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(record.iv) },
      key,
      record.cipher,
    );
    return JSON.parse(new TextDecoder().decode(plain)) as unknown;
  } catch {
    return null;
  }
}

const historyId = (account: string): string => `history:${account}`;

export function createBrowserStore(): SecureStore {
  return {
    async save(cfg: AccountConfig): Promise<void> {
      const db = await openDb();
      try {
        await encryptPut(db, DATA_ID, cfg);
      } finally {
        db.close();
      }
    },

    async load(): Promise<AccountConfig | null> {
      const db = await openDb();
      try {
        const cfg = (await decryptGet(db, DATA_ID)) as AccountConfig | null;
        if (!cfg) return null;
        // comptes enregistrés avant l'ajout de ces champs : identifiant séparé
        // absent, et flash actif (le désactiver ne peut être qu'un choix explicite)
        return { ...cfg, authUsername: cfg.authUsername ?? null, flashAlert: cfg.flashAlert ?? true };
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

    async loadHistory(account: string): Promise<CallLogEntry[]> {
      const db = await openDb();
      try {
        const entries = (await decryptGet(db, historyId(account))) as CallLogEntry[] | null;
        return Array.isArray(entries) ? entries : [];
      } finally {
        db.close();
      }
    },

    async saveHistory(account: string, entries: CallLogEntry[]): Promise<void> {
      const db = await openDb();
      try {
        await encryptPut(db, historyId(account), entries);
      } finally {
        db.close();
      }
    },
  };
}
