/**
 * Titre de l'onglet — **propriétaire unique**.
 *
 * Deux sources veulent l'écrire : l'état de la machine (« En communication —
 * 04:12 ») et l'alerte d'appel entrant, qui le fait clignoter deux fois par
 * seconde. Les laisser écrire toutes deux dans `document.title` marchait tant
 * que l'état ne bougeait pas pendant la sonnerie — ce qui est faux : décrocher
 * change l'état *pendant* que le clignotement tourne encore, et la sauvegarde
 * du « titre d'avant » faite par l'alerte le restaurait par-dessus.
 *
 * D'où deux couches : le titre d'état, mis à jour librement, et un override
 * temporaire posé par l'alerte. L'alerte n'a plus rien à mémoriser — elle rend
 * la main, et ce qui réapparaît est l'état courant, pas l'état d'il y a dix
 * secondes.
 */

const BASE = "Trix Communicator";

let state = BASE;
let override: string | null = null;

function apply(): void {
  document.title = override ?? state;
}

/** Titre dérivé de l'état courant ; `null` remet le titre de repos. */
export function setStateTitle(title: string | null): void {
  state = title === null || title === "" ? BASE : title;
  apply();
}

/** Prise de contrôle temporaire (clignotement d'alerte) ; `null` rend la main. */
export function setTitleOverride(title: string | null): void {
  override = title;
  apply();
}
