/**
 * Traces d'erreur des automates sur la console JavaScript.
 *
 * Ce que la machine sait d'un incident vit dans son contexte
 * (`lastError`, `callError`) et dans son journal de transitions : l'écran
 * en montre une phrase, le journal reste en mémoire, et la console — le
 * seul endroit où l'on regarde quand quelque chose cloche à distance —
 * ne recevait rien. Ce module comble ce trou, sans rien demander aux
 * machines : il ne fait qu'observer ce qu'elles publient déjà.
 *
 * Quatre choses sont signalées :
 *
 * - **les erreurs métier** posées par les automates (`lastError`,
 *   `callError`) — une ligne par nouvelle erreur, avec l'état où elle est
 *   apparue et l'événement qui l'a déclenchée ;
 * - **les défauts du moteur** (exception dans un `enter`/handler, `goto`
 *   vers un état inconnu, transition retournée après `fx.sbb`…), que
 *   `finite-state-language` émet en `warn` — remontés en `error`, avec le
 *   journal des dernières transitions ;
 * - **la mort de la machine** : une exception non rattrapée la finalise en
 *   `failure` et l'application se fige sans un mot ;
 * - **les événements non consommés**, restés en file d'attente : le
 *   symptôme d'un état qui a oublié une clause (invariant 7 des SBB).
 *
 * L'inspection est différée d'une microtask, comme le rendu et pour la
 * même raison : une notification part avant le `enter()` de l'état
 * d'arrivée, donc avant ce qu'il écrit dans le contexte.
 */

import type { LogEntry } from "finite-state-language";
import { t } from "../i18n/index.js";
import type { Msg } from "../i18n/types.js";

/** Où partent les traces. Injectable pour les tests. */
export interface Sink {
  error(msg: string, detail?: unknown): void;
  warn(msg: string, detail?: unknown): void;
  debug(msg: string): void;
}

export const consoleSink: Sink = {
  error: (msg, detail) => (detail === undefined ? console.error(msg) : console.error(msg, detail)),
  warn: (msg, detail) => (detail === undefined ? console.warn(msg) : console.warn(msg, detail)),
  debug: (msg) => console.debug(msg),
};

/** Le peu qu'il faut d'une instance FSL pour la surveiller. */
export interface Diagnosable {
  readonly state: string;
  readonly context: {
    /**
     * Messages différés (clé + variables) : la console les traduit dans la
     * langue courante, comme l'écran. Un rapport de bug reste ainsi lisible
     * par qui l'a produit — le code technique, lui, ne bouge pas.
     */
    lastError: Msg | null;
    lastErrorCode: string | null;
    callError: Msg | null;
  };
  readonly pending: readonly { type: string }[];
  readonly log: readonly LogEntry[];
  readonly done: Promise<{ outcome: string; reason?: string }>;
  readonly sbb?: { block: string; state: string } | undefined;
  subscribe(fn: (n: { event?: { type: string } }) => void): () => void;
}

const TAG = "[trix]";

/** Le journal des transitions, prêt à lire dans la console (le plus récent en bas). */
export function formatLog(log: readonly LogEntry[]): string {
  return log.map((e) => `  ${e.event ?? "—"}: (${e.from}) → (${e.to})${e.desc ? ` "${e.desc}"` : ""}`).join("\n");
}

/** L'état courant, bloc compris quand un service building block est en cours. */
function where(m: Diagnosable): string {
  return m.sbb ? `${m.state} / ${m.sbb.block}.${m.sbb.state}` : m.state;
}

/**
 * Branche les traces sur une instance. Rend une fonction qui les débranche.
 */
export function watchMachine(m: Diagnosable, sink: Sink = consoleSink): () => void {
  let lastError: Msg | null = m.context.lastError;
  let callError: Msg | null = m.context.callError;
  let pending = new Set<string>(m.pending.map((e) => e.type));
  let queued = false;
  let lastEvent: string | undefined;

  const inspect = (): void => {
    queued = false;
    const ctx = m.context;
    const from = lastEvent ? ` (sur ${lastEvent})` : "";

    if (ctx.lastError !== lastError) {
      lastError = ctx.lastError;
      if (lastError) {
        const code = ctx.lastErrorCode ? ` [${ctx.lastErrorCode}]` : "";
        sink.error(`${TAG} ${where(m)} : ${t(lastError)}${code}${from}`);
      }
    }
    if (ctx.callError !== callError) {
      callError = ctx.callError;
      if (callError) sink.error(`${TAG} appel échoué : ${t(callError)}${from}`);
    }

    // un événement qui entre dans la file et n'en ressort pas attend un état
    // qui ne l'écoute pas : c'est un trou dans la table de transitions
    const now = new Set(m.pending.map((e) => e.type));
    for (const type of now) {
      if (!pending.has(type)) sink.warn(`${TAG} événement non consommé en ${where(m)} : ${type}`);
    }
    pending = now;
  };

  const unsubscribe = m.subscribe((n) => {
    lastEvent = n.event?.type;
    if (queued) return;
    queued = true;
    queueMicrotask(inspect);
  });

  // finalisation : `success` est une fin normale (déconnexion), le reste est
  // une machine morte — plus rien ne répondra, et l'écran restera tel quel
  void m.done.then(({ outcome, reason }) => {
    if (outcome === "success") return;
    sink.error(
      `${TAG} automate arrêté (${outcome}) : ${reason ?? "sans raison"}\n${formatLog(m.log)}`,
    );
  });

  return unsubscribe;
}

/**
 * Les lignes que `finite-state-language` produit lui-même. Ses avertissements
 * — exception dans un état, `goto` inconnu, livelock — portent tous le
 * préfixe `[NomDeMachine]` que `warn()` ajoute, là où les lignes de
 * transition n'en ont pas : c'est ce qui permet de séparer les deux d'un
 * `logger` unique et de faire ressortir les défauts en `error`.
 */
export function machineLogger(m: () => Diagnosable | null, sink: Sink = consoleSink) {
  return (line: string): void => {
    if (!line.startsWith("[")) {
      sink.debug(line);
      return;
    }
    const inst = m();
    sink.error(`${TAG} ${line}`, inst ? { log: formatLog(inst.log) } : undefined);
  };
}

/** Erreurs qui n'ont pas d'automate pour les porter : rien ne doit passer sous silence. */
export function watchGlobalErrors(sink: Sink = consoleSink): void {
  window.addEventListener("error", (e) => {
    sink.error(`${TAG} erreur non rattrapée : ${e.message}`, e.error);
  });
  window.addEventListener("unhandledrejection", (e) => {
    sink.error(`${TAG} promesse rejetée sans traitement`, e.reason);
  });
}
