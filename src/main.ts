import "./ui/theme.css";
import { bindPresence } from "./ui/presence.js";
import { bindMessaging } from "./ui/messaging.js";
import { syncStrangerPrompt } from "./ui/strangerprompt.js";
import { watchMessageAlerts } from "./ui/messagealerts.js";
import { openThreadKey } from "./ui/screens/call/thread.js";
import { showConversation } from "./ui/screens/call/chat.js";
import { invalidateScreen, renderApp } from "./ui/app.js";
import { applyPrefs } from "./ui/prefs.js";
import { noteSleepReason, watchReachability } from "./ui/reachability.js";
import { registerNotifier } from "./ui/notify.js";
import { watchLayout } from "./ui/layout.js";
import { watchGlobalErrors } from "./ui/diagnostics.js";
import { initI18n, onLocaleChange, translate } from "./i18n/index.js";
import { createTrix, type Trix, type TrixView } from "./core/index.js";

applyPrefs();

// The core (ADR 0011, D2): the three machines, the vault, the conversation,
// what the page says of sleeps and idleness — all behind one facade, as for
// any affiliated UI. This one is merely the first.
const trix = createTrix({ translate });

// Deux chargements à faire avant le premier écran, et un seul aller-retour
// pour les deux — ils ne se doivent rien.
//
// La langue de l'interface, **avant** toute construction d'écran : `t()` est
// synchrone, le chargement du dictionnaire ne l'est pas. L'attendre ici est
// la seule façon qu'aucun écran ne se rende à moitié traduit.
//
// La configuration de déploiement (`config.json`), que le noyau lit avant de
// démarrer ses machines : elle réaligne le compte enregistré sur ce que
// l'exploitant impose, et la lire après aurait laissé passer un rendu — et
// un enregistrement — sur l'ancien proxy.
//
// Top-level await : Vite le sert nativement en ESM, et le premier rendu suit.
await Promise.all([initI18n(), trix.ready]);

watchGlobalErrors();

// Les écrans lisent encore les machines elles-mêmes, en attendant de lire
// la vue (ADR 0011, étape 6) : `debug` est hors contrat, et ce raccourci
// disparaît avec la migration des écrans.
const { phone, presence, messaging, conversation, session } = trix.debug;

// le panneau montre la conversation du noyau (ADR 0011, D5)
showConversation(conversation);

const root = document.getElementById("app")!;

/**
 * Rendu à chaque instantané. Le noyau les coalesce déjà : un seul après la
 * chaîne de transitions, `enter()` compris (ADR 0011, D3). Une frappe dans
 * la conversation n'en est pas une raison : le panneau se redessine seul,
 * et reconstruire l'écran d'appel à chaque caractère lui volerait le focus.
 */
let rendered: TrixView | null = null;
function onView(view: TrixView): void {
  const before = rendered;
  rendered = view;
  if (before && onlyConversation(before, view)) return;
  renderApp(root, phone);
}

function onlyConversation(a: TrixView, b: TrixView): boolean {
  return (Object.keys(b) as (keyof TrixView)[]).every((k) => k === "conversation" || a[k] === b[k]);
}

trix.subscribe(onView);
// notre statut change sans que le téléphone bouge (menu, appel, inactivité) :
// l'en-tête suit — `renderApp` ne reconstruit que si ce qu'il en montre a changé
bindPresence(presence);
// les messages arrivent sans que le téléphone bouge : le fil suit
bindMessaging(messaging);
// la fenêtre d'un inconnu suit la machine, hors du rendu des écrans (D5)
messaging.subscribe(() => syncStrangerPrompt(phone, messaging));
// titre, icône, notification, annonce, pastille d'appel (D10, D11)
watchMessageAlerts(phone, messaging, openThreadKey);

// La joignabilité (ADR 0006) : le niveau dérivé de la machine, la phrase
// dans la page, le titre d'onglet, le favicon et la notification système.
// Avant le premier rendu, qui montre déjà l'absence constatée au
// chargement (D4).
watchReachability(phone, session);
// Le motif d'un endormissement sert la phrase de la notification, et son
// instant le dernier horodatage joignable : le noyau l'annonce avant de
// désenregistrer (D3).
trix.system.onSleep(noteSleepReason);

renderApp(root, phone);

// bascule mobile ⇄ bureau : simple re-rendu, l'appel en cours n'est pas coupé
watchLayout(() => renderApp(root, phone));

// changement de langue : la machine n'a pas bougé, donc `renderApp` filtrerait
// le rendu — on lui fait oublier l'écran affiché avant de le redemander.
// L'appel en cours n'est pas plus concerné qu'un changement de format.
onLocaleChange(() => {
  invalidateScreen();
  renderApp(root, phone);
});

// Le service worker (`public/sw.js`), sans attendre : c'est le seul
// contexte que le gel de la page ne suspend pas, donc le seul d'où l'alerte
// d'endormissement puisse encore partir. Il garde aussi le client en cache
// pour un chargement hors ligne, sans jamais servir une version d'hier quand
// le serveur répond — voir l'en-tête du fichier.
registerNotifier();

// Observabilité (docs/CONCEPTION.md §4.5) : depuis la console,
// trix.debug.mermaid() exporte les diagrammes, trix.debug.phone.log les
// transitions, trix.view() ce que voit l'interface.
declare global {
  interface Window {
    trix: Trix;
  }
}
window.trix = trix;
