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
 */

/** Le compte à reprendre au chargement — identifiant opaque du coffre. */
const RESUME_KEY = "trix-resume";
/** Dernier instant joignable, en millisecondes epoch. */
const REACHABLE_KEY = "trix-reachable";
/** Une alerte d'injoignabilité a été posée et n'a pas été soldée. */
const ALERT_KEY = "trix-reach-alert";
/** Le rappel sur l'épinglage de l'onglet a déjà été montré (D6). */
const PINHINT_KEY = "trix-pin-hint";

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

/**
 * Le compte que l'application doit réenregistrer sans rien demander.
 * Posé au premier enregistrement réussi, effacé par « Déconnexion » : il
 * ne dit pas *quel* compte est actif — le coffre le sait — mais que
 * l'utilisateur, la dernière fois, était joignable et ne l'a pas quitté.
 */
export function resumeAccount(): string | null {
  return read(RESUME_KEY);
}

export function setResumeAccount(id: string | null): void {
  write(RESUME_KEY, id);
}

/**
 * Le dernier instant où l'on était joignable — borne basse de la période
 * d'injoignabilité affichée après un déchargement (D4). `null` quand rien
 * n'a jamais été écrit : on ne sait alors pas depuis quand, et le message
 * ne le prétend pas.
 */
export function lastReachableAt(): number | null {
  const raw = read(REACHABLE_KEY);
  if (raw === null) return null;
  const ts = Number(raw);
  // une valeur illisible vaut une valeur absente : personne ne doit lire
  // « injoignable depuis le 1er janvier 1970 »
  return Number.isFinite(ts) && ts > 0 ? ts : null;
}

export function markReachable(at: number = Date.now()): void {
  write(REACHABLE_KEY, String(at));
}

/**
 * Une alerte d'absence est posée et n'a pas été soldée (D8). Elle survit
 * au déchargement de la page, sans quoi le retour à la normale ne se
 * notifierait plus après un rechargement complet — et l'alerte, devenue
 * fausse, resterait à l'écran sans que personne puisse la fermer.
 */
export function alertPosted(): boolean {
  return read(ALERT_KEY) === "1";
}

export function setAlertPosted(posted: boolean): void {
  write(ALERT_KEY, posted ? "1" : null);
}

/** Le rappel « épinglez l'onglet » a déjà été montré une fois (D6). */
export function pinHintShown(): boolean {
  return read(PINHINT_KEY) === "1";
}

export function setPinHintShown(): void {
  write(PINHINT_KEY, "1");
}
