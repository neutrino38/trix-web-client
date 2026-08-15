import type { PhoneInstance } from "../machines/phone.js";
import { renderHome } from "./screens/home.js";
import { renderConfig } from "./screens/config.js";
import { renderCall } from "./screens/call.js";

let lastState: string | null = null;

/**
 * Re-rend l'écran courant à chaque changement d'état de la machine.
 * En `in_call`, on re-rend aussi sur les stay() (miroir de la CallMachine
 * mis à jour par child:msg) ; ailleurs on s'en abstient pour ne pas
 * écraser les champs en cours de saisie.
 */
export function renderApp(root: HTMLElement, phone: PhoneInstance): void {
  if (phone.state === lastState && phone.state !== "in_call") return;
  lastState = phone.state;
  root.replaceChildren(pick(phone));
}

function pick(phone: PhoneInstance): HTMLElement {
  switch (phone.state) {
    case "initial_state":
      return document.createElement("div"); // chargement de la config (< 3 s)
    case "home":
      return renderHome(phone);
    case "configuring":
    case "reconfiguring":
    case "saving":
      return renderConfig(phone);
    default:
      return renderCall(phone);
  }
}
