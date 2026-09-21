/**
 * Briques communes aux deux vues de l'écran d'appel (bureau et mobile) :
 * libellés, icônes, registre des modes d'appel, rendu de l'historique,
 * et surtout `wireCallScreen` — le câblage des événements.
 *
 * Le câblage est piloté par les attributs `data-act` / `data-ref` et
 * tolère l'absence de chaque élément : les deux templates peuvent donc
 * omettre ce qu'ils veulent sans qu'aucun `if (mobile)` n'apparaisse ici
 * ni là-bas. C'est ce qui permet de garder **une seule** PhoneMachine.
 */

import type { PhoneInstance } from "../../../machines/phone.js";
import type { CallView } from "../../../machines/events.js";
import type { CallLogEntry } from "../../../storage/store.js";
import { MEDIA_KINDS, type CallMedia } from "../../../sip/port.js";
import type { RttTransport } from "../../../sip/rtt.js";
import type { AccountConfig, StoredAccount } from "../../../storage/store.js";
import { normalizeTarget } from "../../../sip/uri.js";
import { el, esc } from "../../el.js";
import { startIncomingAlert, stopIncomingAlert } from "../../alert.js";
import { startRingback, stopRingback } from "../../ring.js";
import { audioLevel, barHeight } from "../../vumeter.js";
import { hideToast, showToast } from "../../toast.js";
import { bumpFont, getCallModeId, setCallModeId } from "../../prefs.js";
import { announce } from "../../announce.js";
import { SCROLL_ICON, showTraceDialog } from "../../tracedialog.js";
import { CHAT_LOG_ICON, showChatDialog } from "../../chatdialog.js";
import { setStateTitle } from "../../title.js";
import {
  discardedEpisode,
  dismissDiscardNotice,
  dismissPinHint,
  pinHintDue,
  reachSentence,
} from "../../reachability.js";
import { wirePanel } from "./panel.js";
import { wireDtmf } from "./dtmf.js";
import { wireChat } from "./chat.js";
import { wireShareStage } from "./share.js";
import { LENS_ICON, showStatsDialog, startMediaStats } from "./stats.js";
import { formatDayMonth, formatTime, t, tn } from "../../../i18n/index.js";
import type { MsgKey } from "../../../i18n/types.js";

/**
 * État du téléphone : la **clé** du libellé, pas le libellé. Ces tables
 * sont des constantes de module, évaluées une fois à l'import — y figer
 * une traduction la rendrait sourde au changement de langue, qui ne
 * recharge que les écrans. Les deux accesseurs ci-dessous résolvent au
 * moment du rendu.
 */
export const STATUS: Record<string, { key: MsgKey; cls: "ok" | "warn" | "err" }> = {
  connecting: { key: "status.connecting", cls: "warn" },
  registering: { key: "status.registering", cls: "warn" },
  ready: { key: "status.ready", cls: "ok" },
  in_call: { key: "status.ready", cls: "ok" },
  reconnecting: { key: "status.reconnecting", cls: "err" },
  switching: { key: "status.switching", cls: "warn" },
  sleeping: { key: "status.sleeping", cls: "warn" },
  reg_failed: { key: "status.regFailed", cls: "err" },
  unregistering: { key: "status.unregistering", cls: "warn" },
};

/** L'état du téléphone tel qu'il s'affiche : libellé traduit + couleur. */
export function statusOf(state: string): { label: string; cls: "ok" | "warn" | "err" } {
  const entry = STATUS[state];
  return entry ? { label: t(entry.key), cls: entry.cls } : { label: state, cls: "warn" };
}

/**
 * Ce que la page dit de la **joignabilité** (ADR 0006, D2, D4 et D6) —
 * une phrase entière, et non une pastille de plus : « Vous ne pouvez pas
 * recevoir d'appel » se lit sans avoir appris un code de couleurs, et
 * rien n'y repose sur la couleur seule (RGAA 3.1).
 *
 * Trois choses s'y succèdent, de la plus urgente à la plus accessoire :
 * l'état présent, l'explication d'une absence qu'on vient de constater au
 * chargement, et le rappel des deux gestes qui empêchent le navigateur de
 * recommencer. Les deux dernières se masquent — elles parlent du passé —,
 * la première non : elle décrit ce qui est.
 */
export function reachBanner(phone: PhoneInstance): string {
  const notes: string[] = [];
  const sentence = reachSentence(phone.state);
  if (sentence) {
    notes.push(`<p class="reach-note err" role="status">${esc(t(sentence))}</p>`);
  }
  const gone = discardedEpisode();
  if (gone) {
    notes.push(
      note(
        t("reach.discarded", { from: formatTime(gone.from), to: formatTime(gone.to) }),
        "reach-dismiss",
      ),
    );
  }
  if (pinHintDue()) notes.push(note(t("reach.pinHint"), "pin-dismiss"));
  return `<div class="reachbar">${notes.join("")}</div>`;
}

/** Un message masquable du bandeau de joignabilité. */
function note(text: string, act: string): string {
  return `<p class="reach-note" role="status">${esc(text)}
    <button class="linkbtn" type="button" data-act="${act}">${esc(t("reach.dismiss"))}</button>
  </p>`;
}

const CALL_LABEL_KEY: Record<CallView["state"], MsgKey> = {
  dialing: "call.dialing",
  ringing: "call.ringing",
  /**
   * Le réseau parle avant le décrochage : ce libellé est le seul endroit
   * où cela existe pour qui n'entend pas. Le raisonnement est celui des
   * DTMF (§4.8) — un son que l'application ne montre pas n'a pas eu lieu.
   */
  early_media: "call.earlyMedia",
  ringing_in: "call.ringingIn",
  answering: "call.answering",
  connected: "call.connected",
  hangingup: "call.hangingup",
};

