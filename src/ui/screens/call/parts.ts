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
import type { CallMedia } from "../../../sip/port.js";
import type { AccountConfig } from "../../../storage/store.js";
import { normalizeTarget } from "../../../sip/uri.js";
import { el, esc } from "../../el.js";
import { startIncomingAlert, stopIncomingAlert } from "../../alert.js";
import { bumpFont, getCallModeId, setCallModeId } from "../../prefs.js";
import { announce } from "../../announce.js";
import { setStateTitle } from "../../title.js";
import { wirePanel } from "./panel.js";

export const STATUS: Record<string, { label: string; cls: "ok" | "warn" | "err" }> = {
  connecting: { label: "Connexion…", cls: "warn" },
  registering: { label: "Enregistrement…", cls: "warn" },
  ready: { label: "Enregistré", cls: "ok" },
  in_call: { label: "Enregistré", cls: "ok" },
  reconnecting: { label: "Reconnexion…", cls: "err" },
  sleeping: { label: "En veille", cls: "warn" },
  reg_failed: { label: "Échec d'enregistrement", cls: "err" },
  unregistering: { label: "Déconnexion…", cls: "warn" },
};

export const CALL_LABEL: Record<CallView["state"], string> = {
  dialing: "Appel en cours",
  ringing: "Sonnerie",
  ringing_in: "Appel entrant",
  answering: "Connexion…",
  connected: "En communication",
  hangingup: "Fin d'appel",
};

export const ICONS = {
  settings: `<svg class="icon" viewBox="0 0 24 24"><path d="M4 6h10v2H4zM17 6h3v2h-3zM13 5h2v4h-2zM4 16h3v2H4zM10 16h10v2H10zM7 15h2v4H7zM4 11h14v2H4zM19 10h1v4h-1z"/></svg>`,
  logout: `<svg class="icon" viewBox="0 0 24 24"><path d="M10 17l5-5-5-5v3H3v4h7v3zM13 3h6c1.1 0 2 .9 2 2v14c0 1.1-.9 2-2 2h-6v-2h6V5h-6V3z"/></svg>`,
  cam: `<svg class="icon" viewBox="0 0 24 24"><path d="M17 10.5V7c0-.6-.4-1-1-1H4c-.6 0-1 .4-1 1v10c0 .6.4 1 1 1h12c.6 0 1-.4 1-1v-3.5l4 4v-11l-4 4z"/></svg>`,
  selfview: `<svg class="icon" viewBox="0 0 24 24"><path d="M12 12c2.2 0 4-1.8 4-4s-1.8-4-4-4-4 1.8-4 4 1.8 4 4 4zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z"/></svg>`,
  speaker: `<svg class="icon" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.8-1-3.3-2.5-4v8c1.5-.7 2.5-2.2 2.5-4z"/></svg>`,
  dtmf: `<svg class="icon" viewBox="0 0 24 24"><circle cx="6" cy="5" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="6" cy="11" r="2"/><circle cx="12" cy="11" r="2"/><circle cx="18" cy="11" r="2"/><circle cx="6" cy="17" r="2"/><circle cx="12" cy="17" r="2"/><circle cx="12" cy="22" r="2"/></svg>`,
  phone: `<svg class="icon" viewBox="0 0 24 24"><path d="M6.6 10.8c1.5 3 3.6 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.3 0 .7-.2 1l-2.3 2.2z"/></svg>`,
  hangup: `<svg class="icon" viewBox="0 0 24 24" style="transform:rotate(135deg)"><path d="M6.6 10.8c1.5 3 3.6 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.3 0 .7-.2 1l-2.3 2.2z"/></svg>`,
  mic: `<svg class="icon" viewBox="0 0 24 24"><path d="M12 14c1.7 0 3-1.3 3-3V5c0-1.7-1.3-3-3-3S9 3.3 9 5v6c0 1.7 1.3 3 3 3zm5-3c0 2.8-2.2 5-5 5s-5-2.2-5-5H5c0 3.5 2.6 6.4 6 6.9V21h2v-3.1c3.4-.5 6-3.4 6-6.9h-2z"/></svg>`,
  clock: `<svg class="icon" viewBox="0 0 24 24" style="width:16px;height:16px"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 5h-2v6l5 3 1-1.7-4-2.3V7z"/></svg>`,
  fullscreen: `<svg class="icon" viewBox="0 0 24 24"><path d="M4 9V4h5v2H6v3H4zm11-5h5v5h-2V6h-3V4zM4 15h2v3h3v2H4v-5zm14 0h2v5h-5v-2h3v-3z"/></svg>`,
  chat: `<svg class="icon" viewBox="0 0 24 24" style="width:26px;height:26px"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>`,
};

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
};

