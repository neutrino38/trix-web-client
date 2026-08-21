/**
 * Commandes média en surimpression sur la scène vidéo (maquette 1b/1c/1f).
 *
 * Les deux vues partagent désormais **la même** barre : la vue mobile la
 * pratiquait déjà, la vue bureau rangeait les mêmes commandes dans sa sidebar.
 * Deux gabarits pour un seul geste, c'était deux occasions de diverger.
 *
 * Règle d'état, tenue ici et nulle part ailleurs :
 *
 * - **rouge + icône barrée** — un flux est coupé (micro, caméra, haut-parleur) :
 *   quelque chose ne passe plus, et le correspondant s'en aperçoit ;
 * - **violet** — une bascule d'affichage purement locale (self-view masqué) :
 *   rien n'est coupé, personne d'autre n'est concerné.
 *
 * Dans les deux cas l'icône barrée et `aria-pressed` portent déjà l'état : la
 * couleur ne fait que le confirmer (RGAA 3.1).
 */

import type { CallView } from "../../../machines/events.js";
import { ICONS, ICONS_OFF } from "./parts.js";
import { panelIcon, panelToggleLabel } from "./panel.js";
import { t } from "../../../i18n/index.js";
import { esc } from "../../el.js";

interface Cmd {
  act: string;
  icon: string;
  label: string; // ce que fait le bouton **maintenant** — pas son état
  aria: string; // intitulé stable, pour ne pas dérouter la navigation vocale
  pressed?: boolean;
  /**
   * Bouton qui montre ou masque une région de l'écran : `aria-expanded`, et
   * non `aria-pressed`. Les deux sur le même bouton se contrediraient —
   * « enfoncé » y voudrait dire « replié », donc « non déployé ».
   */
  expanded?: boolean;
  controls?: string; // id de la région, quand il y a `expanded`
  cut?: boolean; // flux coupé → rouge, sinon bascule locale → violet
  disabled?: boolean;
}

function button(c: Cmd): string {
  const active = c.expanded !== undefined ? !c.expanded : c.pressed;
  const cls = active ? (c.cut ? "off" : "toggled") : "";
  const state =
    c.expanded !== undefined
      ? `aria-expanded="${c.expanded}" ${c.controls ? `aria-controls="${c.controls}"` : ""}`
      : `aria-pressed="${c.pressed ?? false}"`;
  return `<button class="iconbtn ${cls}" data-act="${c.act}" ${c.disabled ? "disabled" : ""}
                  title="${esc(c.label)}" aria-label="${esc(c.aria)}" ${state}>
            ${c.icon}
          </button>`;
}

export interface OverlayCtx {
  view: CallView;
  speakerMuted: boolean;
  /**
   * Raccrocher rejoint la barre : toujours sur mobile, faute de sidebar pour
   * l'accueillir ; sur bureau dès que le panneau peut se replier — c'est le
   * CSS qui le révèle alors, puisque replier ne re-rend pas l'écran.
   */
  withHangup?: boolean;
  /** Le plein écran n'a de sens que là où la vidéo n'occupe pas déjà l'écran. */
  withFullscreen?: boolean;
  /** Bureau : bouton de repli du panneau latéral, en fin de barre. */
  panel?: { collapsed: boolean; controls: string };
}

export function overlayBar(ctx: OverlayCtx): string {
  const { view, speakerMuted } = ctx;
  const connected = view.state === "connected";
  const video = connected && view.media.video;

  const cmds: Cmd[] = [
    {
      act: "muteMic",
      icon: view.micMuted ? ICONS_OFF.mic : ICONS.mic,
      label: t(view.micMuted ? "ctrl.mic.unmute" : "ctrl.mic.mute"),
      aria: t("ctrl.mic.aria"),
      pressed: view.micMuted,
      cut: true,
      disabled: !connected,
    },
    {
      // en conversation totale, la caméra n'est pas une sourdine : elle
      // ajoute la vidéo à l'appel ou l'en retire, et le distant le voit
      // passer (docs/CONCEPTION.md §4.4). Barrée, elle dit que l'appel n'a pas
      // de vidéo — et qu'un clic l'y mettrait.
      act: "toggleVideo",
      icon: video ? ICONS.cam : ICONS_OFF.cam,
      label: t(
        view.videoPending ? "ctrl.cam.pending" : video ? "ctrl.cam.remove" : "ctrl.cam.add",
      ),
      aria: t("ctrl.cam.aria"),
      pressed: !video,
      cut: true,
      // pendant qu'une offre est en vol, le second clic n'a nulle part où
      // aller : une renégociation à la fois
      disabled: !connected || view.videoPending || view.videoAsked,
    },
    {
      act: "selfview",
      icon: view.selfViewHidden ? ICONS_OFF.selfview : ICONS.selfview,
      label: t(view.selfViewHidden ? "ctrl.selfview.show" : "ctrl.selfview.hide"),
      aria: t("ctrl.selfview.aria"),
      pressed: view.selfViewHidden,
      disabled: !video,
    },
    {
      act: "speaker",
      icon: speakerMuted ? ICONS_OFF.speaker : ICONS.speaker,
      label: t(speakerMuted ? "ctrl.speaker.unmute" : "ctrl.speaker.mute"),
      aria: t("ctrl.speaker.aria"),
      pressed: speakerMuted,
      cut: true,
      disabled: !connected,
    },
    {
      act: "dtmf",
      icon: ICONS.dtmf,
      label: t("ctrl.dtmf.label"),
      aria: t("ctrl.dtmf.aria"),
      disabled: true,
    },
  ];

  if (ctx.withFullscreen) {
    // le double-clic sur la vidéo reste, mais il ne peut pas être le seul
    // chemin : au clavier il n'existe pas (RGAA 7.3)
    cmds.push({
      act: "fullscreen",
      icon: ICONS.fullscreen,
      label: t("ctrl.fullscreen"),
      aria: t("ctrl.fullscreen"),
      disabled: !view.media.video,
    });
  }

  if (ctx.panel) {
    cmds.push({
      act: "panel",
      icon: panelIcon(ctx.panel.collapsed),
      label: panelToggleLabel(ctx.panel.collapsed),
      aria: t("panel.aria"),
      expanded: !ctx.panel.collapsed,
      controls: ctx.panel.controls,
    });
  }

  const hangup = ctx.withHangup
    ? `<button class="hangup-round ${view.state === "hangingup" ? "inactive" : ""}"
               data-act="hangup" ${view.state === "hangingup" ? "disabled" : ""}
               aria-label="${esc(t("ctrl.hangup"))}">${ICONS.hangup}</button>`
    : "";

  return `<div class="overlaybar">
            <div class="overlay-pill">${cmds.map(button).join("")}</div>
            ${hangup}
          </div>`;
}
