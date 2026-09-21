/**
 * Les endormissements de la page et de la machine (ADR 0006).
 *
 * Trois choses différentes s'appellent « veille », et une seule est
 * annoncée par le navigateur :
 *
 * - le **gel** de l'onglet (Page Lifecycle, Économiseur d'énergie) : les
 *   files de tâches sont suspendues, `freeze` s'exécute juste avant et
 *   `resume` juste après. C'est le seul endormissement où du JS tourne
 *   encore — donc le seul où Trix peut encore parler au proxy (D3) ;
 * - la **veille machine** : le web n'expose rien, et le signal fiable est
 *   le **saut d'horloge** — un heartbeat régulier qui constate un retard
 *   très supérieur à sa période ;
 * - le **déchargement** de l'onglet (Économiseur de mémoire) : rien n'est
 *   annoncé, rien ne survit ; il se constate au chargement suivant, et
 *   c'est `ui/reachability.ts` qui le lit sur `document.wasDiscarded`.
 *
 * Le heartbeat n'est armé **que sur un onglet visible** (D6). Caché,
 * l'onglet voit ses timers bridés — de l'ordre d'un réveil par minute —
 * et le retard mesuré ne prouve plus rien : le prendre pour une veille
 * désenregistrerait puis réenregistrerait le compte en boucle. Un onglet
 * caché ne rapporte donc aucune veille machine ; ce qui l'endort vraiment
 * là-bas, c'est le gel, et le gel, lui, se signale.
 *
 * Un retour en ligne du navigateur réveille aussi, mais seulement s'il
 * suit une vraie coupure : `online` seul ne dit pas que la WSS est morte.
 *
 * Ce module ne fait que **rapporter des signaux** : il ne sait pas si l'on
 * était joignable, et n'écrit donc pas l'horodatage du dernier instant
 * joignable — c'est `ui/reachability.ts` qui le tient, parce que lui seul
 * lit l'état de la machine. Les deux écoutent `visibilitychange`, `freeze`
 * et `pagehide`, chacun pour sa propre raison.
 */

const TICK_MS = 2000;
/** Au-delà, le retard ne s'explique plus par la charge machine : c'est une veille. */
const GAP_MS = 30_000;

/**
 * Pourquoi la page s'endort, **parmi ce que le navigateur annonce**.
 *
 * `leave` n'est pas un `freeze` déguisé, et les confondre coûterait cher :
 * le gel garde l'onglet dans la barre et le rendra plus tard, tandis que
 * `pagehide` dit que la page s'en va — l'utilisateur a fermé, navigué
 * ailleurs, ou le navigateur se ferme. Le SIP en tire la même conclusion
 * (D3 : on se désenregistre dans les deux cas), mais on n'alerte personne
 * de ce qu'il vient de décider (D2).
 *
 * Les deux autres motifs d'injoignabilité — réseau coupé, onglet déchargé —
 * ne s'observent pas ici : le premier se lit sur `navigator.onLine`, le
 * second au chargement suivant (`ui/reachability.ts`).
 */
export type PageSleepReason = "freeze" | "leave" | "system";

export interface LifecycleEvents {
  onSleep: (reason: PageSleepReason) => void;
  /**
   * Un retour, quel qu'il soit : dégel, sortie du bfcache, retour au
   * premier plan, retour en ligne, réveil machine. Il ne porte pas de
   * motif — ce qui demande une explication est la période écoulée, pas
   * la façon dont elle s'est terminée (D5).
   */
  onWake: () => void;
}

export function watchSystemLifecycle(ev: LifecycleEvents): () => void {
  let last = Date.now();
  let offline = !navigator.onLine;
  let timer: ReturnType<typeof setInterval> | null = null;

  const beat = (): void => {
    const now = Date.now();
    const gap = now - last;
    last = now;
    if (gap <= GAP_MS) return;
    // la veille est constatée après coup : on la signale puis on réveille
    ev.onSleep("system");
    ev.onWake();
  };

  const arm = (): void => {
    if (timer !== null) return;
    last = Date.now();
    timer = setInterval(beat, TICK_MS);
  };

  const disarm = (): void => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };

  const visible = (): boolean => document.visibilityState === "visible";

  const onVisibility = (): void => {
    // l'onglet passe en arrière-plan : le heartbeat n'y sert plus à rien
    if (!visible()) return disarm();
    arm();
    // D5 : tout retour vaut un REGISTER de contrôle — c'est la seule façon
    // de trancher entre « mon enregistrement a tenu » et « il a expiré »
    ev.onWake();
  };

  // Le gel est le dernier instant où du JS tourne : Trix s'y désenregistre
  // (D3). `pagehide` emprunte le même chemin, persisté ou non — quitter la
  // page, la fermer ou partir en bfcache laissent le même contact mort chez
  // le registrar. `beforeunload` n'est pas employé : il n'apporterait rien
  // et disqualifierait la page du bfcache.
  const onFreeze = (): void => {
    disarm();
    ev.onSleep("freeze");
  };

  const onResume = (): void => {
    ev.onWake();
    if (visible()) arm();
  };

  const onPageHide = (): void => {
    disarm();
    ev.onSleep("leave");
  };

  const onPageShow = (e: PageTransitionEvent): void => {
    // `pageshow` se produit aussi au premier chargement : seul le retour
    // du bfcache (`persisted`) est un réveil
    if (!e.persisted) return;
    ev.onWake();
    if (visible()) arm();
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

  if (visible()) arm();
  document.addEventListener("visibilitychange", onVisibility);
  document.addEventListener("freeze", onFreeze);
  document.addEventListener("resume", onResume);
  addEventListener("pagehide", onPageHide);
  addEventListener("pageshow", onPageShow);
  addEventListener("offline", onOffline);
  addEventListener("online", onOnline);

  return () => {
    disarm();
    document.removeEventListener("visibilitychange", onVisibility);
    document.removeEventListener("freeze", onFreeze);
    document.removeEventListener("resume", onResume);
    removeEventListener("pagehide", onPageHide);
    removeEventListener("pageshow", onPageShow);
    removeEventListener("offline", onOffline);
    removeEventListener("online", onOnline);
  };
}
