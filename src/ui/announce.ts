/**
 * Annonces aux lecteurs d'écran — messages de statut (RGAA 7.5, WCAG 4.1.3).
 *
 * Trix change d'état sans que l'utilisateur agisse : l'enregistrement tombe,
 * un appel aboutit, le réseau coupe. À l'écran ces changements se voient ;
 * pour un lecteur d'écran ils sont muets, faute de région dédiée.
 *
 * Deux contraintes dictent l'implémentation :
 *
 * - la région doit **exister avant** que son contenu change, sinon l'annonce
 *   est perdue — elle vit donc hors de `#app`, que chaque rendu remplace en
 *   entier ;
 * - elle est `polite` et jamais `assertive` : une alerte d'appel entrant qui
 *   couperait la parole au lecteur d'écran serait hostile, et le public visé
 *   est déjà prévenu par le flash, la vibration et la notification.
 */

let node: HTMLElement | null = null;
let last = "";

function region(): HTMLElement {
  if (!node) {
    node = document.createElement("p");
    node.className = "sr-only";
    node.setAttribute("role", "status");
    node.setAttribute("aria-live", "polite");
    document.body.append(node);
  }
  return node;
}

/** Idempotent : réémettre le même message ne le fait pas annoncer deux fois. */
export function announce(message: string): void {
  if (message === last) return;
  last = message;
  region().textContent = message;
}
