/**
 * Poser une notification système, par la voie qui survit au gel.
 *
 * Deux voies, et elles ne se valent pas :
 *
 * - **le service worker** (`public/sw.js`) — il vit dans son propre
 *   contexte, que le gel de la page ne suspend pas. C'est la seule qui
 *   fonctionne depuis un handler `freeze`, et c'est celle qu'on prend dès
 *   qu'elle existe ;
 * - **`new Notification(...)`** — le repli : page non contrôlée (premier
 *   chargement, service worker refusé, navigateur qui n'en veut pas).
 *   Elle marche parfaitement tant que la page tourne, et pas du tout
 *   quand elle s'endort.
 *
 * Pourquoi la première l'emporte : une notification ordinaire n'est pas
 * affichée dans l'appel qui la construit. Le moteur prépare ses
 * ressources puis **poste une tâche** qui fera l'affichage — et les files
 * de tâches de la page sont exactement ce que le gel suspend. L'alerte
 * n'apparaît donc jamais : elle attend un dégel qui la rend inutile.
 *
 * Aucun échec n'est avalé en silence. Une notification qui ne part pas est
 * précisément le genre de panne qu'on ne peut pas constater de l'écran —
 * la console, elle, garde la trace, et elle survit au gel.
 */

/** Ce qu'une alerte porte, quelle que soit la voie empruntée. */
export interface Notice {
  title: string;
  body: string;
  /** Un même tag remplace l'alerte précédente au lieu de s'empiler. */
  tag: string;
  /** `requireInteraction` : elle reste jusqu'à ce qu'on la ferme. */
  keep: boolean;
}

/** Le service worker qui contrôle cette page, `null` tant qu'il n'y en a pas. */
function controller(): ServiceWorker | null {
  if (typeof navigator === "undefined") return null;
  return navigator.serviceWorker?.controller ?? null;
}

/**
 * Installe le service worker des notifications. Best-effort et sans
 * attente : un échec ne coûte que le repli, et rien de ce que fait Trix
 * n'en dépend. Appelé une fois, depuis `main.ts`.
 */
export function registerNotifier(): void {
  if (typeof navigator === "undefined" || !navigator.serviceWorker) return;
  // `import.meta.env.BASE_URL` : Trix peut être servi ailleurs qu'à la
  // racine, et un service worker ne contrôle que son propre répertoire
  const url = `${import.meta.env.BASE_URL}sw.js`;
  navigator.serviceWorker.register(url, { scope: import.meta.env.BASE_URL }).catch((err: unknown) => {
    // contexte non sécurisé, fichier absent, réglage du navigateur : on
    // retombe sur `new Notification`, qui suffit tant que la page vit
    console.warn("[trix] service worker des notifications indisponible", err);
  });
}

/**
 * Pose une alerte. Rend l'objet `Notification` **seulement** sur la voie
 * de repli — la voie du service worker n'en expose aucun, et c'est
 * `clearNotice` qui la referme. Rend `null` quand rien n'a pu être posé.
 */
export function showNotice(n: Notice): Notification | null {
  const sw = controller();
  if (sw) {
    sw.postMessage({ kind: "trix:notify", ...n });
    return null;
  }
  try {
    const note = new Notification(n.title, {
      body: n.body,
      tag: n.tag,
      requireInteraction: n.keep,
      silent: true,
    });
    note.onclick = () => {
      window.focus();
      note.close();
    };
    return note;
  } catch (err) {
    // notifications indisponibles (contexte non sécurisé, plateforme qui
    // exige un service worker) : les autres canaux restent, mais ceci doit
    // se lire quelque part
    console.warn("[trix] notification refusée par le navigateur", err);
    return null;
  }
}

/**
 * Retire les alertes portant ce tag. Par le service worker quand il y en
 * a un — c'est le seul qui puisse fermer une notification posée par une
 * page qui n'existe plus (ADR 0006, D8) ; sinon il n'y a rien à faire
 * ici, l'appelant garde son objet et le referme lui-même.
 */
export function clearNotice(tag: string): void {
  controller()?.postMessage({ kind: "trix:notify", tag, close: true, title: "" });
}
