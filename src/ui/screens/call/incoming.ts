/**
 * Appel entrant en popup modale (maquettes 1e et 1g), partagée bureau/mobile.
 *
 * La carte incrustée dans la scène (`.incoming-card`) et son équivalent mobile
 * (`.mincoming`) disparaissent au profit d'une **seule** popup posée au-dessus
 * de l'écran d'appel : un appel entrant n'est pas un contenu de plus dans la
 * page, c'est une interruption qui attend une décision — répondre ou refuser.
 * Le dire en modale, c'est le dire aux lecteurs d'écran comme aux voyants.
 *
 * Les réponses proposées restent dérivées de `answerChoices(offered)`
 * (parts.ts) : 1g n'est que le cas « offre sans vidéo » de la même fonction,
 * aucune règle nouvelle n'est écrite ici.
 *
 * Empilement : la popup passe **au-dessus** du voile (même nœud) et **en
 * dessous** du cadre clignotant de `alert.ts` (`.callflash`, z-index 60), qui
 * reste le signal principal pour un public sourd.
 */

import type { CallView } from "../../../machines/events.js";
import { esc } from "../../el.js";
import { ICONS, answerChoices, callerName, displayTarget } from "./parts.js";
import { t } from "../../../i18n/index.js";

/**
 * Sur-titre : le média offert, avant même le nom de l'appelant. C'est lui, et
 * lui seul, qui dit pourquoi tel bouton de réponse manque — la phrase
 * d'explication de la maquette (« l'offre contient audio + vidéo… ») parlait le
 * vocabulaire du SDP, pas celui de l'utilisateur. D'où sa taille, très
 * au-dessus des 10,5 px de la maquette.
 */
function kicker(view: CallView): string {
  return t(view.offered.video ? "incoming.kicker.video" : "incoming.kicker.audio");
}

/**
 * Gabarit de la popup. À poser à la racine de l'écran d'appel (et non dans la
 * scène) : elle couvre la fenêtre entière, barre d'en-tête comprise.
 *
 * Le premier choix est le bouton plein (vert), les suivants sont des boutons
 * secondaires — l'ordre vient d'`answerChoices`, qui met la réponse la plus
 * riche en tête. Une offre audio pure n'a donc qu'un bouton vert, comme en 1g.
 */
export function incomingDialog(view: CallView): string {
  const choices = answerChoices(view.offered);
  return `<div class="incoming-veil" data-ref="incoming-veil">
    <div class="incoming-dialog" data-ref="incoming" role="dialog" aria-modal="true"
         aria-labelledby="incoming-who">
      <span class="ring-badge" aria-hidden="true">${ICONS.phone}</span>
      <span class="kicker">${esc(kicker(view))}</span>
      <h2 class="who" id="incoming-who">${esc(callerName(view))}</h2>
      ${
        // l'URI ne s'affiche que si le nom ne la répète pas déjà
        view.displayName ? `<span class="uri">${esc(displayTarget(view.target))}</span>` : ""
      }
      <div class="incoming-actions">
        ${choices
          .map(
            (c, i) =>
              `<button class="btn ${i === 0 ? "answer" : ""}" data-act="${c.act}">
                 ${c.icon} ${esc(c.label)}
               </button>`,
          )
          .join("")}
        <button class="btn hangup" data-act="reject">${ICONS.hangup} ${esc(t("incoming.reject"))}</button>
      </div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Comportement modal (RGAA 7.x)
// ---------------------------------------------------------------------------

/**
 * Élément qui avait le focus quand la popup s'est ouverte : on le lui rend à la
 * fermeture. Il vaut le plus souvent `null` — un appel entrant n'est pas
 * déclenché par un clic — mais la règle vaut quand il existe (le champ
 * d'adresse en cours de saisie, par exemple).
 */
let opener: HTMLElement | null = null;

/**
 * Action qui portait le focus au rendu précédent. L'écran d'appel est
 * reconstruit à **chaque** notification de la machine : sans cette mémoire, un
 * simple `stay()` pendant la sonnerie renverrait le focus sur le premier
 * bouton, sous les doigts de qui s'apprêtait à refuser.
 */
let focusedAct: string | null = null;

const actions = (dialog: HTMLElement): HTMLElement[] => [
  ...dialog.querySelectorAll<HTMLElement>("button:not([disabled])"),
];

/**
 * Câble la popup rendue dans `screen` : focus déplacé dedans, piégé tant
 * qu'elle est ouverte, Échap qui refuse l'appel.
 *
 * À appeler à chaque rendu tant que l'état est `ringing_in` — les écouteurs
 * meurent avec le nœud qu'ils servaient, comme partout ailleurs dans cet écran.
 */
export function wireIncoming(screen: HTMLElement, onReject: () => void): void {
  const dialog = screen.querySelector<HTMLElement>('[data-ref="incoming"]');
  if (!dialog) return;

  if (!opener) {
    const active = document.activeElement;
    opener = active instanceof HTMLElement && active !== document.body ? active : null;
  }

  // Ouverture : premier bouton ; re-rendu : celui qui avait le focus.
  // Le câblage précède le montage (renderCall construit le nœud, l'appelant le
  // pose ensuite dans #app) et `focus()` sur un nœud détaché ne fait rien : on
  // repasse donc par une microtâche, exécutée juste après `replaceChildren`.
  const giveFocus = (): void => {
    if (!dialog.isConnected) return; // un rendu plus récent a déjà pris la main
    const items = actions(dialog);
    (items.find((b) => b.dataset.act === focusedAct) ?? items[0])?.focus();
  };
  if (dialog.isConnected) giveFocus();
  else queueMicrotask(giveFocus);

  dialog.addEventListener("focusin", (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>("button")?.dataset.act;
    if (act) focusedAct = act;
  });

  // Le voile ne ferme pas au clic (une erreur de clic ne doit pas raccrocher) et
  // ne prend pas le focus : sans ce `preventDefault`, cliquer à côté sortirait
  // le focus du piège, et Échap — dont l'écouteur vit sur la popup — cesserait
  // de répondre.
  screen
    .querySelector('[data-ref="incoming-veil"]')
    ?.addEventListener("mousedown", (e) => {
      if (e.target !== e.currentTarget) return;
      e.preventDefault();
    });

  dialog.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onReject();
      return;
    }
    if (e.key !== "Tab") return;
    // piège à focus : hors de la popup, il n'y a plus rien à faire tant que
    // l'appel n'est pas tranché — le reste de l'écran est `inert`
    const list = actions(dialog);
    const first = list[0];
    const last = list[list.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
}

/**
 * Fermeture : rend le focus au déclencheur s'il existe encore. Répondre ou
 * refuser re-rend l'écran, donc ce déclencheur a le plus souvent disparu avec
 * son nœud — d'où le `isConnected`, et non un `try`.
 *
 * Idempotente : appelée à chaque rendu où l'état n'est pas `ringing_in`.
 */
export function closeIncoming(): void {
  const back = opener;
  opener = null;
  focusedAct = null;
  if (back?.isConnected) back.focus();
}
