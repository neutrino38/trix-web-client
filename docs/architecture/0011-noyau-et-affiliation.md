# ADR 0011 — Un noyau sans interface, pour les projets affiliés

**Statut :** proposé — 2026-10-02
**Portée :** `src/core/` (nouveau), `machines/`, `sip/`, `storage/`, `deployment.ts`,
`accounts.ts`, `i18n/`, `main.ts`, les modules de `ui/` qui portent de la logique,
`package.json`, `docs/CONCEPTION.md`
**Hors périmètre :** une publication sur le registre npm ; un second protocole de
signalisation (XMPP, Matrix) ; la réécriture de l'UI actuelle dans un framework.

## Contexte

Trix doit pouvoir servir de base à un autre projet, dans un autre dépôt, qui écrit **sa propre
interface** — dans le framework de son choix — sans forker la logique d'appel, de présence et de
messagerie. C'est ce que ce document appelle un **projet affilié**.

La frontière existe déjà en partie. `machines/`, `sip/` et `storage/` n'importent jamais `ui/` ;
JsSIP est enfermé derrière un port (`createJsSipPort`) ; le coffre est injecté
(`createBrowserStore`) ; les automates n'écrivent pas de texte mais des messages différés (`Msg`,
une clé et ses variables). Ce qui empêche aujourd'hui l'affiliation :

1. **`main.ts` mêle deux rôles** : démarrer et relier les trois automates (le noyau), et brancher
   quatorze modules `ui/`. Un affilié devrait le recopier et le trier à la main.
2. **La conversation de l'appel vit dans l'écran.** `ui/screens/call/chat.ts` tient le modèle du
   texte en temps réel dans un état de module, s'abonne lui-même au canal, et `chatTranscript` est
   réinjecté dans `PhoneMachine`. Une UI qui ne monte pas ce panneau perd le texte reçu, et la
   transcription de l'historique avec.
3. **De la logique sans DOM est rangée dans `ui/`** : le fil Échanges (`ui/thread.ts`), le niveau
   de joignabilité (`ui/reachability.ts`), l'inactivité et les endormissements
   (`ui/activity.ts`, `ui/lifecycle.ts`), les profils d'appel (`callKind`, `callProfile`,
   `answerChoices`, `callModes` dans `parts.ts`), l'export WebVTT (`ui/subtitles.ts`).
4. **Des états globaux de module** : brouillon et sourdine (`parts.ts`), automates liés
   (`bindPresence`, `bindMessaging`). Deux instances de Trix dans une page sont impossibles.
5. **L'écran lit le contexte des automates tel quel** — noms d'états FSL, `ctx.call.session`,
   qui est l'objet du port SIP. Le moindre refactor d'un automate casse toute UI extérieure.
6. **Le port SIP touche le DOM** : `CallSession.attachMedia` reçoit des `<video>`.
7. **Les clés i18n forment un seul type** (`MsgKey = keyof fr`) : celles que produit le noyau
   (`error.*`…) sont mêlées aux libellés des écrans.
8. **La marque est dans le stockage** : base IndexedDB `trix`, une vingtaine de clés
   `localStorage` `trix-*`, étiquettes de notification. Deux dérivés sur la même origine
   partageraient leurs données.

## 1. Décisions

### D1 — Deux couches, et une règle vérifiée

- **Le noyau** : `machines/`, `sip/`, `storage/`, `deployment.ts`, `accounts.ts`, `share/link.ts`,
  `i18n/types.ts`, et un nouveau `src/core/` qui porte la façade (D2) et les modèles sortis de
  `ui/` (D5, D6). Les répertoires existants **ne sont pas déplacés** : le diff resterait illisible
  pour un gain nul.
- **L'UI** : `ui/` et `main.ts`. Elle devient un **client du noyau comme un autre** — le premier,
  et la preuve que la frontière tient.

Le noyau n'importe jamais `ui/`, ne touche pas l'arbre DOM (`document.body`, `createElement`,
`document.title`, CSS) ni les canaux d'alerte (`Notification`, favicon, son). Il peut employer
les API de la plateforme web qui ne sont pas de l'affichage — WebRTC, IndexedDB, Web Storage,
WebCrypto — et reçoit le reste par injection (D7).