/**
 * Faut-il produire le retour d'appel local ? Oui pendant la sonnerie, et
 * encore en média précoce tant que celui-ci n'apporte pas de son (ADR 0003,
 * §4 — F.703 §6.1.2). Séparée du câblage parce que c'est une règle, et
 * qu'une règle se relit sans navigateur.
 */
export function ringbackNeeded(view: CallView): boolean {
  if (view.state === "ringing") return true;
  return view.state === "early_media" && !view.earlyMedia.audio;
}

export function callLabel(state: CallView["state"]): string {
  return t(CALL_LABEL_KEY[state]);
}

export const ICONS = {
  settings: `<svg class="icon" viewBox="0 0 24 24"><path d="M4 6h10v2H4zM17 6h3v2h-3zM13 5h2v4h-2zM4 16h3v2H4zM10 16h10v2H10zM7 15h2v4H7zM4 11h14v2H4zM19 10h1v4h-1z"/></svg>`,
  logout: `<svg class="icon" viewBox="0 0 24 24"><path d="M10 17l5-5-5-5v3H3v4h7v3zM13 3h6c1.1 0 2 .9 2 2v14c0 1.1-.9 2-2 2h-6v-2h6V5h-6V3z"/></svg>`,
  cam: `<svg class="icon" viewBox="0 0 24 24"><path d="M17 10.5V7c0-.6-.4-1-1-1H4c-.6 0-1 .4-1 1v10c0 .6.4 1 1 1h12c.6 0 1-.4 1-1v-3.5l4 4v-11l-4 4z"/></svg>`,
  selfview: `<svg class="icon" viewBox="0 0 24 24"><path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zm-2-8h-8v6h8v-6z"/></svg>`,
  speaker: `<svg class="icon" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.8-1-3.3-2.5-4v8c1.5-.7 2.5-2.2 2.5-4z"/></svg>`,
  dtmf: `<svg class="icon" viewBox="0 0 24 24"><circle cx="6" cy="5" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="6" cy="11" r="2"/><circle cx="12" cy="11" r="2"/><circle cx="18" cy="11" r="2"/><circle cx="6" cy="17" r="2"/><circle cx="12" cy="17" r="2"/><circle cx="12" cy="22" r="2"/></svg>`,
  phone: `<svg class="icon" viewBox="0 0 24 24"><path d="M6.6 10.8c1.5 3 3.6 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.3 0 .7-.2 1l-2.3 2.2z"/></svg>`,
  hangup: `<svg class="icon" viewBox="0 0 24 24" style="transform:rotate(135deg)"><path d="M6.6 10.8c1.5 3 3.6 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.3 0 .7-.2 1l-2.3 2.2z"/></svg>`,
  mic: `<svg class="icon" viewBox="0 0 24 24"><path d="M12 14c1.7 0 3-1.3 3-3V5c0-1.7-1.3-3-3-3S9 3.3 9 5v6c0 1.7 1.3 3 3 3zm5-3c0 2.8-2.2 5-5 5s-5-2.2-5-5H5c0 3.5 2.6 6.4 6 6.9V21h2v-3.1c3.4-.5 6-3.4 6-6.9h-2z"/></svg>`,
  clock: `<svg class="icon" viewBox="0 0 24 24" style="width:16px;height:16px"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 5h-2v6l5 3 1-1.7-4-2.3V7z"/></svg>`,
  fullscreen: `<svg class="icon" viewBox="0 0 24 24"><path d="M4 9V4h5v2H6v3H4zm11-5h5v5h-2V6h-3V4zM4 15h2v3h3v2H4v-5zm14 0h2v5h-5v-2h3v-3z"/></svg>`,
  chat: `<svg class="icon" viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>`,
  /**
   * **Le partage d'écran** : un moniteur et une flèche qui en sort. Elle
   * monte, et c'est ce qui la distingue d'un téléversement — ce qui part
   * de cet écran va vers l'appel.
   */
  share: `<svg class="icon" viewBox="0 0 24 24"><path d="M20 4H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h5v2h6v-2h5c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 12H4V6h16v10zm-8-9-4 4h2.5v3h3v-3H16l-4-4z"/></svg>`,
  /**
   * **La permutation de la scène** (ADR 0005, D11) : deux flèches
   * verticales, l'une qui monte et l'autre qui descend — l'écran et le
   * visage échangent leur place. À ne pas confondre avec `swap`, qui
   * change de compte : celle-là est horizontale, et elle ne parle pas de
   * l'appel.
   */
  stageSwap: `<svg class="icon" viewBox="0 0 24 24"><path d="M7 3 3 7h3v7h2V7h3L7 3zm10 18 4-4h-3v-7h-2v7h-3l4 4z"/></svg>`,
  // deux flèches qui se croisent : passer d'un compte à l'autre
  swap: `<svg class="icon" viewBox="0 0 24 24"><path d="M7 3 3 7l4 4V8h9V6H7V3zm10 18 4-4-4-4v3H8v2h9v3z"/></svg>`,
};

/**
 * Le compte sur lequel la bascule renverrait — l'autre, puisqu'il n'y en a
 * que deux (ADR 0002). `null` quand il n'y en a pas : le bouton n'apparaît
 * alors nulle part, plutôt que de s'afficher grisé pour une raison qu'un
 * seul compte ne laisse pas deviner.
 */
export function otherAccount(phone: PhoneInstance): StoredAccount | null {
  const { accounts, activeId } = phone.context;
  return accounts.find((a) => a.id !== activeId) ?? null;
}

