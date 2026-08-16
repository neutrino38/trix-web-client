import type { PhoneInstance } from "../machines/phone.js";
import { renderHome } from "./screens/home.js";
import { renderConfig } from "./screens/config.js";
import { renderCall } from "./screens/call/index.js";
import { layoutMode, type LayoutMode } from "./layout.js";
import { stopIncomingAlert } from "./alert.js";
import { closeIncoming } from "./screens/call/incoming.js";
import { announce } from "./announce.js";
import { setStateTitle } from "./title.js";
import { CALL_LABEL, STATUS, displayTarget, fmtChrono } from "./screens/call/parts.js";

let lastState: string | null = null;
let lastLayout: LayoutMode | null = null;

/** Écrans sans état de téléphone à afficher : l'onglet nomme quand même l'écran. */
const SCREEN_TITLE: Record<string, string> = {
  configuring: "Paramètres",
  reconfiguring: "Paramètres",
  saving: "Enregistrement…",
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
    const label = CALL_LABEL[view.state];
    const who = view.displayName ?? displayTarget(view.target);
    setStateTitle(
      view.state === "connected" && view.connectedAt !== null
        ? `${label} — ${fmtChrono(view.connectedAt)}`
        : `${label} — ${who}`,
    );
    announce(`${label} — ${who}`);
    return;
  }
  const label = STATUS[phone.state]?.label;
  setStateTitle(label ?? SCREEN_TITLE[phone.state] ?? null);
  // les écrans hors appel se lisent d'eux-mêmes : seul l'état du téléphone,
  // qui change sans que l'utilisateur agisse, mérite d'être annoncé
  if (label) announce(label);
}

/**
 * Re-rend l'écran courant à chaque changement d'état de la machine, et à
 * chaque changement de format (mobile ⇄ bureau) — le format ne touche
 * pas à la machine, seulement au gabarit rendu.
 *
 * En `in_call`, on re-rend aussi sur les stay() (miroir de la CallMachine
 * mis à jour par child:msg) ; ailleurs on s'en abstient pour ne pas
 * écraser les champs en cours de saisie.
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
