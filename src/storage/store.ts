/**
 * Persistance des comptes SIP, chiffrée au repos (docs/CONCEPTION.md §6) :
 * clé AES-GCM 256 non-extractible (WebCrypto) + coffre chiffré, tous deux
 * dans IndexedDB. `SecureStore` est le point d'abstraction pour une future
 * implémentation Tauri (trousseau OS).
 *
 * Le coffre tient une **liste** de comptes et l'identifiant de l'actif, dans
 * un seul enregistrement (ADR 0002) : l'écriture reste atomique, et un index
 * séparé aurait de toute façon porté des adresses SIP, donc aurait dû être
 * chiffré lui aussi. Chaque compte porte un identifiant opaque, et c'est lui
 * — non l'adresse SIP — qui nomme son historique : corriger une adresse mal
 * saisie ne fait plus disparaître le journal d'appels avec elle.
 *
 * L'étanchéité entre comptes est **fonctionnelle, pas cryptographique** : la
 * clé AES-GCM reste unique pour l'origine, ce qui déchiffre un compte
 * déchiffre l'autre. Ce qui est garanti est qu'un compte ne voit jamais les
 * appels, les identifiants ni les réglages de l'autre.
 */

import type { CallMedia } from "../sip/port.js";
import type { TraceLine } from "../sip/record.js";
import type { MediaStats } from "../sip/stats.js";
import type { ChatItem } from "../sip/transcript.js";
import { NO_ICE, type IceConfig } from "../sip/ice.js";
import { parseRttTransport, type RttTransport } from "../sip/rtt.js";
import { rawMsg, type Msg } from "../i18n/types.js";

export interface AccountConfig {
  proxy: string; // wss://…
  domain: string;
  displayName: string;
  username: string; // userpart de l'URI SIP
  authUsername: string | null; // identifiant d'authentification, si différent de username
  ha1: string; // jamais le mot de passe
  /**
   * La même empreinte condensée par SHA-256 (RFC 8760), pour les serveurs
   * qui défient avec cet algorithme-là. Les deux sont gardées : le serveur
   * choisit, et MD5 reste ce que défient la plupart.
   *
   * **Vide** quand elle n'a pas pu être calculée — compte enregistré avant
   * son introduction, lien de partage émis par une version précédente. Le
   * mot de passe n'est nulle part, donc rien ne peut la reconstituer : un
   * défi SHA-256 restera alors sans réponse, et c'est ce que l'écran dit
   * (`sip/digest.ts`).
   */
  ha1Sha256: string;
  /**
   * Flash visuel à l'appel entrant (accessibilité sourds — `ui/alert.ts`).
   * Réglage du compte, donc persisté chiffré avec lui : il suit l'utilisateur
   * et non le navigateur. Actif par défaut, y compris pour les comptes
   * enregistrés avant son introduction.
   */
  flashAlert: boolean;
  /**
   * Serveurs STUN/TURN pour la traversée de NAT (`sip/ice.ts`). Réglage
   * du compte : ces serveurs sont fournis par l'opérateur SIP, au même
   * titre que le proxy. Aucun serveur pour les comptes enregistrés avant
   * son introduction — l'appel se comporte comme avant.
   */
  ice: IceConfig;
  /**
   * Transport du texte en temps réel (`sip/rtt.ts`). Réglage du compte,
   * comme le proxy et les serveurs ICE : c'est la plateforme de
   * l'opérateur qui décide de ce qu'elle sait recevoir — WebSocket pour
   * les services déjà déployés, canal de données pour les clients
   * standards, et `none` pour n'en proposer aucun. Aucun pour les comptes
   * enregistrés avant son introduction : leurs appels ne doivent pas
   * changer de forme sans qu'on l'ait demandé.
   */
  rtt: RttTransport;
}

/**
 * Un compte dans le coffre : sa configuration, plus l'identifiant opaque
 * tiré à sa création. L'identifiant ne sort jamais d'ici — il ne part pas
 * chez le registrar, il ne se partage pas (`share/link.ts` transporte la
 * configuration seule) : il ne sert qu'à désigner un compte parmi ceux du
 * coffre, et à nommer son historique.
 */