/**
 * Le bouton de bascule de l'en-tête, pour les deux gabarits. Grisé pendant
 * un appel comme le sont Paramètres et Se déconnecter — et refusé de toute
 * façon par le bloc si l'événement passait quand même (machines/call.ts).
 */
export function switchButton(phone: PhoneInstance, inCall: boolean): string {
  const other = otherAccount(phone);
  if (!other) return "";
  const label = t("action.switchAccount", { address: `${other.username}@${other.domain}` });
  return `<button class="iconbtn ${inCall ? "inactive" : ""}" data-act="switch"
                data-id="${esc(other.id)}" ${inCall ? "disabled" : ""}
                title="${esc(label + (inCall ? t("action.unavailableInCall") : ""))}"
                aria-label="${esc(label)}">${ICONS.swap}</button>`;
}

/**
 * Variantes « coupé » : la barre oblique dit l'état sans la couleur, seule
 * façon de rester lisible en niveaux de gris comme pour un daltonien
 * (RGAA 3.1). Le fond rouge ne fait que renforcer ce que l'icône dit déjà.
 */
const SLASH = `<path d="M3.5 3.5l17 17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`;

export const ICONS_OFF = {
  mic: ICONS.mic.replace("</svg>", `${SLASH}</svg>`),
  cam: ICONS.cam.replace("</svg>", `${SLASH}</svg>`),
  speaker: ICONS.speaker.replace("</svg>", `${SLASH}</svg>`),
  selfview: ICONS.selfview.replace("</svg>", `${SLASH}</svg>`),
  chat: ICONS.chat.replace("</svg>", `${SLASH}</svg>`),
};

/**
 * Registre des modes d'appel proposés par le menu du bouton Appeler.
 * Le mode choisi est retenu (localStorage) et le bouton principal en
 * prend le libellé. Les modes exotiques à venir (vidéo sans son…)
 * s'ajoutent ici — le reste de la chaîne transporte `media`.
 *
 * L'**appel texte** n'y est proposé que si le compte transporte le texte
 * (§4.9) : sans lui, ce serait un appel sans rien. Il ne demande ni micro
 * ni caméra — donc aucune autorisation au navigateur, ce qui compte pour
 * qui n'a rien à dire à un microphone.
 */
interface CallModeDef {
  id: string;
  /** Entrée du menu (« Appel audio ») et bouton principal (« Appeler en audio »). */
  label: string;
  buttonLabel: string;
  icon: string;
  media: CallMedia;
}

/**
 * Ce que chaque mode demande **de son propre chef** : le texte n'y figure
 * pas, parce qu'il n'est jamais un choix de l'appelant (ADR 0003, D2). Il
 * est là si le compte le porte, et `callModes` l'y ajoute — c'est ce qui
 * évite un menu à six entrées pour trois intentions.
 */
const CALL_MODE_KEYS = [
  {
    id: "audio",
    label: "mode.audio.label",
    buttonLabel: "mode.audio.button",
    icon: ICONS.phone,
    media: { audio: true, video: false },
  },
  {
    id: "video",
    label: "mode.video.label",
    buttonLabel: "mode.video.button",
    icon: ICONS.cam,
    media: { audio: true, video: true },
  },
  {
    id: "text",
    label: "mode.text.label",
    buttonLabel: "mode.text.button",
    icon: ICONS.chat,
    media: { audio: false, video: false },
  },
] as const satisfies readonly {
  id: string;
  label: MsgKey;
  buttonLabel: MsgKey;
  icon: string;
  media: { audio: boolean; video: boolean };
}[];

/**
 * Les modes proposés par le compte, libellés dans la langue courante.
 *
 * Le texte s'ajoute à **tous** les modes dès que le compte le transporte
 * (§4.9) — c'est ce qui fait passer l'appel audio du profil F.703 « — »
 * au profil 3c, et l'appel vidéo de la visiophonie (1b/1c) à la
 * conversation totale (4a/4b). L'**appel texte**, lui, n'est proposé que
 * là : sans transport, ce serait un appel sans rien.
 */
export function callModes(rtt?: RttTransport): CallModeDef[] {
  const carriesText = rtt !== undefined && rtt !== "none";
  return CALL_MODE_KEYS.filter((m) => m.id !== "text" || carriesText).map((m) => ({
    id: m.id,
    label: t(m.label),
    buttonLabel: t(m.buttonLabel),
    icon: m.icon,
    // l'appel texte est le seul dont le texte est la raison d'être : il
    // le porte par définition, les deux autres parce que le compte le porte
    media: { ...m.media, text: m.id === "text" || carriesText },
  }));
}

export function currentMode(rtt?: RttTransport): CallModeDef {
  const modes = callModes(rtt);
  return modes.find((m) => m.id === getCallModeId()) ?? modes[0]!;
}

// État UI pur, survivant aux re-rendus (l'écran est reconstruit à chaque
// notification de la machine pendant un appel) et au changement de format.
let draftTarget = "";
let speakerMuted = false;
/** Numéro d'ordre du dernier message fugace affiché (voir `wireCallScreen`). */
let shownNotice = 0;
let chronoTimer: ReturnType<typeof setInterval> | null = null;

export const draft = (): string => draftTarget;
export const isSpeakerMuted = (): boolean => speakerMuted;

/** À appeler en tête de chaque rendu : l'ancien nœud disparaît avec son timer. */
export function stopChrono(): void {
  if (chronoTimer !== null) {
    clearInterval(chronoTimer);
    chronoTimer = null;
  }
}

/** user@domaine sans le préfixe sip:, pour l'affichage. */
export function displayTarget(target: string): string {
  return target.replace(/^sips?:/i, "");
}

