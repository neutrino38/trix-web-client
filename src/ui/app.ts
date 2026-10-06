import type { Trix, TrixView } from "../core/index.js";
import { renderHome } from "./screens/home.js";
import { renderConfig } from "./screens/config.js";
import { renderVaultError } from "./screens/vaulterror.js";
import { renderCall } from "./screens/call/index.js";
import { layoutMode, type LayoutMode } from "./layout.js";
import { stopIncomingAlert } from "./alert.js";
import { stopRingback } from "./ring.js";
import { closeIncoming } from "./screens/call/incoming.js";
import { announce } from "./announce.js";
import { setStateTitle } from "./title.js";
import { STATUS, callLabel, displayTarget, fmtChrono, statusOf } from "./screens/call/parts.js";
import { t } from "../i18n/index.js";
import type { CallLogEntry } from "../storage/store.js";
import { closeStatusMenu, headerKey } from "./presence.js";
import { refreshThread } from "./screens/call/thread.js";

/** Ce qui décide de l'écran : phase, enregistrement, écriture en cours. */
let lastScreen: string | null = null;
let lastLayout: LayoutMode | null = null;
/**
 * L'historique tel qu'il était au dernier rendu — la **référence**, pas son
 * contenu : la vue en garde la référence tant qu'il ne change pas. Il change
 * sans que l'écran change (vidage demandé depuis l'écran, appel qui vient de
 * se terminer), et c'est le seul cas où l'écran au repos doit malgré tout
 * être redessiné.
 */
let lastHistory: readonly CallLogEntry[] | null = null;
/**
 * Ce que l'en-tête montre de la présence (`ui/presence.ts`) : notre statut,
 * sa note, ce que le serveur en accepte. La présence des contacts n'en fait
 * pas partie — elle ne touche pas l'en-tête.
 */
let lastPresence: string | null = null;

/** L'écran de paramètres n'a pas d'enregistrement à montrer : l'onglet le nomme quand même. */
function settingsTitle(app: TrixView): string | null {
  if (app.phase !== "settings") return null;
  const busy = app.settings?.busy ?? null;
  return t(busy === "saving" ? "screen.saving" : busy === "deleting" ? "screen.deleting" : "screen.settings");
}

/**
 * Titre d'onglet et annonce vocale, dérivés du même état — l'un pour qui
 * travaille dans un autre onglet pendant un appel, l'autre pour qui n'a pas
 * l'écran. Pendant la communication, le chrono du titre est ensuite rafraîchi
 * par le tick de l'écran d'appel (parts.ts), seul à battre la seconde.
 */
function syncStatus(app: TrixView): void {
  const view = app.call;
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
  // `STATUS` dit si l'enregistrement a un libellé ; `statusOf` le traduit.
  // Hors de l'écran d'appel, il n'y en a pas (`off`).
  const label = STATUS[app.registration] ? statusOf(app.registration).label : null;
  setStateTitle(label ?? settingsTitle(app));
  // les écrans hors appel se lisent d'eux-mêmes : seul l'état du téléphone,
  // qui change sans que l'utilisateur agisse, mérite d'être annoncé — et
  // seulement quand il change. Un rendu venu d'ailleurs (notre statut de
  // présence, l'historique) écraserait sinon l'annonce qui vient d'être faite
  if (label && label !== lastAnnounced) announce(label);
  lastAnnounced = label;
}

/** Le dernier état d'enregistrement annoncé : on ne le répète pas à chaque rendu. */
let lastAnnounced: string | null = null;

/**
 * Oublie l'écran rendu : le prochain `renderApp` reconstruira tout, même
 * à vue et format inchangés. C'est ce qu'exige un changement de langue —
 * le noyau n'a pas bougé, mais chaque mot de l'écran doit être réécrit.
 */
export function invalidateScreen(): void {
  lastScreen = null;
  lastLayout = null;
  lastHistory = null;
  lastPresence = null;
}

/**
 * Re-rend l'écran courant quand ce qui le cadre change — phase,
 * enregistrement, écriture des paramètres —, et à chaque changement de
 * format (mobile ⇄ bureau) : le format ne touche pas au noyau, seulement
 * au gabarit rendu.
 *
 * En appel, on re-rend à chaque instantané : l'appel change sans que la
 * phase change. Ailleurs on s'en abstient pour ne pas écraser les champs en
 * saisie — à une exception près, l'historique : « Effacer » le vide sans
 * changer d'écran, et sans ce réveil la liste resterait affichée alors
 * qu'elle n'existe plus. La saisie en cours survit de toute façon au rendu,
 * `parts.ts` la garde hors du DOM (`draft()`).
 */
export function renderApp(root: HTMLElement, trix: Trix): void {
  const app = trix.view();
  if (!app) return;
  const layout = layoutMode();
  syncStatus(app); // avant le filtre : l'état peut changer sans re-rendu
  const screen = `${app.phase}|${app.registration}|${app.settings?.busy ?? ""}`;
  const history = app.history;
  const presence = headerKey(app);
  if (
    screen === lastScreen &&
    layout === lastLayout &&
    history === lastHistory &&
    presence === lastPresence &&
    app.phase !== "inCall"
  ) {
    // l'écran reste, mais le fil Échanges peut avoir changé : présence
    // d'un contact, carnet modifié (ADR 0007, D10)
    refreshThread();
    return;
  }
  lastScreen = screen;
  lastLayout = layout;
  lastHistory = history;
  lastPresence = presence;
  root.replaceChildren(pick(app, trix));
}

function pick(app: TrixView, trix: Trix): HTMLElement {
  switch (app.phase) {
    case "loading":
      return document.createElement("div"); // lecture ou effacement du coffre
    case "vaultError":
      return renderVaultError(app, trix);
    case "accounts":
      closeStatusMenu();
      stopIncomingAlert();
      stopRingback();
      closeIncoming();
      return renderHome(app, trix);
    case "settings":
      // filet : l'alerte d'appel entrant vit hors de #app (flash, titre,
      // notification) — quitter l'écran d'appel doit toujours l'éteindre,
      // et refermer la popup pour que le focus ne reste pas piégé. Le
      // retour d'appel sonore est dans le même cas : son oscillateur ne
      // tient à aucun nœud du DOM.
      stopIncomingAlert();
      stopRingback();
      closeIncoming();
      closeStatusMenu();
      return renderConfig(app, trix);
    case "ready":
    case "inCall":
      return renderCall(app, trix);
  }
}
