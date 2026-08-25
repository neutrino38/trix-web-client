import { editedAccount, type PhoneInstance } from "../../machines/phone.js";
import { parseSipUri } from "../../sip/uri.js";
import { el, esc } from "../el.js";
import { alertPermission, requestAlertPermission } from "../alert.js";
import { setTheme, themeChoice, type ThemeChoice } from "../prefs.js";
import { setSipTrace, sipTraceEnabled } from "../../sip/trace.js";
import type { SuspectField } from "../../machines/events.js";
import { langPicker, wireLangPicker } from "../langpicker.js";
import { t } from "../../i18n/index.js";
import type { Msg, MsgKey } from "../../i18n/types.js";
import { DEFAULT_RTT_TRANSPORT, RTT_TRANSPORTS, type RttTransport } from "../../sip/rtt.js";
import { deployment } from "../../deployment.js";
import { shareUrl } from "../../share/link.js";
import { showToast } from "../toast.js";
import { RTT_LABELS } from "../rttlabels.js";

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

/**
 * Le bandeau d'erreur du formulaire et son code technique, réécrits sur
 * place après une validation refusée.
 *
 * Sur place, et non par un re-rendu : un refus laisse la machine dans le
 * même état (`stay`), et l'écran ne se reconstruit pas — ce qui est heureux,
 * puisqu'il effacerait la saisie en cours (ui/app.ts). Sans cette réécriture,
 * une adresse hors du domaine imposé ou un mot de passe manquant seraient
 * refusés sans un mot à l'écran.
 */
function errorSlot(err: Msg | null, code: string | null): string {
  return `${err ? `<div class="error-banner" role="alert">${esc(t(err))}</div>` : ""}${
    code ? `<span class="error-code">${esc(code)}</span>` : ""
  }`;
}

/**
 * Le lien affiché en clair, quand le presse-papier n'a pas voulu de lui.
 * Le champ est en lecture seule et sélectionné : il ne reste qu'à copier.
 * Il remplace le bouton plutôt que de s'ajouter dessous — un bouton
 * « Copier » qui ne copie pas ne doit pas rester cliquable.
 */
function showShareFallback(node: HTMLElement, link: string): void {
  const btn = node.querySelector('[data-act="share"]');
  if (!btn) return;
  const box = el(
    `<input class="share-link" type="text" readonly aria-label="${esc(
      t("config.shareManual"),
    )}" value="${esc(link)}">`,
  ) as HTMLInputElement;
  btn.replaceWith(box);
  box.focus();
  box.select();
}

/**
 * Le userpart proposé quand le déploiement impose le domaine : le champ
 * part de `user@domaine` et cette moitié-là est sélectionnée à la prise de
 * focus. C'est la seule chose qui reste à saisir, autant la désigner.
 */
const URI_USER = "user";

