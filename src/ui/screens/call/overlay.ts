/**
 * Commandes média en surimpression sur la scène vidéo (maquette 1b/1c/1f),
 * et **les deux axes** de l'ADR 0003 (D6).
 *
 * Les deux vues partagent la même barre : la vue mobile la pratiquait déjà,
 * la vue bureau rangeait les mêmes commandes dans sa sidebar. Deux gabarits
 * pour un seul geste, c'était deux occasions de diverger.
 *
 * # Les deux axes
 *
 * F.703 §6.2.4 exige *la fonction* — pouvoir empêcher temporairement son
 * terminal d'émettre — jamais deux boutons, et elle **groupe l'audio et la
 * vidéo dans la même phrase**. Le vrai risque n'était pas de supprimer la
 * sourdine : c'était de la remplacer par un geste qui ressemble à un
 * contrôle média sans en être un. Deux gestes de même forme sur le même axe,
 * et personne ne les distingue. D'où deux axes, et jamais deux gestes sur le
 * même :
 *
 * - **axe 1 — de quoi l'appel est fait.** Deux boutons dans la pastille,
 *   audio et vidéo, strictement symétriques : chacun ajoute ou retire son
 *   média par re-INVITE, et le correspondant le voit. C'est l'expérience
 *   primaire de la conversation totale, et elle ne partage sa place avec
 *   rien ;
 * - **axe 2 — est-ce que je suis là, à l'instant.** Un seul bouton, hors de
 *   la pastille, qui coupe d'un coup tout ce que j'émets. C'est la Pause,
 *   §6.2.4 pris au mot : une fonction, un geste, les deux médias ensemble.
 *
 * Rien ne les distingue sur la même dimension — ni le nombre, ni la place,
 * ni la forme, ni ce dont ils parlent — et c'est ce qui garantit qu'on ne
 * les confondra pas.
 *
 * # Règle d'état, tenue ici et nulle part ailleurs
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
import { isLastMedia, type MediaKind } from "../../../sip/port.js";
import type { MsgKey } from "../../../i18n/types.js";
import { ICONS, ICONS_OFF } from "./parts.js";
import { panelIcon, panelToggleLabel } from "./panel.js";
import { DTMF_PAD_ID, dtmfOpen } from "./dtmf.js";
import { MORE_ICON, SHEET_ID, bottomSheet, sheetOpen } from "./sheet.js";
import { LENS_ICON } from "./stats.js";
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
  /**
   * Ce qui allume le bouton, quand « déployé » et « allumé » ne se
   * répondent pas : le panneau latéral s'annonce **replié**, le clavier
   * DTMF s'annonce **ouvert**. Sans cela, l'un des deux serait allumé au
   * repos, et une barre de commandes qui s'allume toute seule ne veut plus
   * rien dire.
   */
  highlight?: boolean;
  cut?: boolean; // flux coupé → rouge, sinon bascule locale → violet
  disabled?: boolean;
  /**
   * La commande **peut** descendre dans la feuille du bas quand la place
   * manque (D8). Ce qui ne le peut pas — l'audio et la vidéo, les deux
   * boutons de l'axe 1 — n'a pas ce drapeau : ils sont l'expérience
   * primaire de la conversation totale, et ne partagent leur place avec
   * rien.
   */
  sheetable?: boolean;
}

/**
 * Un bouton de commande. Le libellé accompagne **toujours** l'icône dans le
 * balisage : masqué par le CSS dans la pastille, visible dans la feuille du
 * bas. C'est ce qui permet à une commande de passer de l'une à l'autre sans
 * être reconstruite — la promotion d'un haut-parleur coupé (règle 1 de D8)
 * n'est alors qu'un déplacement de nœud.
 */
