/**
 * Écran d'appel — vue bureau (mockup validé, écrans 3 et 3bis) :
 * barre d'en-tête, scène vidéo, sidebar (adresse, appel, contrôles média,
 * chrono, historique, préférences).
 *
 * Ce module ne contient que le gabarit ; tout le comportement vient de
 * `wireCallScreen` (parts.ts), partagé avec la vue mobile.
 */

import { activeAccount, type PhoneInstance } from "../../../machines/phone.js";
import { el, esc } from "../../el.js";
import { trixIcon } from "../../logo.js";
import { overlayBar } from "./overlay.js";
import { incomingDialog } from "./incoming.js";
import { mediaAskDialog } from "./mediaask.js";
import { shareStage } from "./share.js";
import { dtmfPad } from "./dtmf.js";
import { panelHandle } from "./panel.js";
import {
  chatAvailable,
  chatChannel,
  chatHead,
  chatOnStage,
  chatPane,
  chatStage,
  chatWritable,
} from "./chat.js";
import { statsPill } from "./stats.js";
import { pauseBanner, peerPauseNotice } from "./pause.js";
import { panelCollapsed, panelWidth } from "../../prefs.js";
import {
  ICONS,
  ICONS_OFF,
  callLabel,
  callerName,
  currentMode,
  displayTarget,
  draft,
  fmtChrono,
  historyRow,
  isSpeakerMuted,
  statusOf,
  switchButton,
} from "./parts.js";
import { t } from "../../../i18n/index.js";