export interface StoredAccount extends AccountConfig {
  id: string;
}

/**
 * Le coffre entier. `activeId` désigne le compte que l'application
 * enregistre ; `null` tant qu'aucun n'a été choisi — un coffre vide, ou un
 * retour à l'accueil après suppression.
 */
export interface Vault {
  accounts: StoredAccount[];
  activeId: string | null;
}

export const EMPTY_VAULT: Vault = { accounts: [], activeId: null };

/**
 * Un identifiant de compte. `crypto.randomUUID` manque aux navigateurs
 * servis hors contexte sécurisé, où le reste de Trix ne fonctionnerait pas
 * davantage (WebRTC, WebCrypto) — mais un repli coûte trois lignes et évite
 * qu'une page de partage ouverte en `http://` échoue sur ce détail-là.
 */
export function newAccountId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
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
  /**
   * Motif de fin, gardé sous forme de **message différé** (clé + variables)
   * et non de phrase : l'historique se relit dans la langue courante, même
   * pour des appels passés dans une autre. Les causes SIP brutes y entrent
   * par `misc.raw`, qui les rend telles quelles.
   */
  reason: Msg | null;
  /**
   * Les paquets SIP de l'appel et les états traversés, quand la trace était
   * active au moment où il a eu lieu (§5.3) — absent sinon, et absent des
   * lignes écrites par les versions précédentes. Chiffré comme le reste de
   * l'historique : un paquet SIP porte les adresses des deux correspondants
   * et la description de leurs médias.
   */
  trace?: TraceLine[];
  /**
   * Le bilan média de l'appel — codecs, débits et pertes des deux sens —
   * mesuré tant qu'il durait, sous la même condition que le carnet (§5.4) :
   * la trace était cochée. Quelques dizaines d'octets, relus depuis la
   * loupe de l'historique ; absent des lignes écrites sans mesure, et de
   * celles des versions précédentes.
   */
  stats?: MediaStats;
  /**
   * La conversation en texte temps réel de l'appel, telle qu'elle s'est
   * affichée (§4.9) — bulles des deux côtés, remarques du fil, horodatage
   * de chacune. Gardée sans condition, contrairement au carnet et au
   * bilan : ce n'est pas une trace de mise au point mais ce que les deux
   * personnes se sont dit ; elle est chiffrée avec le reste, et vider
   * l'historique l'efface donc aussi. Absente des appels où personne n'a
   * écrit — et de ceux des versions précédentes.
   */
  chat?: ChatItem[];
}

/**
 * Un contact du carnet (ADR 0007, D7), gardé chiffré par compte comme
 * l'historique. `uri` est normalisée (`sip:user@domaine`,
 * `sip/uri.ts`) : c'est elle qui porte l'abonnement de présence, et sa
 * clé (`addressKey`) qui rattache les appels de l'historique au contact.
 */
export interface Contact {
  id: string;
  name: string;
  uri: string;
  addedAt: number; // epoch ms
}

export interface SecureStore {
  /** Le coffre entier, migré depuis le format à compte unique s'il le faut. */
  load(): Promise<Vault>;
  save(vault: Vault): Promise<void>;
  /** Efface les comptes ; les historiques se suppriment un par un. */
  clear(): Promise<void>;
  /** Historique d'un compte (clé : son identifiant), chiffré comme le coffre. */
  loadHistory(id: string): Promise<CallLogEntry[]>;
  saveHistory(id: string, entries: CallLogEntry[]): Promise<void>;
  /** Supprime l'historique d'un compte — la suppression du compte l'emporte. */
  deleteHistory(id: string): Promise<void>;
  /** Carnet de contacts d'un compte, chiffré comme le coffre. */
  loadContacts(id: string): Promise<Contact[]>;
  saveContacts(id: string, contacts: Contact[]): Promise<void>;
  /** Supprime le carnet d'un compte, avec le compte. */
  deleteContacts(id: string): Promise<void>;
}