// ---------------------------------------------------------------------------
// Appel entrant
// ---------------------------------------------------------------------------

/**
 * Le média d'un appel en un mot — l'ordre est celui de la richesse. Ce
 * n'est plus une déduction par l'absence : « texte » se lit désormais sur
 * `media.text`, comme « vidéo » se lit sur `media.video` (ADR 0003, D1).
 * Sert là où un seul mot suffit — l'icône de la sonnerie, la notification
 * système.
 */
export type CallKind = "audio" | "video" | "text";

export function callKind(media: CallMedia): CallKind {
  return media.video ? "video" : media.audio ? "audio" : "text";
}

/**
 * Le **profil** de l'appel, au sens du tableau F.703 §7.2 : la combinaison
 * complète, et non le média dominant. C'est ce que l'écran d'appel entrant
 * annonce — dire « appel audio » d'un appel qui porte aussi le texte
 * cacherait précisément ce qui le rend accessible.
 *
 * Cinq combinaisons, les cinq que Trix propose (D2) :
 *
 * | profil | médias | F.703 §7.2 |
 * |---|---|---|
 * | `text` | T | 3a — text telephone service |
 * | `audio` | A | téléphonie (monomédia) |
 * | `audioText` | A + T | 3c — good text conversation with usable audio |
 * | `video` | A + V | 1b / 1c — videophone service |
 * | `videoText` | A + V + T | **4a / 4b — total conversation service** |
 *
 * Une vidéo sans audio se range avec la visiophonie : c'est bien l'image
 * qui domine, et le mot que l'utilisateur attend est « vidéo ».
 */
export type CallProfile = "audio" | "audioText" | "video" | "videoText" | "text";

export function callProfile(media: CallMedia): CallProfile {
  if (media.video) return media.text ? "videoText" : "video";
  if (media.audio) return media.text ? "audioText" : "audio";
  return "text";
}

/**
 * Réponses proposées, dérivées des seuls médias offerts par l'INVITE
 * (docs/SPECS.md, phase 3) : vidéo proposée → réponse A/V possible ;
 * audio proposé → réponse audio seul possible. Une offre vidéo pure ne
 * laisse donc que la réponse A/V, une offre audio pure que l'audio. Une
 * offre qui ne porte ni l'un ni l'autre est un appel texte seul — le port
 * a déjà refusé celles qui n'étaient rien du tout (`unsupportedOffer`) —
 * et se répond en texte, sans micro ni caméra.
 *
 * Règle tenue ici et nulle part ailleurs : les deux gabarits déroulent
 * simplement cette liste.
 */
export interface AnswerChoice {
  act: "answer-av" | "answer-audio" | "answer-text";
  label: string;
  icon: string;
}

export function answerChoices(offered: CallMedia): AnswerChoice[] {
  const choices: AnswerChoice[] = [];
  // un choix par média offert, du plus riche au plus sobre : c'est tout le
  // tableau de D3, et il n'y a rien de plus à dire — une offre A V T donne
  // « A V T · A T · T », une offre V T donne « V T · T » (pas d'audio à
  // proposer seul, puisqu'il n'est pas offert)
  if (offered.video)
    choices.push({ act: "answer-av", label: t("incoming.answerVideo"), icon: ICONS.cam });
  if (offered.audio)
    choices.push({ act: "answer-audio", label: t("incoming.answerAudio"), icon: ICONS.phone });
  if (offered.text)
    choices.push({ act: "answer-text", label: t("incoming.answerText"), icon: ICONS.chat });
  return choices;
}

/**
 * Médias de la réponse pour un choix donné. **Jamais un sur-ensemble de
 * l'offre** (F.703 §8.1, D3) : l'appelé retranche, il n'ajoute pas —
 * ajouter, cela se fait après, par re-INVITE.
 *
 * Le texte ne s'y décide pas : il suit l'offre partout où il est offert.
 * Il n'apparaît donc dans aucune ligne comme un choix — il est dans toutes
 * les réponses de la ligne, ou dans aucune.
 */
function answerMedia(act: AnswerChoice["act"], offered: CallMedia): CallMedia {
  if (act === "answer-av") return { audio: offered.audio, video: true, text: offered.text };
  // répondre en texte, c'est n'allumer ni micro ni caméra — et ce choix
  // n'est proposé que si le texte est offert, donc `text: true` sans risque
  if (act === "answer-text") return { audio: false, video: false, text: true };
  return { audio: true, video: false, text: offered.text };
}

/** Identité de l'appelant : nom affiché si le From en porte un, URI sinon. */
export function callerName(view: CallView): string {
  return view.displayName ?? displayTarget(view.target);
}

// ---------------------------------------------------------------------------
// Historique d'appels
// ---------------------------------------------------------------------------

const OUTCOME_KEY: Record<CallLogEntry["outcome"], MsgKey> = {
  answered: "outcome.answered",
  missed: "outcome.missed",
  failed: "outcome.failed",
  canceled: "outcome.canceled",
  dropped: "outcome.dropped",
};

const ENDED_BY_KEY: Record<NonNullable<CallLogEntry["endedBy"]>, MsgKey> = {
  local: "endedBy.local",
  remote: "endedBy.remote",
  network: "endedBy.network",
};

