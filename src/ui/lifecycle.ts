/**
 * Détection de la veille / du réveil de la machine.
 *
 * Le web n'expose aucun événement « suspend / resume » : ni Page
 * Visibility, ni Page Lifecycle (`freeze`/`resume`) ne couvrent la mise
 * en veille du système — `freeze` ne concerne que les onglets mis en
 * arrière-plan par le navigateur. Le signal fiable est le **saut
 * d'horloge** : un heartbeat régulier qui constate un retard très
 * supérieur à sa période signifie que la machine a dormi entre-temps.
 *
 * On émet donc `sys:sleep` (rétroactif, au retour) puis `sys:wake`. Un
 * `online` du navigateur après une coupure réseau déclenche aussi un
 * réveil : la WSS est morte de toute façon.
 */

const TICK_MS = 2000;
/** Au-delà, le retard ne s'explique plus par la charge machine : c'est une veille. */
const GAP_MS = 30_000;

export interface LifecycleEvents {
  onSleep: () => void;
  onWake: () => void;
}

export function watchSystemLifecycle(ev: LifecycleEvents): () => void {
  let last = Date.now();

  const timer = setInterval(() => {
    const now = Date.now();
    if (now - last > GAP_MS) {
      // la veille est constatée après coup : on la signale puis on réveille
      ev.onSleep();
      ev.onWake();
    }
    last = now;
  }, TICK_MS);

  const onOnline = (): void => {
    last = Date.now();
    ev.onWake();
  };
  addEventListener("online", onOnline);

  return () => {
    clearInterval(timer);
    removeEventListener("online", onOnline);
  };
}
