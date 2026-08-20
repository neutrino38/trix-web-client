import type { PhoneInstance } from "../machines/phone.js";
import { renderHome } from "./screens/home.js";
import { renderConfig } from "./screens/config.js";
import { renderCall } from "./screens/call/index.js";
import { layoutMode, type LayoutMode } from "./layout.js";
import { stopIncomingAlert } from "./alert.js";
import { closeIncoming } from "./screens/call/incoming.js";
import { announce } from "./announce.js";
import { setStateTitle } from "./title.js";
import { STATUS, callLabel, displayTarget, fmtChrono, statusOf } from "./screens/call/parts.js";
import { t } from "../i18n/index.js";
import type { MsgKey } from "../i18n/types.js";

let lastState: string | null = null;
let lastLayout: LayoutMode | null = null;

/** Écrans sans état de téléphone à afficher : l'onglet nomme quand même l'écran. */
const SCREEN_TITLE: Record<string, MsgKey> = {
  configuring: "screen.settings",
  reconfiguring: "screen.settings",
  saving: "screen.saving",
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
  // qui change sans que l'utilisateur agisse, mérite d'être annoncé
  if (label) announce(label);
}

/**
 * Oublie l'écran rendu : le prochain `renderApp` reconstruira tout, même
 * à état et format inchangés. C'est ce qu'exige un changement de langue —
 * la machine n'a pas bougé, mais chaque mot de l'écran doit être réécrit.
 */
export function invalidateScreen(): void {
  lastState = null;
  lastLayout = null;
}

/**
 * Re-rend l'écran courant à chaque changement d'état de la machine, et à
 * chaque changement de format (mobile ⇄ bureau) — le format ne touche
 * pas à la machine, seulement au gabarit rendu.
 *
 * En `in_call`, on re-rend aussi sur les stay() : le bloc d'appel écrit
 * `ctx.call` dans ce même contexte et notifie sans changer l'état hôte.
 * Ailleurs on s'en abstient pour ne pas écraser les champs en saisie.
 */
export function renderApp(root: HTMLElement, phone: PhoneInstance): void {
  const layout = layoutMode();
  syncStatus(phone); // avant le filtre : l'état peut changer sans re-rendu
  if (phone.state === lastState && layout === lastLayout && phone.state !== "in_call") return;
  lastState = phone.state;
  lastLayout = layout;
  root.replaceChildren(pick(phone));
}

function pick(phone: PhoneInstance): HTMLElement {
  switch (phone.state) {
    case "initial_state":
      return document.createElement("div"); // chargement de la config (< 3 s)
    case "home":
      stopIncomingAlert();
      closeIncoming();
      return renderHome(phone);
    case "configuring":
    case "reconfiguring":
    case "saving":
      // filet : l'alerte d'appel entrant vit hors de #app (flash, titre,
      // notification) — quitter l'écran d'appel doit toujours l'éteindre,
      // et refermer la popup pour que le focus ne reste pas piégé
      stopIncomingAlert();
      closeIncoming();
      return renderConfig(phone);
    default:
      return renderCall(phone);
  }
}