const HISTORY_ICONS: Record<CallLogEntry["outcome"], string> = {
  // flèches sortante/entrante ; la couleur porte le sens (vert/rouge/orange)
  answered: `<svg class="icon dir" viewBox="0 0 24 24"><path d="M5 19L18 6M18 6h-7M18 6v7"/></svg>`,
  canceled: `<svg class="icon dir" viewBox="0 0 24 24"><path d="M5 19L18 6M18 6h-7M18 6v7"/></svg>`,
  failed: `<svg class="icon dir" viewBox="0 0 24 24"><path d="M5 19L18 6M18 6h-7M18 6v7"/></svg>`,
  dropped: `<svg class="icon dir" viewBox="0 0 24 24"><path d="M5 19L18 6M18 6h-7M18 6v7"/></svg>`,
  missed: `<svg class="icon dir" viewBox="0 0 24 24"><path d="M19 5L6 18M6 18h7M6 18v-7"/></svg>`,
};

/**
 * La caméra d'une ligne d'historique porte sa propre classe : la grille place
 * chaque élément par colonne (theme.css), et le parchemin vient se glisser
 * juste dessous, sur la rangée du motif.
 */
const HISTORY_CAM = ICONS.cam.replace('class="icon"', 'class="icon cam"');

/** Heure seule pour aujourd'hui, date + heure au-delà — au format de la langue. */
function fmtWhen(ts: number): string {
  const sameDay = new Date(ts).toDateString() === new Date().toDateString();
  const time = formatTime(ts);
  return sameDay ? time : `${formatDayMonth(ts)} ${time}`;
}

function fmtDuration(entry: CallLogEntry): string {
  if (entry.connectedAt === null) return "";
  const s = Math.max(0, Math.round((entry.endedAt - entry.connectedAt) / 1000));
  const m = Math.floor(s / 60);
  return m > 0
    ? t("duration.minSec", { m, s: String(s % 60).padStart(2, "0") })
    : t("duration.sec", { s });
}

/**
 * `index` : la place de la ligne dans `ctx.history`, portée par le bouton de
 * trace — c'est par là que le câblage retrouve l'entrée à ouvrir, sans que
 * le gabarit ait à transporter le carnet lui-même.
 */
export function historyRow(entry: CallLogEntry, index: number): string {
  const outcome = t(OUTCOME_KEY[entry.outcome]);
  const detail =
    entry.connectedAt !== null
      ? `${fmtDuration(entry)}${entry.endedBy ? ` — ${t(ENDED_BY_KEY[entry.endedBy])}` : ""}`
      : entry.reason
        ? t(entry.reason)
        : outcome;
  return `<div class="calllog-row ${entry.outcome}"
       title="${esc(t("history.entryTitle", { target: entry.target, outcome }))}">
    ${HISTORY_ICONS[entry.outcome]}
    <span class="who">${esc(entry.target)}</span>
    ${entry.media.video ? HISTORY_CAM : ""}
    <span class="when">${esc(fmtWhen(entry.startedAt))}</span>
    <span class="detail">${esc(detail)}</span>
    ${rowButtons(entry, index)}
  </div>`;
}

/**
 * Ce que la ligne d'historique donne à rouvrir, dans un même coin : la
 * bulle « T » de la conversation (§4.9), le parchemin de la trace SIP
 * (§5.3) et la loupe du bilan média (§5.4). Chacune n'apparaît que si
 * l'appel a gardé de quoi la remplir — et une ligne qui n'en porte aucune
 * garde toute sa largeur pour son motif.
 *
 * La conversation vient en tête parce que c'est la seule des trois qui
 * parle de ce qui a été dit ; les deux autres parlent de la mécanique.
 */
function rowButtons(entry: CallLogEntry, index: number): string {
  const one = (act: string, cls: string, label: MsgKey, icon: string): string =>
    `<button class="${cls}" data-act="${act}" data-i="${index}"
             title="${esc(t(label))}" aria-label="${esc(t(label))}">${icon}</button>`;
  const btns = [
    // sans condition, elle : le fil rejoint l'historique dès que quelqu'un
    // a écrit, que la trace ait été cochée ou non
    entry.chat?.length ? one("chat-log", "chatlogbtn", "chat.log.open", CHAT_LOG_ICON) : "",
    // le parchemin n'apparaît que si l'appel a gardé sa trace : la case
    // était cochée pendant qu'il avait lieu (§5.3)
    entry.trace?.length ? one("trace", "tracebtn", "trace.open", SCROLL_ICON) : "",
    // et la loupe si le média a été mesuré pendant ce temps-là (§5.4) :
    // même case, mais un appel sans flux n'a rien à montrer
    entry.stats ? one("stats", "statsbtn", "stats.open", LENS_ICON) : "",
  ].filter((b) => b !== "");
  return btns.length > 0 ? `<span class="rowbtns">${btns.join("")}</span>` : "";
}

/**
 * Change l'icône et le libellé d'une commande sans toucher au reste du
 * bouton. Les deux vivent dans leurs propres nœuds (`overlay.ts`) : c'est ce
 * qui permet à une commande de passer de la pastille à la feuille du bas —
 * où le libellé devient visible — sans être reconstruite.
 */
function setCmd(btn: HTMLElement, icon: string, label: string): void {
  const iconNode = btn.querySelector(".cmd-icon");
  const labelNode = btn.querySelector(".cmd-label");
  if (iconNode) iconNode.innerHTML = icon;
  else btn.innerHTML = icon; // vue bureau : pas de feuille, pas de nœuds
  if (labelNode) labelNode.textContent = label;
}

