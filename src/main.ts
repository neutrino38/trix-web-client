import "./ui/theme.css";
import { PhoneMachine, type PhoneInstance } from "./machines/phone.js";
import { CallBlock } from "./machines/call.js";
import { createBrowserStore } from "./storage/store.js";
import { createJsSipPort } from "./sip/port.js";
import { invalidateScreen, renderApp } from "./ui/app.js";
import { applyPrefs } from "./ui/prefs.js";
import { watchSystemLifecycle } from "./ui/lifecycle.js";
import { watchLayout } from "./ui/layout.js";
import { formatLog, machineLogger, watchGlobalErrors, watchMachine } from "./ui/diagnostics.js";
import { traceCallStates } from "./sip/trace.js";
import { initI18n, onLocaleChange } from "./i18n/index.js";

applyPrefs();

// Langue de l'interface, **avant** toute construction d'écran : `t()` est
// synchrone, le chargement du dictionnaire ne l'est pas. L'attendre ici est
// la seule façon qu'aucun écran ne se rende à moitié traduit. Top-level
// await : Vite le sert nativement en ESM, et le premier rendu suit.
await initI18n();

watchGlobalErrors();

// le moteur peut écrire avant que `phone` ne soit affectée (transition
// initiale) : le logger passe par cette variable, pas par la const
let started: PhoneInstance | null = null;

const phone = PhoneMachine.start({
  debug: true,
  // les transitions restent en console.debug ; ce que le moteur signale
  // lui-même (exception dans un état, goto inconnu…) ressort en console.error
  logger: machineLogger(() => started),
  args: {
    store: createBrowserStore(),
    sip: createJsSipPort(),
  },
});

// erreurs des automates (lastError, callError, mort de la machine, événements
// non consommés) : l'écran en montre une phrase, la console en garde la trace
started = phone;
watchMachine(phone);

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

// veille / réveil de la machine : raccrocher + désenregistrer, puis réenregistrer
watchSystemLifecycle({
  onSleep: () => phone.send({ type: "sys:sleep" }),
  onWake: () => phone.send({ type: "sys:wake" }),
});

// Observabilité (docs/CONCEPTION.md §4.4) : depuis la console,
// trix.mermaid() exporte les diagrammes, trix.phone.log les transitions.
declare global {
  interface Window {
    trix: { phone: typeof phone; mermaid: () => string; dump: () => string };
  }
}
window.trix = {
  phone,
  mermaid: () => `${PhoneMachine.toMermaid()}\n${CallBlock.toMermaid()}`,
  // à copier dans un rapport de bug : les dernières transitions, en clair
  dump: () => formatLog(phone.log),
};
