import "./ui/theme.css";
import { PhoneMachine, type PhoneInstance } from "./machines/phone.js";
import { CallBlock } from "./machines/call.js";
import { PresenceMachine } from "./machines/presence.js";
import { linkPresence } from "./machines/presencesignals.js";
import { MessagingMachine } from "./machines/messaging.js";
import { linkMessaging } from "./machines/messagingsignals.js";
import { bindPresence } from "./ui/presence.js";
import { bindMessaging } from "./ui/messaging.js";
import { syncStrangerPrompt } from "./ui/strangerprompt.js";
import { setStatusPrefs, statusPrefs } from "./storage/session.js";
import { createBrowserStore } from "./storage/store.js";
import { createJsSipPort } from "./sip/port.js";
import { chatTranscript } from "./ui/screens/call/chat.js";
import { invalidateScreen, renderApp } from "./ui/app.js";
import { applyPrefs } from "./ui/prefs.js";
import { watchSystemLifecycle } from "./ui/lifecycle.js";
import { watchActivity } from "./ui/activity.js";
import { noteSleepReason, watchReachability } from "./ui/reachability.js";
import { registerNotifier } from "./ui/notify.js";
import { watchLayout } from "./ui/layout.js";
import { formatLog, machineLogger, watchGlobalErrors, watchMachine } from "./ui/diagnostics.js";
import { traceCallStates } from "./sip/trace.js";
import { initI18n, onLocaleChange } from "./i18n/index.js";
import { deployment, loadDeployment } from "./deployment.js";

applyPrefs();

// Deux chargements à faire avant le premier écran, et un seul aller-retour
// pour les deux — ils ne se doivent rien.
//
// La langue de l'interface, **avant** toute construction d'écran : `t()` est
// synchrone, le chargement du dictionnaire ne l'est pas. L'attendre ici est
// la seule façon qu'aucun écran ne se rende à moitié traduit.
//
// La configuration de déploiement (`config.json`, src/deployment.ts) pour la
// même raison, et une de plus : la machine la lit dès l'amorçage pour
// réaligner le compte enregistré sur ce que l'exploitant impose. La lire
// après aurait laissé passer un rendu — et un enregistrement — sur l'ancien
// proxy. Absente, illisible : Trix se comporte comme sans elle.
//
// Top-level await : Vite le sert nativement en ESM, et le premier rendu suit.
await Promise.all([initI18n(), loadDeployment()]);

watchGlobalErrors();

// le moteur peut écrire avant que `phone` ne soit affectée (transition
// initiale) : le logger passe par cette variable, pas par la const
let started: PhoneInstance | null = null;

// La présence (ADR 0007, D12) : une machine paire de PhoneMachine, démarrée
// avant elle parce que PhoneMachine lit son statut à chaque INVITE. Les deux
// ne se voient pas : `linkPresence`, plus bas, lui traduit les transitions
// du téléphone.
const presence = PresenceMachine.start({
  debug: true,
  args: {
    statusStore: { load: statusPrefs, save: setStatusPrefs },
    // `"presence": "no"` dans config.json (ADR 0007, D8) : la machine reste
    // en `disabled`, et pas un SUBSCRIBE ne part
    enabled: deployment().presence,
  },
});

// Un seul coffre pour les deux machines qui y écrivent : PhoneMachine
// (comptes, historique, contacts) et MessagingMachine (messages).
const store = createBrowserStore();

// La messagerie (ADR 0008, D12) : une troisième paire, sur le modèle de la
// présence. Elle ne lit du téléphone que ses transitions (`linkMessaging`).
const messaging = MessagingMachine.start({
  debug: true,
  args: {
    store,
    // `"messaging": "no"` dans config.json (D13)
    enabled: deployment().messaging,
    visible: document.visibilityState === "visible",
  },
});

const phone = PhoneMachine.start({
  debug: true,
  // les transitions restent en console.debug ; ce que le moteur signale
  // lui-même (exception dans un état, goto inconnu…) ressort en console.error
  logger: machineLogger(() => started),
  args: {
    store,
    // `"messaging": "no"` dans config.json (ADR 0008, D13) : ni écouteur,
    // ni MESSAGE dans `Allow`
    sip: createJsSipPort({ messaging: deployment().messaging }),
    // la conversation de l'appel qui se termine, lue au panneau au moment
    // où la machine range sa ligne d'historique (§4.9) : c'est ici, et
    // nulle part ailleurs, que l'écran et la machine se rencontrent
    transcript: chatTranscript,
    // Ne pas déranger refuse les appels (ADR 0007, D6) : le statut est tenu
    // par PresenceMachine, lu ici au moment de décider
    doNotDisturb: () => presence.state !== "disabled" && presence.context.prefs.chosen === "dnd",
  },
});

