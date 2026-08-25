/**
 * La feuille du bas de la barre mobile (ADR 0003, D8).
 *
 * Le diagnostic tient en une ligne d'arithmétique. En communication avec
 * texte, la pastille mobile portait micro, caméra, self-view, haut-parleur,
 * DTMF, tchat, plus le rond rouge — sept cibles, et la Pause en ajoute une.
 * À 44 px de cible (WCAG 2.5.5) et 6 px d'écart : `8 × 44 + 7 × 6 + 16 =
 * 410 px`. L'écran fait 390 px, souvent 360. Ça débordait, et ce n'était pas
 * rattrapable au CSS.
 *
 * La pastille porte donc **quatre** icônes, et le reste vit ici. Cette
 * séparation n'est pas qu'une affaire de place : c'est le rendu visuel des
 * deux axes de D6 — ce dont l'appel est fait d'un côté, ce que je suis en
 * train d'émettre de l'autre.
 *
 * Une **feuille du bas**, et non un menu déroulant : atteignable au pouce,
 * lisible, et annonçable. Elle porte des **libellés**, pas des icônes seules
 * — c'est un gain net, la pastille étant muette et Trix s'affichant en six
 * langues.
 *
 * Deux règles la gouvernent, et elles sont tenues dans `overlay.ts` :
 *
 * 1. **un état coupé ne se cache jamais** — toute commande dont l'état est
 *    *coupé* (rouge) remonte dans la pastille. C'est aussi pourquoi la
 *    feuille ne contient que des commandes locales et réversibles ;
 * 2. **ni Raccrocher ni Pause n'y entrent** — un geste d'urgence ne se
 *    cherche pas, et un geste qui doit être instantané ne demande pas deux
 *    appuis.
 *
 * L'état d'ouverture vit ici, jamais dans la machine : le format d'affichage
 * ne change rien au protocole SIP (docs/CONCEPTION.md §4.6). Comme le pavé
 * DTMF, la feuille s'ouvre et se ferme sans re-rendre l'écran.
 */

import { esc } from "../../el.js";
import { t } from "../../../i18n/index.js";

/** L'identifiant de la région, cible de l'`aria-controls` du « ⋯ ». */
export const SHEET_ID = "call-sheet";

/** Trois points : « il y a d'autres commandes », sans en nommer une seule. */
export const MORE_ICON = `<svg class="icon" viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`;

// ---------------------------------------------------------------------------
// État d'ouverture — local à l'écran, comme le pavé DTMF
// ---------------------------------------------------------------------------

let open = false;

export function sheetOpen(): boolean {
  return open;
}

/**
 * L'appel se termine, ou l'écran change : la feuille n'a plus d'objet. À
 * appeler au raccrochage — une feuille laissée ouverte se rouvrirait sur
 * l'appel suivant, par-dessus une barre qui n'a plus la même composition.
 */
export function closeSheet(): void {
  open = false;
}

// ---------------------------------------------------------------------------
// Gabarit
// ---------------------------------------------------------------------------

/**
 * Le contenu de la feuille est composé par `overlay.ts` — ce sont les mêmes
 * boutons que la pastille aurait portés, avec leur libellé rendu visible.
 * `bottomSheet` ne fait que les poser dans la région et lui donner son voile.
 *
 * Le voile est là pour le clic hors de la feuille : sans lui, refermer
 * demanderait de viser le « ⋯ » à nouveau, ou d'avoir remarqué Échap.
 */
export function bottomSheet(buttons: string): string {
  if (buttons === "") return "";
  return `<div class="sheet-veil" data-ref="sheet-veil" ${open ? "" : "hidden"}></div>
    <div class="sheet" id="${SHEET_ID}" data-ref="sheet" role="group"
         aria-label="${esc(t("sheet.title"))}" ${open ? "" : "hidden"}>
      ${buttons}
    </div>`;
}

// ---------------------------------------------------------------------------
// Câblage
// ---------------------------------------------------------------------------

/**
 * Branche la feuille rendue dans `screen` : le « ⋯ » l'ouvre et la referme,
 * Échap et le voile la referment, et **toute action prise dedans la referme
 * aussi** — on ne reste pas devant une liste après y avoir choisi.
 *
 * Le focus entre dans la feuille à l'ouverture et revient au « ⋯ » à la
 * fermeture (RGAA 7.3) : sans cela, la feuille serait ouverte pour la souris
 * seule. Le piège à focus, en revanche, n'a pas lieu d'être — ce n'est pas
 * une modale, et rien derrière elle n'est interdit.
 */
export function wireSheet(screen: HTMLElement): void {
  const sheet = screen.querySelector<HTMLElement>('[data-ref="sheet"]');
  const veil = screen.querySelector<HTMLElement>('[data-ref="sheet-veil"]');
  const toggle = screen.querySelector<HTMLElement>('[data-act="more"]');
  if (!sheet || !toggle) {
    // pas de feuille dans ce rendu (vue bureau, hors appel) : son état ne
    // doit pas survivre à un écran qui ne la porte pas
    open = false;
    return;
  }

  const setOpen = (next: boolean, moveFocus: boolean): void => {
    open = next;
    sheet.hidden = !next;
    if (veil) veil.hidden = !next;
    toggle.setAttribute("aria-expanded", String(next));
    toggle.classList.toggle("toggled", next);
    if (!moveFocus) return;
    if (next) sheet.querySelector<HTMLElement>("button:not([disabled])")?.focus();
    else toggle.focus();
  };

  toggle.addEventListener("click", () => setOpen(!open, true));
  veil?.addEventListener("click", () => setOpen(false, true));

  // Toute action referme. L'écouteur est posé en **capture** : les commandes
  // de la feuille sont câblées ailleurs (parts.ts, dtmf.ts, chat.ts), et
  // certaines re-rendent l'écran — la fermeture doit être décidée avant que
  // le nœud ne disparaisse, sans quoi l'état resterait « ouvert » pour le
  // rendu suivant.
  sheet.addEventListener(
    "click",
    (e) => {
      if (!(e.target as HTMLElement).closest("button")) return;
      setOpen(false, false);
      // Le focus ne se déplace pas ici : il appartient à ce que l'action va
      // ouvrir — le pavé DTMF y met le sien, le haut-parleur coupé emmène le
      // sien en remontant dans la pastille (parts.ts). Mais l'action peut
      // aussi n'en déplacer aucun, et le focus resterait alors sur un bouton
      // que la feuille vient de cacher : au clavier, il serait simplement
      // perdu. On le rattrape après coup, et seulement dans ce cas-là.
      queueMicrotask(() => {
        const active = document.activeElement;
        const lost = active === null || active === document.body || sheet.contains(active);
        if (lost && toggle.isConnected) toggle.focus();
      });
    },
    true,
  );

  sheet.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    // Échap ne doit pas remonter fermer autre chose : il vient de refermer ceci
    e.stopPropagation();
    e.preventDefault();
    setOpen(false, true);
  });

  // le rendu vient de reconstruire l'écran : la feuille reprend l'état
  // qu'elle avait, sans déplacer le focus de qui n'a rien demandé
  setOpen(open, false);
}
