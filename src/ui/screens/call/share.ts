/**
 * **L'écran que le correspondant partage** (ADR 0005, D11).
 *
 * Recevoir un partage ne demande aucune capacité particulière — c'est tout
 * l'intérêt : le poste qui ne sait pas capturer un écran sait parfaitement
 * en afficher un. Ce qui se joue ici n'est donc pas une négociation, c'est
 * une **mise en scène**, et elle tient en trois règles :
 *
 * - **`object-fit: contain`, jamais `cover`.** Recadrer un écran partagé
 *   coupe du texte — c'est-à-dire tout ce qu'il transportait ;
 * - **la permutation est offerte.** L'écran prend la grande surface et le
 *   visage passe en vignette ; remettre le visage en grand ne refuse pas
 *   le partage, cela le range. Pour le public de Trix, ce n'est pas un
 *   réglage d'affichage : la vidéo de l'appel est le canal de la langue des
 *   signes (F.703 §4.5 et §6.2.4), et tout ce qui l'en chasse est un acte
 *   de conversation ;
 * - **deux chemins pour un geste.** Un appui sur la vignette, et un bouton
 *   dans la barre : le geste tactile seul n'existe pas au clavier
 *   (RGAA 7.3), la même leçon que le double-clic du plein écran.
 *
 * La permutation est une bascule **locale** : rien ne part sur le fil, la
 * machine n'en sait rien, et son état vit ici — hors du DOM, comme le pavé
 * DTMF (`call/dtmf.ts`) et le repli du panneau.
 */

import type { CallView } from "../../../machines/events.js";
import { t } from "../../../i18n/index.js";
import { esc } from "../../el.js";

/**
 * **Le visage a-t-il repris la grande surface ?** Faux au départ : c'est
 * l'écran qui la prend quand il arrive, sans quoi le partage n'aurait servi
 * à rien.
 */
let swapped = false;

export function shareSwapped(): boolean {
  return swapped;
}

/**
 * La seconde surface, posée dans la zone vidéo à côté de la première. C'est
 * le **CSS** qui décide laquelle des deux occupe la scène — l'échange se
 * fait alors sans reconstruire l'écran, donc sans perdre une image.
 *
 * `muted` : l'audio de l'appel arrive par la surface principale, et un
 * second élément qui jouerait la même piste la doublerait. L'audio d'onglet
 * (`getDisplayMedia({ audio: true })`) est hors périmètre — il n'y a rien à
 * entendre ici.
 */
export function shareStage(view: CallView, peer: string): string {
  if (!view.peerSharing) return "";
  return `<video class="share" data-ref="share" autoplay playsinline muted
                 aria-label="${esc(t("share.stageAria", { peer }))}"></video>`;
}

/**
 * Câble la permutation : la vignette au doigt, le bouton au clavier. Les
 * deux mènent au même geste, et aucun ne re-rend l'écran — une classe sur
 * la zone vidéo suffit, et l'image ne cligne pas.
 */
export function wireShareStage(screen: HTMLElement): void {
  const zone = screen.querySelector<HTMLElement>('[data-ref="videozone"]');
  const share = screen.querySelector<HTMLVideoElement>('[data-ref="share"]');
  if (!zone || !share) {
    // Pas de partage dans ce rendu : la permutation n'a plus d'objet, et son
    // état ne doit pas lui survivre — sans quoi le partage suivant s'ouvrirait
    // en vignette pour avoir été permuté une fois, dix minutes plus tôt. C'est
    // la fin du partage **et** la fin de l'appel, en une seule ligne.
    swapped = false;
    return;
  }
  const remote = screen.querySelector<HTMLVideoElement>('[data-ref="remote"]');
  const buttons = [...screen.querySelectorAll<HTMLElement>('[data-act="swap-stage"]')];

  const apply = (next: boolean): void => {
    swapped = next;
    zone.classList.toggle("swapped", next);
    for (const b of buttons) {
      b.setAttribute("aria-pressed", String(next));
      const label = t(next ? "ctrl.swap.screen" : "ctrl.swap.face");
      b.title = label;
      const slot = b.querySelector(".cmd-label");
      if (slot) slot.textContent = label;
      b.classList.toggle("toggled", next);
    }
  };

  for (const b of buttons) b.addEventListener("click", () => apply(!swapped));
  // un appui sur la **vignette** la met en grand : c'est celle des deux
  // surfaces qui n'a pas la scène, et elle change avec la permutation
  share.addEventListener("click", () => {
    if (swapped) apply(false);
  });
  remote?.addEventListener("click", () => {
    if (!swapped) apply(true);
  });

  // le rendu vient de reconstruire l'écran : la scène reprend l'ordre
  // qu'elle avait, sans que personne n'ait rien demandé
  apply(swapped);
}
