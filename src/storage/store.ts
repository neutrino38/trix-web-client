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
  /**
   * L'identifiant d'instance de ce compte **sur cet appareil** : le
   * `+sip.instance` que JsSIP pose sur le Contact de chaque REGISTER
   * (RFC 5626 §4.1). Un UUID tiré une fois, à la création du compte ou à
   * la première relecture d'un compte plus ancien, puis gardé.
   *
   * Laissé à JsSIP, il était tiré à chaque démarrage de l'UA — chaque
   * chargement de page, chaque réveil d'onglet (ADR 0006). Pour le
   * serveur, chaque réveil était alors un appareil neuf : un stockage de
   * messages qui distribue par appareil (le Silo de kelixip) remettait
   * tout ce qu'il gardait encore, à chaque réveil, à un client qui n'a
   * rien pour dédoublonner (ADR 0008, D3). La RFC le veut persistant pour
   * cette raison-là.
   *
   * Pas dans `AccountConfig` : il désigne l'appareil, pas le compte. Un
   * lien de partage (`share/link.ts`) ne l'emporte pas, et le compte
   * ouvert ailleurs tire le sien — deux appareils sous un même instance
   * se remplaceraient l'un l'autre chez le registrar.
   */
  instanceId: string;
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

/**
 * Un identifiant d'instance : toujours un UUID au format RFC 4122, parce
 * que JsSIP **ignore sans rien dire** un `instance_id` qui n'en est pas un
 * et en tire un au hasard — exactement le défaut que ce champ corrige. Le
 * repli de `newAccountId` (32 chiffres hexadécimaux) ne conviendrait donc
 * pas : celui-ci pose les tirets, la version 4 et la variante.
 */
export function newInstanceId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CallDirection = "outgoing" | "incoming";
/**
 * `missed` : entrant non répondu (phase 3) ; `canceled` : sortant abandonné
 * avant réponse ; `dropped` : incident réseau (proxy perdu pendant l'appel) ;
 * `declined` : entrant refusé d'office en Ne pas déranger (ADR 0007, D6) —
 * personne ne l'a laissé sonner, ce n'est pas un appel manqué.
 */
export type CallOutcome = "answered" | "missed" | "failed" | "canceled" | "dropped" | "declined";

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
  /**
   * Blocked (ADR 0008, D7): calls and messages refused 603, no presence
   * subscription. Read as false from a book written before it.
   */
  blocked: boolean;
}

/** State of a message (ADR 0008, D3); `received` for every incoming one. */
export type MessageState = "pending" | "sent" | "failed" | "received";

/**
 * One instant message (ADR 0008, D6), kept encrypted per account next to
 * the call history. The thread groups them with calls by `key`.
 */
export interface MessageEntry {
  /** Local and stable; also what the link reports a send's outcome under. */
  id: string;
  /** `addressKey` of the correspondent (`sip/uri.ts`). */
  key: string;
  /** The address as it came in or went out. */
  uri: string;
  direction: CallDirection;
  text: string;
  /**
   * Epoch ms: the CPIM `DateTime` or the `Date` header when there was one
   * (D8, ADR 0009), else reception or writing.
   */
  at: number;
  /**
   * Incoming, in CPIM: the sender's `imdn.Message-ID`, which files a
   * message delivered twice only once (ADR 0009). An outgoing message's
   * `imdn.Message-ID` is its `id`.
   */
  messageId?: string;
  state: MessageState;
  /** Why a send failed, as a deferred message. */
  reason: Msg | null;
  /** Incoming messages only; always true for outgoing ones. */
  read: boolean;
}

/** D6: past this, a correspondent's oldest messages go. */
export const MAX_MESSAGES_PER_PEER = 1000;

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
  /** An account's messages (ADR 0008, D6), encrypted like the vault. */
  loadMessages(id: string): Promise<MessageEntry[]>;
  saveMessages(id: string, messages: MessageEntry[]): Promise<void>;
  /** Deletes an account's messages, with the account. */
  deleteMessages(id: string): Promise<void>;
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
const messagesId = (id: string): string => `messages:${id}`;

/**
 * Un carnet relu : ce qui n'a pas la forme d'un contact est écarté plutôt
 * que de faire tomber tout le carnet — un enregistrement abîmé ne doit pas
 * coûter les autres.
 */
