/**
 * Écran d'appel : choisit le gabarit selon le format d'affichage.
 *
 * Une seule PhoneMachine sert les deux vues — le format est un détail de
 * rendu, pas un état du protocole SIP. Basculer de format ne coupe donc
 * ni l'appel en cours ni l'enregistrement.
 */

import { activeAccount, type PhoneInstance } from "../../../machines/phone.js";
import { layoutMode } from "../../layout.js";
import { renderDesktop } from "./desktop.js";
import { renderMobile } from "./mobile.js";
import { closeIncoming, wireIncoming } from "./incoming.js";
import { closeMediaAsk, wireMediaAsk } from "./mediaask.js";
import { closeDtmf } from "./dtmf.js";
import { closeSheet, wireSheet } from "./sheet.js";
import { stopChrono, wireCallScreen } from "./parts.js";
import { stopMediaStats } from "./stats.js";
import { wireStatusButton } from "../../presence.js";
import { wireThread } from "./thread.js";

export function renderCall(phone: PhoneInstance): HTMLElement {
  stopChrono(); // le nœud précédent disparaît avec ses timers
  stopMediaStats();
  const view = phone.state === "in_call" ? phone.context.call : null;
  const node = layoutMode() === "mobile" ? renderMobile(phone) : renderDesktop(phone);
  wireCallScreen(node, {
    phone,
    view,
    ready: phone.state === "ready",
    cfg: activeAccount(phone.context),
  });
  // Le comportement modal de la popup d'appel entrant est câblé ici, et non
  // dans `wireCallScreen` : les boutons, eux, le sont là-bas comme tous les
  // autres `data-act`. Seuls le focus et son piège sont propres à la modale.
  if (view?.state === "ringing_in") {
    wireIncoming(node, () => phone.send({ type: "ui:reject" }));
  } else {
    closeIncoming();
  }
  // le pavé DTMF ne survit pas à la communication : un appel qui se termine
  // le referme, et le suivant repart clavier rangé
  if (view?.state !== "connected") closeDtmf();
  // la feuille du bas non plus (ADR 0003, D8) : le raccrochage la referme,
  // et elle ne se rouvre pas d'elle-même sur l'appel suivant, dont la barre
  // n'a pas forcément la même composition
  if (view?.state !== "connected") closeSheet();
  wireSheet(node);
  // le bouton de statut et son menu, qui vit hors de l'écran et s'y
  // raccroche à chaque reconstruction (ui/presence.ts)
  wireStatusButton(node);
  // le fil Échanges, sur la scène au repos (ADR 0007, D10) : il se
  // redessine seul quand la présence ou le carnet changent
  wireThread(node, phone);
  // même partage pour la question posée en cours d'appel (« Alice souhaite
  // ajouter la vidéo ») : les deux boutons sont câblés avec les autres,
  // seul le focus est propre à la popup
  if (view?.mediaAsked !== null && view !== null) {
    wireMediaAsk(node, () => phone.send({ type: "ui:rejectMedia" }));
  } else {
    closeMediaAsk();
  }
  return node;
}
