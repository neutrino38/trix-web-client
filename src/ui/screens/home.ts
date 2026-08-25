import { activeAccount, type PhoneInstance } from "../../machines/phone.js";
import { MAX_ACCOUNTS, addressOf } from "../../accounts.js";
import { el, esc } from "../el.js";
import { fslBadge, trixIcon } from "../logo.js";
import { langPicker, wireLangPicker } from "../langpicker.js";
import { t } from "../../i18n/index.js";
import { APP_VERSION } from "../../version.js";
import type { StoredAccount } from "../../storage/store.js";

/**
 * Une ligne de compte : de quoi le reconnaître, de quoi s'y enregistrer, et
 * de quoi le modifier. Le compte utilisé la dernière fois porte le bouton
 * plein — c'est celui qu'on rouvre le plus souvent, et il doit se cliquer
 * sans être lu.
 */
function accountRow(account: StoredAccount, active: boolean): string {
  const who = account.displayName.trim();
  return `<li class="account-row">
      <button class="btn ${active ? "primary" : ""}" data-act="use" data-id="${esc(account.id)}">
        ${esc(t("home.useAccount"))}
      </button>
      <span class="account-hint">${who ? `${esc(who)} — ` : ""}${esc(addressOf(account))}</span>
      <button class="btn ghost" data-act="edit" data-id="${esc(account.id)}">
        ${esc(t("home.editAccount"))}
      </button>
    </li>`;
}

export function renderHome(phone: PhoneInstance): HTMLElement {
  const { accounts } = phone.context;
  const active = activeAccount(phone.context);
  // Le coffre en tient deux (ADR 0002) ; passé la limite, l'accueil cesse
  // simplement de proposer d'en ajouter un. Rien d'autre ne change.
  const room = accounts.length < MAX_ACCOUNTS;
  const node = el(`
    <div class="screen-home">
      <div>
        ${trixIcon(200)}
        <h1>Trix Communicator</h1>
        <div class="tagline">${esc(t("home.tagline"))}</div>
        <!-- Le numéro de version : la première chose qu'on demande à qui
             signale une anomalie, et le seul écran où l'on est sûr qu'il
             sera passé. Il vient de package.json (voir src/version.ts). -->
        <div class="version">${esc(t("home.version", { version: APP_VERSION }))}</div>
      </div>
      <div class="actions">
        ${
          accounts.length > 0
            ? `<ul class="account-list">${accounts
                .map((a) => accountRow(a, a.id === active?.id))
                .join("")}</ul>`
            : ""
        }
        ${
          room
            ? `<button class="btn ${accounts.length > 0 ? "" : "primary"}" data-act="new">${esc(
                t(accounts.length > 0 ? "home.addAccount" : "home.newAccount"),
              )}</button>`
            : ""
        }
        <!-- La langue se choisit ici, avant tout le reste : c'est le premier
             écran, et c'est le seul endroit où l'on passe forcément avant
             d'avoir un compte à configurer. Les paramètres la reprennent,
             pour qui n'y revient plus. -->
        ${langPicker()}
      </div>
      ${fslBadge()}
    </div>`);
  for (const btn of node.querySelectorAll<HTMLElement>('[data-act="use"]')) {
    btn.addEventListener("click", () =>
      phone.send({ type: "ui:useAccount", id: btn.dataset.id! }),
    );
  }
  for (const btn of node.querySelectorAll<HTMLElement>('[data-act="edit"]')) {
    btn.addEventListener("click", () => phone.send({ type: "ui:configure", id: btn.dataset.id! }));
  }
  // `id: null` : un formulaire vide, et non celui d'un compte existant
  node
    .querySelector('[data-act="new"]')
    ?.addEventListener("click", () => phone.send({ type: "ui:configure", id: null }));
  wireLangPicker(node);
  return node;
}