Un test (`test/layers.test.ts`) lit le graphe d'imports et échoue si la règle est violée. Une
règle qui n'est pas vérifiée finit toujours par ne plus être vraie.

### D2 — Une façade, `createTrix`

Un affilié n'importe qu'un seul module : `src/core/index.ts`. Tout le reste est interne et peut
changer sans préavis.

```ts
const trix = createTrix({
  config: "/config.json",     // ou un objet Deployment, ou rien
  storagePrefix: "acme",      // D8
  // facultatifs, pour les tests ou une autre plateforme :
  store, sip, platform, logger,
});

await trix.ready;             // langue du noyau, config, coffre lu
const off = trix.subscribe((view) => render(view));

trix.call.dial("bob@example.fr", { audio: true, video: false, text: true });
trix.conversation.type("Bonjour");
trix.presence.setStatus("busy");
trix.messaging.send("bob@example.fr", "À tout de suite");

trix.dispose();               // désenregistre, ferme le port, libère les écouteurs
```

Les commandes sont des **méthodes** groupées par domaine (`accounts`, `call`, `conversation`,
`contacts`, `presence`, `messaging`, `system`), pas des événements `ui:*` à envoyer. Elles
traduisent vers les événements des automates, ce qui laisse renommer un événement sans toucher
au contrat.

`createTrix` reprend exactement le câblage du noyau de `main.ts` : ordre de démarrage
(présence avant téléphone), coffre partagé, `linkPresence`, `linkMessaging`, `doNotDisturb`.

### D3 — Une vue, pas le contexte des automates

`subscribe` livre une **`TrixView`** : un instantané immuable, calculé par le noyau à partir des
trois automates.

```ts
interface TrixView {
  phase: "loading" | "vaultError" | "accounts" | "settings" | "ready" | "inCall";
  registration: "off" | "registering" | "registered" | "failed";
  account: AccountView | null;
  accounts: readonly AccountView[];
  settings: SettingsView | null;        // formulaire, champs suspects, champs imposés
  call: CallSnapshot | null;            // sans `session` (D4)
  conversation: ConversationView | null;// D5
  threads: readonly Thread[];           // le fil Échanges (D6)
  presence: PresenceView;               // mon statut, mes règles, ce que le serveur accepte
  messaging: MessagingView;             // non-lus, quarantaine, envois en attente
  reachability: ReachabilityView;       // niveau et motif (ADR 0006)
  errors: { last: Msg | null; call: Msg | null; contact: Msg | null };
}
```

- **Pas de nom d'état FSL** dans la vue : `phase` et `registration` sont des projections
  stables. Les états réels restent lisibles par `trix.debug` (D9), hors contrat.
- **Partage structurel** : une sous-vue inchangée garde la même référence d'un instantané à
  l'autre. Une UI peut comparer par `===` — ce que `ui/app.ts` fait déjà à la main pour
  l'historique — et un framework réactif évite les re-rendus inutiles.
- **Notification coalescée** : le noyau publie une microtâche après la chaîne de transitions,
  `enter()` compris. Le piège que `main.ts` contourne aujourd'hui (`scheduleRender`) est réglé
  une fois, dans le noyau, pour tous les clients.
- Les champs **ajoutés** à la vue ne sont pas une rupture ; les champs retirés ou renommés en
  sont une (D10).

### D4 — Les médias sortent en flux, pas en éléments

`CallSession.attachMedia(remote, local, share)` est remplacé par des flux :

```ts
trix.call.streams(): { remote: MediaStream | null; local: MediaStream | null; share: MediaStream | null }
trix.call.onStreams(listener): () => void   // pistes ajoutées, partage démarré ou arrêté
```

L'UI pose elle-même `srcObject`. `MediaStream` est une API WebRTC, pas du DOM : le noyau peut
la manipuler sans rien savoir de l'affichage. Les statistiques suivent le même chemin
(`trix.call.stats()`), et `CallSnapshot` ne porte plus `session`.

