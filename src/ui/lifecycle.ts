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
 * Ce signal ne vaut que sur un onglet visible. Caché, l'onglet voit ses
 * timers bridés — de l'ordre d'un réveil par minute — et le retard mesuré
 * ne prouve plus rien : le prendre pour une veille désenregistre puis
 * réenregistre le compte en boucle. Un onglet caché ne rapporte donc
 * aucune veille ; le rafraîchissement périodique du REGISTER et la
 * fermeture de la WSS rattrapent le cas.
 *
 * Un retour en ligne du navigateur réveille aussi, mais seulement s'il
 * suit une vraie coupure : `online` seul ne dit pas que la WSS est morte.
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
  let offline = !navigator.onLine;

  const timer = setInterval(() => {
    const now = Date.now();
    const gap = now - last;
    last = now;
    if (document.visibilityState !== "visible") return;
    if (gap > GAP_MS) {
      // la veille est constatée après coup : on la signale puis on réveille
      ev.onSleep();
      ev.onWake();
    }
  }, TICK_MS);

  // le retour au premier plan solde le retard accumulé par le bridage
  const onVisibility = (): void => {
    last = Date.now();
  };
  const onOffline = (): void => {
    offline = true;
  };
  const onOnline = (): void => {
    last = Date.now();
    if (!offline) return;
    offline = false;
    ev.onWake();
  };
  document.addEventListener("visibilitychange", onVisibility);
  addEventListener("offline", onOffline);
  addEventListener("online", onOnline);

  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisibility);
    removeEventListener("offline", onOffline);
    removeEventListener("online", onOnline);
  };
}
