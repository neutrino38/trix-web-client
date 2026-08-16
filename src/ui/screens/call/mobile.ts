/**
 * Écran d'appel — vue mobile (portrait étroit).
 *
 * Hors appel : pastille d'état + Paramètres/Déconnexion en barre haute,
 * champ d'adresse (sans aide), bouton d'appel et son menu de mode, puis
 * l'historique. Ni vidéo ni contrôles média.
 *
 * En appel : l'adresse et l'historique disparaissent, la vidéo occupe
 * l'écran, les contrôles média sont en surimpression au bas de la vidéo
 * et le raccrochage est un bouton rond rouge à leur droite.
 *
 * Ce module ne contient que le gabarit ; tout le comportement vient de
 * `wireCallScreen` (parts.ts), partagé avec la vue bureau.
 */

import type { PhoneInstance } from "../../../machines/phone.js";
import { el, esc } from "../../el.js";
import { overlayBar } from "./overlay.js";
import { incomingDialog } from "./incoming.js";
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

export function renderMobile(phone: PhoneInstance): HTMLElement {
  const cfg = phone.context.config;
  const view = phone.state === "in_call" ? phone.context.call : null;
  const status = STATUS[phone.state] ?? { label: phone.state, cls: "warn" as const };
  const failed = phone.state === "reg_failed";
  const ready = phone.state === "ready";
  const reconnecting = phone.state === "reconnecting";
  const sleeping = phone.state === "sleeping";
  const connected = view?.state === "connected";
  const incoming = view?.state === "ringing_in";
  const speakerMuted = isSpeakerMuted();
  const err = phone.context.lastError;
  const errCode = phone.context.lastErrorCode;
  const callError = phone.context.callError;
  const history = phone.context.history;

  return el(`
    <div class="screen-call mobile">
      <div class="mtopbar">
        <span class="dot ${status.cls}" title="${esc(status.label)}"
              role="img" aria-label="${esc(status.label)}"></span>
        <span class="mstatus">${
          view ? `${CALL_LABEL[view.state]} — ${esc(displayTarget(view.target))}` : status.label
        }</span>
        <span class="spacer"></span>
        <button class="iconbtn ${view ? "inactive" : ""}" data-act="settings" ${view ? "disabled" : ""}
                aria-label="Paramètres">${ICONS.settings}</button>
        <button class="iconbtn ${view ? "inactive" : ""}" data-act="logout" ${view ? "disabled" : ""}
                aria-label="Se déconnecter">${ICONS.logout}</button>
      </div>

      ${
        // sonnerie : la scène reste au repos derrière la popup, seul endroit où
        // l'on répond ou refuse (voir incoming.ts)
        incoming
          ? `<div class="mvideo" inert>
               <div class="call-overlay">${CALL_LABEL.ringing_in}…<br>
                 <span class="target">${esc(displayTarget(view.target))}</span></div>
             </div>`
          : view
          ? `<div class="mvideo" data-ref="videozone">
               <video class="remote" data-ref="remote" autoplay playsinline></video>
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
                      </div>
                      <div class="mchrono">${ICONS.clock}<span data-ref="chrono">${fmtChrono(
                        view.connectedAt ?? Date.now(),
                      )}</span></div>`
                   : `<div class="call-overlay">${CALL_LABEL[view.state]}…<br>
                        <span class="target">${esc(displayTarget(view.target))}</span></div>`
               }
               ${overlayBar({ view, speakerMuted, withHangup: true })}
             </div>`
          : `<div class="mdial">
               ${
                 failed || reconnecting
                   ? `${err ? `<div class="error-banner">${esc(err)}</div>` : ""}
                      ${errCode ? `<span class="error-code">${esc(errCode)}</span>` : ""}
                      <div class="error-actions">
                        <button class="btn primary" data-act="retry">Réessayer</button>
                        <button class="btn" data-act="fix-settings">Paramètres</button>
                      </div>`
                   : ""
               }
               ${sleeping ? `<span class="idle-msg">Veille — reprise au réveil</span>` : ""}
               <div class="field">
                 <input id="f-target" data-ref="target" inputmode="email"
                        placeholder="Adresse SIP" aria-label="Adresse SIP"
                        value="${esc(draft())}">
                 ${callError ? `<span class="call-error">${esc(callError)}</span>` : ""}
               </div>
               <div class="splitbtn" data-ref="splitbtn">
                 <button class="btn call" data-act="call" ${ready ? "" : "disabled"}>
                   ${currentMode().icon} ${currentMode().buttonLabel}
                 </button>
                 <button class="btn caret" data-act="call-menu" ${ready ? "" : "disabled"}
                         aria-label="Choisir le mode d'appel" aria-expanded="false">▾</button>
                 <div class="dropdown" data-ref="modemenu" hidden></div>
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
             </div>`
      }
      ${incoming ? incomingDialog(view) : ""}
    </div>`);
}