### D5 — La conversation de l'appel appartient au noyau

Le modèle du texte en temps réel quitte `ui/screens/call/chat.ts` pour `src/core/conversation.ts` :
bulles, état du lien, brouillon, envoi différentiel, scellement de la transcription. Le noyau
s'abonne au canal RTT dès qu'il s'ouvre — que l'écran soit monté ou non — et c'est lui qui fournit
la transcription à l'historique. `chat.ts` ne garde que le rendu et la saisie, qui appelle
`trix.conversation.type()` et `enter()`.

C'est la condition pour qu'une UI qui n'a pas de panneau de tchat — ou qui l'affiche autrement —
ne perde ni le texte ni l'historique.

### D6 — Les modèles purs remontent dans le noyau

| aujourd'hui | demain |
|---|---|
| `ui/thread.ts` | `core/thread.ts` |
| niveau et motif de `ui/reachability.ts` | `core/reachability.ts` ; phrase, titre, favicon et notification restent dans `ui/` |
| `callKind`, `callProfile`, `answerChoices`, `callModes` (`parts.ts`) | `core/callmodes.ts` |
| `chatAsWebVtt`, `subtitlesOf` (`ui/subtitles.ts`) | `core/subtitles.ts` ; le téléchargement reste dans `ui/` |
| `formatLog`, `watchMachine` (`ui/diagnostics.ts`) | `core/diagnostics.ts` |

Le critère est simple : **ce qu'un autre écran devrait réécrire à l'identique appartient au
noyau.** Ce qui dépend de la mise en page, des icônes ou du thème reste dans `ui/`.

### D7 — La plateforme est injectée

Le noyau a besoin de signaux que seul le navigateur donne — gel et retour de la page, inactivité,
visibilité de l'onglet. Ils passent par une interface :

```ts
interface Platform {
  lifecycle(events: { onSleep(reason: PageSleepReason): void; onWake(): void; onOffline(): void }): () => void;
  activity(events: { onIdle(): void; onActive(): void }): () => void;
  visibility(listener: (visible: boolean) => void): () => void;
  visible(): boolean;   // lu au démarrage, avant tout changement
  online(): boolean;    // lu quand l'enregistrement échoue : réseau coupé ou mauvais réglage ?
}
```

`browserPlatform()` (`core/browser/`) — ce que faisaient `ui/lifecycle.ts`, `ui/activity.ts`,
l'écouteur `visibilitychange` de `main.ts` et `navigator.onLine` — est la valeur par défaut. C'est
la seule partie du noyau qui écoute la page (`document`, `window`), et la règle de D1 le lui
permet nommément : elle l'entend, elle ne la change jamais. Un affilié qui embarque Trix dans
Tauri, Capacitor ou un test fournit la sienne.

### D8 — Une instance, un espace de stockage

- **Aucun état de module dans le noyau** : brouillon, conversation, automates liés vivent dans
  l'instance que rend `createTrix`. Deux instances dans une page ne se voient pas — c'est ce
  qu'exigent les tests, et le composant embarquable (D11).
- **`storagePrefix`** (défaut `"trix"`) préfixe la base IndexedDB, chaque clé `localStorage` et
  les étiquettes de notification. Le défaut garde les données des installations existantes.

### D9 — Les messages : un catalogue du noyau

`MsgKey` est scindé. Le noyau exporte `CoreMsgKey` — les seules clés que ses automates et son
port peuvent produire — et leurs textes dans les langues livrées (`core/i18n/`). Un affilié peut :

- les afficher avec `formatMsg(msg, locale)` fourni par le noyau ;
- ou les traduire lui-même : le type `CoreMsgKey` lui dit, à la compilation, quelles clés il
  doit couvrir.

Les dictionnaires de `ui/` étendent celui du noyau ; la vérification de complétude actuelle
(`test/i18n.test.ts`) s'applique aux deux.