function button(c: Cmd): string {
  const active = c.highlight ?? (c.expanded !== undefined ? !c.expanded : c.pressed);
  const cls = active ? (c.cut ? "off" : "toggled") : "";
  const state =
    c.expanded !== undefined
      ? `aria-expanded="${c.expanded}" ${c.controls ? `aria-controls="${c.controls}"` : ""}`
      : `aria-pressed="${c.pressed ?? false}"`;
  return `<button class="iconbtn ${cls}" data-act="${c.act}" ${c.disabled ? "disabled" : ""}
                  title="${esc(c.label)}" aria-label="${esc(c.aria)}" ${state}>
            <span class="cmd-icon">${c.icon}</span><span class="cmd-label">${esc(c.label)}</span>
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
  /**
   * Mobile : bouton de pli du tchat, faute de sidebar pour l'accueillir.
   * Absent quand l'appel ne porte pas de canal texte du tout — il n'y a
   * alors rien à promettre ni à retirer.
   *
   * `unavailable` est l'autre cas : l'appel portait un canal, et le texte
   * n'a pas été négocié (§4.9). Le bouton **reste**, barré et inactif,
   * comme le micro et la caméra le sont quand leur média n'est pas là — le
   * faire disparaître laisserait croire que ce poste n'a jamais eu de tchat.
   */
  chat?: { open: boolean; controls: string; unavailable?: boolean };
  /**
   * **La barre mobile (D8).** Quatre icônes dans la pastille, le reste dans
   * la feuille du bas, la Pause et le raccrochage dehors. Le bureau ne
   * change pas : la sidebar a la place, et la barre y reste ce qu'elle
   * était.
   */
  compact?: boolean;
  /**
   * Le bilan média a de quoi s'afficher — l'appel est en communication et la
   * trace est cochée (§5.4). La feuille y mène ; la pastille d'état de la
   * barre haute reste l'autre chemin, celui du survol et du focus.
   */
  withStats?: boolean;
}

/** Combien d'icônes la pastille mobile porte (D8) : le calcul de place en dépend. */
const PILL_SLOTS = 4;

/** Ce que chaque média met dans son bouton : les deux jeux sont parallèles. */
const MEDIA_UI: Record<MediaKind, { on: string; off: string; aria: MsgKey; add: MsgKey; remove: MsgKey; pending: MsgKey; last: MsgKey }> = {
  audio: {
    on: ICONS.mic,
    off: ICONS_OFF.mic,
    aria: "ctrl.mic.aria",
    add: "ctrl.mic.add",
    remove: "ctrl.mic.remove",
    pending: "ctrl.media.pending",
    last: "ctrl.media.last",
  },
  video: {
    on: ICONS.cam,
    off: ICONS_OFF.cam,
    aria: "ctrl.cam.aria",
    add: "ctrl.cam.add",
    remove: "ctrl.cam.remove",
    pending: "ctrl.media.pending",
    last: "ctrl.media.last",
  },
};

/**
 * **Axe 1** : un bouton par média, et les deux exactement pareils (ADR
 * 0003, D6). Chacun ajoute son média à l'appel ou l'en retire, par
 * re-INVITE, et le correspondant le voit passer — ce n'est pas une
 * sourdine, et l'icône barrée dit « l'appel n'a pas ce média », non
 * « je me suis tu ».
 *
 * Trois raisons de le griser, et une seule est propre au média : la
 * renégociation en vol et la question posée par le distant valent pour les
 * deux (un seul verrou, D5) ; **retirer le dernier média** ne se refuse que
 * pour celui qui est le dernier. L'invariant lui-même vit dans le bloc
 * (`isLastMedia`) — ici on ne fait qu'en griser le bouton.
 */
function mediaButton(ctx: OverlayCtx, kind: MediaKind, on: boolean): Cmd {
  const { view } = ctx;
  const connected = view.state === "connected";
  const ui = MEDIA_UI[kind];
  const last = on && isLastMedia(view.media, kind);
  return {
    act: `toggle-${kind}`,
    icon: on ? ui.on : ui.off,
    label: t(view.mediaPending ? ui.pending : last ? ui.last : on ? ui.remove : ui.add),
    aria: t(ui.aria),
    pressed: !on,
    cut: true,
    disabled: !connected || view.mediaPending || view.mediaAsked !== null || last,
  };
}

export function overlayBar(ctx: OverlayCtx): string {
  const { view, speakerMuted } = ctx;
  const connected = view.state === "connected";
  const video = connected && view.media.video;

  const cmds: Cmd[] = [
    mediaButton(ctx, "audio", connected && view.media.audio),
    mediaButton(ctx, "video", video),
    {
      // hors des deux axes : c'est de la réception locale, et le §6.2.4 n'en
      // parle pas. Sa place est donc la feuille — sauf coupé, où la règle 1
      // le fait remonter (voir `dispatch`)
      act: "speaker",
      icon: speakerMuted ? ICONS_OFF.speaker : ICONS.speaker,
      label: t(speakerMuted ? "ctrl.speaker.unmute" : "ctrl.speaker.mute"),
      aria: t("ctrl.speaker.aria"),
      pressed: speakerMuted,
      cut: true,
      disabled: !connected,
      sheetable: true,
    },
    {
      act: "selfview",
      icon: view.selfViewHidden ? ICONS_OFF.selfview : ICONS.selfview,
      label: t(view.selfViewHidden ? "ctrl.selfview.show" : "ctrl.selfview.hide"),
      aria: t("ctrl.selfview.aria"),
      pressed: view.selfViewHidden,
      disabled: !video,
      sheetable: true,
    },
    {
      // le pavé déployé est un affichage local de plus, comme le self-view :
      // violet, et jamais rouge — rien n'est coupé quand il est ouvert
      act: "dtmf",
      icon: ICONS.dtmf,
      label: t(dtmfOpen() ? "ctrl.dtmf.hide" : "ctrl.dtmf.show"),
      aria: t("ctrl.dtmf.aria"),
      expanded: connected && dtmfOpen(),
      highlight: connected && dtmfOpen(),
      controls: DTMF_PAD_ID,
      disabled: !connected,
      sheetable: true,
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
      sheetable: true,
    });
  }

  if (ctx.withStats) {
    // rien à basculer, rien à couper : la feuille est sa seule place, et
    // c'est l'entrée qui justifie le mieux les libellés — « statistiques »
    // ne se devine dans aucune icône
    cmds.push({
      act: "stats-open",
      icon: LENS_ICON,
      label: t("stats.title"),
      aria: t("stats.title"),
      sheetable: true,
    });
  }

  if (ctx.chat?.unavailable) {
    // le texte n'a pas été négocié : rien à déplier, et le dire est le seul
    // service que ce bouton puisse encore rendre. Barré et grisé — et non
    // rouge : rien n'a été coupé ici, le distant n'a simplement pas suivi,
    // ce qui n'est pas un geste à défaire
    cmds.push({
      act: "chat",
      icon: ICONS_OFF.chat,
      label: t("ctrl.chat.unavailable"),
      aria: t("ctrl.chat.aria"),
      disabled: true,
    });
  } else if (ctx.chat) {
    // le tchat déployé est un affichage local de plus, comme le pavé DTMF :
    // violet, jamais rouge — rien n'est coupé quand il est ouvert
    cmds.push({
      act: "chat",
      icon: ICONS.chat,
      label: t(ctx.chat.open ? "ctrl.chat.hide" : "ctrl.chat.show"),
      aria: t("ctrl.chat.aria"),
      expanded: ctx.chat.open,
      highlight: ctx.chat.open,
      controls: ctx.chat.controls,
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

  if (!ctx.compact) {
    // La Pause est **hors de la pastille sur les deux gabarits** : c'est
    // l'axe 2 (D6), et il ne se confond avec les commandes média sur aucun
    // écran. Ce que D8 réserve au mobile est le remaniement pastille /
    // feuille, pas l'existence du geste — un bureau sans Pause laisserait
    // sans recours quelqu'un à qui l'on sonne à la porte.
    return `<div class="overlaybar ${ctx.view.paused ? "dimmed" : ""}">
              <div class="overlay-pill">${cmds.map(button).join("")}</div>
              ${pauseButton(view)}
              ${hangup}
            </div>`;
  }

  const { pill, promoted, sheet } = dispatch(cmds);
  // En pause, l'écran entier le dit et « Reprendre » est le seul geste
  // offert (D7) : les commandes média s'éteignent derrière le bandeau. Le
  // raccrochage, lui, reste — un geste d'urgence ne se suspend pas.
  const dimmed = ctx.view.paused ? "dimmed" : "";
  return `<div class="overlaybar compact ${dimmed} ${promoted.length > 0 ? "crowded" : ""}">
            <div class="overlay-pill">
              ${pill.map(button).join("")}
              ${moreButton(sheet.length > 0)}
              ${promoted.map(button).join("")}
            </div>
            <span class="bar-break" aria-hidden="true"></span>
            ${pauseButton(view)}
            ${hangup}
          </div>
          ${bottomSheet(sheet.map(button).join(""))}`;
}

/**
 * Qui va dans la pastille, qui va dans la feuille (D8).
 *
 * Trois places sur quatre sont écrites d'avance : **audio**, **vidéo** — les
 * deux boutons de l'axe 1, qui ne descendent jamais — et le **« ⋯ »**. La
 * troisième revient à la première commande qui n'est pas descendable : le
 * tchat quand l'appel en porte un panneau à plier, faute de quoi la place
 * échoit au haut-parleur, qui est justement la commande la plus utile d'un
 * appel sans image.
 *
 * Puis la **règle 1 : un état coupé ne se cache jamais.** Toute commande
 * *coupée* (rouge) que la feuille aurait prise remonte dans la pastille, qui
 * porte alors cinq icônes — le CSS lui donne sa seconde ligne (`crowded`)
 * plutôt que de rogner une cible sous 44 px. En pratique cela ne concerne
 * que le haut-parleur : c'est le seul membre de la feuille qui coupe quoi
 * que ce soit, et c'est pourquoi rien d'autre ne peut y tomber.
 *
 * Ce qui bouge en cours d'appel — le tchat qui monte quand la vidéo entre —
 * n'est pas un remaniement silencieux : c'est la conséquence visible d'un
 * changement de nature de l'appel, que l'utilisateur vient de demander ou
 * d'accepter. La règle 2 vise ce qui bouge **sans qu'on ait rien fait**.
 */
function dispatch(cmds: Cmd[]): { pill: Cmd[]; promoted: Cmd[]; sheet: Cmd[] } {
  const pill: Cmd[] = [];
  const sheet: Cmd[] = [];
  for (const c of cmds) {
    // le « ⋯ » occupe la dernière place : la pastille n'en garde que trois
    if (c.sheetable !== true && pill.length < PILL_SLOTS - 1) pill.push(c);
    else sheet.push(c);
  }
  // la troisième place revient au haut-parleur quand rien d'autre ne l'a prise
  while (pill.length < PILL_SLOTS - 1 && sheet.length > 0) pill.push(sheet.shift()!);

  // Règle 1 : ce qui est coupé remonte, quoi qu'il en coûte à la largeur. Le
  // promu se pose **après** le « ⋯ », en queue de pastille : les quatre
  // places de tête ne bougent pas d'un pixel sous le pouce, et c'est aussi
  // là que `promoteIfCut` (parts.ts) le pose quand la promotion arrive en
  // cours d'appel, sans re-rendre l'écran.
  const promoted = sheet.filter((c) => c.cut === true && c.pressed === true);
  return { pill, promoted, sheet: sheet.filter((c) => !promoted.includes(c)) };
}

/** Le « ⋯ » : la dernière place de la pastille, et la porte de la feuille. */
function moreButton(enabled: boolean): string {
  return `<button class="iconbtn more" data-act="more" ${enabled ? "" : "disabled"}
                  title="${esc(t("ctrl.more"))}" aria-label="${esc(t("ctrl.more"))}"
                  aria-expanded="${enabled && sheetOpen()}" aria-controls="${SHEET_ID}">
            <span class="cmd-icon">${MORE_ICON}</span>
          </button>`;
}

/**
 * **Axe 2.** Hors de la pastille, près du raccrochage, carré arrondi et
 * cerclé d'ambre : rien de ce qui le distingue des boutons média ne se joue
 * sur la même dimension qu'eux (D6). Il parle de moi, pas de l'appel, et il
 * ne change rien à sa nature — le temps d'une pause.
 *
 * Un **appel texte seul n'en a pas** : il n'y a rien à suspendre, et le
 * texte, lui, ne se coupe jamais (D7) — une pause qui couperait le texte
 * reviendrait, pour un usager sourd, à raccrocher sans le dire.
 *
 * Il n'est jamais grisé pendant la communication, pas même en pleine
 * renégociation : un geste qui doit être instantané ne peut pas dépendre de
 * l'issue d'un aller-retour SIP.
 */
function pauseButton(view: CallView): string {
  if (!view.media.audio && !view.media.video) return "";
  const connected = view.state === "connected";
  const label = t(view.paused ? "ctrl.resume" : "ctrl.pause");
  return `<button class="pause-btn ${view.paused ? "on" : ""}" data-act="pause"
                  ${connected ? "" : "disabled"}
                  title="${esc(label)}" aria-label="${esc(t("ctrl.pause.aria"))}"
                  aria-pressed="${view.paused}">${PAUSE_ICON}</button>`;
}

/** Deux barres : le signe universel de la suspension, jamais celui de l'arrêt. */
const PAUSE_ICON = `<svg class="icon" viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/></svg>`;
