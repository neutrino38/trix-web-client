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

import { activeAccount, type PhoneInstance } from "../../../machines/phone.js";
import type { CallView } from "../../../machines/events.js";
import { el, esc } from "../../el.js";
import { overlayBar } from "./overlay.js";
import { incomingDialog } from "./incoming.js";
import { mediaAskDialog } from "./mediaask.js";
import { shareStage } from "./share.js";
import { dtmfPad } from "./dtmf.js";
import {
  CHAT_PANE_ID,
  chatAvailable,
  chatChannel,
  chatHead,
  chatMobileOpen,
  chatOnStage,
  chatPane,
  chatStage,
  chatWritable,
} from "./chat.js";
import { statsAvailable, statsPill } from "./stats.js";
import { pauseBanner, peerPauseNotice } from "./pause.js";
import {
  ICONS,
  callLabel,
  callerName,
  currentMode,
  displayTarget,
  draft,
  fmtChrono,
  historyRow,
  isSpeakerMuted,
  reachBanner,
  statusOf,
  switchButton,
} from "./parts.js";
import { t } from "../../../i18n/index.js";

export function renderMobile(phone: PhoneInstance): HTMLElement {
  const cfg = activeAccount(phone.context);
  const view = phone.state === "in_call" ? phone.context.call : null;
  const status = statusOf(phone.state);
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
  // le tchat n'existe que si le texte est **négocié** (§4.9) ; déplié, il
  // prend la place que la vidéo lui cède — ce n'est pas une couche de plus
  const chat = chatAvailable(view);
  // l'appel porte un canal texte dont le distant n'a pas voulu : le bouton
  // reste dans la barre, barré et inactif, au lieu de disparaître sans un
  // mot d'un appel qui promettait le tchat
  const chatOff = view !== null && !chat && chatChannel(view) !== null;
  // Un appel sans image lui donne l'écran entier (§4.9) : plus rien à
  // céder, donc plus de pli — ni classe sur la racine, ni bouton dans la
  // barre. Le fil est l'appel.
  const stageChat = chatOnStage(view);
  const chatOpen = chat && !stageChat && chatMobileOpen();

  return el(`
    <div class="screen-call mobile ${chatOpen ? "chat-open" : ""}">
      <div class="mtopbar">
        <span class="dot ${status.cls}" title="${esc(status.label)}"
              role="img" aria-label="${esc(status.label)}"></span>
        ${
          // en communication, l'état devient un bouton : les statistiques
          // média se découvrent au doigt, faute de survol (call/stats.ts)
          statsPill(
            view
              ? `${esc(callLabel(view.state))} — ${esc(displayTarget(view.target))}`
              : esc(status.label),
            { cls: "mstatus", connected },
          )
        }
        <span class="spacer"></span>
        ${
          // Scène de texte : le chrono n'a plus d'image où se poser, il rejoint
          // la barre haute — comme sur bureau. Le mettre dans le bandeau de
          // commandes en aurait chassé Raccrocher hors de l'écran à 390 px.
          stageChat && connected
            ? `<span class="mchrono flat">${ICONS.clock}<span data-ref="chrono">${fmtChrono(
                view.connectedAt ?? Date.now(),
              )}</span></span>`
            : ""
        }
        ${switchButton(phone, view !== null)}
        <button class="iconbtn ${view ? "inactive" : ""}" data-act="settings" ${view ? "disabled" : ""}
                aria-label="${esc(t("action.settings"))}">${ICONS.settings}</button>
        <button class="iconbtn ${view ? "inactive" : ""}" data-act="logout" ${view ? "disabled" : ""}
                aria-label="${esc(t("action.logout"))}">${ICONS.logout}</button>
      </div>
      <!-- la joignabilité, sous la barre comme sur bureau (ADR 0006, D2) -->
      ${reachBanner(phone)}

      ${
        // sonnerie : la scène reste au repos derrière la popup, seul endroit où
        // l'on répond ou refuse (voir incoming.ts)
        incoming
          ? `<div class="mvideo" inert>
               <div class="call-overlay">${esc(callLabel("ringing_in"))}…<br>
                 <span class="target">${esc(displayTarget(view.target))}</span></div>
             </div>`
          : view && stageChat
          ? chatStage({
              peer: callerName(view),
              bar: overlayBar({
                view,
                speakerMuted,
                withHangup: true,
                compact: true,
                withStats: statsAvailable(connected),
              }),
              // pas de vu-mètres ici : à 390 px, cinq commandes et le rond
              // rouge tiennent tout juste le bandeau. L'audio entrant se voit
              // quand même — le haut-parleur s'allume dessus (`startVuMeters`)
              meters: false,
              // avant le décrochage, le fil se lit mais ne s'écrit pas — et
              // un texte que le distant a refusé ne s'écrit jamais
              writable: chatWritable(view),
              dtmf: dtmfPad(view),
              // la scène de texte a aussi son bandeau : un appel qu'on lit
              // reste un appel dont on émet le son (§4.9)
              banner: `${peerPauseNotice(view)}${pauseBanner(view)}`,
            })
          : view
          ? `<div class="mvideo ${view.peerSharing ? "sharing" : ""}" data-ref="videozone">
               <video class="remote" data-ref="remote" autoplay playsinline></video>
               ${
                 // l'écran reçu prend la scène, le visage la vignette (D11) :
                 // sur 390 px, c'est la seule mise en scène qui laisse les
                 // deux lisibles — et la permutation la rend au visage
                 shareStage(view, callerName(view))
               }
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
                   : `<div class="call-overlay">${esc(callLabel(view.state))}…<br>
                        <span class="target">${esc(displayTarget(view.target))}</span></div>`
               }
               ${peerPauseNotice(view)}
               ${dtmfPad(view)}
               ${pauseBanner(view)}
               ${overlayBar({
                 view,
                 speakerMuted,
                 withHangup: true,
                 // la barre mobile est celle des deux axes (ADR 0003, D6/D8) :
                 // quatre icônes dans la pastille, le reste dans la feuille du
                 // bas, la Pause et le raccrochage dehors
                 compact: true,
                 // le plein écran a du sens ici : c'est lui qui fait
                 // disparaître la barre d'adresse du navigateur mobile
                 withFullscreen: true,
                 withStats: statsAvailable(connected),
                 ...(chat
                   ? { chat: { open: chatOpen, controls: CHAT_PANE_ID } }
                   : chatOff
                     ? { chat: { open: false, controls: CHAT_PANE_ID, unavailable: true } }
                     : {}),
               })}
             </div>
             ${chat ? mobileChat(view) : ""}`
          : `<div class="mdial">
               ${
                 failed || reconnecting
                   ? `${err ? `<div class="error-banner">${esc(t(err))}</div>` : ""}
                      ${errCode ? `<span class="error-code">${esc(errCode)}</span>` : ""}
                      <div class="error-actions">
                        <button class="btn primary" data-act="retry">${esc(t("action.retry"))}</button>
                        <button class="btn" data-act="fix-settings">${esc(t("action.settings"))}</button>
                      </div>`
                   : ""
               }
               ${sleeping ? `<span class="idle-msg">${esc(t("call.sleepingShort"))}</span>` : ""}
               <div class="field">
                 <input id="f-target" data-ref="target" inputmode="email"
                        placeholder="${esc(t("call.targetLabel"))}" aria-label="${esc(t("call.targetLabel"))}"
                        value="${esc(draft())}">
                 ${callError ? `<span class="call-error">${esc(t(callError))}</span>` : ""}
               </div>
               <div class="splitbtn" data-ref="splitbtn">
                 <button class="btn call" data-act="call" ${ready ? "" : "disabled"}>
                   ${currentMode(cfg?.rtt).icon} ${currentMode(cfg?.rtt).buttonLabel}
                 </button>
                 <button class="btn caret" data-act="call-menu" ${ready ? "" : "disabled"}
                         aria-label="${esc(t("call.chooseMode"))}" aria-expanded="false">▾</button>
                 <div class="dropdown" data-ref="modemenu" hidden></div>
               </div>
               <div class="calllog">
                 <div class="calllog-head">
                   <span>${esc(t("history.title"))}</span>
                   ${
                     history.length
                       ? `<button class="linkbtn" data-act="clear-history">${esc(t("history.clear"))}</button>`
                       : ""
                   }
                 </div>
                 <div class="calllog-list">
                   ${
                     history.length
                       ? history.map((e, i) => historyRow(e, i)).join("")
                       : `<p class="calllog-empty">${esc(t("history.empty"))}</p>`
                   }
                 </div>
               </div>
             </div>`
      }
      ${incoming ? incomingDialog(view) : ""}
      ${view?.mediaAsked !== null && view !== null ? mediaAskDialog(view) : ""}
    </div>`);
}

/**
 * Le tchat mobile : un en-tête minuscule — il n'y a pas d'onglets là où il
 * n'y a pas de sidebar — et le même panneau que sur le bureau.
 */
function mobileChat(view: CallView): string {
  return `<div class="mchat">
      ${chatHead(ICONS.chat)}
      ${chatPane(callerName(view), chatWritable(view))}
    </div>`;
}
