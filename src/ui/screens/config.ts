import type { PhoneInstance } from "../../machines/phone.js";
import { parseSipUri } from "../../sip/uri.js";
import { el, esc } from "../el.js";
import { alertPermission, requestAlertPermission } from "../alert.js";
import { setTheme, themeChoice, type ThemeChoice } from "../prefs.js";
import type { SuspectField } from "../../machines/events.js";

/**
 * État de la permission de notification — le seul canal d'alerte qui traverse
 * une fenêtre masquée. On dit toujours où il en est : une permission refusée
 * qu'on ne signale pas laisse croire à une alerte qui ne viendra jamais.
 */
function notificationRow(): string {
  switch (alertPermission()) {
    case "default":
      return `<button class="btn" type="button" data-act="enable-alerts">Activer les notifications</button>
              <span class="hint">Sans elles, Trix ne peut pas vous alerter quand la fenêtre est
                masquée ou réduite.</span>`;
    case "granted":
      return `<span class="setting-state ok">Notifications activées</span>`;
    case "denied":
      return `<span class="setting-state ko">Notifications bloquées par le navigateur</span>
              <span class="hint">À rétablir dans les réglages de site du navigateur : Trix ne peut
                pas redemander l'autorisation lui-même.</span>`;
    default:
      return ""; // navigateur sans Notification : rien à proposer
  }
}

const THEMES: { id: ThemeChoice; label: string }[] = [
  { id: "system", label: "Système" },
  { id: "light", label: "Clair" },
  { id: "dark", label: "Sombre" },
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
        <h2>Paramètres</h2>
        ${err ? `<div class="error-banner">${esc(err)}</div>` : ""}
        ${errCode ? `<span class="error-code">${esc(errCode)}</span>` : ""}
        <div class="config-cols">
        <section class="config-col">
        <h3>Compte SIP</h3>
        <div class="field">
          <label for="f-proxy">Serveur SIP</label>
          <input id="f-proxy" name="proxy" required placeholder="wss://sip.example.fr:8443/ws"
                 value="${cfg ? esc(cfg.proxy) : ""}"${inv("proxy")}>
        </div>
        <div class="field">
          <label for="f-uri">Adresse SIP</label>
          <input id="f-uri" name="uri" required autocomplete="username" placeholder="sip:alice@example.fr"
                 value="${cfg ? esc(`${cfg.username}@${cfg.domain}`) : ""}"${inv("credentials")}>
          <span class="hint">Avec ou sans le préfixe « sip: ». Le domaine sert de realm pour l'authentification.</span>
        </div>
        <div class="field">
          <label for="f-display">Votre nom</label>
          <input id="f-display" name="displayName" value="${cfg ? esc(cfg.displayName) : ""}">
        </div>
        <div class="field">
          <label class="checkline" for="f-auth-toggle">
            <input type="checkbox" id="f-auth-toggle" ${cfg?.authUsername ? "checked" : ""}>
            <span>Identifiant d'authentification (si différent de
              <b data-ref="userpart">${esc(cfg?.username ?? "l'utilisateur de l'adresse")}</b>)</span>
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

        </section>

        <section class="config-col">
        <h3>Traversée de NAT</h3>
        <p class="section-hint">Serveurs fournis par votre opérateur SIP. Sans eux, un appel
          entre deux réseaux privés peut aboutir sans qu'aucun son ne passe.</p>
        <div class="field">
          <label for="f-stun">Serveur STUN</label>
          <input id="f-stun" name="stun" autocomplete="off" placeholder="stun.example.fr:3478"
                 value="${cfg?.ice.stun ? esc(cfg.ice.stun) : ""}"${inv("stun")}>
          <span class="hint">Facultatif. Hôte seul ou hôte:port — sans port, 3478 est utilisé.</span>
        </div>
        <div class="field">
          <label for="f-turn">Serveur TURN</label>
          <input id="f-turn" name="turn" autocomplete="off" placeholder="turn.example.fr:3478"
                 value="${turn ? esc(turn.host) : ""}"${inv("turn")}>
          <span class="hint">Facultatif — relais des flux média quand la connexion directe
            échoue. Laisser vide pour ne pas en utiliser.</span>
        </div>
        <div class="field">
          <label for="f-turn-user">Identifiant TURN</label>
          <input id="f-turn-user" name="turnUsername" autocomplete="off"
                 value="${turn ? esc(turn.username) : ""}" ${turn ? "" : "disabled"}${inv("turn")}>
        </div>
        <div class="field">
          <label for="f-turn-pass">Mot de passe TURN</label>
          <input id="f-turn-pass" name="turnPassword" type="password" autocomplete="off"
                 placeholder="${turn ? "•••••• (déjà défini)" : ""}" ${turn ? "" : "disabled"}${inv("turn")}>
          ${turn ? `<span class="hint">Laisser vide pour conserver le mot de passe actuel.</span>` : ""}
        </div>
        <div class="field">
          <label class="checkline" for="f-turn-tls">
            <input type="checkbox" id="f-turn-tls" name="turnTls"
                   ${turn?.tls ? "checked" : ""} ${turn ? "" : "disabled"}>
            <span><b>TURN sur TLS</b> — relais chiffré (« turns: »), qui passe là où seul
              le trafic TLS est autorisé</span>
          </label>
          <span class="hint">Sans port explicite, 5349 est alors utilisé au lieu de 3478.</span>
        </div>
        <div class="note">Le mot de passe TURN, lui, est conservé (chiffré) : le relais réclame
          le secret lui-même à chaque appel, une empreinte n'y suffirait pas.</div>

        </section>

        <section class="config-col">
        <h3>Alertes et affichage</h3>
        <p class="section-hint">Ces réglages prennent effet immédiatement, sans attendre
          l'enregistrement — sauf le flash, qui suit le compte.</p>
        <div class="field">
          <label class="checkline" for="f-flash">
            <input type="checkbox" id="f-flash" name="flashAlert"
                   ${cfg?.flashAlert === false ? "" : "checked"}>
            <span><b>Flash visuel à l'appel entrant</b> — l'écran clignote pendant
              la sonnerie, pour être alerté sans le son</span>
          </label>
          <span class="hint">Enregistré avec le compte : il vous suit d'un poste à l'autre.</span>
        </div>
        <div class="field">
          <span class="field-title">Notifications système</span>
          ${notificationRow()}
        </div>
        <fieldset class="field">
          <legend class="field-title">Thème</legend>
          <div class="radio-row">
            ${THEMES.map(
              (t) => `<label class="radio">
                        <input type="radio" name="theme" value="${t.id}"
                               ${themeChoice() === t.id ? "checked" : ""}>
                        <span>${t.label}</span>
                      </label>`,
            ).join("")}
          </div>
          <span class="hint">« Système » suit le réglage clair/sombre de votre appareil.</span>
        </fieldset>
        </section>
        </div>
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
      row.innerHTML = `<span class="field-title">Notifications système</span>${notificationRow()}`;
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
    userpartRef.textContent = parsed?.username ?? "l'utilisateur de l'adresse";
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
