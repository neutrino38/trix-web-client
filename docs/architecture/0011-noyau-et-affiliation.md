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

- **Le noyau** : `machines/`, `sip/`, `storage/`, `deployment.ts`, `accounts.ts`,
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
  lifecycle(events: { onSleep(reason: PageSleepReason): void; onWake(): void }): () => void;
  activity(events: { onIdle(): void; onActive(): void }): () => void;
  visibility(listener: (visible: boolean) => void): () => void;
}
```

`browserPlatform()` — ce que font aujourd'hui `ui/lifecycle.ts`, `ui/activity.ts` et l'écouteur
`visibilitychange` de `main.ts` — est la valeur par défaut. Un affilié qui embarque Trix dans
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
- Les versions suivent semver sur ce contrat, avec les étiquettes git du dépôt (`v0.10.0`…).
  Avant 1.0, une version mineure peut rompre, et le dit dans `CHANGELOG.md` sous « API noyau ».
- **Un exemple minimal** (`examples/minimal/`, quelques centaines de lignes) est une seconde UI
  écrite contre la seule façade : comptes, appel audio et texte, fil Échanges. Il est compilé par
  `npm run build` et sert de test de contrat. S'il a besoin d'importer autre chose que
  `src/core/index.ts`, la façade est incomplète.

### D11 — Distribution sans registre npm : une dépendance git étiquetée

L'affilié déclare Trix comme dépendance **par son URL git et une étiquette** :

```json
"dependencies": {
  "trix": "git+https://github.com/neutrino38/trix-web-client.git#v0.10.0"
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

## 3. Plan d'implémentation

Chaque étape laisse l'application fonctionnelle et la suite de tests verte.

1. **La règle** : `test/layers.test.ts` (D1), en signalant d'abord les violations connues comme
   exceptions nommées, retirées au fil des étapes suivantes. Fait le 2026-10-02 : le noyau
   n'importait déjà rien de `ui/`, et deux exceptions seulement restent — `i18n/types.ts` qui
   importe le dictionnaire français (D9) et `sip/port.ts` qui reçoit des `HTMLVideoElement`
   (D4). Les points 2 à 4 du contexte ne sont pas des imports interdits mais de la logique
   absente du noyau : ce test ne les voit pas, les étapes 2 et 3 les traitent.
2. **Les modèles purs** (D6) : déplacements sans changement de comportement, tests déplacés avec.
3. **La conversation** (D5) : `core/conversation.ts`, abonnement au canal par le noyau,
   transcription fournie par lui ; `chat.ts` réduit au rendu.
4. **Les médias** (D4) : `streams()`/`onStreams()` dans le port, `session` retiré de la vue.
5. **La plateforme et l'instance** (D7, D8) : `Platform`, `storagePrefix`, plus d'état de module
   dans le noyau.
6. **La façade et la vue** (D2, D3) : `createTrix`, `TrixView`, sélecteurs ; `main.ts` passe par
   elle, puis chaque écran migre de `phone.context` vers la vue. `trix.debug` remplace
   `window.trix`.
7. **Les messages** (D9) : `CoreMsgKey`, `core/i18n/`, `formatMsg`.
8. **La preuve et la distribution** (D10, D11) : `examples/minimal/`, `exports`, première
   étiquette annoncée comme base d'affiliation.
9. **Le guide d'affiliation** : `docs/utilisation/affiliation.md`, écrit pour celui qui démarre
   un projet affilié sans connaître le dépôt — déclarer la dépendance git étiquetée et régler
   son bundler, appeler `createTrix` et lire la `TrixView`, afficher les flux et les messages
   du noyau, fournir sa `Platform` hors navigateur, servir `config.json` et `sw.js`, choisir son
   `storagePrefix`, monter de version en lisant « API noyau » dans `CHANGELOG.md`. Il s'appuie
   sur `examples/minimal/` et sur l'essai d'installation en réel de la section 4 : il ne décrit
   que ce qui a été vérifié.
10. **Plus tard** : le composant embarquable (D12) ; le guide gagne alors sa section.

## 4. Validation

- `test/layers.test.ts` sans exception restante.
- `examples/minimal/` construit et lancé contre un vrai serveur SIP : enregistrement, appel
  audio + texte, transcription dans l'historique, message, changement de statut.
- Un projet vierge, hors de ce dépôt, installe Trix par l'URL git étiquetée et construit avec
  Vite sans configuration particulière — **à vérifier en réel** : la compilation des sources
  TypeScript d'une dépendance par le pré-bundling de Vite est l'hypothèse de D11.
- Deux `createTrix` avec des `storagePrefix` différents dans la même page : deux comptes, deux
  enregistrements, aucune donnée partagée.

## 5. Questions ouvertes

- **Granularité des abonnements** : un seul `subscribe` sur toute la vue, ou des abonnements
  par domaine (`trix.call.subscribe`) ? Le partage structurel rend le premier suffisant pour
  commencer.
- **Le formulaire de paramètres** : la validation (champs suspects, champs imposés par
  `config.json`) est dans le noyau ; la forme du formulaire, elle, est-elle contractuelle
  (`ConfigForm`) ou chaque UI construit-elle la sienne ?
- **La page de partage de compte** (`share/`, ADR 0004) : noyau (`share/link.ts` l'est déjà) et
  page à part entière, ou modèle de page à réécrire par l'affilié ?

## Références

- ADR 0006 (endormissement), 0007 (présence), 0008 (messagerie) — les automates pairs que la
  façade relie.
- `docs/CONCEPTION.md` §2 — l'architecture en couches, dont cet ADR fait un contrat.
