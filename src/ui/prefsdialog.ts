/**
 * "Alertes et affichage": the settings that take effect at once, opened
 * from the main screen's header rather than buried in the account form.
 *
 * Same shape as the self-test and the SIP notebook: a native `<dialog>`,
 * which brings Escape, the focus trap, the inert background and the focus
 * given back for free. It lives on `<body>`, outside the screen the machine
 * redraws, so a re-render behind it does not close it — only a call does:
 * a modal left over the incoming-call popup would hide the one thing to
 * answer.
 *
 * Everything here is a browser setting (theme, language, notification
 * permission, reachability warning), except the incoming-call flash,
 * which belongs to the account and goes through the machine
 * (`ui:setFlashAlert`).
 */

import { activeAccount, type PhoneInstance } from "../machines/phone.js";
import { onLocaleChange, t } from "../i18n/index.js";
import type { MsgKey } from "../i18n/types.js";
import { alertPermission, requestAlertPermission } from "./alert.js";
import { esc } from "./el.js";
import { langPicker, wireLangPicker } from "./langpicker.js";
import { setTheme, themeChoice, type ThemeChoice } from "./prefs.js";
import { showSelfTestDialog } from "./selftest.js";

const THEMES: { id: ThemeChoice; label: MsgKey }[] = [
  { id: "system", label: "theme.system" },
  { id: "light", label: "theme.light" },
  { id: "dark", label: "theme.dark" },
];

/**
 * Where the notification permission stands — the only alert channel that
 * reaches a hidden window. Always said: a refusal left unsaid lets one
 * believe in an alert that will never come.
 */
function notificationRow(): string {
  switch (alertPermission()) {
    case "default":
      return `<button class="btn" type="button" data-act="enable-alerts">${esc(
        t("config.notifEnable"),
      )}</button>
              <span class="hint">${esc(t("config.notifHint"))}</span>`;
    case "granted":
      return `<span class="setting-state ok">${esc(t("config.notifOn"))}</span>`;
    case "denied":
      return `<span class="setting-state ko">${esc(t("config.notifBlocked"))}</span>
              <span class="hint">${esc(t("config.notifBlockedHint"))}</span>`;
    default:
      return ""; // no Notification in this browser: nothing to offer
  }
}

/** The whole "Notifications système" block — rewritten in place after the request. */
function notificationField(): string {
  return `<span class="field-title">${esc(t("config.notifications"))}</span>${notificationRow()}`;
}

/** The dialog's content, drawn again when the language changes under it. */
function prefsHtml(flash: boolean): string {
  return `<div class="stats-head">
      <div>
        <h2>${esc(t("config.section.alerts"))}</h2>
      </div>
      <div class="stats-actions">
        <button class="linkbtn" type="button" data-act="close">${esc(t("stats.close"))}</button>
      </div>
    </div>
    <div class="prefs-body">
      <div class="field">
        <label class="checkline" for="p-flash">
          <input type="checkbox" id="p-flash" ${flash ? "checked" : ""}>
          <span><b>${esc(t("config.flashLabel"))}</b>${esc(t("config.flashDesc"))}</span>
        </label>
        <span class="hint">${esc(t("config.flashHint"))}</span>
      </div>
      <div class="field" data-ref="notif">${notificationField()}</div>
      <fieldset class="field">
        <legend class="field-title">${esc(t("config.theme"))}</legend>
        <div class="radio-row">
          ${THEMES.map(
            (theme) => `<label class="radio">
                      <input type="radio" name="p-theme" value="${theme.id}"
                             ${themeChoice() === theme.id ? "checked" : ""}>
                      <span>${esc(t(theme.label))}</span>
                    </label>`,
          ).join("")}
        </div>
        <span class="hint">${esc(t("config.themeHint"))}</span>
      </fieldset>
      <!-- The off-call self-test (F.703 §4.4 note): a button, and a modal
           that gives the devices back when it leaves (ui/selftest.ts). -->
      <h3>${esc(t("selftest.section"))}</h3>
      <p class="section-hint">${esc(t("selftest.sectionHint"))}</p>
      <div class="field">
        <button class="btn" type="button" data-act="selftest">${esc(t("selftest.open"))}</button>
      </div>
      ${langPicker()}
      <span class="hint">${esc(t("lang.hint"))}</span>
    </div>`;
}

/** Opens the dialog. A second click while it is open does nothing more. */
export function showPrefsDialog(phone: PhoneInstance): void {
  if (document.querySelector("dialog.prefs-dialog")) return;
  const dlg = document.createElement("dialog");
  dlg.className = "stats-dialog prefs-dialog";
  let selfTest: HTMLDialogElement | null = null;

  const render = (): void => {
    dlg.innerHTML = prefsHtml(
      activeAccount(phone.context)?.flashAlert !== false,
    );

    const flash = dlg.querySelector<HTMLInputElement>("#p-flash")!;
    flash.addEventListener("change", () =>
      phone.send({ type: "ui:setFlashAlert", on: flash.checked }),
    );
    // the permission can only be asked from a user gesture; the row is
    // rewritten in place with the new state, whatever it is
    dlg
      .querySelector('[data-act="enable-alerts"]')
      ?.addEventListener("click", () => {
        void requestAlertPermission().then(() => {
          dlg.querySelector('[data-ref="notif"]')!.innerHTML =
            notificationField();
        });
      });
    for (const radio of dlg.querySelectorAll<HTMLInputElement>(
      'input[name="p-theme"]',
    )) {
      radio.addEventListener("change", () =>
        setTheme(radio.value as ThemeChoice),
      );
    }
    // opens the mic and camera: it has to start from a user gesture
    dlg
      .querySelector('[data-act="selftest"]')!
      .addEventListener("click", () => {
        selfTest = showSelfTestDialog();
      });
    dlg
      .querySelector('[data-act="close"]')!
      .addEventListener("click", () => dlg.close());
    wireLangPicker(dlg);
  };
  render();

  // the app redraws itself on a language change, but not what sits on <body>
  const offLocale = onLocaleChange(render);
  // a call coming in or going out takes the screen: the settings step aside,
  // and so does a self-test that would hold the microphone
  const offPhone = phone.subscribe((n) => {
    if (n.state === "in_call" || n.context.incoming) {
      selfTest?.close();
      dlg.close();
    }
  });

  // click on the backdrop, outside the frame: same gesture as Escape
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) dlg.close();
  });
  dlg.addEventListener("close", () => {
    offLocale();
    offPhone();
    dlg.remove();
  });
  document.body.appendChild(dlg);
  dlg.showModal();
}