/**
 * Registre des modes d'appel proposés par le menu du bouton Appeler.
 * Le mode choisi est retenu (localStorage) et le bouton principal en
 * prend le libellé. Les modes exotiques à venir (vidéo sans son, texte
 * seul…) s'ajoutent ici — le reste de la chaîne transporte `media`.
 */
interface CallModeDef {
  id: string;
  label: string; // entrée du menu : « Appel audio »
  buttonLabel: string; // bouton principal : « Appeler en audio »
  icon: string;
  media: CallMedia;
}

const CALL_MODES: CallModeDef[] = [
  {
    id: "audio",
    label: "Appel audio",
    buttonLabel: "Appeler en audio",
    icon: ICONS.phone,
    media: { audio: true, video: false },
  },
  {
    id: "video",
    label: "Appel vidéo",
    buttonLabel: "Appeler en vidéo",
    icon: ICONS.cam,
    media: { audio: true, video: true },
  },
];

export function currentMode(): CallModeDef {
  return CALL_MODES.find((m) => m.id === getCallModeId()) ?? CALL_MODES[0]!;
}

// État UI pur, survivant aux re-rendus (l'écran est reconstruit à chaque
// notification de la machine pendant un appel) et au changement de format.
let draftTarget = "";
let speakerMuted = false;
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
 * Réponses proposées, dérivées des seuls médias offerts par l'INVITE
 * (docs/SPECS.md, phase 3) : vidéo proposée → réponse A/V possible ;
 * audio proposé → réponse audio seul possible. Une offre vidéo pure ne
 * laisse donc que la réponse A/V, une offre audio pure que l'audio.
 *
 * Règle tenue ici et nulle part ailleurs : les deux gabarits déroulent
 * simplement cette liste.
 */
export interface AnswerChoice {
  act: "answer-av" | "answer-audio";
  label: string;
  icon: string;
}

export function answerChoices(offered: CallMedia): AnswerChoice[] {
  const choices: AnswerChoice[] = [];
  if (offered.video) choices.push({ act: "answer-av", label: "Répondre en vidéo", icon: ICONS.cam });
  if (offered.audio)
    choices.push({ act: "answer-audio", label: "Répondre en audio", icon: ICONS.phone });
  return choices;
}

/** Médias de la réponse pour un choix donné (jamais plus que ce qui est proposé). */
function answerMedia(act: AnswerChoice["act"], offered: CallMedia): CallMedia {
  return act === "answer-av"
    ? { audio: offered.audio, video: true }
    : { audio: true, video: false };
}

/** Identité de l'appelant : nom affiché si le From en porte un, URI sinon. */
export function callerName(view: CallView): string {
  return view.displayName ?? displayTarget(view.target);
}

// ---------------------------------------------------------------------------
// Historique d'appels
// ---------------------------------------------------------------------------

const OUTCOME_LABEL: Record<CallLogEntry["outcome"], string> = {
  answered: "Répondu",
  missed: "Manqué",
  failed: "Échec",
  canceled: "Annulé",
  dropped: "Interrompu",
};

const ENDED_BY_LABEL: Record<NonNullable<CallLogEntry["endedBy"]>, string> = {
  local: "raccroché par vous",
  remote: "raccroché par le correspondant",
  network: "coupé par le réseau",
};

const HISTORY_ICONS: Record<CallLogEntry["outcome"], string> = {
  // flèches sortante/entrante ; la couleur porte le sens (vert/rouge/orange)
  answered: `<svg class="icon dir" viewBox="0 0 24 24"><path d="M5 19L18 6M18 6h-7M18 6v7"/></svg>`,
  canceled: `<svg class="icon dir" viewBox="0 0 24 24"><path d="M5 19L18 6M18 6h-7M18 6v7"/></svg>`,
  failed: `<svg class="icon dir" viewBox="0 0 24 24"><path d="M5 19L18 6M18 6h-7M18 6v7"/></svg>`,
  dropped: `<svg class="icon dir" viewBox="0 0 24 24"><path d="M5 19L18 6M18 6h-7M18 6v7"/></svg>`,
  missed: `<svg class="icon dir" viewBox="0 0 24 24"><path d="M19 5L6 18M6 18h7M6 18v-7"/></svg>`,
};

function fmtWhen(ts: number): string {
  const d = new Date(ts);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return sameDay
    ? time
    : `${d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} ${time}`;
}