`trix.debug` (`phone`, `presence`, `messaging`, `mermaid()`, `dump()`) reste exposé pour
l'observabilité (CONCEPTION §4.5), **hors contrat** : rien n'y est garanti d'une version à
l'autre.

### D10 — Le contrat, ses versions, sa preuve

- Le contrat est **ce qu'exporte `src/core/index.ts`**, rien d'autre.
- Les versions suivent semver sur ce contrat, avec les étiquettes git du dépôt, sans préfixe
  (`0.10.9`…), comme celles qui existent déjà.
  Avant 1.0, une version mineure peut rompre, et le dit dans `CHANGELOG.md` sous « API noyau ».
- **Un exemple minimal** (`examples/minimal/`, quelques centaines de lignes) est une seconde UI
  écrite contre la seule façade : comptes, appel audio et texte, fil Échanges. Il est compilé par
  `npm run build` et sert de test de contrat. S'il a besoin d'importer autre chose que
  `src/core/index.ts`, la façade est incomplète.

### D11 — Distribution sans registre npm : une dépendance git étiquetée

L'affilié déclare Trix comme dépendance **par son URL git et une étiquette** :

```json
"dependencies": {
  "trix": "git+https://github.com/neutrino38/trix-web-client.git#1.0.0"
}
```

et importe `trix/core`. `package.json` gagne un champ `exports` :

```json
"exports": { "./core": "./src/core/index.ts" }
```

- **Les sources TypeScript sont livrées telles quelles**, sans étape de build à l'installation
  (pas de `prepare`) : le bundler de l'affilié (Vite, esbuild) les compile comme les siennes, et
  les erreurs de types pointent vers les vraies sources. Contrainte acceptée : l'affilié compile
  en TypeScript avec `moduleResolution: "bundler"` — les imports du noyau sont en `.js`.
- `jssip` et `finite-state-language` restent des dépendances ordinaires : npm les installe depuis
  le registre, comme pour Trix lui-même.
- Le champ `"private": true` reste : il interdit la publication, pas l'installation par git.
- Le miroir framagit sert d'URL de repli.

Écartés :

- **`git subtree`** : l'affilié copie les sources dans son dépôt et peut les modifier sur place —
  tentant, mais chaque modification locale rend la remontée suivante conflictuelle, et rien ne
  dit plus quelle version il utilise. À réserver à qui veut réellement forker.
- **sous-module git** : mêmes versions explicites que la dépendance git, mais un outillage que
  peu de gens maîtrisent (`--recursive`, détachement de HEAD), pour aucun gain ici.

### D12 — Le composant embarquable : un second client, plus tard

Un élément `<trix-phone>` à poser dans la page d'un tiers (piste E) **se cumule** avec ce noyau :
c'est l'UI actuelle, emballée dans un Custom Element qui appelle `createTrix` au montage et
`dispose` au démontage. Il ne demande rien de plus au noyau que D8 — instance isolée, espace de
stockage propre —, mais il demande à `ui/` :

- des styles dans un Shadow DOM, au lieu de `theme.css` posé sur toute la page ;
- un état par instance, et non par module (`parts.ts`, `chat.ts`, `presence.ts`) ;
- **les canaux globaux de la page en option** — titre d'onglet, favicon, notification système,
  service worker, flash d'écran : la page hôte en est propriétaire, et le composant ne les prend
  que si elle l'y autorise (attributs `alerts="title favicon notify"`) ;
- `public/sw.js` servi par l'origine hôte, faute de quoi les alertes d'endormissement
  (ADR 0006) ne partent pas ;
- la configuration par attributs (`config`, `storage-prefix`, `lang`).

Distribution : un fichier `trix-phone.js` construit par `vite build --lib`, joint à chaque
étiquette git (version de GitHub) — toujours sans registre npm. Ce travail vient **après** D1 à
D10 : commencer par lui figerait l'UI actuelle comme seul client possible.

## 2. Écarts assumés

- **Pas de build distribué du noyau** : un affilié en JavaScript sans TypeScript ni bundler ne
  peut pas consommer le noyau directement. Le composant embarquable (D12) est sa réponse.
