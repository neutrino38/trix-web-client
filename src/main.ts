import "./ui/theme.css";
import { PhoneMachine } from "./machines/phone.js";
import { CallMachine } from "./machines/call.js";
import { createBrowserStore } from "./storage/store.js";
import { createJsSipPort } from "./sip/port.js";
import { renderApp } from "./ui/app.js";
import { applyPrefs } from "./ui/prefs.js";
import { watchSystemLifecycle } from "./ui/lifecycle.js";
import { watchLayout } from "./ui/layout.js";

applyPrefs();

const phone = PhoneMachine.start({
  debug: true,
  args: {
    store: createBrowserStore(),
    sip: createJsSipPort(),
  },
});

const root = document.getElementById("app")!;
phone.subscribe(() => renderApp(root, phone));
renderApp(root, phone);

// bascule mobile ⇄ bureau : simple re-rendu, l'appel en cours n'est pas coupé
watchLayout(() => renderApp(root, phone));

// veille / réveil de la machine : raccrocher + désenregistrer, puis réenregistrer
watchSystemLifecycle({
  onSleep: () => phone.send({ type: "sys:sleep" }),
  onWake: () => phone.send({ type: "sys:wake" }),
});

// Observabilité (docs/CONCEPTION.md §4.4) : depuis la console,
// stauri.mermaid() exporte les diagrammes, stauri.phone.log les transitions.
declare global {
  interface Window {
    stauri: { phone: typeof phone; mermaid: () => string };
  }
}
window.stauri = {
  phone,
  mermaid: () => `${PhoneMachine.toMermaid()}\n${CallMachine.toMermaid()}`,
};