function fmtDuration(entry: CallLogEntry): string {
  if (entry.connectedAt === null) return "";
  const s = Math.max(0, Math.round((entry.endedAt - entry.connectedAt) / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m} min ${String(s % 60).padStart(2, "0")} s` : `${s} s`;
}

export function historyRow(entry: CallLogEntry): string {
  const detail =
    entry.connectedAt !== null
      ? `${fmtDuration(entry)}${entry.endedBy ? ` — ${ENDED_BY_LABEL[entry.endedBy]}` : ""}`
      : (entry.reason ?? OUTCOME_LABEL[entry.outcome]);
  return `<div class="calllog-row ${entry.outcome}"
       title="${esc(`${entry.target} — ${OUTCOME_LABEL[entry.outcome]}`)}">
    ${HISTORY_ICONS[entry.outcome]}
    <span class="who">${esc(entry.target)}</span>
    ${entry.media.video ? ICONS.cam : ""}
    <span class="when">${esc(fmtWhen(entry.startedAt))}</span>
    <span class="detail">${esc(detail)}</span>
  </div>`;
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
    phone.send({ type: "ui:call", target, media: currentMode().media });
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
      ...CALL_MODES.map((m) => {
        const selected = m.id === currentMode().id;
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
      video: view.offered.video,
      flash: cfg?.flashAlert !== false,
    });
  } else {
    stopIncomingAlert();
  }

  // --- commandes en communication -----------------------------------------
  on('[data-act="hangup"]', () => phone.send({ type: "ui:hangup" }));
  on('[data-act="muteMic"]', () => phone.send({ type: "ui:muteMic" }));
  on('[data-act="muteCam"]', () => phone.send({ type: "ui:muteCam" }));
  on('[data-act="selfview"]', () => phone.send({ type: "ui:toggleSelfView" }));
  // haut-parleur : UI pure (mute de l'élément <video> distant), pas de machine
  on('[data-act="speaker"]', (btn) => {
    speakerMuted = !speakerMuted;
    const remote = node.querySelector('[data-ref="remote"]') as HTMLVideoElement | null;
    if (remote) remote.muted = speakerMuted;
    // `off` et non `toggled` : un son coupé est un flux interrompu (voir overlay.ts)
    btn.classList.toggle("off", speakerMuted);
    btn.setAttribute("aria-pressed", String(speakerMuted));
    btn.title = speakerMuted ? "Rétablir le son" : "Couper le son";
    btn.innerHTML = speakerMuted ? ICONS_OFF.speaker : ICONS.speaker;
  });

  // --- historique ----------------------------------------------------------
  on('[data-act="clear-history"]', () => phone.send({ type: "ui:clearHistory" }));
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
    remote.muted = speakerMuted;
    view.session?.attachMedia(remote, self);

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
        setStateTitle(`${CALL_LABEL.connected} — ${elapsed}`);
        const minutes = Math.floor((Date.now() - startedAt) / 60_000);
        if (minutes > 0) {
          announce(`En communication depuis ${minutes} minute${minutes > 1 ? "s" : ""}`);
        }
      }, 1000);
      startVuMeters(node, remote, self);
    }
  }
}

// ---------------------------------------------------------------------------
// Vu-mètres : analyse du flux audio distant et local (WebAudio), UI pure.
// ---------------------------------------------------------------------------

let audioCtx: AudioContext | null = null;
const analysers = new WeakMap<MediaStream, AnalyserNode>();
let vuRaf: number | null = null;

function analyserFor(stream: MediaStream): AnalyserNode | null {
  if (stream.getAudioTracks().length === 0) return null;
  const existing = analysers.get(stream);
  if (existing) return existing;
  audioCtx ??= new AudioContext();
  const an = audioCtx.createAnalyser();
  an.fftSize = 256;
  audioCtx.createMediaStreamSource(stream).connect(an);
  analysers.set(stream, an);
  return an;
}

function level(an: AnalyserNode, buf: Uint8Array<ArrayBuffer>): number {
  an.getByteTimeDomainData(buf);
  let sum = 0;
  for (const v of buf) {
    const d = (v - 128) / 128;
    sum += d * d;
  }
  return Math.sqrt(sum / buf.length); // RMS 0..1
}

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
  const buf = new Uint8Array(256);
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
      const an = stream ? analyserFor(stream) : null;
      const rms = an ? level(an, buf) : 0;
      // le plancher est en pixels (min-height CSS) : la barre court sur
      // toute la hauteur de la scène, un plancher en % y serait énorme
      if (bar) bar.style.height = `${Math.min(100, Math.round(rms * 260))}%`;
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