export function renderDesktop(phone: PhoneInstance): HTMLElement {
  const cfg = activeAccount(phone.context);
  const view = phone.state === "in_call" ? phone.context.call : null;
  const status = statusOf(phone.state);
  const identity = cfg ? ` — ${esc(cfg.username)}@${esc(cfg.domain)}` : "";
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
  const width = panelWidth();
  // Le repli ne vaut qu'en communication : hors appel le panneau porte le
  // composeur, et pendant la sonnerie les boutons de réponse — le masquer
  // rendrait l'écran inutilisable, sans même un bouton pour le rouvrir
  // (la barre de surimpression n'existe pas dans ces deux états).
  const collapsed = !!view && !incoming && panelCollapsed();
  // Le tchat n'existe que si le texte est **négocié** (§4.9) : compte sans
  // texte, appel qui n'a pas encore de session (sonnerie entrante),
  // correspondant qui n'a pas suivi — dans tous ces cas la sidebar reste
  // celle d'avant, et le fil ne s'affiche pas plus qu'il ne s'écrit.
  const chat = chatAvailable(view);
  // L'appel porte un canal texte, mais le distant n'en a pas voulu : la
  // sidebar le dit d'une bande barrée là où le panneau se serait ouvert.
  // Sans elle, le tchat disparaîtrait sans un mot d'un appel qui l'avait
  // promis — le bouton barré de la barre mobile joue le même rôle.
  const chatOff = view !== null && !chat && chatChannel(view) !== null;
  // Un appel sans image donne la scène au tchat (§4.9) : le fil passe au
  // centre, et la sidebar n'en garde rien — un panneau vide à côté d'un fil
  // plein serait la même conversation affichée deux fois.
  const stageChat = chatOnStage(view);

  return el(`
    <div class="screen-call ${collapsed ? "panel-collapsed" : ""}">
      <div class="topbar">
        <span class="logo">${trixIcon(38)}<span>Trix</span></span>
        <span class="pill"><span class="dot ${status.cls}"></span>
          ${status.label}${ready ? identity : ""}</span>
        ${
          // en communication, la pastille découvre les statistiques média
          // (survol, focus ou clic — voir call/stats.ts)
          view
            ? statsPill(
                `<span class="dot live"></span>
                 ${esc(callLabel(view.state))} — ${esc(displayTarget(view.target))}`,
                { cls: "pill", connected },
              )
            : ""
        }
        ${
          connected
            ? `<span class="chrono">${ICONS.clock}<span data-ref="chrono">${
                view.connectedAt !== null ? fmtChrono(view.connectedAt) : "00:00:00"
              }</span></span>`
            : ""
        }
        <span class="spacer"></span>
        <!-- La bascule de compte, avant Paramètres : elle ne change pas les
             réglages, elle change d'identité (ADR 0002, décision 4). Absente
             tant qu'il n'y a qu'un compte. -->
        ${switchButton(phone, view !== null)}
        <button class="iconbtn ${view ? "inactive" : ""}" data-act="settings" ${view ? "disabled" : ""}
                title="${esc(t("action.settings") + (view ? t("action.unavailableInCall") : ""))}"
                aria-label="${esc(t("action.settings"))}">
          ${ICONS.settings}
        </button>
        <button class="iconbtn ${view ? "inactive" : ""}" data-act="logout" ${view ? "disabled" : ""}
                title="${esc(t("action.logout") + (view ? t("action.unavailableInCall") : ""))}"
                aria-label="${esc(t("action.logout"))}">
          ${ICONS.logout}
        </button>
      </div>
      <!-- pendant la sonnerie, la popup est la seule chose à laquelle répondre :
           \`inert\` retire tout le reste de l'écran au clavier comme à la souris,
           ce que \`aria-modal\` ne dit qu'aux lecteurs d'écran -->
      <div class="callbody" ${incoming ? "inert" : ""}>
        <div class="stage">
          ${
            // `view &&` : la scène de texte suppose un appel, et c'est ce qui
            // le dit au compilateur — `stageChat` seul le sait sans le prouver
            view && stageChat
              ? chatStage({
                  peer: callerName(view),
                  bar: overlayBar({
                    view,
                    speakerMuted,
                    // pas de plein écran : il n'y a pas d'image à agrandir,
                    // et le bouton serait grisé pour tout le monde
                    withHangup: true,
                    panel: { collapsed, controls: "call-panel" },
                  }),
                  meters: connected && view.media.audio,
                  // avant le décrochage, le fil se lit mais ne s'écrit pas —
                  // et un texte que le distant a refusé ne s'écrit jamais
                  writable: chatWritable(view),
                  dtmf: dtmfPad(view),
                  banner: `${peerPauseNotice(view)}${pauseBanner(view)}`,
                })
              : `<div class="video ${view?.peerSharing ? "sharing" : ""}" data-ref="videozone">
            ${
              incoming
                ? `<div class="call-overlay">${esc(callLabel("ringing_in"))}…<br>
                     <span class="target">${esc(displayTarget(view.target))}</span></div>`
                : view
                ? `<video class="remote" data-ref="remote" autoplay playsinline></video>
                   ${
                     // l'écran du correspondant prend la scène, et son visage
                     // la vignette (ADR 0005, D11) — c'est le CSS qui décide
                     // laquelle des deux surfaces occupe laquelle, pour que la
                     // permutation n'ait pas à reconstruire l'image
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
                          </div>`
                       : `<div class="call-overlay">${esc(callLabel(view.state))}…<br>
                            <span class="target">${esc(displayTarget(view.target))}</span></div>`
                   }
                   ${peerPauseNotice(view)}
                   ${dtmfPad(view)}
                   ${pauseBanner(view)}
                   ${overlayBar({
                     view,
                     speakerMuted,
                     withFullscreen: true,
                     // Raccrocher reste atteignable panneau replié : le rond
                     // rouge est rendu dans les deux cas, le CSS le montre
                     // quand la sidebar s'efface
                     withHangup: true,
                     panel: { collapsed, controls: "call-panel" },
                   })}`
                : failed
                  ? `${err ? `<div class="error-banner">${esc(t(err))}</div>` : ""}
                     ${errCode ? `<span class="error-code">${esc(errCode)}</span>` : ""}
                     <div class="error-actions">
                       <button class="btn primary" data-act="fix-settings">${esc(t("action.fixSettings"))}</button>
                       <button class="btn" data-act="retry">${esc(t("action.retry"))}</button>
                     </div>`
                  : reconnecting
                    ? `${err ? `<div class="error-banner">${esc(t(err))}</div>` : ""}
                       ${errCode ? `<span class="error-code">${esc(errCode)}</span>` : ""}
                       <span class="idle-msg">${esc(t("call.retryIn"))}</span>
                       <div class="error-actions">
                         <button class="btn primary" data-act="retry">${esc(t("action.retryNow"))}</button>
                         <button class="btn" data-act="fix-settings">${esc(t("action.settings"))}</button>
                       </div>`
                    : sleeping
                      ? `<span class="idle-msg">${esc(t("call.sleeping"))}</span>`
                      : `<span class="idle-msg">${esc(ready ? t("call.idle") : status.label)}</span>`
            }
          </div>`
          }
        </div>
        <div class="sidebar" id="call-panel" style="width:${width}px">
          ${panelHandle(width)}
          <div class="call-controls">
            <div class="field">
              <label for="f-target">${esc(t(incoming ? "call.callerLabel" : "call.targetLabel"))}</label>
              <input id="f-target" data-ref="target" ${view ? "disabled" : ""}
                     value="${view ? esc(displayTarget(view.target)) : esc(draft())}">
              ${
                cfg && !view
                  ? `<span class="hint">${t("call.domainHint", { domain: esc(cfg.domain) })}</span>`
                  : ""
              }
              ${callError && !view ? `<span class="call-error">${esc(t(callError))}</span>` : ""}
            </div>
            ${
              // pendant la sonnerie, répondre et refuser n'existent que dans la
              // popup : les doubler ici les rendrait inatteignables (l'écran est
              // `inert`) tout en laissant croire le contraire
              incoming
                ? ""
                : view
                ? `<button class="btn hangup ${view.state === "hangingup" ? "inactive" : ""}"
                           data-act="hangup" ${view.state === "hangingup" ? "disabled" : ""}>
                     ${ICONS.hangup} ${esc(t("ctrl.hangup"))}
                   </button>`
                : `<div class="splitbtn" data-ref="splitbtn">
                     <button class="btn call" data-act="call" ${ready ? "" : "disabled"}>
                       ${currentMode(cfg?.rtt).icon} ${currentMode(cfg?.rtt).buttonLabel}
                     </button>
                     <button class="btn caret" data-act="call-menu" ${ready ? "" : "disabled"}
                             aria-label="${esc(t("call.chooseMode"))}" aria-expanded="false">▾</button>
                     <div class="dropdown" data-ref="modemenu" hidden></div>
                   </div>`
            }
          </div>
          ${
            // l'historique quitte la sidebar dès qu'il y a un appel : il n'a
            // rien à dire pendant qu'on parle, et la place revient au tchat
            view
              ? ""
              : `<div class="calllog">
                   <div class="calllog-head">
                     <span>${esc(t("history.title"))}</span>
                     ${
                       history.length
                         ? `<button class="linkbtn" data-act="clear-history">${esc(
                             t("history.clear"),
                           )}</button>`
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
                 </div>`
          }
          ${
            // le tchat ne tient la sidebar que si la scène ne l'a pas pris :
            // c'est le cas de l'appel vidéo, où l'image occupe le centre
            chat && view && !stageChat
              ? chatHead(ICONS.chat) + chatPane(callerName(view), chatWritable(view))
              : ""
          }
          ${
            // hors appel, le tchat n'a pas lieu d'être : il naît avec le canal
            // de données et s'en va avec lui (§4.9). Un compte qui ne
            // transporte pas de texte n'en a même pas la promesse à afficher
            // — c'est le cas d'un déploiement `realtime_text: "none"`, où
            // plus rien de l'interface ne parle de tchat.
            chatOff && !stageChat
              ? `<div class="chat-strip off">${ICONS_OFF.chat}<span>${esc(
                  t("chat.stripRefused"),
                )}</span></div>`
              : view || cfg?.rtt === "none"
              ? ""
              : `<div class="chat-strip">${ICONS.chat}<span>${esc(t("chat.strip"))}</span></div>`
          }
          <div class="sidefoot">
            <span>${esc(t("prefs.fontSize"))}</span>
            <span class="fontsize">
              <button data-act="font-down" aria-label="${esc(t("prefs.fontDown"))}">A−</button>
              <button data-act="font-up" aria-label="${esc(t("prefs.fontUp"))}">A+</button>
            </span>
          </div>
        </div>
      </div>
      ${incoming ? incomingDialog(view) : ""}
      ${view?.mediaAsked !== null && view !== null ? mediaAskDialog(view) : ""}
    </div>`);
}
