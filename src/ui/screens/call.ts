/**
 * Écran d'appel — phase 2 : appel sortant audio/vidéo.
 * Layout du mockup validé (docs/mockups/mockup.html, écrans 3 et 3bis) :
 * barre d'en-tête, scène vidéo + barre inférieure, sidebar (adresse,
 * Appeler/Raccrocher, chrono, tchat verrouillé ph. 4, préférences).
 *
 * L'UI ne parle qu'à PhoneMachine : pendant un appel elle rend le miroir
 * `context.call` (CallView) publié par la CallMachine, et ses commandes
 * (raccrocher, mutes) transitent par le parent. Seul `attachMedia` de la
 * CallSession touche aux flux WebRTC.
 */

import type { PhoneInstance } from "../../machines/phone.js";
import type { CallView } from "../../machines/events.js";
import type { CallLogEntry } from "../../storage/store.js";
import { normalizeTarget } from "../../sip/uri.js";
import { el, esc } from "../el.js";
import { logoSvg } from "../logo.js";
import { bumpFont, currentTheme, getCallModeId, setCallModeId, toggleTheme } from "../prefs.js";
import type { CallMedia } from "../../sip/port.js";

const STATUS: Record<string, { label: string; cls: "ok" | "warn" | "err" }> = {
  connecting: { label: "Connexion…", cls: "warn" },
  registering: { label: "Enregistrement…", cls: "warn" },
  ready: { label: "Enregistré", cls: "ok" },
  in_call: { label: "Enregistré", cls: "ok" },
  reconnecting: { label: "Reconnexion…", cls: "err" },
  sleeping: { label: "En veille", cls: "warn" },
  reg_failed: { label: "Échec d'enregistrement", cls: "err" },
  unregistering: { label: "Déconnexion…", cls: "warn" },
};

const CALL_LABEL: Record<CallView["state"], string> = {
  dialing: "Appel en cours",
  ringing: "Sonnerie",
  connected: "En communication",
  hangingup: "Fin d'appel",
};

