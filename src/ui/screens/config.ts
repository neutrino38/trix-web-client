import type { PhoneInstance } from "../../machines/phone.js";
import { parseSipUri } from "../../sip/uri.js";
import { el, esc } from "../el.js";

export function renderConfig(phone: PhoneInstance): HTMLElement {
  const cfg = phone.context.config;
  const saving = phone.state === "saving";
  const err = phone.context.lastError;
  const errCode = phone.context.lastErrorCode;
  const suspect = phone.context.suspectFields;
  // "Mot de passe requis" (validation locale) ne vise que le mot de passe
  const inv = (f: "proxy" | "credentials"): string => (suspect === f ? " class=\"invalid\"" : "");

  const node = el(`
    <div class="screen-config">
      <form novalidate>
        <h2>Configuration du compte SIP</h2>
        ${err ? `<div class="error-banner">${esc(err)}</div>` : ""}
        ${errCode ? `<span class="error-code">${esc(errCode)}</span>` : ""}
        <div class="field">
          <label for="f-proxy">Serveur SIP</label>
          <input id="f-proxy" name="proxy" required placeholder="wss://sip.example.fr:8443/ws"
                 value="${cfg ? esc(cfg.proxy) : ""}"${inv("proxy")}>
        </div>
        <div class="field">
          <label for="f-uri">URI SIP</label>
          <input id="f-uri" name="uri" required autocomplete="username" placeholder="sip:alice@example.fr"
                 value="${cfg ? esc(`${cfg.username}@${cfg.domain}`) : ""}"${inv("credentials")}>
          <span class="hint">Avec ou sans le préfixe « sip: ». Le domaine sert de realm pour l'authentification.</span>
        </div>
        <div class="field">
          <label for="f-display">Display name</label>
          <input id="f-display" name="displayName" value="${cfg ? esc(cfg.displayName) : ""}">
        </div>
        <div class="field">
          <label class="checkline" for="f-auth-toggle">
            <input type="checkbox" id="f-auth-toggle" ${cfg?.authUsername ? "checked" : ""}>
            <span>Identifiant d'authentification (si différent de
              <b data-ref="userpart">${esc(cfg?.username ?? "l'utilisateur de l'URI")}</b>)</span>
          </label>
          <input id="f-auth" name="authUsername" autocomplete="off"
                 value="${cfg?.authUsername ? esc(cfg.authUsername) : ""}"
                 ${cfg?.authUsername ? "" : "disabled"}${inv("credentials")}>
        </div>
        <div class="field">
          <label for="f-pass">Mot de passe</label>
          <input id="f-pass" name="password" type="password" autocomplete="current-password"
                 placeholder="${cfg ? "•••••• (déjà défini)" : ""}" ${cfg ? "" : "required"}${inv("credentials")}>
          ${cfg ? `<span class="hint">Laisser vide pour conserver le mot de passe actuel.</span>` : ""}
        </div>
        <div class="note">Le mot de passe n'est pas conservé : seule une empreinte (HA1)
          est stockée, chiffrée, dans ce navigateur.</div>
        <div class="form-actions">
          <button class="btn primary" type="submit" ${saving ? "disabled" : ""}>
            ${saving ? "Enregistrement…" : "Enregistrer et se connecter"}
          </button>
          <button class="btn ghost" type="button" data-act="cancel" ${saving ? "disabled" : ""}>Annuler</button>
        </div>
      </form>
    </div>`);

  const form = node.querySelector("form")!;
  const authToggle = form.querySelector("#f-auth-toggle") as HTMLInputElement;
  const authInput = form.querySelector("#f-auth") as HTMLInputElement;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = (name: string): string =>
      (form.querySelector(`[name="${name}"]`) as HTMLInputElement).value.trim();
    const password = v("password");
    const authUsername = authToggle.checked ? v("authUsername") : "";
    phone.send({
      type: "ui:saveConfig",
      form: {
        proxy: v("proxy"),
        uri: v("uri"),
        displayName: v("displayName"),
        authUsername: authUsername === "" ? null : authUsername,
        password: password === "" ? null : password,
      },
    });
  });

  authToggle.addEventListener("change", () => {
    authInput.disabled = !authToggle.checked;
    if (authToggle.checked) authInput.focus();
  });

  // la mention « si différent de … » suit le userpart de l'URI en cours de saisie
  const uriInput = form.querySelector("#f-uri") as HTMLInputElement;
  const userpartRef = form.querySelector('[data-ref="userpart"]')!;
  uriInput.addEventListener("input", () => {
    const parsed = parseSipUri(uriInput.value);
    userpartRef.textContent = parsed?.username ?? "l'utilisateur de l'URI";
  });
  node
    .querySelector('[data-act="cancel"]')!
    .addEventListener("click", () => phone.send({ type: "ui:cancelConfig" }));
  // le surlignage s'efface dès que l'utilisateur corrige le champ
  for (const input of node.querySelectorAll("input.invalid")) {
    input.addEventListener("input", () => input.classList.remove("invalid"), { once: true });
  }
  return node;
}
