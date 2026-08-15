/**
 * Écran d'appel : choisit le gabarit selon le format d'affichage.
 *
 * Une seule PhoneMachine sert les deux vues — le format est un détail de
 * rendu, pas un état du protocole SIP. Basculer de format ne coupe donc
 * ni l'appel en cours ni l'enregistrement.
 */

import type { PhoneInstance } from "../../../machines/phone.js";
import { layoutMode } from "../../layout.js";
import { renderDesktop } from "./desktop.js";
import { renderMobile } from "./mobile.js";
import { stopChrono, wireCallScreen } from "./parts.js";

export function renderCall(phone: PhoneInstance): HTMLElement {
  stopChrono(); // le nœud précédent disparaît avec son timer
  const node = layoutMode() === "mobile" ? renderMobile(phone) : renderDesktop(phone);
  wireCallScreen(node, {
    phone,
    view: phone.state === "in_call" ? phone.context.call : null,
    ready: phone.state === "ready",
    cfg: phone.context.config,
  });
  return node;
}
