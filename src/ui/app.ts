import type { PhoneInstance } from "../machines/phone.js";
import { renderHome } from "./screens/home.js";
import { renderConfig } from "./screens/config.js";
import { renderCall } from "./screens/call/index.js";
import { layoutMode, type LayoutMode } from "./layout.js";
import { stopIncomingAlert } from "./alert.js";
import { stopRingback } from "./ring.js";
import { closeIncoming } from "./screens/call/incoming.js";
import { announce } from "./announce.js";
import { setStateTitle } from "./title.js";
import { STATUS, callLabel, displayTarget, fmtChrono, statusOf } from "./screens/call/parts.js";
import { t } from "../i18n/index.js";
import type { MsgKey } from "../i18n/types.js";
import type { CallLogEntry } from "../storage/store.js";
import { closeStatusMenu, headerKey } from "./presence.js";
import { refreshThread } from "./screens/call/thread.js";

let lastState: string | null = null;
let lastLayout: LayoutMode | null = null;
/**
 * L'historique tel qu'il était au dernier rendu — la **référence**, pas son
 * contenu : la machine ne le modifie jamais en place, elle en pose un
 * nouveau (`ctx.history = […]`). Il change sans que l'état change (vidage
 * demandé depuis l'écran, appel qui vient de se terminer), et c'est le seul
 * cas où un `stay()` doit malgré tout redessiner l'écran d'accueil.
 */
let lastHistory: readonly CallLogEntry[] | null = null;
/**
 * Ce que l'en-tête montre de la présence (`ui/presence.ts`) : notre statut,
 * sa note, ce que le serveur en accepte. La présence des contacts n'en fait
 * pas partie — elle ne touche pas l'en-tête.
 */
let lastPresence: string | null = null;

/** Écrans sans état de téléphone à afficher : l'onglet nomme quand même l'écran. */
const SCREEN_TITLE: Record<string, MsgKey> = {
  configuring: "screen.settings",
  reconfiguring: "screen.settings",
  saving: "screen.saving",
  deleting: "screen.deleting",
};

/**
 * Titre d'onglet et annonce vocale, dérivés du même état — l'un pour qui
 * travaille dans un autre onglet pendant un appel, l'autre pour qui n'a pas
 * l'écran. Pendant la communication, le chrono du titre est ensuite rafraîchi
 * par le tick de l'écran d'appel (parts.ts), seul à battre la seconde.
 */
function syncStatus(phone: PhoneInstance): void {
  const view = phone.state === "in_call" ? phone.context.call : null;
  if (view) {
    const label = callLabel(view.state);
    const who = view.displayName ?? displayTarget(view.target);
    setStateTitle(
      view.state === "connected" && view.connectedAt !== null
        ? `${label} — ${fmtChrono(view.connectedAt)}`
        : `${label} — ${who}`,
    );
    announce(`${label} — ${who}`);
    return;
  }
  // `STATUS` dit si cet état a un libellé d'état de téléphone ; `statusOf`
  // le traduit. Un écran hors téléphone (paramètres) n'y figure pas.
  const label = STATUS[phone.state] ? statusOf(phone.state).label : null;
  const screen = SCREEN_TITLE[phone.state];
  setStateTitle(label ?? (screen ? t(screen) : null));
  // les écrans hors appel se lisent d'eux-mêmes : seul l'état du téléphone,
  // qui change sans que l'utilisateur agisse, mérite d'être annoncé — et
  // seulement quand il change. Un rendu venu d'ailleurs (notre statut de
  // présence, l'historique) écraserait sinon l'annonce qui vient d'être faite
  if (label && label !== lastAnnounced) announce(label);
  lastAnnounced = label;
}

/** Le dernier état du téléphone annoncé : on ne le répète pas à chaque rendu. */
let lastAnnounced: string | null = null;

/**
 * Oublie l'écran rendu : le prochain `renderApp` reconstruira tout, même
 * à état et format inchangés. C'est ce qu'exige un changement de langue —
 * la machine n'a pas bougé, mais chaque mot de l'écran doit être réécrit.
 */
export function invalidateScreen(): void {
  lastState = null;
  lastLayout = null;
  lastHistory = null;
  lastPresence = null;
}

/**
 * Re-rend l'écran courant à chaque changement d'état de la machine, et à
 * chaque changement de format (mobile ⇄ bureau) — le format ne touche
 * pas à la machine, seulement au gabarit rendu.
 *
 * En `in_call`, on re-rend aussi sur les stay() : le bloc d'appel écrit
 * `ctx.call` dans ce même contexte et notifie sans changer l'état hôte.
 * Ailleurs on s'en abstient pour ne pas écraser les champs en saisie — à
 * une exception près, l'historique : « Effacer » le vide par un `stay()`,
 * et sans ce réveil la liste resterait affichée alors qu'elle n'existe
 * plus. La saisie en cours survit de toute façon au rendu, `parts.ts` la
 * garde hors du DOM (`draft()`).
 */
export function renderApp(root: HTMLElement, phone: PhoneInstance): void {
  const layout = layoutMode();
  syncStatus(phone); // avant le filtre : l'état peut changer sans re-rendu
  const history = phone.context.history;
  const presence = headerKey(phone);
  if (
    phone.state === lastState &&
    layout === lastLayout &&
    history === lastHistory &&
    presence === lastPresence &&
    phone.state !== "in_call"
  ) {
    // l'écran reste, mais le fil Échanges peut avoir changé : présence
    // d'un contact, carnet modifié (ADR 0007, D10)
    refreshThread();
    return;
  }
  lastState = phone.state;
  lastLayout = layout;
  lastHistory = history;
  lastPresence = presence;
  root.replaceChildren(pick(phone));
}

function pick(phone: PhoneInstance): HTMLElement {
  switch (phone.state) {
    case "initial_state":
      return document.createElement("div"); // chargement de la config (< 3 s)
    case "home":
      closeStatusMenu();
      stopIncomingAlert();
      stopRingback();
      closeIncoming();
      return renderHome(phone);
    case "configuring":
    case "reconfiguring":
    case "saving":
    case "deleting":
      // filet : l'alerte d'appel entrant vit hors de #app (flash, titre,
      // notification) — quitter l'écran d'appel doit toujours l'éteindre,
      // et refermer la popup pour que le focus ne reste pas piégé. Le
      // retour d'appel sonore est dans le même cas : son oscillateur ne
      // tient à aucun nœud du DOM.
      stopIncomingAlert();
      stopRingback();
      closeIncoming();
      closeStatusMenu();
      return renderConfig(phone);
    default:
      return renderCall(phone);
  }
}
