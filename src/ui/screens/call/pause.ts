/**
 * La Pause, telle qu'elle se voit (ADR 0003, D6 et D7).
 *
 * Deux affichages, et ils ne disent pas la même chose :
 *
 * - **le bandeau**, quand c'est moi qui suis en pause. L'écran entier le
 *   dit, les commandes média s'éteignent derrière, et « Reprendre » est le
 *   seul geste offert. C'est ce qui supprime le « tu étais en sourdine » —
 *   mieux qu'une icône rouge de 44 px, qu'on cesse de voir au bout de dix
 *   secondes ;
 * - **l'avis**, quand c'est le correspondant. Sa piste arrêtée passe `muted`
 *   chez nous : on affiche « Emmanuel est en pause » à la place de l'image
 *   figée qu'on verrait sinon. C'est exactement l'*avis explicite* que
 *   F.703 §6.2.4 réclame pour une vidéo suspendue, rendu par le récepteur.
 *
 * Aucun des deux ne passe par SIP, et c'est tout le principe : la pause est
 * locale, instantanée, et ne peut pas échouer (D7).
 */

import type { CallView } from "../../../machines/events.js";
import { callerName } from "./parts.js";
import { esc } from "../../el.js";
import { t } from "../../../i18n/index.js";

/** Deux barres : le signe de la suspension, jamais celui de l'arrêt. */
const PAUSE_GLYPH = `<svg class="icon" viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/></svg>`;

/**
 * Le bandeau de ma propre pause. Posé sur la scène, au-dessus de tout ce
 * qu'elle porte — sauf du bandeau clignotant d'appel entrant, qui reste le
 * signal le plus fort de l'application.
 *
 * `role="status"` et non `alert` : c'est un état que l'utilisateur vient de
 * demander, pas une nouvelle qui lui tombe dessus. Un lecteur d'écran
 * l'annonce sans interrompre ce qu'il était en train de lire.
 *
 * Le rappel sur le texte n'est pas décoratif : c'est ce qui distingue la
 * Pause d'un raccrochage pour qui n'entend pas — le fil continue de passer
 * dans les deux sens, et c'est là qu'on écrit « deux minutes ».
 */
export function pauseBanner(view: CallView): string {
  if (!view.paused) return "";
  return `<div class="pause-banner" data-ref="pause-banner" role="status">
    <span class="pause-badge" aria-hidden="true">${PAUSE_GLYPH}</span>
    <h2>${esc(t("pause.banner"))}</h2>
    <p>${esc(t("pause.hint"))}</p>
    <button class="btn answer" data-act="pause">${esc(t("pause.resume"))}</button>
  </div>`;
}

/**
 * L'avis de la pause du correspondant, à la place de son image. Discret —
 * ce n'est pas mon état, et je n'ai rien à décider : il reviendra.
 *
 * Il s'affiche que l'appel porte l'image ou non : sur un appel audio, c'est
 * la seule façon de comprendre pourquoi le silence dure.
 */
export function peerPauseNotice(view: CallView): string {
  if (!view.peerPaused || view.state !== "connected") return "";
  return `<div class="peer-paused" data-ref="peer-paused" role="status">
    <span aria-hidden="true">${PAUSE_GLYPH}</span>
    <span>${esc(t("pause.peer", { peer: callerName(view) }))}</span>
  </div>`;
}