- **Une seule plateforme livrée** (`browserPlatform`) ; les autres sont à la charge de l'affilié.
- **La vue est calculée, donc copiée** : un coût par notification, négligeable devant un rendu
  DOM, et le prix d'un contrat qui survit aux refactors des automates.
- **Ce qui appartient à JsSIP ou à l'origine reste global** (D8). La greffe SHA-256
  (`sip/digest.ts`) modifie le prototype de JsSIP, partagé par toutes les instances : son
  registre l'est aussi, rangé par identité — deux instances sur deux comptes ne se voient pas.
  L'en-tête `Allow` (`announceMessaging`) s'écrit dans les constantes de JsSIP : deux
  instances dont une seule éteint la messagerie annoncent le choix du dernier port créé. La
  demande de stockage persistant vaut pour l'origine. `test/layers.test.ts` les nomme, et
  refuse tout autre `let` de module dans le noyau.

## 3. Plan d'implémentation

Chaque étape laisse l'application fonctionnelle et la suite de tests verte.

1. **La règle** : `test/layers.test.ts` (D1), en signalant d'abord les violations connues comme
   exceptions nommées, retirées au fil des étapes suivantes. Fait le 2026-10-02 : le noyau
   n'importait déjà rien de `ui/`, et deux exceptions seulement restent — `i18n/types.ts` qui
   importe le dictionnaire français (D9) et `sip/port.ts` qui reçoit des `HTMLVideoElement`
   (D4). Les points 2 à 4 du contexte ne sont pas des imports interdits mais de la logique
   absente du noyau : ce test ne les voit pas, les étapes 2 et 3 les traitent.
2. **Les modèles purs** (D6) : déplacements sans changement de comportement, tests déplacés avec.
   Fait le 2026-10-02 : `core/thread.ts`, `core/callmodes.ts` (la règle ; libellés et icônes
   restent dans `parts.ts`), `core/reachability.ts` (niveau, motif, phrase ; les épisodes, leurs
   timers et les canaux d'alerte restent dans `ui/`, avec leur état de module, jusqu'à l'étape
   5), `core/subtitles.ts` et `core/diagnostics.ts` (`watchGlobalErrors`, qui écoute `window`,
   reste dans `ui/`). Le noyau ne lit aucun dictionnaire : quand il a des mots à écrire, il
   reçoit un `Translate` (`i18n/types.ts`) — celui de l'UI d'ici à D9.
3. **La conversation** (D5) : `core/conversation.ts`, abonnement au canal par le noyau,
   transcription fournie par lui ; `chat.ts` réduit au rendu. Fait le 2026-10-02 : une
   instance par `createConversation()`, sans état de module ; `followCalls(phone, conv)`
   l'attache au canal de l'appel une microtâche après chaque notification et l'en détache
   à la fin ; elle prévient l'écran par des événements (`reset`, `changed`, `frozen`,
   `alert`, `link`) — l'annonce d'une bulle figée, le flash du `BEL`, le décompte des deux
   secondes et le pli mobile restent dans `chat.ts`. Les tests du modèle passent par un faux
   canal (`test/fakes/rtt.ts`) et vérifient ce qui part sur le fil, ce que l'ancien panneau
   ne permettait pas. Reste : `chat.ts` garde son état d'affichage au niveau du module
   (D12). Vérifié en réel le 2026-10-03 : texte en temps réel dans les deux sens, et sa
   transcription dans l'historique.
4. **Les médias** (D4) : `streams()`/`onStreams()` dans le port, `session` retiré de la vue.
   Fait le 2026-10-02 : `CallSession.streams()` rend `{ remote, local, share }` — routage
   par MID et miroir de l'auto-vue compris, désormais testés sans DOM —, `onStreams()`
   prévient à chaque piste reçue et à chaque négociation conclue ; `ui/` pose `srcObject`
   (`showStreams`) et ne rebranche une surface que si ses pistes changent. `CallView` perd
   `session` et gagne `textChannel` (le tchat existe-t-il ?) ; la session est écrite par
   CallBlock **à côté** de la vue, dans `ctx.session`, où la lisent l'historique, la
   conversation du noyau et, d'ici à l'étape 6, l'écran d'appel pour ses flux et sa mesure.
   `test/layers.test.ts` n'a plus que l'exception de D9. Les statistiques
   (`trix.call.stats()`) attendent la façade. Vérifié en réel le 2026-10-03 : vidéo et
   partage d'écran.