// erreurs des automates (lastError, callError, mort de la machine, événements
// non consommés) : l'écran en montre une phrase, la console en garde la trace
started = phone;
watchMachine(phone);

// du téléphone vers la présence : enregistré, désenregistré, en appel,
// carnet modifié (machines/presencesignals.ts)
linkPresence(phone, presence);
// et vers la messagerie : compte choisi, enregistré, en appel, carnet
linkMessaging(phone, messaging);

// états et transitions de l'appel, dans le même flux que les paquets SIP et
// sous le même réglage : c'est de leur juxtaposition qu'on lit un échange
traceCallStates(phone);

const root = document.getElementById("app")!;

/**
 * Rendu différé d'une microtask, et coalescé : une notification de
 * transition part **avant** le `enter()` de l'état d'arrivée, donc avant
 * que celui-ci n'ait écrit ce qu'il publie (`ctx.call`, pour l'écran
 * d'appel). Rendre dans le callback afficherait l'état précédent — et
 * plus rien ne repasserait ensuite : l'écran resterait sur « Sonnerie »
 * alors que l'appel est établi. La microtask arrive après la chaîne de
 * transitions synchrones, `enter()` compris, et n'en rend que le résultat.
 */
let renderQueued = false;
function scheduleRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(() => {
    renderQueued = false;
    renderApp(root, phone);
  });
}

phone.subscribe(scheduleRender);
// notre statut change sans que le téléphone bouge (menu, appel, inactivité) :
// l'en-tête suit — `renderApp` ne reconstruit que si ce qu'il en montre a changé
bindPresence(presence);
presence.subscribe(scheduleRender);
// les messages arrivent sans que le téléphone bouge : le fil suit
bindMessaging(messaging);
messaging.subscribe(scheduleRender);
// la fenêtre d'un inconnu suit la machine, hors du rendu des écrans (D5)
messaging.subscribe(() => syncStrangerPrompt(phone, messaging));
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

// La joignabilité (ADR 0006) : le niveau dérivé de la machine, la phrase
// dans la page, le titre d'onglet, le favicon et la notification système.
//
// **Avant** `watchSystemLifecycle`, et ce n'est pas indifférent : les deux
// écoutent `freeze` et `pagehide`, les écouteurs partent dans l'ordre où
// ils ont été posés, et celui-ci doit horodater le dernier instant
// joignable pendant que la machine est encore enregistrée — l'autre l'en
// sort aussitôt après (D3).
watchReachability(phone);

// Le service worker des notifications (`public/sw.js`), sans attendre :
// c'est le seul contexte que le gel de la page ne suspend pas, donc le
// seul d'où l'alerte d'endormissement puisse encore partir. Il n'intercepte
// rien et ne met rien en cache — voir l'en-tête du fichier.
registerNotifier();

// Endormissements de la page et de la machine : gel de l'onglet, départ en
// bfcache, fermeture, veille de l'ordinateur. Tous raccrochent et
// désenregistrent ; tout retour réenregistre (ADR 0006, D3 et D5).
watchSystemLifecycle({
  onSleep: (reason) => {
    // le motif sert la phrase de la notification, pas la décision : elle
    // est la même pour les trois
    noteSleepReason(reason);
    phone.send({ type: "sys:sleep" });
  },
  onWake: () => phone.send({ type: "sys:wake" }),
});

// Personne au clavier depuis dix minutes : Disponible devient Absent pour
// les autres, et revient au premier geste (ADR 0007, D5, règle 2). La
// présence seule en décide ; le téléphone n'en sait rien.
// La fenêtre d'un inconnu ne compte ses deux minutes que dans un onglet
// visible (ADR 0008, D5).
document.addEventListener("visibilitychange", () =>
  messaging.send({ type: "sys:visible", visible: document.visibilityState === "visible" }),
);

watchActivity({
  onIdle: () => presence.send({ type: "sys:idle" }),
  onActive: () => presence.send({ type: "sys:active" }),
});

// Observabilité (docs/CONCEPTION.md §4.5) : depuis la console,
// trix.mermaid() exporte les diagrammes, trix.phone.log les transitions.
declare global {
  interface Window {
    trix: {
      phone: typeof phone;
      presence: typeof presence;
      messaging: typeof messaging;
      mermaid: () => string;
      dump: () => string;
    };
  }
}
window.trix = {
  phone,
  presence,
  messaging,
  mermaid: () =>
    [PhoneMachine, CallBlock, PresenceMachine, MessagingMachine].map((m) => m.toMermaid()).join("\n"),
  // à copier dans un rapport de bug : les dernières transitions, en clair
  dump: () => formatLog(phone.log),
};