export function renderConfig(phone: PhoneInstance): HTMLElement {
  // Le compte que le formulaire modifie — pas forcément l'actif : on
  // corrige le compte au repos pendant que l'autre est enregistré
  // (machines/phone.ts). `null` en création.
  const cfg = editedAccount(phone.context);
  const saving = phone.state === "saving" || phone.state === "deleting";
  const err = phone.context.lastError;
  const errCode = phone.context.lastErrorCode;
  const suspect = phone.context.suspectFields;
  // "Mot de passe requis" (validation locale) ne vise que le mot de passe.
  // `data-suspect` reste sur le champ : c'est par lui que le surlignage se
  // repose après un échec, sans re-rendre l'écran (`refreshError`).
  const inv = (f: SuspectField): string =>
    ` data-suspect="${f}"${suspect === f ? ' class="invalid"' : ""}`;
  const turn = cfg?.ice.turn ?? null;
  /**
   * Ce que l'exploitant a fixé dans `config.json` (src/deployment.ts) :
   * chaque réglage imposé **disparaît** d'ici plutôt que de s'afficher
   * grisé. Un champ qu'on ne peut pas changer n'a pas à être lu, et un
   * formulaire qui n'en montre que la moitié se remplit deux fois plus
   * vite. La machine, elle, ne lit pas davantage ces champs : ce qui suit
   * est de l'affichage, pas de la sécurité (machines/phone.ts).
   */
  const dep = deployment();
  // La colonne du milieu porte deux sections indépendantes ; elle ne
  // disparaît que lorsque le déploiement les a prises toutes les deux.
  const natCol = dep.ice === null || dep.rtt === null;
  const uriValue = cfg
    ? `${cfg.username}@${cfg.domain}`
    : dep.domain
      ? `${URI_USER}@${dep.domain}`
      : "";
  const uriUser = cfg?.username ?? (dep.domain ? URI_USER : t("config.authUserDefault"));

  /**
   * La traversée de NAT, en entier ou pas du tout : STUN et TURN sont
   * fournis ensemble par l'opérateur, et n'en imposer qu'un laisserait une
   * demi-section à remplir. Le déploiement qui en parle les prend donc tous
   * les deux, et la section s'en va (src/deployment.ts).
   */
  const natSection = dep.ice
    ? ""
    : `          <h3>${esc(t("config.section.nat"))}</h3>
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
          <div class="note">${esc(t("config.turnNote"))}</div>`;

  /**
   * Le transport du texte : imposé, il n'y a plus de choix à offrir — et
   * quand c'est `none` qui est imposé, il n'y a plus de texte du tout,
   * donc plus une mention du tchat nulle part (§4.9).
   */
  const rttSection = dep.rtt !== null ? "" : `          <!-- Le texte en temps réel voyage par un tuyau que la plateforme
               de l'opérateur choisit : il est ici, avec les autres réglages
               de transport, et non avec les réglages d'affichage. -->
          <h3>${esc(t("config.section.rtt"))}</h3>
          <p class="section-hint">${esc(t("config.rttHint"))}</p>
          <fieldset class="field">
            <legend class="field-title">${esc(t("config.rttTransport"))}</legend>
            <div class="radio-col">
              ${RTT_TRANSPORTS.map(
                (id) => `<label class="radio">
                          <input type="radio" name="rtt" value="${id}"
                                 ${(cfg?.rtt ?? DEFAULT_RTT_TRANSPORT) === id ? "checked" : ""}>
                          <span><b>${esc(t(RTT_LABELS[id].label))}</b>${esc(
                            t(RTT_LABELS[id].desc),
                          )}</span>
                        </label>`,
              ).join("")}
            </div>
            <span class="hint">${esc(t("config.rttNote"))}</span>
          </fieldset>`;

  const node = el(`
    <div class="screen-config">
      <form novalidate>
        <h2>${esc(t(cfg ? "config.title" : "config.titleNew"))}</h2>
        <div class="error-slot" data-ref="errslot">${errorSlot(err, errCode)}</div>
        <div class="config-cols${natCol ? "" : " cols-2"}">
        <section class="config-col">
        <h3>${esc(t("config.section.account"))}</h3>
        ${
          // serveur imposé : ni champ ni mention — l'adresse du proxy est
          // une affaire d'exploitation, pas une préférence
          dep.proxy
            ? ""
            : `<div class="field">
          <label for="f-proxy">${esc(t("config.proxy"))}</label>
          <input id="f-proxy" name="proxy" required placeholder="${esc(t("config.proxyPlaceholder"))}"
                 value="${cfg ? esc(cfg.proxy) : ""}"${inv("proxy")}>
        </div>`
        }
        <div class="field">
          <label for="f-uri">${esc(t("config.uri"))}</label>
          <input id="f-uri" name="uri" required autocomplete="username"
                 placeholder="${esc(t("config.uriPlaceholder"))}"
                 value="${esc(uriValue)}"${inv("credentials")}>
          <span class="hint">${esc(
            dep.domain ? t("config.uriHintDomain", { domain: dep.domain }) : t("config.uriHint"),
          )}</span>
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
              user: `<b data-ref="userpart">${esc(uriUser)}</b>`,
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
        ${
          // Partager, c'est partager de quoi s'authentifier : le lien porte
          // le HA1, et le mot de passe TURN s'il y en a un. L'avertissement
          // reste sous le bouton plutôt que de passer dans un bandeau — il
          // vaut au moment où l'on hésite à envoyer le lien, pas trois
          // secondes après l'avoir copié (share/link.ts).
          //
          // Rien à partager d'un formulaire de création : le compte n'existe
          // pas encore, et son HA1 non plus.
          cfg
            ? `<div class="field">
          <span class="field-title">${esc(t("config.share"))}</span>
          <button class="btn" type="button" data-act="share">${esc(t("config.shareCopy"))}</button>
          <span class="hint warn">${esc(t("config.shareWarn"))}</span>
        </div>`
            : ""
        }

        </section>

        ${
          // les deux sections de cette colonne peuvent partir séparément ;
          // la colonne elle-même ne disparaît que quand il ne reste rien
          natCol ? `<section class="config-col">${natSection}${rttSection}
        </section>` : ""
        }

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

        ${
          // Le diagnostic ferme la colonne des réglages locaux : il n'a rien
          // à voir avec le compte, ne s'enregistre pas, et n'intéresse qu'un
          // dépannage en cours. Le déploiement peut le retirer d'un mot
          // (`debug_activated: "no"`) : la trace est alors éteinte pour de
          // bon, la proposer serait mentir (sip/trace.ts).
          dep.debug
            ? `<h3>${esc(t("config.section.diag"))}</h3>
        <div class="field">
          <label class="checkline" for="f-siptrace">
            <input type="checkbox" id="f-siptrace" ${sipTraceEnabled() ? "checked" : ""}>
            <span><b>${esc(t("config.traceLabel"))}</b>${esc(t("config.traceDesc"))}</span>
          </label>
          <span class="hint">${esc(t("config.traceHint"))}</span>
        </div>`
            : ""
        }
        </section>
        </div>
        <div class="form-actions">
          <button class="btn primary" type="submit" ${saving ? "disabled" : ""}>
            ${esc(t(saving ? "config.saving" : "config.save"))}
          </button>
          <button class="btn ghost" type="button" data-act="cancel" ${saving ? "disabled" : ""}>${esc(
            t("config.cancel"),
          )}</button>
          ${
            // Supprimer emporte le compte **et son historique**, sans retour
            // possible : le bouton demande donc deux clics, le second sur un
            // libellé qui dit ce qui va disparaître. Pas de `confirm()` —
            // une modale native ne se traduit pas, ne se met pas au thème,
            // et bloque la page tant qu'elle est là.
            cfg
              ? `<span class="spacer"></span>
          <button class="btn danger" type="button" data-act="delete" ${saving ? "disabled" : ""}
                  data-armed="no">${esc(t("config.delete"))}</button>`
              : ""
          }
        </div>
      </form>
    </div>`);

  const form = node.querySelector("form")!;
  const authToggle = form.querySelector("#f-auth-toggle") as HTMLInputElement;
  const authInput = form.querySelector("#f-auth") as HTMLInputElement;
  const flashToggle = form.querySelector("#f-flash") as HTMLInputElement;
  // Champs que le déploiement peut avoir emportés : ils se cherchent, ils
  // ne s'affirment pas. `null` ici n'est pas un écran cassé, c'est un
  // réglage qui ne se discute plus.
  const turnInput = form.querySelector<HTMLInputElement>("#f-turn");
  // identifiants et TLS n'ont de sens qu'avec un serveur TURN : ils suivent le champ
  const turnDeps = [
    form.querySelector<HTMLInputElement>("#f-turn-user"),
    form.querySelector<HTMLInputElement>("#f-turn-pass"),
    form.querySelector<HTMLInputElement>("#f-turn-tls"),
  ];
  const turnTls = turnDeps[2];

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    // un champ absent rend la chaîne vide : c'est ce que la machine attend
    // pour « rien saisi », et elle prendra de toute façon la valeur imposée
    const v = (name: string): string =>
      form.querySelector<HTMLInputElement>(`[name="${name}"]`)?.value.trim() ?? "";
    const password = v("password");
    const turnPass = v("turnPassword");
    const authUsername = authToggle.checked ? v("authUsername") : "";
    const rtt = form.querySelector<HTMLInputElement>('input[name="rtt"]:checked');
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
        turnTls: turnTls?.checked ?? false,
        rtt: (rtt?.value as RttTransport | undefined) ?? DEFAULT_RTT_TRANSPORT,
      },
    });
    // refusée, la soumission laisse la machine où elle est : c'est ici, et
    // nulle part ailleurs, que l'écran apprend pourquoi
    refreshError();
  });

  /** Repose le bandeau et le surlignage sur ce que la machine vient de dire. */
  function refreshError(): void {
    const slot = form.querySelector('[data-ref="errslot"]')!;
    slot.innerHTML = errorSlot(phone.context.lastError, phone.context.lastErrorCode);
    const bad = phone.context.suspectFields;
    for (const field of form.querySelectorAll<HTMLElement>("[data-suspect]")) {
      field.classList.toggle("invalid", field.dataset.suspect === bad);
    }
  }

  turnInput?.addEventListener("input", () => {
    const off = turnInput.value.trim() === "";
    for (const field of turnDeps) if (field) field.disabled = off;
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

  // la trace n'est pas un champ du formulaire : elle ne part pas chez le
  // registrar et ne doit pas attendre l'enregistrement pour s'allumer —
  // le socket relit ce réglage à chaque paquet
  const traceToggle = node.querySelector<HTMLInputElement>("#f-siptrace");
  traceToggle?.addEventListener("change", () => setSipTrace(traceToggle.checked));

  // la mention « si différent de … » suit le userpart de l'URI en cours de saisie
  const uriInput = form.querySelector("#f-uri") as HTMLInputElement;
  const userpartRef = form.querySelector('[data-ref="userpart"]')!;
  uriInput.addEventListener("input", () => {
    const parsed = parseSipUri(uriInput.value);
    userpartRef.textContent = parsed?.username ?? t("config.authUserDefault");
  });
  // Domaine imposé, champ encore au gabarit : la prise de focus sélectionne
  // `user` pour qu'il suffise de taper par-dessus. Le domaine, lui, ne se
  // retape pas — et il ne serait pas accepté autrement (machines/phone.ts).
  if (!cfg && dep.domain) {
    uriInput.addEventListener("focus", () => {
      if (uriInput.value === uriValue) uriInput.setSelectionRange(0, URI_USER.length);
    });
  }
  node
    .querySelector('[data-act="cancel"]')!
    .addEventListener("click", () => phone.send({ type: "ui:cancelConfig" }));

  /**
   * Le lien de partage, copié dans le presse-papier. Il est fabriqué à
   * partir du compte **enregistré** et non de la saisie en cours : ce qui
   * n'a pas été validé n'a pas de HA1, et partager une adresse à moitié
   * corrigée n'aurait aucun sens.
   *
   * `writeText` n'est pas garanti — contexte non sécurisé, permission
   * refusée, navigateur ancien. L'échec ne laisse pas l'utilisateur sans
   * rien : le lien s'affiche alors, sélectionné, à copier à la main.
   */
  node.querySelector('[data-act="share"]')?.addEventListener("click", () => {
    const link = shareUrl(cfg!, location.href);
    void navigator.clipboard
      ?.writeText(link)
      .then(() => showToast(t("config.shareCopied")))
      .catch(() => showShareFallback(node, link));
    if (!navigator.clipboard) showShareFallback(node, link);
  });

  /**
   * La suppression en deux temps : le premier clic arme le bouton et lui
   * fait dire ce qui va disparaître, le second envoie l'événement. Quitter
   * le bouton le désarme — un bouton rouge resté armé derrière soi est un
   * piège.
   */
  const deleteBtn = node.querySelector<HTMLButtonElement>('[data-act="delete"]');
  const disarm = (): void => {
    if (!deleteBtn) return;
    deleteBtn.dataset.armed = "no";
    deleteBtn.textContent = t("config.delete");
  };
  deleteBtn?.addEventListener("click", () => {
    if (deleteBtn.dataset.armed === "yes") {
      phone.send({ type: "ui:deleteAccount" });
      return;
    }
    deleteBtn.dataset.armed = "yes";
    deleteBtn.textContent = t("config.deleteConfirm", { address: `${cfg!.username}@${cfg!.domain}` });
  });
  deleteBtn?.addEventListener("blur", disarm);

  wireLangPicker(node);
  // le surlignage s'efface dès que l'utilisateur corrige le champ — et il
  // peut revenir à la soumission suivante, d'où l'écoute permanente
  for (const input of node.querySelectorAll("[data-suspect]")) {
    input.addEventListener("input", () => input.classList.remove("invalid"));
  }
  return node;
}
