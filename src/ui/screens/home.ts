import type { PhoneInstance } from "../../machines/phone.js";
import { el, esc } from "../el.js";
import { fslBadge, trixIcon } from "../logo.js";
import { langPicker, wireLangPicker } from "../langpicker.js";
import { t } from "../../i18n/index.js";

export function renderHome(phone: PhoneInstance): HTMLElement {
  const cfg = phone.context.config;
  const node = el(`
    <div class="screen-home">
      <div>
        ${trixIcon(200)}
        <h1>Trix Communicator</h1>
        <div class="tagline">${esc(t("home.tagline"))}</div>
      </div>
      <div class="actions">
        ${
          cfg
            ? `<button class="btn primary" data-act="use">${esc(t("home.useAccount"))}</button>
               <span class="account-hint">${esc(cfg.displayName)} — ${esc(cfg.username)}@${esc(cfg.domain)}</span>`
            : ""
        }
        <button class="btn ${cfg ? "" : "primary"}" data-act="new">${esc(t("home.newAccount"))}</button>
        <!-- La langue se choisit ici, avant tout le reste : c'est le premier
             écran, et c'est le seul endroit où l'on passe forcément avant
             d'avoir un compte à configurer. Les paramètres la reprennent,
             pour qui n'y revient plus. -->
        ${langPicker()}
      </div>
      ${fslBadge()}
    </div>`);
  node
    .querySelector('[data-act="use"]')
    ?.addEventListener("click", () => phone.send({ type: "ui:useAccount" }));
  node
    .querySelector('[data-act="new"]')!
    .addEventListener("click", () => phone.send({ type: "ui:configure" }));
  wireLangPicker(node);
  return node;
}
