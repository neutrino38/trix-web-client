/**
 * Messages fugaces de l'appel — « Bob n'a pas accepté la vidéo ».
 *
 * Ce que l'écran d'appel montre en permanence décrit un **état** : qui
 * est en ligne, quels médias passent, depuis combien de temps. Un refus
 * de vidéo n'est pas un état, c'est un événement qui vient de passer :
 * l'afficher à demeure serait mentir dès la seconde suivante, ne pas
 * l'afficher du tout laisserait l'image manquante sans explication. D'où
 * ce bandeau, visible quelques secondes puis oublié.
 *
 * Il vit hors de `#app`, comme la région d'annonces (`announce.ts`) et
 * l'alerte d'appel entrant : l'écran est reconstruit à chaque
 * notification de la machine, un nœud posé dedans disparaîtrait au
 * premier re-rendu — c'est-à-dire aussitôt, puisque c'est justement une
 * transition d'état qui déclenche le message.
 *
 * `role="status"` et `aria-live="polite"` le portent aux lecteurs
 * d'écran sans couper la parole ; le public sourd, lui, le lit. Personne
 * n'a besoin d'agir : rien n'y est cliquable, et le bandeau ne prend
 * jamais le focus.
 */

/** Durée d'affichage : le temps de lire une phrase courte, sans plus. */
const TOAST_MS = 5000;

let node: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function region(): HTMLElement {
  if (!node) {
    node = document.createElement("div");
    node.className = "toast";
    node.setAttribute("role", "status");
    node.setAttribute("aria-live", "polite");
    node.hidden = true;
    document.body.append(node);
  }
  return node;
}

/**
 * Affiche `message` par-dessus l'écran. Un second message remplace le
 * premier au lieu de s'empiler : deux bandeaux superposés se cacheraient
 * l'un l'autre, et c'est toujours le dernier qui compte.
 */
export function showToast(message: string): void {
  const bar = region();
  bar.textContent = message;
  bar.hidden = false;
  // relance de l'animation d'entrée pour un message qui en remplace un autre
  bar.classList.remove("in");
  void bar.offsetWidth;
  bar.classList.add("in");
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(hideToast, TOAST_MS);
}

/** Efface le bandeau — à la fin de l'appel, sans attendre le délai. */
export function hideToast(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (!node) return;
  node.classList.remove("in");
  node.hidden = true;
  node.textContent = "";
}
