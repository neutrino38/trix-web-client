/*
 * Service worker de Trix — **une seule raison d'exister** : afficher une
 * notification quand la page ne le peut plus (ADR 0006, D2).
 *
 * Pourquoi il a fallu en passer par là. Une notification ordinaire,
 * `new Notification(...)`, n'est pas affichée sur-le-champ : le moteur
 * prépare ses ressources et **poste une tâche** qui fera l'affichage. Or
 * ce sont exactement les files de tâches de la page que le gel suspend.
 * Une notification posée dans le handler `freeze` n'apparaît donc jamais —
 * elle attend un dégel qui, lui, la rend inutile. Le service worker, lui,
 * vit dans son propre contexte : il n'est pas gelé avec la page, et c'est
 * le seul endroit d'où l'alerte peut encore partir.
 *
 * Ce qu'il ne fait **pas**, et ce n'est pas un oubli : aucun `fetch`. Il
 * n'intercepte rien, ne met rien en cache, ne sert aucune version
 * d'avance — Trix se recharge comme n'importe quelle page. Ajouter un
 * cache ici, ce serait décider que l'utilisateur peut tomber sur une
 * version d'hier, et ça ne se décide pas dans un fichier qui parle
 * d'alertes.
 *
 * Il n'a rien à voir avec le push SIP (RFC 8599) : aucun abonnement Web
 * Push, aucun serveur à prévenir, aucun message venu de l'extérieur.
 * C'est la page qui lui parle, et personne d'autre. L'étape 2 le trouvera
 * en place ; elle n'est pas commencée ici.
 */

// Prendre la main tout de suite : sans cela, un service worker fraîchement
// installé n'aurait la page sous son contrôle qu'au chargement suivant —
// et le premier gel venu serait justement celui qu'on ne saurait pas dire.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

/**
 * Le seul message que la page envoie. `close` efface ce qui portait déjà
 * ce tag — c'est ce dont `reachability.ts` a besoin pour retirer une
 * alerte `requireInteraction` devenue fausse, y compris quand la page qui
 * l'avait posée n'existe plus (D8).
 */
self.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || msg.kind !== "trix:notify") return;
  event.waitUntil(handle(msg));
});

async function handle(msg) {
  if (msg.close) {
    const open = await self.registration.getNotifications({ tag: msg.tag });
    for (const note of open) note.close();
  }
  if (!msg.title) return;
  await self.registration.showNotification(msg.title, {
    body: msg.body,
    tag: msg.tag,
    requireInteraction: msg.keep === true,
    // le retour sonore, quand il y en a un, est celui de l'application
    silent: true,
  });
}

// Cliquer sur l'alerte ramène sur **l'onglet Trix qui existe déjà**, et sur
// aucun autre.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(backToTrix());
});

/**
 * Reprendre l'onglet d'origine, et ne jamais en ouvrir un second.
 *
 * `clients.matchAll` voit les onglets vivants, y compris gelés :
 * `focus()` les dégèle et les ramène au premier plan, ce qui est
 * exactement ce que le clic demande. Un onglet **déchargé**, lui, n'est
 * plus un client — il reste pourtant dans la barre, et un clic dessus le
 * recharge.
 *
 * D'où la règle : quand aucun onglet ne se laisse reprendre, on n'ouvre
 * rien. `openWindow()` créerait un **second** Trix — donc un second
 * enregistrement et un second contact chez le registrar (D4 le tolère,
 * mais personne ne le demande en cliquant sur « revenez sur Trix ») — et
 * le premier resterait là, à côté, impossible à distinguer du nouveau.
 * Ne rien faire est moins utile, mais ce n'est pas faux.
 */
async function backToTrix() {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of windows) {
    if (typeof client.focus !== "function") continue;
    try {
      await client.focus();
      return;
    } catch (err) {
      // celui-là ne se laisse pas ramener (fenêtre fermée entre-temps,
      // page en train de partir) : au suivant
      console.warn("[trix sw] onglet impossible à reprendre", err);
    }
  }
  console.warn(`[trix sw] aucun onglet Trix à reprendre (${windows.length} client(s))`);
}
