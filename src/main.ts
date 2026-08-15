import "./ui/theme.css";
import { PhoneMachine } from "./machines/phone.js";
import { createBrowserStore } from "./storage/store.js";
import { createJsSipPort } from "./sip/port.js";
import { renderApp } from "./ui/app.js";

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

// Observabilité (docs/CONCEPTION.md §4.4) : depuis la console,
// stauri.mermaid() exporte le diagramme, stauri.phone.log les transitions.
declare global {
  interface Window {
    stauri: { phone: typeof phone; mermaid: () => string };
  }
}
window.stauri = { phone, mermaid: () => PhoneMachine.toMermaid() };