const ICONS = {
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
  chat: `<svg class="icon" viewBox="0 0 24 24" style="width:26px;height:26px"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>`,
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

function currentMode(): CallModeDef {
  return CALL_MODES.find((m) => m.id === getCallModeId()) ?? CALL_MODES[0]!;
}

// État UI pur, survivant aux re-rendus (l'écran est reconstruit à chaque
// notification de la machine pendant un appel).
let draftTarget = "";
let speakerMuted = false;
let chronoTimer: ReturnType<typeof setInterval> | null = null;

/** user@domaine sans le préfixe sip:, pour l'affichage. */
function displayTarget(target: string): string {
  return target.replace(/^sips?:/i, "");
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
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return sameDay ? time : `${d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} ${time}`;
}

function fmtDuration(entry: CallLogEntry): string {
  if (entry.connectedAt === null) return "";
  const s = Math.max(0, Math.round((entry.endedAt - entry.connectedAt) / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m} min ${String(s % 60).padStart(2, "0")} s` : `${s} s`;
}

function historyRow(entry: CallLogEntry): string {
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

function fmtChrono(startedAt: number): string {
  const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

export function renderCall(phone: PhoneInstance): HTMLElement {
  const cfg = phone.context.config;
  const view = phone.state === "in_call" ? phone.context.call : null;
  const status = STATUS[phone.state] ?? { label: phone.state, cls: "warn" as const };
  const identity = cfg ? ` — ${esc(cfg.username)}@${esc(cfg.domain)}` : "";
  const failed = phone.state === "reg_failed";
  const ready = phone.state === "ready";
  const reconnecting = phone.state === "reconnecting";
  const sleeping = phone.state === "sleeping";
  const connected = view?.state === "connected";
  const err = phone.context.lastError;
  const errCode = phone.context.lastErrorCode;
  const callError = phone.context.callError;
  const history = phone.context.history;

  if (chronoTimer !== null) {
    clearInterval(chronoTimer);
    chronoTimer = null;
  }

  const node = el(`
    <div class="screen-call">
      <div class="topbar">
        <span class="logo">${logoSvg(26, false)}<span>STAURI</span></span>
        <span class="pill"><span class="dot ${status.cls}"></span>
          ${status.label}${ready ? identity : ""}</span>
        ${
          view
            ? `<span class="pill"><span class="dot live"></span>
                 ${CALL_LABEL[view.state]} — ${esc(displayTarget(view.target))}</span>`
            : ""
        }
        <span class="spacer"></span>
        <button class="iconbtn ${view ? "inactive" : ""}" data-act="settings" ${view ? "disabled" : ""}
                title="Paramètres${view ? " (indisponible en appel)" : ""}" aria-label="Paramètres">
          ${ICONS.settings}
        </button>
        <button class="iconbtn ${view ? "inactive" : ""}" data-act="logout" ${view ? "disabled" : ""}
                title="Se déconnecter${view ? " (indisponible en appel)" : ""}" aria-label="Se déconnecter">
          ${ICONS.logout}
        </button>
      </div>
      <div class="callbody">
        <div class="stage">
          <div class="video" data-ref="videozone">
            ${
              view
                ? `<video class="remote" data-ref="remote" autoplay playsinline></video>
                   ${
                     view.media.video && !view.selfViewHidden
                       ? `<video class="selfview" data-ref="self" autoplay playsinline muted></video>`
                       : ""
                   }
                   ${
                     connected
                       ? `<div class="vumeters" aria-hidden="true">
                            <span class="bar" data-ref="vu-remote" style="height:4%"></span>
                            <span class="bar" data-ref="vu-local" style="height:4%"></span>
                          </div>`
                       : `<div class="call-overlay">${CALL_LABEL[view.state]}…<br>
                            <span class="target">${esc(displayTarget(view.target))}</span></div>`
                   }`
                : failed
                  ? `${err ? `<div class="error-banner">${esc(err)}</div>` : ""}
                     ${errCode ? `<span class="error-code">${esc(errCode)}</span>` : ""}
                     <div class="error-actions">
                       <button class="btn primary" data-act="fix-settings">Corriger les paramètres</button>
                       <button class="btn" data-act="retry">Réessayer</button>
                     </div>`
                  : reconnecting
                    ? `${err ? `<div class="error-banner">${esc(err)}</div>` : ""}
                       ${errCode ? `<span class="error-code">${esc(errCode)}</span>` : ""}
                       <span class="idle-msg">Nouvelle tentative de connexion dans 10 s…</span>
                       <div class="error-actions">
                         <button class="btn primary" data-act="retry">Réessayer maintenant</button>
                         <button class="btn" data-act="fix-settings">Paramètres</button>
                       </div>`
                    : sleeping
                      ? `<span class="idle-msg">Veille — l'enregistrement reprendra au réveil</span>`
                      : `<span class="idle-msg">${
                          ready
                            ? "Aucun appel en cours — saisissez une adresse SIP"
                            : esc(status.label)
                        }</span>`
            }
          </div>
        </div>
        <div class="sidebar">
          <div class="call-controls">
            <div class="field">
              <label for="f-target">Adresse SIP</label>
              <input id="f-target" data-ref="target" ${view ? "disabled" : ""}
                     value="${view ? esc(displayTarget(view.target)) : esc(draftTarget)}">
              ${cfg && !view ? `<span class="hint">Sans « @ » : appellera &lt;adresse&gt;@${esc(cfg.domain)}</span>` : ""}
              ${callError && !view ? `<span class="call-error">${esc(callError)}</span>` : ""}
            </div>
            ${
              view
                ? `<button class="btn hangup ${view.state === "hangingup" ? "inactive" : ""}"
                           data-act="hangup" ${view.state === "hangingup" ? "disabled" : ""}>
                     ${ICONS.hangup} Raccrocher
                   </button>`
                : `<div class="splitbtn" data-ref="splitbtn">
                     <button class="btn call" data-act="call" ${ready ? "" : "disabled"}>
                       ${currentMode().icon} ${currentMode().buttonLabel}
                     </button>
                     <button class="btn caret" data-act="call-menu" ${ready ? "" : "disabled"}
                             aria-label="Choisir le mode d'appel" aria-expanded="false">▾</button>
                     <div class="dropdown" data-ref="modemenu" hidden></div>
                   </div>`
            }
            <div class="mediabar">
              <button class="iconbtn ${connected ? (view.micMuted ? "toggled" : "") : "inactive"}"
                      data-act="muteMic" ${connected ? "" : "disabled"}
                      title="${view?.micMuted ? "Rétablir le micro" : "Couper le micro"}"
                      aria-label="Couper le micro" aria-pressed="${view?.micMuted ?? false}">
                ${ICONS.mic}
              </button>
              <button class="iconbtn ${connected && view.media.video ? (view.camMuted ? "toggled" : "") : "inactive"}"
                      data-act="muteCam" ${connected && view?.media.video ? "" : "disabled"}
                      title="${view?.camMuted ? "Rétablir la caméra" : "Couper la caméra"}"
                      aria-label="Couper la caméra" aria-pressed="${view?.camMuted ?? false}">
                ${ICONS.cam}
              </button>
              <button class="iconbtn ${connected && view.media.video ? (view.selfViewHidden ? "toggled" : "") : "inactive"}"
                      data-act="selfview" ${connected && view?.media.video ? "" : "disabled"}
                      title="${view?.selfViewHidden ? "Afficher le self-view" : "Masquer le self-view"}"
                      aria-label="Masquer le self-view" aria-pressed="${view?.selfViewHidden ?? false}">
                ${ICONS.selfview}
              </button>
              <button class="iconbtn ${connected ? (speakerMuted ? "toggled" : "") : "inactive"}"
                      data-act="speaker" ${connected ? "" : "disabled"}
                      title="${speakerMuted ? "Rétablir le son" : "Couper le son"}"
                      aria-label="Haut-parleur" aria-pressed="${speakerMuted}">
                ${ICONS.speaker}
              </button>
              <span class="dtmf-slot">
                <button class="iconbtn inactive" disabled title="Clavier DTMF (phase 4)" aria-label="Clavier DTMF">
                  ${ICONS.dtmf}
                </button><span class="phase-tag">ph. 4</span>
              </span>
            </div>
            <div class="time-row">
              <span class="chrono" ${connected ? "" : 'style="opacity:.45"'}>
                ${connected ? ICONS.clock : ""}<span data-ref="chrono">${
                  connected && view.connectedAt !== null ? fmtChrono(view.connectedAt) : "00:00:00"
                }</span>
              </span>
              ${
                view?.micMuted
                  ? `<span class="mute-flag">Micro coupé</span>`
                  : ""
              }
            </div>
          </div>
          <div class="calllog">
            <div class="calllog-head">
              <span>Historique</span>
              ${history.length ? `<button class="linkbtn" data-act="clear-history">Effacer</button>` : ""}
            </div>
            <div class="calllog-list">
              ${
                history.length
                  ? history.map(historyRow).join("")
                  : `<p class="calllog-empty">Aucun appel enregistré</p>`
              }
            </div>
          </div>
          <div class="chat-strip">
            ${ICONS.chat}<span>Tchat — disponible en phase 4</span>
          </div>
          <div class="sidefoot">
            <span class="fontsize">
              <button data-act="font-down" aria-label="Réduire la taille du texte">A−</button>
              <button data-act="font-up" aria-label="Augmenter la taille du texte">A+</button>
            </span>
            <button class="switch" data-act="theme" aria-label="Basculer le thème">
              ${currentTheme() === "dark" ? "Foncé" : "Clair"} <span class="track" aria-hidden="true"></span>
            </button>
          </div>
        </div>
      </div>
    </div>`);

  const on = (sel: string, fn: (elem: HTMLElement) => void): void => {
    const elem = node.querySelector(sel) as HTMLElement | null;
    if (elem) elem.addEventListener("click", () => fn(elem));
  };

  // --- barre d'en-tête -------------------------------------------------
  on('[data-act="settings"]', () => phone.send({ type: "ui:backToSettings" }));
  on('[data-act="logout"]', () => phone.send({ type: "ui:logout" }));
  on('[data-act="retry"]', () => phone.send({ type: "ui:retry" }));
  on('[data-act="fix-settings"]', () => phone.send({ type: "ui:backToSettings" }));

  // --- lancement d'appel ------------------------------------------------
  const targetInput = node.querySelector('[data-ref="target"]') as HTMLInputElement;
  if (!view) {
    targetInput.addEventListener("input", () => {
      draftTarget = targetInput.value;
    });
    targetInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") placeCall();
    });
  }
  const placeCall = (): void => {
    if (!ready || !cfg) return;
    const target = normalizeTarget(targetInput.value, cfg.domain);
    if (!target) {
      targetInput.classList.add("invalid");
      targetInput.focus();
      return;
    }
    phone.send({ type: "ui:call", target, media: currentMode().media });
  };
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
        const item = el(
          `<button role="menuitemradio" aria-checked="${m.id === currentMode().id}"
                   class="${m.id === currentMode().id ? "selected" : ""}">
             ${m.icon} ${esc(m.label)}${m.id === currentMode().id ? `<span class="check">✓</span>` : ""}
           </button>`,
        );
        item.addEventListener("click", () => {
          setCallModeId(m.id);
          const main = node.querySelector('[data-act="call"]');
          if (main) main.innerHTML = `${m.icon} ${esc(m.buttonLabel)}`;
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

  // --- commandes en communication ----------------------------------------
  on('[data-act="hangup"]', () => phone.send({ type: "ui:hangup" }));
  on('[data-act="muteMic"]', () => phone.send({ type: "ui:muteMic" }));
  on('[data-act="muteCam"]', () => phone.send({ type: "ui:muteCam" }));
  on('[data-act="selfview"]', () => phone.send({ type: "ui:toggleSelfView" }));
  // haut-parleur : UI pure (mute de l'élément <video> distant), pas de machine
  on('[data-act="speaker"]', (btn) => {
    speakerMuted = !speakerMuted;
    const remote = node.querySelector('[data-ref="remote"]') as HTMLVideoElement | null;
    if (remote) remote.muted = speakerMuted;
    btn.classList.toggle("toggled", speakerMuted);
    btn.setAttribute("aria-pressed", String(speakerMuted));
    btn.title = speakerMuted ? "Rétablir le son" : "Couper le son";
  });

  // --- historique ---------------------------------------------------------
  on('[data-act="clear-history"]', () => phone.send({ type: "ui:clearHistory" }));
  if (!view) {
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

  // --- préférences -------------------------------------------------------
  on('[data-act="font-down"]', () => bumpFont(-1));
  on('[data-act="font-up"]', () => bumpFont(1));
  on('[data-act="theme"]', (btn) => {
    toggleTheme();
    btn.childNodes[0]!.textContent = `${currentTheme() === "dark" ? "Foncé" : "Clair"} `;
  });

  // --- média, chrono, vu-mètres -------------------------------------------
  if (view) {
    const remote = node.querySelector('[data-ref="remote"]') as HTMLVideoElement;
    const self = node.querySelector('[data-ref="self"]') as HTMLVideoElement | null;
    remote.muted = speakerMuted;
    view.session?.attachMedia(remote, self);

    const zone = node.querySelector('[data-ref="videozone"]') as HTMLElement;
    zone.addEventListener("dblclick", () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void zone.requestFullscreen();
    });

    if (connected && view.connectedAt !== null) {
      const startedAt = view.connectedAt;
      const label = node.querySelector('[data-ref="chrono"]')!;
      chronoTimer = setInterval(() => {
        label.textContent = fmtChrono(startedAt);
      }, 1000);
      startVuMeters(node, remote, self);
    }
  }

  return node;
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
      if (bar) bar.style.height = `${Math.max(4, Math.min(100, Math.round(rms * 260)))}%`;
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
