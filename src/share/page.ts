/**
 * `share_account.html` — la page qui reçoit un compte partagé par un lien.
 *
 * Elle est **volontairement séparée de l'application** : une page à un seul
 * geste, sans automate, sans pile SIP, sans coffre ouvert avant qu'on ne le
 * demande. Ce qu'elle sait faire tient en une phrase : lire le compte que
 * porte le lien, le montrer, et l'écrire dans le coffre si on le lui dit.
 *
 * ## Rien n'est créé sans un clic
 *
 * Un lien reçu par erreur, ou ouvert par curiosité, ne doit pas configurer
 * un compte sur l'appareil de qui l'a cliqué. La page affiche donc ce
 * qu'elle a compris — l'adresse, le serveur, les réglages transportés — et
 * attend. Ce qui est affiché est exactement ce qui sera créé : le
 * récapitulatif est construit à partir du compte décodé et validé
 * (`share/link.ts`), pas de la charge brute.
 *
 * ## Ce qu'elle refuse
 *
 * Le compte existe déjà, l'appareil en garde déjà autant qu'il en tient, le
 * déploiement impose un autre domaine SIP : dans les trois cas la page le
 * dit et ne touche à rien. La dernière n'est pas une politesse — un compte
 * d'un autre domaine porte un HA1 calculé sur ce domaine-là (RFC 2617), et
 * ne s'authentifierait nulle part ici (src/deployment.ts).
 */

import "../ui/theme.css";
import { applyPrefs } from "../ui/prefs.js";
import { initI18n, t } from "../i18n/index.js";
import { loadDeployment, pinAccount } from "../deployment.js";
import { el, esc } from "../ui/el.js";
import { trixIcon } from "../ui/logo.js";
import { langPicker, wireLangPicker } from "../ui/langpicker.js";
import {
  createBrowserStore,
  newAccountId,
  newInstanceId,
  type AccountConfig,
  type StoredAccount,
} from "../storage/store.js";
import { MAX_ACCOUNTS, addressOf, findByAddress } from "../accounts.js";
import { decodeAccount, linkPayload } from "./link.js";
import { RTT_LABELS } from "../ui/rttlabels.js";
import type { MsgKey } from "../i18n/types.js";

/** Où l'on repart une fois le compte créé — l'application, à côté. */
const APP_URL = "./";

/**
 * Ce que la page a à dire. `account` porte le compte prêt à être créé ;
 * `error` la raison de ne rien proposer. Jamais les deux : il n'y a pas de
 * demi-lien qu'on créerait quand même.
 */
type Outcome =
  | { account: AccountConfig; existing: null }
  | { account: null; error: string };

/** Une ligne du récapitulatif — libellé, valeur. Rien n'est cliquable. */
function row(label: string, value: string): string {
  return `<div class="share-row">
      <span class="share-label">${esc(label)}</span>
      <span class="share-value">${esc(value)}</span>
    </div>`;
}

/**
 * Les serveurs de traversée de NAT, en une ligne lisible. Le mot de passe
 * TURN voyage dans le lien mais ne s'affiche pas : le montrer n'apprendrait
 * rien à qui reçoit le compte, et l'exposerait à qui regarde l'écran.
 */
function iceSummary(cfg: AccountConfig): string {
  const parts: string[] = [];
  if (cfg.ice.stun) parts.push(`STUN ${cfg.ice.stun}`);
  if (cfg.ice.turn) parts.push(`TURN ${cfg.ice.turn.host}`);
  return parts.length > 0 ? parts.join(" · ") : t("share.none");
}

function summary(cfg: AccountConfig): string {
  const rtt: MsgKey = RTT_LABELS[cfg.rtt].label;
  return `<div class="share-summary">
      ${row(t("share.address"), addressOf(cfg))}
      ${cfg.displayName.trim() ? row(t("share.displayName"), cfg.displayName) : ""}
      ${row(t("share.proxy"), cfg.proxy)}
      ${cfg.authUsername ? row(t("share.authUsername"), cfg.authUsername) : ""}
      ${row(t("share.ice"), iceSummary(cfg))}
      ${row(t("share.rtt"), t(rtt))}
    </div>`;
}

/**
 * Décide de ce que la page propose, coffre ouvert. Tout ce qui peut
 * empêcher la création est tranché ici, avant le premier pixel : l'écran
 * n'affiche jamais un bouton qui échouerait au clic.
 */
