/**
 * « Alice souhaite ajouter la vidéo » — la popup de décision, en cours de
 * communication.
 *
 * Le distant a envoyé un re-INVITE qui ajoute la vidéo. Accepter allume
 * une caméra : cela ne se décide pas sans son propriétaire, et le port
 * SIP laisse donc la réponse en suspens le temps de la question (le
 * re-INVITE a déjà reçu son 100 Trying, l'appelant patiente).
 *
 * Même gabarit modal que l'appel entrant (`incoming.ts`), à ceci près que
 * le reste de l'écran **n'est pas** rendu `inert` : la conversation
 * continue pendant qu'on réfléchit, et raccrocher doit rester possible.
 */

import type { CallView } from "../../../machines/events.js";
import { esc } from "../../el.js";
import { ICONS, callerName } from "./parts.js";
import { t } from "../../../i18n/index.js";

export function videoAskDialog(view: CallView): string {
  return `<div class="incoming-veil videoask-veil">
    <div class="incoming-dialog videoask" data-ref="videoask" role="dialog" aria-modal="false"
         aria-labelledby="videoask-title">
      <span class="ring-badge" aria-hidden="true">${ICONS.cam}</span>
      <h2 class="who" id="videoask-title">${esc(
        t("videoask.title", { peer: callerName(view) }),
      )}</h2>
      <span class="uri">${esc(t("videoask.body"))}</span>
      <div class="incoming-actions">
        <button class="btn answer" data-act="accept-video">
          ${ICONS.cam} ${esc(t("videoask.accept"))}
        </button>
        <button class="btn" data-act="reject-video">${esc(t("videoask.reject"))}</button>
      </div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Comportement de la popup (RGAA 7.x)
// ---------------------------------------------------------------------------

/**
 * Bouton qui portait le focus au rendu précédent : l'écran d'appel est
 * reconstruit à chaque notification de la machine, et sans cette mémoire un
 * simple changement de sourdine renverrait le focus sur « Accepter », sous les
 * doigts de qui s'apprêtait à refuser.
 */
let focusedAct: string | null = null;

/**
 * Câble la popup rendue dans `screen` : focus posé dedans à l'ouverture,
 * Échap qui refuse. Pas de piège à focus, contrairement à l'appel entrant —
 * la conversation continue derrière, et raccrocher doit rester atteignable.
 */
export function wireVideoAsk(screen: HTMLElement, onReject: () => void): void {
  const dialog = screen.querySelector<HTMLElement>('[data-ref="videoask"]');
  if (!dialog) return;

  const giveFocus = (): void => {
    if (!dialog.isConnected) return; // un rendu plus récent a déjà pris la main
    const items = [...dialog.querySelectorAll<HTMLElement>("button:not([disabled])")];
    (items.find((b) => b.dataset.act === focusedAct) ?? items[0])?.focus();
  };
  // le câblage précède le montage : `focus()` sur un nœud détaché ne fait rien
  if (dialog.isConnected) giveFocus();
  else queueMicrotask(giveFocus);

  dialog.addEventListener("focusin", (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>("button")?.dataset.act;
    if (act) focusedAct = act;
  });

  dialog.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    onReject();
  });
}

/** Fin de la question : la mémoire du focus repart à zéro. */
export function closeVideoAsk(): void {
  focusedAct = null;
}
