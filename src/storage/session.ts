/**
 * L'état de session **hors coffre** (ADR 0006).
 *
 * Trois choses que l'application doit retrouver au chargement suivant, et
 * qui n'ont rien à faire dans le coffre chiffré : le compte qui *doit*
 * être enregistré (D4), le dernier instant où l'on était joignable (D4),
 * et le fait qu'une alerte d'injoignabilité soit restée posée (D8).
 *
 * Hors du coffre pour trois raisons, toutes énoncées en D4 : rien ici
 * n'est secret — un identifiant opaque, un horodatage, un booléen ;
 * aucune migration du format chiffré n'est imposée ; et surtout tout
 * reste lisible quand le coffre, lui, refuse de s'ouvrir — c'est
 * précisément le moment où il faut pouvoir dire pourquoi on n'est pas
 * joignable.
 *
 * Lecture et écriture **tolérantes** : stockage indisponible (mode privé,
 * cookies tiers coupés, quota plein) ou valeur illisible, on se comporte
 * comme si rien n'avait jamais été écrit. Aucun appelant n'a de repli à
 * prévoir.
 *
 * Une instance par `createSessionStore(prefix)` (ADR 0011, D8) : chaque clé
 * porte le préfixe de l'instance, si bien que deux dérivés sur la même
 * origine ne lisent pas la session l'un de l'autre. Le préfixe par défaut,
 * `trix`, garde les clés des installations existantes.
 */

/**
 * Le statut **choisi** par l'utilisateur (ADR 0007, D5), et non celui que
 * voient les autres : Invisible n'est pas un état publié, et « En
 * communication » ou « Absent » ne se choisissent pas — ils découlent des
 * deux règles.
 */
export type ChosenStatus = "available" | "busy" | "away" | "dnd" | "invisible";

/** Statut choisi, note et règles automatiques d'un compte (D5). */
export interface StatusPrefs {
  chosen: ChosenStatus;
  note: string | null;
  /** Règle 1 : « En communication » pendant un appel. */
  onThePhone: boolean;
  /** Règle 2 : « Absent » après dix minutes sans activité. */
  awayWhenIdle: boolean;
}

export const DEFAULT_STATUS: StatusPrefs = {
  chosen: "available",
  note: null,
  onThePhone: true,
  awayWhenIdle: true,
};

const CHOSEN: readonly ChosenStatus[] = ["available", "busy", "away", "dnd", "invisible"];

/** The part of the session PhoneMachine writes: the account to resume (D4). */
export interface ResumeStore {
  /**
   * Le compte que l'application doit réenregistrer sans rien demander.
   * Posé au premier enregistrement réussi, effacé par « Déconnexion » : il
   * ne dit pas *quel* compte est actif — le coffre le sait — mais que
   * l'utilisateur, la dernière fois, était joignable et ne l'a pas quitté.
   */
  resumeAccount(): string | null;
  setResumeAccount(id: string | null): void;
}

export interface SessionStore extends ResumeStore {
  /**
   * Le dernier instant où l'on était joignable — borne basse de la période
   * d'injoignabilité affichée après un déchargement (D4). `null` quand rien
   * n'a jamais été écrit : on ne sait alors pas depuis quand, et le message
   * ne le prétend pas.
   */
  lastReachableAt(): number | null;
  markReachable(at?: number): void;
  /**
   * Une alerte d'absence est posée et n'a pas été soldée (D8). Elle survit
   * au déchargement de la page, sans quoi le retour à la normale ne se
   * notifierait plus après un rechargement complet — et l'alerte, devenue
   * fausse, resterait à l'écran sans que personne puisse la fermer.
   */
  alertPosted(): boolean;
  setAlertPosted(posted: boolean): void;
  /** Le rappel « épinglez l'onglet » a déjà été montré une fois (D6). */
  pinHintShown(): boolean;
  setPinHintShown(): void;
  /**
   * Les préférences de statut d'un compte (ADR 0007, D5), hors coffre pour
   * survivre au rechargement de D4 sans attendre le déchiffrement. Chaque
   * champ illisible retombe sur sa valeur par défaut, sans emporter les
   * autres.
   */
  statusPrefs(accountId: string): StatusPrefs;
  setStatusPrefs(accountId: string, prefs: StatusPrefs): void;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // stockage refusé : la session ne se reprendra pas toute seule, et
    // c'est tout — rien ici n'est nécessaire au fonctionnement de l'appel
  }
}

/** The session of one instance, under `<prefix>-…` keys in `localStorage`. */
export function createSessionStore(prefix = "trix"): SessionStore {
  const resumeKey = `${prefix}-resume`;
  const reachableKey = `${prefix}-reachable`;
  const alertKey = `${prefix}-reach-alert`;
  const pinHintKey = `${prefix}-pin-hint`;
  const statusKey = (accountId: string): string => `${prefix}-status:${accountId}`;

  return {
    resumeAccount: () => read(resumeKey),
    setResumeAccount: (id) => write(resumeKey, id),

    lastReachableAt() {
      const raw = read(reachableKey);
      if (raw === null) return null;
      const ts = Number(raw);
      // une valeur illisible vaut une valeur absente : personne ne doit lire
      // « injoignable depuis le 1er janvier 1970 »
      return Number.isFinite(ts) && ts > 0 ? ts : null;
    },
    markReachable: (at = Date.now()) => write(reachableKey, String(at)),

    alertPosted: () => read(alertKey) === "1",
    setAlertPosted: (posted) => write(alertKey, posted ? "1" : null),

    pinHintShown: () => read(pinHintKey) === "1",
    setPinHintShown: () => write(pinHintKey, "1"),

    statusPrefs(accountId) {
      let raw: unknown;
      try {
        raw = JSON.parse(read(statusKey(accountId)) ?? "null");
      } catch {
        raw = null;
      }
      const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
      return {
        chosen: CHOSEN.includes(r.chosen as ChosenStatus) ? (r.chosen as ChosenStatus) : DEFAULT_STATUS.chosen,
        note: typeof r.note === "string" && r.note.trim() !== "" ? r.note : null,
        onThePhone: typeof r.onThePhone === "boolean" ? r.onThePhone : DEFAULT_STATUS.onThePhone,
        awayWhenIdle: typeof r.awayWhenIdle === "boolean" ? r.awayWhenIdle : DEFAULT_STATUS.awayWhenIdle,
      };
    },
    setStatusPrefs: (accountId, prefs) => write(statusKey(accountId), JSON.stringify(prefs)),
  };
}