async function decide(): Promise<Outcome> {
  const data = linkPayload(location);
  if (data === null) return { account: null, error: t("share.noLink") };
  const decoded = decodeAccount(data);
  if (!decoded.ok) {
    return {
      account: null,
      error: t(decoded.error === "version" ? "share.version" : "share.malformed"),
    };
  }
  // le compte reçu passe par le déploiement comme un compte relu du coffre :
  // proxy, serveurs ICE et transport texte imposés l'emportent sur ce que le
  // lien transportait, et un autre domaine SIP le disqualifie
  const account = pinAccount(decoded.account);
  if (!account) {
    return {
      account: null,
      error: t("share.wrongDomain", { domain: decoded.account.domain }),
    };
  }
  const vault = await createBrowserStore().load();
  const twin = findByAddress(vault.accounts, addressOf(account));
  if (twin) {
    return { account: null, error: t("share.exists", { address: addressOf(twin) }) };
  }
  if (vault.accounts.length >= MAX_ACCOUNTS) {
    return { account: null, error: t("share.full", { max: MAX_ACCOUNTS }) };
  }
  return { account, existing: null };
}

/**
 * Écrit le compte dans le coffre. Le coffre est **relu** à ce moment plutôt
 * que réutilisé depuis `decide()` : entre l'affichage et le clic, un autre
 * onglet a pu en ajouter un, et écraser sa liste avec une copie plus
 * ancienne le ferait disparaître.
 */
async function create(cfg: AccountConfig): Promise<void> {
  const store = createBrowserStore();
  const vault = await store.load();
  if (findByAddress(vault.accounts, addressOf(cfg))) return; // ajouté entre-temps
  if (vault.accounts.length >= MAX_ACCOUNTS) throw new Error("vault full");
  // l'identifiant d'instance est celui de cet appareil : le lien ne l'a pas
  // apporté, et reprendre celui de l'expéditeur ferait passer deux appareils pour
  // un seul
  const account: StoredAccount = { ...cfg, id: newAccountId(), instanceId: newInstanceId() };
  await store.save({
    accounts: [...vault.accounts, account],
    // premier compte de l'appareil : il devient l'actif, sans quoi l'accueil
    // n'aurait rien à proposer. S'il y en avait déjà un, on ne le déloge
    // pas — recevoir un lien n'est pas décider de changer de compte.
    activeId: vault.activeId ?? account.id,
  });
}

function render(root: HTMLElement, outcome: Outcome): void {
  const node = el(`
    <div class="screen-share">
      <div class="share-head">
        ${trixIcon(120)}
        <h1>${esc(t("share.title"))}</h1>
      </div>
      ${
        outcome.account
          ? `<p class="share-intro">${esc(t("share.intro"))}</p>
             ${summary(outcome.account)}
             <p class="hint warn">${esc(t("share.warn"))}</p>
             <div class="share-actions">
               <button class="btn primary" data-act="create">${esc(t("share.create"))}</button>
               <a class="btn ghost" href="${APP_URL}">${esc(t("share.open"))}</a>
             </div>`
          : `<div class="error-banner" role="alert">${esc(outcome.error)}</div>
             <div class="share-actions">
               <a class="btn" href="${APP_URL}">${esc(t("share.open"))}</a>
             </div>`
      }
      <div class="share-slot" data-ref="slot"></div>
      ${langPicker()}
    </div>`);
  root.replaceChildren(node);
  wireLangPicker(node);

  const button = node.querySelector<HTMLButtonElement>('[data-act="create"]');
  button?.addEventListener("click", () => {
    button.disabled = true;
    button.textContent = t("share.creating");
    void create(outcome.account!)
      .then(() => {
        // le compte est dans le coffre : il n'y a plus rien à faire sur
        // cette page, et l'y laisser inviterait à recliquer
        location.replace(APP_URL);
      })
      .catch((e: unknown) => {
        button.disabled = false;
        button.textContent = t("share.create");
        node.querySelector('[data-ref="slot"]')!.innerHTML =
          `<div class="error-banner" role="alert">${esc(
            t("share.saveFailed", { detail: String(e) }),
          )}</div>`;
      });
  });
}

applyPrefs();

// même amorçage que l'application (`main.ts`) : la langue avant tout écran,
// puisque `t()` est synchrone, et le déploiement avant toute décision,
// puisque c'est lui qui dit quel domaine cette installation accepte
await Promise.all([initI18n(), loadDeployment()]);

const root = document.getElementById("app")!;
render(root, await decide());
