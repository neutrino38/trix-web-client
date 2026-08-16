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

interface Cmd {
  act: string;
  icon: string;
  label: string; // ce que fait le bouton **maintenant** — pas son état
  aria: string; // intitulé stable, pour ne pas dérouter la navigation vocale
  pressed?: boolean;
  cut?: boolean; // flux coupé → rouge, sinon bascule locale → violet
  disabled?: boolean;
}

function button(c: Cmd): string {
  const cls = c.pressed ? (c.cut ? "off" : "toggled") : "";
  return `<button class="iconbtn ${cls}" data-act="${c.act}" ${c.disabled ? "disabled" : ""}
                  title="${c.label}" aria-label="${c.aria}" aria-pressed="${c.pressed ?? false}">
            ${c.icon}
          </button>`;
}

export interface OverlayCtx {
  view: CallView;
  speakerMuted: boolean;
  /** Mobile : Raccrocher rejoint la barre, faute de sidebar pour l'accueillir. */
  withHangup?: boolean;
  /** Le plein écran n'a de sens que là où la vidéo n'occupe pas déjà l'écran. */
  withFullscreen?: boolean;
}

export function overlayBar(ctx: OverlayCtx): string {
  const { view, speakerMuted } = ctx;
  const connected = view.state === "connected";
  const video = connected && view.media.video;

  const cmds: Cmd[] = [
    {
      act: "muteMic",
      icon: view.micMuted ? ICONS_OFF.mic : ICONS.mic,
      label: view.micMuted ? "Rétablir le micro" : "Couper le micro",
      aria: "Micro",
      pressed: view.micMuted,
      cut: true,
      disabled: !connected,
    },
    {
      act: "muteCam",
      icon: view.camMuted ? ICONS_OFF.cam : ICONS.cam,
      label: view.camMuted ? "Rétablir la caméra" : "Couper la caméra",
      aria: "Caméra",
      pressed: view.camMuted,
      cut: true,
      disabled: !video,
    },
    {
      act: "selfview",
      icon: view.selfViewHidden ? ICONS_OFF.selfview : ICONS.selfview,
      label: view.selfViewHidden ? "Afficher le self-view" : "Masquer le self-view",
      aria: "Self-view",
      pressed: view.selfViewHidden,
      disabled: !video,
    },
    {
      act: "speaker",
      icon: speakerMuted ? ICONS_OFF.speaker : ICONS.speaker,
      label: speakerMuted ? "Rétablir le son" : "Couper le son",
      aria: "Haut-parleur",
      pressed: speakerMuted,
      cut: true,
      disabled: !connected,
    },
    {
      act: "dtmf",
      icon: ICONS.dtmf,
      label: "Clavier DTMF — disponible en phase 4",
      aria: "Clavier DTMF",
      disabled: true,
    },
  ];

  if (ctx.withFullscreen) {
    // le double-clic sur la vidéo reste, mais il ne peut pas être le seul
    // chemin : au clavier il n'existe pas (RGAA 7.3)
    cmds.push({
      act: "fullscreen",
      icon: ICONS.fullscreen,
      label: "Plein écran",
      aria: "Plein écran",
      disabled: !view.media.video,
    });
  }

  const hangup = ctx.withHangup
    ? `<button class="hangup-round ${view.state === "hangingup" ? "inactive" : ""}"
               data-act="hangup" ${view.state === "hangingup" ? "disabled" : ""}
               aria-label="Raccrocher">${ICONS.hangup}</button>`
    : "";

  return `<div class="overlaybar">
            <div class="overlay-pill">${cmds.map(button).join("")}</div>
            ${hangup}
          </div>`;
}
