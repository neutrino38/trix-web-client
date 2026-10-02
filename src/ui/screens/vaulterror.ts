import type { PhoneInstance } from "../../machines/phone.js";
import { el, esc } from "../el.js";
import { trixIcon } from "../logo.js";
import { t } from "../../i18n/index.js";
import { APP_VERSION } from "../../version.js";

/**
 * The vault could not be read (`vault_error`). This screen exists so that
 * an unreadable vault never looks like an empty one: the home screen would
 * offer to create an account, and saving it would overwrite the ones that
 * are only unreadable.
 *
 * Trying again comes first and is the obvious button — a read cut short
 * by a slow start is the common case, and the accounts come back. Erasing
 * is there for a vault that will never decrypt, so the person is not
 * locked out for good; like deleting an account, it takes two clicks, the
 * second on a label that says what goes.
 */
export function renderVaultError(phone: PhoneInstance): HTMLElement {
  const err = phone.context.lastError;
  const node = el(`
    <div class="screen-home">
      <div>
        ${trixIcon(120)}
        <h1>${esc(t("vault.title"))}</h1>
        <div class="tagline">${esc(t("vault.explain"))}</div>
        ${err ? `<div class="error-banner" role="alert">${esc(t(err))}</div>` : ""}
        <div class="version">${esc(t("home.version", { version: APP_VERSION }))}</div>
      </div>
      <div class="actions">
        <button class="btn primary" data-act="retry">${esc(t("vault.retry"))}</button>
        <button class="btn danger" data-act="reset" data-armed="no">${esc(t("vault.reset"))}</button>
      </div>
    </div>`);
  node
    .querySelector('[data-act="retry"]')!
    .addEventListener("click", () => phone.send({ type: "ui:retryVault" }));
  const reset = node.querySelector<HTMLButtonElement>('[data-act="reset"]')!;
  reset.addEventListener("click", () => {
    if (reset.dataset.armed === "yes") {
      phone.send({ type: "ui:resetVault" });
      return;
    }
    reset.dataset.armed = "yes";
    reset.textContent = t("vault.resetConfirm");
  });
  // leaving the button disarms it, as on the settings screen
  reset.addEventListener("blur", () => {
    reset.dataset.armed = "no";
    reset.textContent = t("vault.reset");
  });
  return node;
}
