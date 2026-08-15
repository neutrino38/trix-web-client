/**
 * Écran d'appel — vue bureau (mockup validé, écrans 3 et 3bis) :
 * barre d'en-tête, scène vidéo, sidebar (adresse, appel, contrôles média,
 * chrono, historique, préférences).
 *
 * Ce module ne contient que le gabarit ; tout le comportement vient de
 * `wireCallScreen` (parts.ts), partagé avec la vue mobile.
 */

import type { PhoneInstance } from "../../../machines/phone.js";
import { el, esc } from "../../el.js";
import { logoSvg } from "../../logo.js";
import { currentTheme } from "../../prefs.js";
import {
  CALL_LABEL,
  ICONS,
  STATUS,
  currentMode,
  displayTarget,
  draft,
  fmtChrono,
  historyRow,
  isSpeakerMuted,
} from "./parts.js";

export function renderDesktop(phone: PhoneInstance): HTMLElement {
  const cfg = phone.context.config;
  const view = phone.state === "in_call" ? phone.context.call : null;
  const status = STATUS[phone.state] ?? { label: phone.state, cls: "warn" as const };
  const identity = cfg ? ` — ${esc(cfg.username)}@${esc(cfg.domain)}` : "";
  const failed = phone.state === "reg_failed";
  const ready = phone.state === "ready";
  const reconnecting = phone.state === "reconnecting";
  const sleeping = phone.state === "sleeping";
  const connected = view?.state === "connected";
  const speakerMuted = isSpeakerMuted();
  const err = phone.context.lastError;
  const errCode = phone.context.lastErrorCode;
  const callError = phone.context.callError;
  const history = phone.context.history;

  return el(`
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
                     value="${view ? esc(displayTarget(view.target)) : esc(draft())}">
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
              ${view?.micMuted ? `<span class="mute-flag">Micro coupé</span>` : ""}
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
}
