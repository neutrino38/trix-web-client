/**
 * Le favicon — **propriétaire unique**, exactement pour la raison qui a
 * donné `ui/title.ts` : deux canaux d'alerte veulent l'écrire, et aucun
 * des deux ne sait ce que l'autre y a mis.
 *
 * La joignabilité (ADR 0006, D2) y pose une pastille **permanente** tant
 * que l'on ne peut pas recevoir d'appel ; l'alerte d'appel entrant
 * (`ui/alert.ts`) la fait **clignoter** le temps d'une sonnerie. Les deux
 * ne peuvent pas se produire ensemble — un appel qui sonne prouve qu'on
 * était joignable —, mais rien dans le code ne le garantissait : une
 * sonnerie qui se termine restaurait « le favicon d'avant », c'est-à-dire
 * celui qu'elle avait trouvé, et non celui que l'état réclame maintenant.
 *
 * D'où les deux couches : l'**état**, écrit librement, et un **override**
 * temporaire posé par l'alerte. L'alerte n'a plus rien à mémoriser ; ce
 * qui réapparaît quand elle rend la main est l'état courant.
 */

/** Pastille : un SVG inline, aucun fichier à embarquer. */
function dotUri(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="${color}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function link(): HTMLLinkElement {
  let node = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!node) {
    node = document.createElement("link");
    node.rel = "icon";
    document.head.append(node);
  }
  return node;
}

/**
 * Le favicon de la page tel qu'il était avant toute alerte — lu une seule
 * fois, à la première prise de contrôle, parce qu'après il ne sera plus
 * là pour être lu.
 */
let base: string | null = null;
let baseRead = false;
let state: string | null = null;
let override: string | null = null;
/**
 * Unread messages (ADR 0008, D11): the lowest layer. Being unreachable
 * says more than a message waiting, and an alert more than both.
 */
let unread: string | null = null;

function apply(): void {
  const node = link();
  if (!baseRead) {
    base = node.getAttribute("href");
    baseRead = true;
  }
  const color = override ?? state ?? unread;
  if (color !== null) {
    node.href = dotUri(color);
    return;
  }
  // rendu de la main : le favicon déclaré par la page, ou aucun s'il n'y
  // en avait pas — dans ce cas la balise qu'on a créée n'a plus lieu d'être
  if (base !== null) node.href = base;
  else node.remove();
}

/** Pastille durable dérivée de l'état (joignabilité) ; `null` rend la main. */
export function setFaviconState(color: string | null): void {
  state = color;
  apply();
}

/** Messages non lus : la couche la plus basse ; `null` l'efface. */
export function setFaviconUnread(color: string | null): void {
  unread = color;
  apply();
}

/** Prise de contrôle temporaire (clignotement d'alerte) ; `null` rend la main. */
export function setFaviconOverride(color: string | null): void {
  override = color;
  apply();
}