const DB_NAME = "trix";
const STORE = "vault";
const KEY_ID = "aes-key";
/** Le coffre à liste (ADR 0002). */
const VAULT_ID = "accounts";
/** Le compte unique des versions précédentes, migré puis effacé. */
const LEGACY_ID = "account";

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

const historyId = (id: string): string => `history:${id}`;
const contactsId = (id: string): string => `contacts:${id}`;

/**
 * Un carnet relu : ce qui n'a pas la forme d'un contact est écarté plutôt
 * que de faire tomber tout le carnet — un enregistrement abîmé ne doit pas
 * coûter les autres.
 */
function normalizeContacts(raw: unknown): Contact[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (c): c is Contact =>
      typeof c === "object" &&
      c !== null &&
      typeof c.id === "string" &&
      typeof c.name === "string" &&
      typeof c.uri === "string" &&
      typeof c.addedAt === "number",
  );
}

/**
 * Une ligne d'historique relue, complétée des champs apparus après elle —
 * l'équivalent de `migrateAccount` pour l'historique.
 *
 * Deux passages, et rien d'autre :
 *
 * - **le motif**, écrit avant l'internationalisation sous forme de phrase
 *   française figée. On l'enveloppe pour qu'il traverse la même chaîne de
 *   rendu que les messages traduisibles — il ne changera pas de langue,
 *   mais il ne disparaîtra pas non plus de l'historique ;
 * - **le texte**, apparu dans `CallMedia` avec l'ADR 0003. Une ligne
 *   d'avant ne dit rien de lui, et l'absence se lit `false` : le champ est
 *   déclaré obligatoire, une ligne relue sans lui ferait mentir le type au
 *   premier `entry.media.text`.
 */
function migrateEntry(entry: CallLogEntry): CallLogEntry {
  const reason = entry.reason as Msg | string | null;
  return {
    ...entry,
    ...(typeof reason === "string" ? { reason: rawMsg(reason) } : {}),
    // seul `text` peut manquer : `audio` et `video` sont là depuis la
    // première ligne jamais écrite
    media: { ...entry.media, text: (entry.media as Partial<CallMedia>).text ?? false },
  };
}

/**
 * Complète un compte relu des champs apparus après lui : identifiant séparé
 * absent, flash actif (le désactiver ne peut être qu'un choix explicite),
 * aucun serveur ICE et aucun texte en temps réel. Exporté parce que la page
 * de partage relit un compte venu d'une autre installation, éventuellement
 * plus ancienne, et lui doit les mêmes défauts.
 *
 * L'empreinte SHA-256 est le seul de ces champs dont l'absence ne se
 * rattrape pas par un défaut : elle se calcule du mot de passe, et le mot
 * de passe n'est pas là. La chaîne vide dit « inconnue », et c'est le défi
 * du serveur qui décidera si cela manque.
 */
export function migrateAccount(cfg: AccountConfig): AccountConfig {
  return {
    ...cfg,
    authUsername: cfg.authUsername ?? null,
    ha1Sha256: cfg.ha1Sha256 ?? "",
    flashAlert: cfg.flashAlert ?? true,
    ice: cfg.ice ?? { ...NO_ICE },
    rtt: parseRttTransport(cfg.rtt),
  };
}

/**
 * Le coffre relu, ramené à une forme utilisable : la liste doit en être une,
 * chaque compte doit porter un identifiant, et l'actif doit désigner un
 * compte qui existe. Un coffre à moitié lisible vaut mieux qu'un écran
 * blanc — mais un `activeId` qui pointe dans le vide enverrait la machine
 * s'enregistrer sur rien, et c'est cela qu'on refuse ici.
 */
function normalizeVault(raw: unknown): Vault {
  if (typeof raw !== "object" || raw === null) return { ...EMPTY_VAULT };
  const { accounts, activeId } = raw as Partial<Vault>;
  if (!Array.isArray(accounts)) return { ...EMPTY_VAULT };
  const kept = accounts
    .filter((a): a is StoredAccount => typeof a?.id === "string" && a.id !== "")
    .map((a) => ({ ...migrateAccount(a), id: a.id }));
  const active = kept.some((a) => a.id === activeId) ? activeId! : null;
  return { accounts: kept, activeId: active };
}