5. **La plateforme et l'instance** (D7, D8) : `Platform`, `storagePrefix`, plus d'état de module
   dans le noyau. Fait le 2026-10-03 : `core/platform.ts` et `core/browser/` (D7) ;
   `createSessionStore(prefix)`, `createBrowserStore(prefix)` et `createSipTrace({ prefix })`
   rangent la session, le coffre et la trace sous le préfixe de l'instance — `trix` par défaut,
   les clés des installations existantes. Le déploiement n'est plus un état de module :
   `loadDeployment()` le rend, `main.ts` le passe aux automates (`ctx.deployment`). La trace SIP
   et les carnets d'appel appartiennent à un port, et non plus au module. L'UI lit ce dont elle
   a besoin — marqueur de reprise, déploiement, réglage de la trace — dans le contexte du
   téléphone, jusqu'à l'étape 6 ; ses propres états de module restent (D12). Le préfixe ne
   s'applique pas encore aux clés de l'UI (`trix-theme`, `trix-lang`…) ni aux étiquettes de
   notification : elles sont à l'UI de Trix, qu'un affilié ne monte pas. Vérifié en réel le
   2026-10-03, avec l'étape 6 : comptes, historique, contacts, messages, statut et trace
   retrouvés après redéploiement et rechargement, reprise sur le compte enregistré.
