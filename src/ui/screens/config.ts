import type { PhoneInstance } from "../../machines/phone.js";
import { parseSipUri } from "../../sip/uri.js";
import { el, esc } from "../el.js";
import { alertPermission, requestAlertPermission } from "../alert.js";
import { setTheme, themeChoice, type ThemeChoice } from "../prefs.js";
import type { SuspectField } from "../../machines/events.js";
import { langPicker, wireLangPicker } from "../langpicker.js";
import { t } from "../../i18n/index.js";
import type { MsgKey } from "../../i18n/types.js";

/**
 * État de la permission de notification — le seul canal d'alerte qui traverse
 * une fenêtre masquée. On dit toujours où il en est : une permission refusée
 * qu'on ne signale pas laisse croire à une alerte qui ne viendra jamais.
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
      return ""; // navigateur sans Notification : rien à proposer
  }
}

/** Le bloc « Notifications système » en entier — réécrit sur place après la demande. */
function notificationField(): string {
  return `<span class="field-title">${esc(t("config.notifications"))}</span>${notificationRow()}`;
}

const THEMES: { id: ThemeChoice; label: MsgKey }[] = [
  { id: "system", label: "theme.system" },
  { id: "light", label: "theme.light" },
  { id: "dark", label: "theme.dark" },
];

