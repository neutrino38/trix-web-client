import type { PhoneInstance } from "../../machines/phone.js";
import { el, esc } from "../el.js";
import { fslBadge, trixIcon } from "../logo.js";

export function renderHome(phone: PhoneInstance): HTMLElement {
  const cfg = phone.context.config;
  const node = el(`
    <div class="screen-home">
      <div>
        ${trixIcon(200)}
        <h1>Trix Communicator</h1>
        <div class="tagline">Webphone conversation totale</div>
      </div>
      <div class="actions">
        ${
          cfg
            ? `<button class="btn primary" data-act="use">Utiliser le compte</button>
               <span class="account-hint">${esc(cfg.displayName)} — ${esc(cfg.username)}@${esc(cfg.domain)}</span>`
            : ""
        }
        <button class="btn ${cfg ? "" : "primary"}" data-act="new">Configurer un nouveau compte</button>
      </div>
      ${fslBadge()}
    </div>`);
  node
    .querySelector('[data-act="use"]')
    ?.addEventListener("click", () => phone.send({ type: "ui:useAccount" }));
  node
    .querySelector('[data-act="new"]')!
    .addEventListener("click", () => phone.send({ type: "ui:configure" }));
  return node;
}