export function fmtChrono(startedAt: number): string {
  const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

// ---------------------------------------------------------------------------
// Câblage commun
// ---------------------------------------------------------------------------

export interface CallScreenCtx {
  phone: PhoneInstance;
  view: CallView | null;
  ready: boolean;
  cfg: AccountConfig | null;
}

export function wireCallScreen(node: HTMLElement, ctx: CallScreenCtx): void {
  const { phone, view, ready, cfg } = ctx;
  // Tous les éléments qui portent l'action, et pas seulement le premier : une
  // même commande peut avoir deux boutons dans un même gabarit — Raccrocher
  // est dans la sidebar **et** en rond rouge dans la barre de surimpression,
  // selon que le panneau est déplié ou replié (call/panel.ts). Câbler le seul
  // premier trouvé laissait l'autre inerte.
  const on = (sel: string, fn: (elem: HTMLElement) => void): void => {
    for (const elem of node.querySelectorAll<HTMLElement>(sel)) {
      elem.addEventListener("click", () => fn(elem));
    }
  };

  // --- barre d'en-tête ----------------------------------------------------
  on('[data-act="settings"]', () => phone.send({ type: "ui:backToSettings" }));
  on('[data-act="logout"]', () => phone.send({ type: "ui:logout" }));
  on('[data-act="switch"]', (btn) =>
    phone.send({ type: "ui:switchAccount", id: btn.dataset.id! }),
  );
  on('[data-act="retry"]', () => phone.send({ type: "ui:retry" }));
  on('[data-act="fix-settings"]', () => phone.send({ type: "ui:backToSettings" }));

  // --- lancement d'appel ---------------------------------------------------
  const targetInput = node.querySelector('[data-ref="target"]') as HTMLInputElement | null;
  const placeCall = (): void => {
    if (!ready || !cfg || !targetInput) return;
    const target = normalizeTarget(targetInput.value, cfg.domain);
    if (!target) {
      targetInput.classList.add("invalid");
      targetInput.focus();
      return;
    }
    phone.send({ type: "ui:call", target, media: currentMode(cfg.rtt).media });
  };
  if (targetInput && !view) {
    targetInput.addEventListener("input", () => {
      draftTarget = targetInput.value;
    });
    targetInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") placeCall();
    });
  }
  on('[data-act="call"]', () => placeCall());

  // menu de sélection du mode d'appel : choisir retient le mode et
  // rebaptise le bouton principal — l'appel ne part que par le bouton
  const modeMenu = node.querySelector('[data-ref="modemenu"]') as HTMLElement | null;
  const caretBtn = node.querySelector('[data-act="call-menu"]') as HTMLElement | null;
  const closeMenu = (): void => {
    if (modeMenu) modeMenu.hidden = true;
    caretBtn?.setAttribute("aria-expanded", "false");
  };
  const fillMenu = (): void => {
    if (!modeMenu) return;
    modeMenu.replaceChildren(
      ...callModes(cfg?.rtt).map((m) => {
        const selected = m.id === currentMode(cfg?.rtt).id;
        const item = el(
          `<button role="menuitemradio" aria-checked="${selected}"
                   class="${selected ? "selected" : ""}">
             ${m.icon} ${esc(m.label)}${selected ? `<span class="check">✓</span>` : ""}
           </button>`,
        );
        item.addEventListener("click", () => {
          setCallModeId(m.id);
          const main = node.querySelector('[data-act="call"]');
          // le bouton mobile n'affiche que l'icône : on respecte son gabarit
          if (main) {
            main.innerHTML = main.classList.contains("iconlabel")
              ? m.icon
              : `${m.icon} ${esc(m.buttonLabel)}`;
            main.setAttribute("title", m.buttonLabel);
          }
          closeMenu();
        });
        return item;
      }),
    );
  };
  if (caretBtn) {
    caretBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!modeMenu) return;
      if (modeMenu.hidden) fillMenu();
      modeMenu.hidden = !modeMenu.hidden;
      caretBtn.setAttribute("aria-expanded", String(!modeMenu.hidden));
    });
    // clic hors du menu ou Échap : fermeture
    node.addEventListener("click", (e) => {
      if (!(e.target as HTMLElement).closest(".splitbtn")) closeMenu();
    });
    node.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeMenu();
    });
  }

  // --- appel entrant --------------------------------------------------------
  if (view?.state === "ringing_in") {
    for (const choice of answerChoices(view.offered)) {
      on(`[data-act="${choice.act}"]`, () =>
        phone.send({ type: "ui:answer", media: answerMedia(choice.act, view.offered) }),
      );
    }
    on('[data-act="reject"]', () => phone.send({ type: "ui:reject" }));
    // alerte multi-canal : l'application s'adresse d'abord à des sourds
    startIncomingAlert({
      caller: callerName(view),
      kind: callKind(view.offered),
      flash: cfg?.flashAlert !== false,
    });
  } else {
    stopIncomingAlert();
  }

  // --- retour d'appel sortant ----------------------------------------------
  // F.703 §6.1.2 : la progression de l'appel s'annonce à l'appelant par des
  // signaux visuels **et** sonores. « Sonnerie » est le visuel ; le son est
  // produit ici, faute de quoi l'appelant n'entendrait rien du tout — un
  // appel SIP ne transporte aucun média avant le 200 OK.
  //
  // Sauf en `early_media`, où le réseau émet déjà (RFC 3960) — et c'est
  // **son audio à lui** qui commande, pas le simple fait qu'il émette :
  // une annonce en langue des signes ou en texte temps réel ne remplit
  // aucun silence, et couper la tonalité laisserait l'appelant croire que
  // la ligne est morte. La condition tient donc en une phrase : on sonne
  // tant que rien de sonore n'arrive.
  if (view?.direction === "outgoing" && ringbackNeeded(view)) startRingback();
  else stopRingback();

  // --- message fugace -------------------------------------------------------
  // L'écran est reconstruit à chaque notification de la machine : c'est le
  // numéro d'ordre, et lui seul, qui distingue un message neuf d'un rendu de
  // plus. Sans lui, le même bandeau se rallumerait à chaque battement du
  // chrono — et deux refus identiques n'en feraient qu'un.
  if (view?.notice && view.notice.seq !== shownNotice) {
    shownNotice = view.notice.seq;
    showToast(t(view.notice.message));
  }
  if (!view) {
    shownNotice = 0;
    hideToast();
  }

  // --- commandes en communication -----------------------------------------
  on('[data-act="hangup"]', () => phone.send({ type: "ui:hangup" }));
  // les deux boutons de l'axe 1, câblés par la même ligne : c'est ce que
  // « strictement symétriques » veut dire jusque dans le code (ADR 0003, D6)
  for (const kind of MEDIA_KINDS) {
    on(`[data-act="toggle-${kind}"]`, () => phone.send({ type: "ui:toggleMedia", kind }));
  }
  // le partage rejoint l'axe 1 : il change ce que le correspondant voit, et
  // le bouton n'existe que là où la machine sait capturer un écran (D8)
  on('[data-act="share"]', () => phone.send({ type: "ui:toggleShare" }));
  // deux boutons pour un seul geste : celui de la barre, et « Reprendre »
  // dans le bandeau plein écran. `on` les câble tous les deux
  on('[data-act="pause"]', () => phone.send({ type: "ui:togglePause" }));
  on('[data-act="accept-media"]', () => phone.send({ type: "ui:acceptMedia" }));
  on('[data-act="reject-media"]', () => phone.send({ type: "ui:rejectMedia" }));
  on('[data-act="selfview"]', () => phone.send({ type: "ui:toggleSelfView" }));
  // écoute : UI pure (mute de l'élément <video> distant), pas de machine
  on('[data-act="speaker"]', (btn) => {
    speakerMuted = !speakerMuted;
    const remote = node.querySelector('[data-ref="remote"]') as HTMLVideoElement | null;
    if (remote) remote.muted = speakerMuted;
    // `toggled` et non `off` : rien n'est sorti de l'appel, le correspondant
    // parle toujours et le vu-mètre distant continue de le montrer. Le rouge
    // est réservé à un média qui a quitté l'appel (voir overlay.ts)
    btn.classList.toggle("toggled", speakerMuted);
    btn.setAttribute("aria-pressed", String(speakerMuted));
    const label = t(speakerMuted ? "ctrl.speaker.unmute" : "ctrl.speaker.mute");
    btn.title = label;
    // l'icône seule est remplacée : le libellé vit dans son propre nœud, et
    // c'est lui qui rend le bouton lisible une fois dans la feuille du bas
    setCmd(btn, speakerMuted ? ICONS_OFF.speaker : ICONS.speaker, label);
  });

  // la feuille mène au bilan média (ADR 0003, D8) ; la pastille d'état de la
  // barre haute reste l'autre chemin — c'est elle qui porte l'encart, et
  // c'est donc à elle que l'entrée s'adresse
  on('[data-act="stats-open"]', () => {
    const pill = node.querySelector<HTMLElement>('[data-ref="statsbtn"]');
    // une microtask plus tard : le clic qui nous amène ici va d'abord
    // remonter jusqu'à l'écran, où `startMediaStats` dépingle l'encart pour
    // tout clic pris hors de la pastille. L'épingler avant serait l'épingler
    // pour rien.
    if (pill) queueMicrotask(() => pill.click());
  });

  // --- bandeau de joignabilité (ADR 0006) ----------------------------------
  // Masquer ne change aucun état : ces deux messages parlent du passé, et
  // le nœud disparaît sur place — rien à re-rendre, et surtout pas la
  // saisie en cours dans le champ d'adresse.
  on('[data-act="reach-dismiss"]', (btn) => {
    dismissDiscardNotice();
    btn.closest(".reach-note")?.remove();
  });
  on('[data-act="pin-dismiss"]', (btn) => {
    dismissPinHint();
    btn.closest(".reach-note")?.remove();
  });

  // --- historique ----------------------------------------------------------
  on('[data-act="clear-history"]', () => phone.send({ type: "ui:clearHistory" }));
  // parchemin : le carnet de l'appel, relu tel qu'il a été enregistré
  on('[data-act="trace"]', (elem) => {
    const entry = phone.context.history[Number(elem.dataset.i)];
    if (entry) showTraceDialog(entry);
  });
  // loupe : le bilan média du même appel, sur toute sa durée mesurée
  on('[data-act="stats"]', (elem) => {
    const entry = phone.context.history[Number(elem.dataset.i)];
    if (entry) showStatsDialog(entry);
  });
  // bulle « T » : la conversation de cet appel, en lecture seule (§4.9)
  on('[data-act="chat-log"]', (elem) => {
    const entry = phone.context.history[Number(elem.dataset.i)];
    if (entry) showChatDialog(entry);
  });
  if (targetInput && !view) {
    // clic sur une ligne : pré-remplit le champ d'adresse pour rappeler
    for (const row of node.querySelectorAll(".calllog-row")) {
      const who = row.querySelector(".who")?.textContent ?? "";
      row.addEventListener("click", () => {
        draftTarget = who;
        targetInput.value = who;
        targetInput.focus();
      });
    }
  }

  // --- clavier DTMF ---------------------------------------------------------
  // Le pavé s'ouvre et se ferme sans la machine (call/dtmf.ts) ; seule la
  // tonalité pressée lui est envoyée, et c'est elle qui décidera si elle
  // rejoint l'écho de l'écran.
  wireDtmf(node, (tone) => phone.send({ type: "ui:dtmf", tone }));

  // --- tchat texte temps réel ----------------------------------------------
  // Comme le pavé DTMF : le panneau vit hors de la machine, qui ne sait rien
  // du texte échangé — il naît avec le canal de l'appel et meurt avec lui.
  wireChat(node, {
    view,
    peer: view ? callerName(view) : "",
    // l'alerte en séance (`BEL`) réemploie les canaux de l'appel entrant,
    // réglage du compte compris
    flash: cfg?.flashAlert !== false,
  });

  // --- écran partagé reçu ---------------------------------------------------
  // La permutation scène / vignette vit hors de la machine, comme le pavé
  // DTMF : rien ne part sur le fil, et le correspondant continue de recevoir
  // exactement la même chose (ADR 0005, D11).
  wireShareStage(node);

  // --- panneau latéral (repli, largeur) ------------------------------------
  // absent de la vue mobile : `wirePanel` ne trouve alors ni bouton ni
  // poignée et ne fait rien, comme tout le reste de ce câblage
  wirePanel(node);

  // --- préférences ---------------------------------------------------------
  // seule la taille du texte reste ici : c'est le seul réglage qu'on ajuste en
  // cours de conversation. Thème et notifications vivent dans les paramètres.
  on('[data-act="font-down"]', () => bumpFont(-1));
  on('[data-act="font-up"]', () => bumpFont(1));

  // --- média, chrono, vu-mètres --------------------------------------------
  const remote = node.querySelector('[data-ref="remote"]') as HTMLVideoElement | null;
  if (view && remote) {
    const self = node.querySelector('[data-ref="self"]') as HTMLVideoElement | null;
    // la surface de l'écran partagé n'existe que pendant un partage reçu ;
    // le port y route la piste **par son MID**, jamais par ordre d'arrivée
    const shared = node.querySelector('[data-ref="share"]') as HTMLVideoElement | null;
    remote.muted = speakerMuted;
    view.session?.attachMedia(remote, self, shared);

    // plein écran : le double-clic est un raccourci, le bouton est le chemin
    // praticable au clavier (RGAA 7.3) — les deux mènent au même geste
    const zone = node.querySelector('[data-ref="videozone"]') as HTMLElement | null;
    const toggleFullscreen = (): void => {
      if (!zone) return;
      if (document.fullscreenElement) void document.exitFullscreen();
      else void zone.requestFullscreen().catch(() => {});
    };
    zone?.addEventListener("dblclick", toggleFullscreen);
    on('[data-act="fullscreen"]', toggleFullscreen);

    if (view.state === "connected" && view.connectedAt !== null) {
      const startedAt = view.connectedAt;
      const label = node.querySelector('[data-ref="chrono"]');
      chronoTimer = setInterval(() => {
        const elapsed = fmtChrono(startedAt);
        if (label) label.textContent = elapsed;
        // le titre d'onglet suit la seconde ; l'annonce, elle, ne réveille le
        // lecteur d'écran qu'à la minute — l'entendre battre la seconde
        // rendrait la conversation impossible à suivre
        setStateTitle(`${callLabel("connected")} — ${elapsed}`);
        const minutes = Math.floor((Date.now() - startedAt) / 60_000);
        if (minutes > 0) announce(tn("announce.inCall", minutes));
      }, 1000);
      startVuMeters(node, remote, self);
      // mesure du média sur fenêtre glissante, découverte depuis la pastille
      if (view.session) startMediaStats(node, view.session, startedAt);
    }
  }
}