function normalizeContacts(raw: unknown): Contact[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (c): c is Contact =>
        typeof c === "object" &&
        c !== null &&
        typeof c.id === "string" &&
        typeof c.name === "string" &&
        typeof c.uri === "string" &&
        typeof c.addedAt === "number",
    )
    // `blocked` appeared with ADR 0008: absent means not blocked
    .map((c) => ({ ...c, blocked: c.blocked === true }));
}

const MESSAGE_STATES: ReadonlySet<string> = new Set(["pending", "sent", "failed", "received"]);

/**
 * Messages read back: whatever does not have the shape of one is dropped,
 * like a damaged contact — one bad record must not cost the others.
 */
function normalizeMessages(raw: unknown): MessageEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (m): m is MessageEntry =>
      typeof m === "object" &&
      m !== null &&
      typeof m.id === "string" &&
      typeof m.key === "string" &&
      typeof m.uri === "string" &&
      (m.direction === "outgoing" || m.direction === "incoming") &&
      typeof m.text === "string" &&
      typeof m.at === "number" &&
      MESSAGE_STATES.has(m.state) &&
      typeof m.read === "boolean",
  ).map((m) => {
    const entry: MessageEntry = { ...m, reason: m.reason ?? null };
    if (typeof entry.messageId !== "string") delete entry.messageId;
    return entry;
  });
}

/**
 * Keeps the `max` most recent messages of each correspondent (D6), in
 * the order given. Pending ones are never dropped: they have not left.
 * Applied by MessagingMachine before it saves; the store writes what it
 * is given, like the history.
 */
export function capMessages(messages: MessageEntry[], max = MAX_MESSAGES_PER_PEER): MessageEntry[] {
  const count = new Map<string, number>();
  for (const m of messages) if (m.state !== "pending") count.set(m.key, (count.get(m.key) ?? 0) + 1);
  const excess = new Map<string, number>();
  for (const [key, n] of count) if (n > max) excess.set(key, n - max);
  if (excess.size === 0) return messages;
  // the oldest go first, whatever order the list is kept in
  const oldestFirst = [...messages].sort((a, b) => a.at - b.at);
  const dropped = new Set<MessageEntry>();
  for (const m of oldestFirst) {
    const left = excess.get(m.key) ?? 0;
    if (left === 0 || m.state === "pending") continue;
    dropped.add(m);
    excess.set(m.key, left - 1);
  }
  return messages.filter((m) => !dropped.has(m));
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
function normalizeVault(raw: unknown): { vault: Vault; drawn: boolean } {
  if (typeof raw !== "object" || raw === null) return { vault: { ...EMPTY_VAULT }, drawn: false };
  const { accounts, activeId } = raw as Partial<Vault>;
  if (!Array.isArray(accounts)) return { vault: { ...EMPTY_VAULT }, drawn: false };
  let drawn = false;
  const kept = accounts
    .filter((a): a is StoredAccount => typeof a?.id === "string" && a.id !== "")
    .map((a) => {
      const valid = typeof a.instanceId === "string" && UUID.test(a.instanceId);
      if (!valid) drawn = true;
      return { ...migrateAccount(a), id: a.id, instanceId: valid ? a.instanceId : newInstanceId() };
    });
  const active = kept.some((a) => a.id === activeId) ? activeId! : null;
  return { vault: { accounts: kept, activeId: active }, drawn };
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
  const account: StoredAccount = {
    ...migrateAccount(legacy),
    id: newAccountId(),
    instanceId: newInstanceId(),
  };
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
        if (raw === null) return await migrateLegacy(db);
        const { vault, drawn } = normalizeVault(raw);
        // Un identifiant d'instance tiré à la relecture est écrit tout de
        // suite : gardé en mémoire seulement, il serait retiré au
        // chargement suivant, et c'est précisément ce qu'il doit éviter.
        if (drawn) await encryptPut(db, VAULT_ID, vault);
        return vault;
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

    async loadMessages(id: string): Promise<MessageEntry[]> {
      const db = await openDb();
      try {
        return normalizeMessages(await decryptGet(db, messagesId(id)));
      } finally {
        db.close();
      }
    },

    async saveMessages(id: string, messages: MessageEntry[]): Promise<void> {
      const db = await openDb();
      try {
        await encryptPut(db, messagesId(id), messages);
      } finally {
        db.close();
      }
    },

    async deleteMessages(id: string): Promise<void> {
      const db = await openDb();
      try {
        await idbDelete(db, messagesId(id));
      } finally {
        db.close();
      }
    },
  };
}
