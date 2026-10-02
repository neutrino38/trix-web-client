/**
 * The errors only the page sees: nothing to do with a machine, and nowhere
 * else to report them. The machines' own traces are the core's
 * (`core/diagnostics.ts`).
 */

import { TAG, consoleSink, type Sink } from "../core/diagnostics.js";

/** Erreurs qui n'ont pas d'automate pour les porter : rien ne doit passer sous silence. */
export function watchGlobalErrors(sink: Sink = consoleSink): void {
  window.addEventListener("error", (e) => {
    sink.error(`${TAG} erreur non rattrapée : ${e.message}`, e.error);
  });
  window.addEventListener("unhandledrejection", (e) => {
    sink.error(`${TAG} promesse rejetée sans traitement`, e.reason);
  });
}
