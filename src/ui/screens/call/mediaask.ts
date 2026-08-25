/**
 * « Alice souhaite ajouter la vidéo » — la popup de décision, en cours de
 * communication.
 *
 * Le distant a envoyé un re-INVITE qui **ajoute un média**. Accepter allume
 * un capteur — micro ou caméra, la question est la même (ADR 0003, D5) :
 * cela ne se décide pas sans son propriétaire, et le port SIP laisse donc
 * la réponse en suspens le temps de la question (le re-INVITE a déjà reçu
 * son 100 Trying, l'appelant patiente).
 *
 * Même gabarit modal que l'appel entrant (`incoming.ts`), à ceci près que
 * le reste de l'écran **n'est pas** rendu `inert` : la conversation
 * continue pendant qu'on réfléchit, et raccrocher doit rester possible.
 */

import type { CallView } from "../../../machines/events.js";
import type { MediaKind } from "../../../sip/port.js";
import { esc } from "../../el.js";
import { ICONS, callerName } from "./parts.js";
import { t } from "../../../i18n/index.js";
import type { MsgKey } from "../../../i18n/types.js";

/**
 * Comment la question se pose, selon ce que le distant ajoute. Trois
 * formes, et non une phrase à trous : ajouter les deux d'un coup n'est pas
 * « ajouter l'audio » deux fois, et le titre doit le dire d'un trait dans
 * les six langues.
 */
const ASK: Record<"audio" | "video" | "both", { icon: string; title: MsgKey; body: MsgKey; accept: MsgKey }> = {
  audio: {
    icon: ICONS.mic,
    title: "mediaask.audio.title",
    body: "mediaask.audio.body",
    accept: "mediaask.audio.accept",
  },
  video: {
    icon: ICONS.cam,
    title: "mediaask.video.title",
    body: "mediaask.video.body",
    accept: "mediaask.video.accept",
  },
  both: {
    icon: ICONS.cam,
    title: "mediaask.both.title",
    body: "mediaask.both.body",
    accept: "mediaask.both.accept",
  },
};

/** Laquelle des trois questions poser, d'après ce que l'offre ajoute. */
function askFor(adds: readonly MediaKind[]): (typeof ASK)[keyof typeof ASK] {
  if (adds.length > 1) return ASK.both;
  return ASK[adds[0] ?? "video"];
}

export function mediaAskDialog(view: CallView): string {
  const ask = askFor(view.mediaAsked ?? []);
  return `<div class="incoming-veil mediaask-veil">
    <div class="incoming-dialog mediaask" data-ref="mediaask" role="dialog" aria-modal="false"
         aria-labelledby="mediaask-title">
      <span class="ring-badge" aria-hidden="true">${ask.icon}</span>
      <h2 class="who" id="mediaask-title">${esc(t(ask.title, { peer: callerName(view) }))}</h2>
      <span class="uri">${esc(t(ask.body))}</span>
      <div class="incoming-actions">
        <button class="btn answer" data-act="accept-media">
          ${ask.icon} ${esc(t(ask.accept))}
        </button>
        <button class="btn" data-act="reject-media">${esc(t("mediaask.reject"))}</button>
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
export function wireMediaAsk(screen: HTMLElement, onReject: () => void): void {
  const dialog = screen.querySelector<HTMLElement>('[data-ref="mediaask"]');
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
export function closeMediaAsk(): void {
  focusedAct = null;
}