/**
 * Migration du compte unique vers le coffre à liste (ADR 0002, décision 8).
 *
 * L'ordre des trois écritures est celui qui survit à une interruption sans
 * rien perdre : l'historique est **recopié** sous le nouvel identifiant
 * avant que le coffre ne le désigne, et les anciennes clés ne partent
 * qu'une fois les deux en place. Coupée avant la deuxième, la migration
 * n'aura rien changé de ce qui est lu, et rejouera entièrement au
 * démarrage suivant.
 *
 * L'effacement des anciennes clés n'est pas de la cosmétique : sans lui, un
 * compte supprimé plus tard laisserait son HA1 chiffré dans la base, sous
 * une clé que plus personne ne lit.
 */
async function migrateLegacy(db: IDBDatabase): Promise<Vault> {
  const legacy = (await decryptGet(db, LEGACY_ID)) as AccountConfig | null;
  if (!legacy) return { ...EMPTY_VAULT };
  const account: StoredAccount = { ...migrateAccount(legacy), id: newAccountId() };
  const oldKey = `${legacy.username}@${legacy.domain}`;
  const entries = (await decryptGet(db, historyId(oldKey))) as CallLogEntry[] | null;
  if (Array.isArray(entries)) await encryptPut(db, historyId(account.id), entries);
  const vault: Vault = { accounts: [account], activeId: account.id };
  await encryptPut(db, VAULT_ID, vault);
  await idbDelete(db, LEGACY_ID);
  await idbDelete(db, historyId(oldKey));
  return vault;
}

export function createBrowserStore(): SecureStore {
  return {
    async save(vault: Vault): Promise<void> {
      const db = await openDb();
      try {
        await encryptPut(db, VAULT_ID, vault);
      } finally {
        db.close();
      }
    },

    async load(): Promise<Vault> {
      const db = await openDb();
      try {
        const raw = await decryptGet(db, VAULT_ID);
        // Le coffre absent est le seul cas où l'on regarde l'ancienne clé :
        // la migration est ainsi idempotente sans avoir à se souvenir
        // qu'elle a eu lieu.
        return raw === null ? await migrateLegacy(db) : normalizeVault(raw);
      } finally {
        db.close();
      }
    },

    async clear(): Promise<void> {
      const db = await openDb();
      try {
        await idbDelete(db, VAULT_ID);
        await idbDelete(db, LEGACY_ID);
      } finally {
        db.close();
      }
    },

    async loadHistory(id: string): Promise<CallLogEntry[]> {
      const db = await openDb();
      try {
        const entries = (await decryptGet(db, historyId(id))) as CallLogEntry[] | null;
        return Array.isArray(entries) ? entries.map(migrateEntry) : [];
      } finally {
        db.close();
      }
    },

    async saveHistory(id: string, entries: CallLogEntry[]): Promise<void> {
      const db = await openDb();
      try {
        await encryptPut(db, historyId(id), entries);
      } finally {
        db.close();
      }
    },

    async deleteHistory(id: string): Promise<void> {
      const db = await openDb();
      try {
        await idbDelete(db, historyId(id));
      } finally {
        db.close();
      }
    },

    async loadContacts(id: string): Promise<Contact[]> {
      const db = await openDb();
      try {
        return normalizeContacts(await decryptGet(db, contactsId(id)));
      } finally {
        db.close();
      }
    },

    async saveContacts(id: string, contacts: Contact[]): Promise<void> {
      const db = await openDb();
      try {
        await encryptPut(db, contactsId(id), contacts);
      } finally {
        db.close();
      }
    },

    async deleteContacts(id: string): Promise<void> {
      const db = await openDb();
      try {
        await idbDelete(db, contactsId(id));
      } finally {
        db.close();
      }
    },
  };
}