// ---------------------------------------------------------------------------
// Vu-mètres : les deux barres de la scène, et le flash du haut-parleur.
// La mesure elle-même vit dans `ui/vumeter.ts` — l'autotest hors appel s'en
// sert aussi, et deux analyseurs sur le même flux ne mesureraient pas mieux.
// ---------------------------------------------------------------------------

let vuRaf: number | null = null;

/** Seuil de détection de parole (RMS) et durée de maintien du flash. */
const SPEECH_RMS = 0.015;
const SPEECH_HOLD_MS = 250;

function startVuMeters(
  node: HTMLElement,
  remote: HTMLVideoElement,
  self: HTMLVideoElement | null,
): void {
  if (vuRaf !== null) cancelAnimationFrame(vuRaf);
  const remoteBar = node.querySelector('[data-ref="vu-remote"]') as HTMLElement | null;
  const localBar = node.querySelector('[data-ref="vu-local"]') as HTMLElement | null;
  // le haut-parleur clignote sur l'audio entrant, même sans vu-mètres à l'écran
  const speakerBtn = node.querySelector('[data-act="speaker"]') as HTMLElement | null;
  if (!remoteBar && !localBar && !speakerBtn) return;
  let lastSpeech = 0;

  const tick = (): void => {
    if (!node.isConnected) {
      vuRaf = null;
      return; // l'écran a été re-rendu : cette boucle meurt
    }
    for (const [video, bar] of [
      [remote, remoteBar],
      [self, localBar],
    ] as const) {
      const stream = video?.srcObject instanceof MediaStream ? video.srcObject : null;
      const rms = audioLevel(stream);
      // le plancher est en pixels (min-height CSS) : la barre court sur
      // toute la hauteur de la scène, un plancher en % y serait énorme
      if (bar) bar.style.height = `${barHeight(rms)}%`;
      if (video === remote && speakerBtn) {
        // maintien court : sinon le flash strobe entre deux syllabes
        if (rms > SPEECH_RMS) lastSpeech = Date.now();
        const speaking = !speakerMuted && Date.now() - lastSpeech < SPEECH_HOLD_MS;
        speakerBtn.classList.toggle("speaking", speaking);
      }
    }
    vuRaf = requestAnimationFrame(tick);
  };
  vuRaf = requestAnimationFrame(tick);
}