export function renderConfig(phone: PhoneInstance): HTMLElement {
  const cfg = phone.context.config;
  const saving = phone.state === "saving";
  const err = phone.context.lastError;
  const errCode = phone.context.lastErrorCode;
  const suspect = phone.context.suspectFields;
  // "Mot de passe requis" (validation locale) ne vise que le mot de passe
  const inv = (f: SuspectField): string => (suspect === f ? " class=\"invalid\"" : "");
  const turn = cfg?.ice.turn ?? null;

  const node = el(`
    <div class="screen-config">
      <form novalidate>
        <h2>${esc(t("config.title"))}</h2>
        ${err ? `<div class="error-banner">${esc(t(err))}</div>` : ""}
        ${errCode ? `<span class="error-code">${esc(errCode)}</span>` : ""}
        <div class="config-cols">
        <section class="config-col">
        <h3>${esc(t("config.section.account"))}</h3>
        <div class="field">
          <label for="f-proxy">${esc(t("config.proxy"))}</label>
          <input id="f-proxy" name="proxy" required placeholder="${esc(t("config.proxyPlaceholder"))}"
                 value="${cfg ? esc(cfg.proxy) : ""}"${inv("proxy")}>
        </div>
        <div class="field">
          <label for="f-uri">${esc(t("config.uri"))}</label>
          <input id="f-uri" name="uri" required autocomplete="username"
                 placeholder="${esc(t("config.uriPlaceholder"))}"
                 value="${cfg ? esc(`${cfg.username}@${cfg.domain}`) : ""}"${inv("credentials")}>
          <span class="hint">${esc(t("config.uriHint"))}</span>
        </div>
        <div class="field">
          <label for="f-display">${esc(t("config.displayName"))}</label>
          <input id="f-display" name="displayName" value="${cfg ? esc(cfg.displayName) : ""}">
        </div>
        <div class="field">
          <label class="checkline" for="f-auth-toggle">
            <input type="checkbox" id="f-auth-toggle" ${cfg?.authUsername ? "checked" : ""}>
            <span>${t("config.authToggle", {
              // le userpart est un fragment HTML : il se met à jour tout seul
              // à la saisie de l'adresse, sans réécrire la phrase autour
              user: `<b data-ref="userpart">${esc(cfg?.username ?? t("config.authUserDefault"))}</b>`,
            })}</span>
          </label>
          <input id="f-auth" name="authUsername" autocomplete="off"
                 value="${cfg?.authUsername ? esc(cfg.authUsername) : ""}"
                 ${cfg?.authUsername ? "" : "disabled"}${inv("credentials")}>
        </div>
        <div class="field">
          <label for="f-pass">${esc(t("config.password"))}</label>
          <input id="f-pass" name="password" type="password" autocomplete="current-password"
                 placeholder="${cfg ? esc(t("config.passwordSet")) : ""}" ${cfg ? "" : "required"}${inv("credentials")}>
          ${cfg ? `<span class="hint">${esc(t("config.passwordKeep"))}</span>` : ""}
        </div>
        <div class="note">${esc(t("config.ha1Note"))}</div>

        </section>

        <section class="config-col">
        <h3>${esc(t("config.section.nat"))}</h3>
        <p class="section-hint">${esc(t("config.natHint"))}</p>
        <div class="field">
          <label for="f-stun">${esc(t("config.stun"))}</label>
          <input id="f-stun" name="stun" autocomplete="off" placeholder="${esc(t("config.stunPlaceholder"))}"
                 value="${cfg?.ice.stun ? esc(cfg.ice.stun) : ""}"${inv("stun")}>
          <span class="hint">${esc(t("config.stunHint"))}</span>
        </div>
        <div class="field">
          <label for="f-turn">${esc(t("config.turn"))}</label>
          <input id="f-turn" name="turn" autocomplete="off" placeholder="${esc(t("config.turnPlaceholder"))}"
                 value="${turn ? esc(turn.host) : ""}"${inv("turn")}>
          <span class="hint">${esc(t("config.turnHint"))}</span>
        </div>
        <div class="field">
          <label for="f-turn-user">${esc(t("config.turnUser"))}</label>
          <input id="f-turn-user" name="turnUsername" autocomplete="off"
                 value="${turn ? esc(turn.username) : ""}" ${turn ? "" : "disabled"}${inv("turn")}>
        </div>
        <div class="field">
          <label for="f-turn-pass">${esc(t("config.turnPass"))}</label>
          <input id="f-turn-pass" name="turnPassword" type="password" autocomplete="off"
                 placeholder="${turn ? esc(t("config.passwordSet")) : ""}" ${turn ? "" : "disabled"}${inv("turn")}>
          ${turn ? `<span class="hint">${esc(t("config.turnPassKeep"))}</span>` : ""}
        </div>
        <div class="field">
          <label class="checkline" for="f-turn-tls">
            <input type="checkbox" id="f-turn-tls" name="turnTls"
                   ${turn?.tls ? "checked" : ""} ${turn ? "" : "disabled"}>
            <span><b>${esc(t("config.turnTlsLabel"))}</b>${esc(t("config.turnTlsDesc"))}</span>
          </label>
          <span class="hint">${esc(t("config.turnTlsHint"))}</span>
        </div>
        <div class="note">${esc(t("config.turnNote"))}</div>

        </section>

        <section class="config-col">
        <h3>${esc(t("config.section.alerts"))}</h3>
        <p class="section-hint">${esc(t("config.alertsHint"))}</p>
        <div class="field">
          <label class="checkline" for="f-flash">
            <input type="checkbox" id="f-flash" name="flashAlert"
                   ${cfg?.flashAlert === false ? "" : "checked"}>
            <span><b>${esc(t("config.flashLabel"))}</b>${esc(t("config.flashDesc"))}</span>
          </label>
          <span class="hint">${esc(t("config.flashHint"))}</span>
        </div>
        <div class="field">
          ${notificationField()}
        </div>
        <fieldset class="field">
          <legend class="field-title">${esc(t("config.theme"))}</legend>
          <div class="radio-row">
            ${THEMES.map(
              (theme) => `<label class="radio">
                        <input type="radio" name="theme" value="${theme.id}"
                               ${themeChoice() === theme.id ? "checked" : ""}>
                        <span>${esc(t(theme.label))}</span>
                      </label>`,
            ).join("")}
          </div>
          <span class="hint">${esc(t("config.themeHint"))}</span>
        </fieldset>
        <!-- La langue est aussi offerte à l'accueil, qu'on ne revoit plus
             une fois le compte enregistré : c'est ici qu'on la retrouve. -->
        ${langPicker()}
        <span class="hint">${esc(t("lang.hint"))}</span>
        </section>
        </div>
        <div class="form-actions">
          <button class="btn primary" type="submit" ${saving ? "disabled" : ""}>
            ${esc(t(saving ? "config.saving" : "config.save"))}
          </button>
          <button class="btn ghost" type="button" data-act="cancel" ${saving ? "disabled" : ""}>${esc(
            t("config.cancel"),
          )}</button>
        </div>
      </form>
    </div>`);

  const form = node.querySelector("form")!;
  const authToggle = form.querySelector("#f-auth-toggle") as HTMLInputElement;
  const authInput = form.querySelector("#f-auth") as HTMLInputElement;
  const flashToggle = form.querySelector("#f-flash") as HTMLInputElement;
  const turnInput = form.querySelector("#f-turn") as HTMLInputElement;
  // identifiants et TLS n'ont de sens qu'avec un serveur TURN : ils suivent le champ
  const turnDeps = [
    form.querySelector("#f-turn-user") as HTMLInputElement,
    form.querySelector("#f-turn-pass") as HTMLInputElement,
    form.querySelector("#f-turn-tls") as HTMLInputElement,
  ];
  const turnTls = turnDeps[2]!;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = (name: string): string =>
      (form.querySelector(`[name="${name}"]`) as HTMLInputElement).value.trim();
    const password = v("password");
    const turnPass = v("turnPassword");
    const authUsername = authToggle.checked ? v("authUsername") : "";
    phone.send({
      type: "ui:saveConfig",
      form: {
        proxy: v("proxy"),
        uri: v("uri"),
        displayName: v("displayName"),
        authUsername: authUsername === "" ? null : authUsername,
        password: password === "" ? null : password,
        flashAlert: flashToggle.checked,
        stun: v("stun"),
        turn: v("turn"),
        turnUsername: v("turnUsername"),
        turnPassword: turnPass === "" ? null : turnPass,
        turnTls: turnTls.checked,
      },
    });
  });

  turnInput.addEventListener("input", () => {
    const off = turnInput.value.trim() === "";
    for (const dep of turnDeps) dep.disabled = off;
  });

  authToggle.addEventListener("change", () => {
    authInput.disabled = !authToggle.checked;
    if (authToggle.checked) authInput.focus();
  });

  // --- réglages du navigateur : effet immédiat, hors soumission du formulaire ---

  // la permission ne peut être demandée que depuis un geste utilisateur ;
  // la ligne se réécrit sur place avec le nouvel état, quel qu'il soit
  node.querySelector('[data-act="enable-alerts"]')?.addEventListener("click", (e) => {
    const row = (e.currentTarget as HTMLElement).parentElement!;
    void requestAlertPermission().then(() => {
      row.innerHTML = notificationField();
    });
  });

  for (const radio of node.querySelectorAll<HTMLInputElement>('input[name="theme"]')) {
    radio.addEventListener("change", () => setTheme(radio.value as ThemeChoice));
  }

  // la mention « si différent de … » suit le userpart de l'URI en cours de saisie
  const uriInput = form.querySelector("#f-uri") as HTMLInputElement;
  const userpartRef = form.querySelector('[data-ref="userpart"]')!;
  uriInput.addEventListener("input", () => {
    const parsed = parseSipUri(uriInput.value);
    userpartRef.textContent = parsed?.username ?? t("config.authUserDefault");
  });
  node
    .querySelector('[data-act="cancel"]')!
    .addEventListener("click", () => phone.send({ type: "ui:cancelConfig" }));
  wireLangPicker(node);
  // le surlignage s'efface dès que l'utilisateur corrige le champ
  for (const input of node.querySelectorAll("input.invalid")) {
    input.addEventListener("input", () => input.classList.remove("invalid"), { once: true });
  }
  return node;
}
