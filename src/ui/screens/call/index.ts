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
import { closeIncoming, wireIncoming } from "./incoming.js";
import { stopChrono, wireCallScreen } from "./parts.js";

export function renderCall(phone: PhoneInstance): HTMLElement {
  stopChrono(); // le nœud précédent disparaît avec son timer
  const view = phone.state === "in_call" ? phone.context.call : null;
  const node = layoutMode() === "mobile" ? renderMobile(phone) : renderDesktop(phone);
  wireCallScreen(node, {
    phone,
    view,
    ready: phone.state === "ready",
    cfg: phone.context.config,
  });
  // Le comportement modal de la popup d'appel entrant est câblé ici, et non
  // dans `wireCallScreen` : les boutons, eux, le sont là-bas comme tous les
  // autres `data-act`. Seuls le focus et son piège sont propres à la modale.
  if (view?.state === "ringing_in") {
    wireIncoming(node, () => phone.send({ type: "ui:reject" }));
  } else {
    closeIncoming();
  }
  return node;
}
