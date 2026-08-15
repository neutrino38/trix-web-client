/**
 * Écran d'appel — phase 1 : la coque seulement (barre d'en-tête,
 * indicateur d'enregistrement, Paramètres, Déconnexion). La scène
 * vidéo et les commandes d'appel arrivent en phase 2.
 */

import type { PhoneInstance } from "../../machines/phone.js";
import { el, esc } from "../el.js";
import { logoSvg } from "../logo.js";

const STATUS: Record<string, { label: string; cls: "ok" | "warn" | "err" }> = {
  connecting: { label: "Connexion…", cls: "warn" },
  registering: { label: "Enregistrement…", cls: "warn" },
  ready: { label: "Enregistré", cls: "ok" },
  reg_failed: { label: "Échec d'enregistrement", cls: "err" },
  unregistering: { label: "Déconnexion…", cls: "warn" },
};

export function renderCall(phone: PhoneInstance): HTMLElement {
  const cfg = phone.context.config;
  const status = STATUS[phone.state] ?? { label: phone.state, cls: "warn" as const };
  const identity = cfg ? ` — ${esc(cfg.username)}@${esc(cfg.domain)}` : "";
  const failed = phone.state === "reg_failed";
  const err = phone.context.lastError;
  const errCode = phone.context.lastErrorCode;

  const node = el(`
    <div class="screen-call">
      <div class="topbar">
        <span class="logo">${logoSvg(26, false)}<span>STAURI</span></span>
        <span class="pill"><span class="dot ${status.cls}"></span>
          ${status.label}${phone.state === "ready" ? identity : ""}</span>
        <span class="spacer"></span>
        <button class="iconbtn" data-act="settings" title="Paramètres" aria-label="Paramètres">
          <svg viewBox="0 0 24 24"><path d="M4 6h10v2H4zM17 6h3v2h-3zM13 5h2v4h-2zM4 16h3v2H4zM10 16h10v2H10zM7 15h2v4H7zM4 11h14v2H4zM19 10h1v4h-1z"/></svg>
        </button>
        <button class="iconbtn" data-act="logout" title="Se déconnecter" aria-label="Se déconnecter">
          <svg viewBox="0 0 24 24"><path d="M10 17l5-5-5-5v3H3v4h7v3zM13 3h6c1.1 0 2 .9 2 2v14c0 1.1-.9 2-2 2h-6v-2h6V5h-6V3z"/></svg>
        </button>
      </div>
      <div class="stage">
        ${
          failed
            ? `${err ? `<div class="error-banner">${esc(err)}</div>` : ""}
               ${errCode ? `<span class="error-code">${esc(errCode)}</span>` : ""}
               <div class="error-actions">
                 <button class="btn primary" data-act="fix-settings">Corriger les paramètres</button>
                 <button class="btn" data-act="retry">Réessayer</button>
               </div>`
            : `<span>L'écran d'appel arrive en phase 2 — enregistrement SIP opérationnel.</span>`
        }
      </div>
    </div>`);

  node
    .querySelector('[data-act="settings"]')!
    .addEventListener("click", () => phone.send({ type: "ui:backToSettings" }));
  node
    .querySelector('[data-act="logout"]')!
    .addEventListener("click", () => phone.send({ type: "ui:logout" }));
  node
    .querySelector('[data-act="retry"]')
    ?.addEventListener("click", () => phone.send({ type: "ui:retry" }));
  node
    .querySelector('[data-act="fix-settings"]')
    ?.addEventListener("click", () => phone.send({ type: "ui:backToSettings" }));
  return node;
}