6. **La façade et la vue** (D2, D3) : `createTrix`, `TrixView`, sélecteurs ; `main.ts` passe par
   elle, puis chaque écran migre de `phone.context` vers la vue. `trix.debug` remplace
   `window.trix`. Première moitié faite le 2026-10-03 : `core/index.ts` (la façade, ses
   commandes par domaine, `trix.call.stats()`) et `core/view.ts` (la vue, mémoïsée sous-vue
   par sous-vue sur les références qu'elle lit). Le noyau démarre les trois automates, les
   relie, écoute la `Platform` et publie un instantané par chaîne de transitions ; `main.ts`
   ne fait plus que monter l'UI. Deux choix de la section 5 sont tranchés : un seul
   `subscribe` ; le formulaire de paramètres hors contrat — la vue porte le compte édité,
   le champ suspect et l'écriture en cours, `trix.accounts.save(form)` reçoit le
   `ConfigForm`. La vue décline l'enregistrement en dix valeurs et non quatre : chacune a
   ses mots à l'écran, qu'un affilié ne doit pas aller chercher dans l'automate. Ce que le
   texte de D3 laissait implicite : `trix.system.onSleep` prévient l'UI d'un endormissement
   **avant** que le noyau ne désenregistre — c'est là que `ui/reachability.ts` pose son
   dernier horodatage joignable, au lieu de compter sur l'ordre de pose des écouteurs.
   Seconde moitié faite le 2026-10-06 : chaque écran lit la `TrixView` et n'agit que par
   les commandes de la façade ; `main.ts` ne touche plus `trix.debug`, qui ne sert plus
   qu'à la console. `test/layers.test.ts` le vérifie : `ui/` et `main.ts` n'importent rien
   de `machines/`, pas même un type — la façade réexporte ceux dont l'UI a besoin. Pour
   y arriver, la vue a gagné ce que les écrans lisaient dans les automates : l'état de la
   messagerie (`messaging.state`), ses messages, sa quarantaine et la fin de la lecture
   du coffre (`loaded`) ; `settings.busy` dit **ce qui** s'écrit (`saving`, `deleting`)
   et non plus seulement que quelque chose s'écrit. `trix.view()` calcule l'instantané à
   la demande : lu juste après une commande, il en montre déjà le résultat, et c'est le
   même objet que portera la notification suivante — l'écran de paramètres et le fil
   Échanges relisent ainsi le refus d'un champ ou d'un contact sans attendre une
   microtâche. Le lien de partage d'un compte porte son HA1, que la vue ne montre pas :
   il passe par une commande, `trix.accounts.shareUrl()`, et `share/link.ts` entre dans
   le noyau (question ouverte de la section 5, pour moitié). La conversation de l'appel
   se lit dans la vue (`conversationOf`, `ui/screens/call/chat.ts`), la joignabilité de
   l'UI suit `view.reachability`, et la session de l'instance est créée par `main.ts`,
   qui la remet à `createTrix` et à `ui/reachability.ts`. `ctx.session`,
   `ctx.deployment` et `ctx.trace` restent dans le contexte du téléphone : ce sont des
   entrées des automates, que plus aucun écran n'y lit. Vérifié en réel le 2026-10-03 : ajout et retrait
   de la vidéo et d'un média, invite du distant, attente, micro, partage d'écran, appel reçu
   onglet caché. Puis le 2026-10-04 : gel de l'onglet, déchargement (`edge://discard`) et
   veille de la machine, chacun suivi de sa reprise ; coupure réseau, annoncée comme telle ;
   statistiques d'appel (`trix.call.stats()`), réglage de la trace SIP, modification d'un
   compte et signalement du champ suspect. Après la veille comme après la coupure, le premier
   réenregistrement échoue et le second, dix secondes plus tard, réussit : `online` arrive
   avant que le réseau ne serve. Deux appels avec un Trix sur Chrome Android ont été raccrochés par ce
   dernier pendant une longue saisie en texte temps réel ; la cause, côté Android, reste à
   établir.
7. **Les messages** (D9) : `CoreMsgKey`, `core/i18n/`, `formatMsg`. Fait le 2026-10-06 : les
   73 clés que le noyau produit — relevées dans son code par l'arbre syntaxique, pas à la
   main — quittent les dictionnaires de l'UI pour `core/i18n/<langue>.ts`, que chacun
   d'eux étend (`...core`). `i18n/types.ts` ne connaît plus que `CoreMsgKey` et
   `CoreDictionary` ; `Dictionary` et `MsgKey`, qui couvrent les deux, passent à l'UI
   (`i18n/dictionary.ts`). Le français du noyau est livré avec lui, les autres langues
   se chargent à la demande (`loadCoreMessages`, des `import()` ordinaires et non un
   glob de Vite, pour tout bundler) ; `createTrix({ locale })` charge la sienne avant
   `ready`, et c'est elle qui écrit la console quand l'UI ne donne pas sa traduction.
   `formatMsg` retombe sur le français, jamais sur une chaîne vide. `test/i18n.test.ts`
   vérifie que chaque langue de l'UI a son catalogue du noyau, complet, aux mêmes
   variables, repris tel quel ; `test/layers.test.ts` n'a plus d'exception.
8. **La preuve et la distribution** (D10, D11) : `examples/minimal/`, `exports`, première
   étiquette annoncée comme base d'affiliation. Fait le 2026-10-14, sauf l'étiquette.
   - `test/contract.test.ts` parcourt les exports de la façade avec le vérificateur de types.
     Chaque type nommé de `src/` rencontré en chemin doit être exporté lui aussi. Il en
     manquait 26 : les bulles de la conversation, `RttState`, `FileAttachment`,
     `UploadFile`, l'issue d'un appel… Un affilié n'aurait pu les nommer qu'en important un
     module interne. Ils sont exportés, avec `bubbleText`, `isVoiceMessage` et
     `isExpired`. `Trix.debug` et les accès de test de `TrixOptions` (`store`, `session`,
     `sip`) restent hors du parcours, puisqu'ils sont hors contrat.
   - `examples/minimal/` est une seconde UI, sans framework, qui importe `trix/core` et
     rien d'autre ; `test/layers.test.ts` le vérifie. Grâce au champ `exports`, le paquet
     s'importe lui-même par son nom, comme chez un affilié : ni `tsc` ni Vite n'ont besoin
     d'alias. `npm run build` la construit dans son propre `dist/`, que `deploy.sh`
     n'envoie jamais, et `npm run example` la sert.
   - `CHANGELOG.md` commence, avec sa rubrique « API noyau ».
   - Les sources sont compilées par le TypeScript de l'affilié, **avec ses options** (D11).
     L'essai en réel l'a montré : sous `exactOptionalPropertyTypes` ou `noUnusedLocals`,
     le noyau ne compilait pas. Il compile maintenant, et `test/contract.test.ts` le
     vérifie sous ces options et quatre autres options strictes. Les options de pur style,
     comme `noPropertyAccessFromIndexSignature`, ne sont pas prises en charge.
   - Les étiquettes restent sans préfixe, comme les existantes. La base d'affiliation sera
     la **1.0.0**, posée à la fin de l'étape 9 : le contrat sera alors prouvé et documenté.
9. **Le guide d'affiliation** : `docs/utilisation/affiliation.md`, écrit pour celui qui démarre
   un projet affilié sans connaître le dépôt — déclarer la dépendance git étiquetée et régler
   son bundler, appeler `createTrix` et lire la `TrixView`, afficher les flux et les messages
   du noyau, fournir sa `Platform` hors navigateur, servir `config.json` et `sw.js`, choisir son
   `storagePrefix`, monter de version en lisant « API noyau » dans `CHANGELOG.md`. Il s'appuie
   sur `examples/minimal/` et sur l'essai d'installation en réel de la section 4 : il ne décrit
   que ce qui a été vérifié.
10. **Plus tard** : le composant embarquable (D12) ; le guide gagne alors sa section.

La version **1.0.0** clôt le chantier, avec l'étape 9 : à partir d'elle, une rupture du
contrat demande une version majeure (D10).

## 4. Validation

- `test/layers.test.ts` sans exception restante. **Fait** (étape 7).
- `examples/minimal/` construit et lancé contre un vrai serveur SIP : enregistrement, appel
  audio + texte, transcription dans l'historique, message, changement de statut. Construit
  (étape 8) ; **l'essai contre un vrai serveur reste à faire**.
- Un projet vierge, hors de ce dépôt, installe Trix par l'URL git étiquetée et construit avec
  Vite sans configuration particulière. **Vérifié le 2026-10-14**, par `git+file://` sur un
  commit plutôt que par l'URL publique, faute d'étiquette poussée. `tsc --noEmit` et
  `vite build` passent sans alias. En développement, le pré-bundling de Vite compile les
  sources TypeScript de la dépendance (`node_modules/.vite/deps/trix_core.js`) : l'hypothèse
  de D11 tient. L'installation par git prend tout le dépôt (docs, tests), faute de champ
  `files`. C'est sans effet sur le bundle, et c'est laissé tel quel.
- Deux `createTrix` avec des `storagePrefix` différents dans la même page : deux comptes, deux
  enregistrements, aucune donnée partagée. Couvert avec des faux par `test/trix.test.ts`
  (« keeps two instances apart ») ; **l'essai avec deux vrais comptes reste à faire**.

## 5. Questions ouvertes

- ~~**Granularité des abonnements**~~ : un seul `subscribe` (étape 6). Des abonnements par
  domaine pourront s'y ajouter sans rupture.
- ~~**Le formulaire de paramètres**~~ : hors contrat (étape 6). Le noyau porte la validation et
  ce qui l'encadre ; chaque UI construit son formulaire et remet un `ConfigForm`.
- **La page de partage de compte** (`share/page.ts`, ADR 0004) : page à part entière, ou modèle
  de page à réécrire par l'affilié ? Le lien lui-même est au noyau depuis l'étape 6
  (`share/link.ts`, `trix.accounts.shareUrl()`).

## Références

- ADR 0006 (endormissement), 0007 (présence), 0008 (messagerie) — les automates pairs que la
  façade relie.
- `docs/CONCEPTION.md` §2 — l'architecture en couches, dont cet ADR fait un contrat.
