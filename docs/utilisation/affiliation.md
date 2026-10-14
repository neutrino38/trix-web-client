# Construire un projet affilié

Ce guide s'adresse à qui veut bâtir sa propre interface sur Trix, sans connaître son dépôt. Un
projet affilié réutilise le **noyau** de Trix : les comptes, l'enregistrement SIP, les appels,
le texte en temps réel, la messagerie, la présence et l'historique. Il y pose sa propre
interface.

Il ne décrit que ce qui a été vérifié en réel (ADR 0011, section 4). L'exemple
[`examples/minimal/`](../../examples/minimal/) suit pas à pas ce qui est expliqué ici : c'est
une seconde interface complète, en quelques centaines de lignes, qui n'utilise que le noyau.

## Ce que le noyau fait, et ce qu'il laisse à votre interface

Le noyau fait tout ce qui ne s'affiche pas. Il ne touche jamais à la page : ni éléments, ni
styles, ni titre d'onglet, ni notification, ni son. Il donne à votre interface :

- une **vue** : un instantané immuable de l'état, à afficher ;
- des **commandes** : appeler, répondre, envoyer un message, changer de statut… ;
- les **flux** de l'appel (`MediaStream`), à poser sur vos propres éléments `<audio>` et
  `<video>` ;
- des **messages** à traduire, sous forme de clé et de variables.

Restent à votre interface : l'affichage, les sonneries, les alertes (titre, favicon,
notification système), le service worker et les préférences d'affichage.

## 1. Installer Trix

Trix n'est pas publié sur npm. On le déclare **par son URL git et une étiquette** :

```json
"dependencies": {
  "trix": "git+https://github.com/neutrino38/trix-web-client.git#1.0.0"
}
```

Le miroir `https://framagit.org/elixip/trix-web-client.git` sert d'URL de repli. Les
étiquettes n'ont pas de préfixe : `1.0.0`, et non `v1.0.0`.

On importe ensuite **`trix/core`, et rien d'autre** :

```ts
import { createTrix, formatMsg, type TrixView } from "trix/core";
```

Tout le reste du dépôt est interne et peut changer sans préavis. Si vous avez besoin d'autre
chose que `trix/core`, c'est que la façade est incomplète : signalez-le plutôt que d'importer
un module interne.

### Le bundler et TypeScript

Trix est livré **en sources TypeScript**, sans étape de construction à l'installation. C'est
votre bundler qui les compile, comme les vôtres. Vérifié avec **Vite**, en construction comme
en développement, sans aucune configuration particulière. D'autres bundlers devraient
convenir s'ils compilent le TypeScript des dépendances, mais ce n'est pas vérifié.

Votre `tsconfig.json` doit avoir :

```json
"moduleResolution": "bundler"
```

Les imports du noyau sont écrits en `.js`, et c'est ce réglage qui les résout.

Votre `tsc` vérifie aussi les sources de Trix, **avec vos options**. Le noyau compile sous
`strict` et sous ces options strictes, ce que vérifie `test/contract.test.ts` :

- `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` ;
- `noUnusedLocals`, `noUnusedParameters` ;
- `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`.

Les options de pur style, comme `noPropertyAccessFromIndexSignature`, ne sont pas prises en
charge.

## 2. Démarrer une instance

```ts
const trix = createTrix({ storagePrefix: "acme", locale: "fr" });

trix.call.onStreams(() => {
  audio.srcObject = trix.call.streams().remote;
});

await trix.ready;
trix.subscribe(render);
render(trix.view()!);
```

`createTrix` lit la configuration de déploiement, démarre les automates, puis lit le coffre du
navigateur. `trix.ready` se résout quand les automates tournent. Le coffre se lit ensuite :
c'est `view.phase` qui dit quand il est lu.

**Avant `ready`**, seuls `view()` (qui rend `null`), `subscribe`, `call.onStreams` et
`system.onSleep` sont permis. Toute autre commande lève une exception, et
`conversation.subscribe` aussi. C'est le piège le plus courant : une commande appelée trop tôt
arrête le module, et la page reste blanche.

Les options de `createTrix` :

| Option | Rôle | Par défaut |
|---|---|---|
| `storagePrefix` | préfixe du stockage de l'instance (voir section 8) | `trix` |
| `config` | URL de `config.json`, ou l'objet `Deployment` lui-même | `config.json`, relatif à la page |
| `locale` | langue des messages du noyau (balise BCP 47) | `fr` |
| `translate` | votre propre traduction des messages, pour la console | le catalogue du noyau |
| `platform` | ce que le noyau entend de la page (voir section 7) | `browserPlatform()` |
| `sink` | où vont les journaux du noyau | la console |

Les options `store`, `session` et `sip` servent aux tests de Trix lui-même. Elles ne font pas
partie du contrat.

`trix.dispose()` désenregistre le compte, arrête les automates et lâche tous les écouteurs.

## 3. Lire la vue

`trix.subscribe(listener)` appelle `listener` à chaque nouvel instantané. Il ne le fait jamais
au milieu d'une transition : un seul appel suit chaque chaîne de transitions, une microtâche
plus tard. `trix.view()` rend le même instantané, et le montre déjà à jour juste après une
commande.

Une partie de la vue qui n'a pas changé **garde sa référence** d'un instantané à l'autre. On
peut donc comparer par `===` et ne redessiner que ce qui a bougé. Un framework réactif en
profite sans rien faire.

### Quel écran afficher

`view.phase` dit quel écran l'état demande :

| `phase` | Écran | Ce qui sert |
|---|---|---|
| `loading` | chargement | — |
| `vaultError` | le coffre est illisible | `accounts.retryVault()`, `accounts.resetVault()` |
| `accounts` | la liste des comptes (vide au premier lancement) | `view.accounts`, `accounts.use(id)`, `accounts.configure(id \| null)` |
| `settings` | le formulaire d'un compte | `view.settings`, `accounts.save(form)`, `accounts.cancel()` |
| `ready` | l'accueil : appeler, les Échanges | `view.threads`, `view.presence`, `view.messaging` |
| `inCall` | l'appel | `view.call`, `view.conversation` |

`view.registration` précise où en est l'enregistrement : `registered`, `connecting`,
`reconnecting`, `offline`, `sleeping`, `failed`… Chaque valeur mérite ses propres mots à
l'écran.

`accounts.resetVault()` efface tout, sans confirmation : demandez-la deux fois avant de
l'appeler.

### Les messages du noyau

Le noyau n'écrit pas de phrases : il donne des `Msg`, c'est-à-dire une clé et des variables.
`view.errors.last`, la raison d'échec d'un message ou l'issue d'un appel en sont. On les écrit
avec `formatMsg` :

```ts
formatMsg(view.errors.last, "fr");          // un Msg de la vue
formatMsg("error.passwordRequired", "fr");  // « Mot de passe requis »
```

Le noyau livre ses messages en `fr`, `fr-CA`, `en`, `ar`, `ja` et `zh-Hans` (`CORE_LOCALES`).
Le français est chargé avec lui, et la langue de `locale` avant `ready`. Pour une autre langue,
`loadCoreMessages(tag)` la charge à la demande. Une langue absente retombe sur le français,
jamais sur une chaîne vide.

`view.errors.code` donne en plus le code technique (« SIP 404 », « WSS_CONNECT »), à afficher
sous la phrase.

## 4. Les comptes

Le formulaire d'un compte appartient à votre interface. Le noyau valide ce qu'elle lui remet,
sous la forme d'un `ConfigForm` :

```ts
trix.accounts.save({
  proxy: "wss://sip.example.fr:8443/ws",
  uri: "alice@example.fr",
  displayName: "Alice Martin",
  authUsername: null,
  password: "…",     // null ou vide : inchangé, pour un compte existant
  stun: "",
  turn: "",
  turnUsername: "",
  turnPassword: null, // null : inchangé
  turnTls: false,
  rtt: "datachannel",
  fileStore: "https://files.example.fr/hft.php",
});
```

Le mot de passe n'est **jamais gardé** : le noyau en calcule les empreintes (HA1 MD5 et
SHA-256), puis l'oublie. La vue ne montre ni empreinte ni mot de passe TURN.

Après un échec, `view.settings.suspect` nomme le champ à mettre en évidence : `proxy`,
`credentials`, `stun`, `turn` ou `fileStore`.

Pour le texte en temps réel, choisissez **`datachannel`** par défaut. Un appel de pair à pair,
sans serveur de médias entre les deux, ne peut pas porter le texte en WebSocket.

Ce que `config.json` impose est dans `view.deployment` : un champ fixé par l'exploitant
(`proxy`, `domain`, `fileStore`, `rtt`, `ice`) se cache du formulaire.

## 5. Les appels

```ts
trix.call.dial("bob@example.fr", { audio: true, video: false, text: true });
trix.call.answer({ ...view.call!.offered, video: false });
trix.call.hangup();
```

Un appel entrant fait passer la vue en phase `inCall`, avec `view.call.state` à `ringing_in`.
`view.call.offered` dit ce que l'appelant propose.

### Le son et l'image

Le noyau ne crée aucun élément : il donne des flux. **Abonnez-vous une seule fois** à
`call.onStreams`, et posez les flux sur vos éléments :

```ts
trix.call.onStreams(() => {
  const { remote, local, share } = trix.call.streams();
  audio.srcObject = remote;
});
```

L'écouteur suit tous les appels. Il est prévenu quand une piste arrive, quand un média
s'ajoute ou se retire, et quand un appel commence ou se termine. Hors appel, les trois flux
sont `null`.

Placez l'élément `<audio>` **hors de la zone que vous reconstruisez** à chaque vue : sinon, le
son se coupe à chaque instantané.

### Le texte en temps réel

`view.conversation` porte le texte de l'appel en cours : les bulles des deux côtés
(`items`), et ce que le champ de saisie doit afficher (`draft`).

```ts
input.oninput = () => trix.conversation.type(input.value);
// Entrée fige la bulle, des deux côtés
trix.conversation.enter();
```

Passez **toute la valeur** du champ à `type()`, et non la dernière touche : le noyau calcule
lui-même ce qui doit partir. `bubbleText(bubble)` donne le texte d'une bulle.

À la fin de l'appel, la conversation est gardée dans l'historique, dans le champ `chat` de
chaque appel.

## 6. Les Échanges, les messages, la présence

`view.threads` est le fil Échanges : une ligne par correspondant. Chacune réunit :
- ses appels (`calls`, du plus récent au plus ancien) ;
- ses messages (`messages`, du plus ancien au plus récent, comme se lit une conversation) ;
- ses non-lus ;
- la présence du contact.

Le noyau ne trie pas les lignes entre elles. Chacune porte `last`, l'heure de son dernier appel
ou message, pour que votre interface les trie à sa façon.

```ts
trix.messaging.send(thread.target, "Bonjour");
trix.messaging.read(thread.key); // la ligne est ouverte, dans un onglet visible
```

N'appelez `read` que si la ligne est réellement sous les yeux de la personne : c'est ce qui
envoie l'accusé de lecture.

Quand un inconnu écrit, ses messages sont mis de côté. `view.messaging.prompt` le désigne :
proposez `messaging.acceptSender(key)` ou `messaging.refuseSender(key)`.

Les pièces jointes partent par `messaging.sendFile(uri, file, caption)`, si le compte a un
serveur de fichiers (`view.messaging.canSendFiles`). Les fichiers reçus sont décrits par
`message.file` (`FileAttachment`). C'est à votre interface de les télécharger :
`isVoiceMessage` et `isExpired` aident à les présenter.

Le statut se change par `presence.setStatus("dnd")`. `view.presence.shown` dit ce que les
autres voient de vous, une fois appliquées les règles automatiques (« En communication »,
« Absent » après dix minutes d'inactivité).

## 7. La plateforme

Le noyau n'écoute pas la page lui-même. Il apprend par une `Platform` :
- la mise en veille de la page et son retour ;
- l'inactivité ;
- la visibilité de l'onglet ;
- l'état du réseau.

Dans un navigateur, `browserPlatform()`, utilisée par défaut, suffit.

Une application Tauri ou Capacitor fournit la sienne, qui implémente l'interface `Platform`.
Ce cas n'est vérifié qu'avec une plateforme factice (`test/trix.test.ts`), pas en réel.

`system.onSleep(listener)` prévient votre interface **avant** le désenregistrement, quand la
page s'endort. C'est le dernier moment où elle peut encore se dire joignable.

## 8. Le stockage et `storagePrefix`

Chaque instance garde ses comptes, son historique, ses contacts et ses messages dans une base
IndexedDB chiffrée, et quelques réglages dans `localStorage`. Tout est préfixé par
`storagePrefix`.

**Choisissez votre propre préfixe.** Le préfixe par défaut, `trix`, est celui du client Trix.
Sur la même origine, vous partageriez ses comptes.

Deux instances avec deux préfixes peuvent tourner dans la même page, chacune avec son compte et
son enregistrement. C'est vérifié en réel, avec `examples/minimal/?double`. Deux onglets sur le
même préfixe partagent le même coffre, et chacun peut utiliser un compte différent.

## 9. Déployer

Le noyau ne demande que des fichiers statiques servis en HTTPS. Votre interface y ajoute ce
qu'elle veut.

**`config.json`**, à côté de la page, permet à l'exploitant d'imposer des réglages. Il est
facultatif : absent ou illisible, le noyau fait comme s'il n'existait pas. Ses clés :

| Clé | Effet |
|---|---|
| `sip_server` | le proxy SIP (`wss://…`) |
| `sip_domain` | le domaine SIP : l'adresse doit en faire partie |
| `stun_server`, `turn_server`, `turn_username`, `turn_password`, `turn_tls` | les serveurs ICE |
| `realtime_text` | `datachannel`, `websocket`, `none`, ou `user_choice` |
| `file_transfer_server` | le serveur de fichiers de la messagerie (`https://…`) |
| `debug_activated` | `no` : pas de trace SIP |
| `presence` | `no` : ni SUBSCRIBE ni PUBLISH |
| `messaging` | `no` : ni envoi ni réception de messages |

Le gabarit est [`config/config.json.example`](../../config/config.json.example). Vous pouvez
aussi passer l'objet `Deployment` lui-même à `createTrix({ config })`, avec tous ses champs.

**La politique de sécurité (CSP)** doit laisser passer :

```
connect-src 'self' wss: https:; media-src 'self' blob:; img-src 'self' data: blob:
```

`wss:` sert au proxy SIP, réglé par compte. `https:` sert au serveur de fichiers, que l'on
peut restreindre à son origine. `blob:` sert aux fichiers reçus, affichés depuis la mémoire.
Si `https:` ou le serveur de fichiers manque à `connect-src`, l'envoi d'un fichier échoue avant
de partir : rien n'apparaît dans l'onglet Réseau, et la console du noyau le signale.

Le **serveur de fichiers**, sur une autre origine, doit répondre au CORS :
`Access-Control-Allow-Origin` avec l'origine de votre page, `Access-Control-Allow-Headers:
From, Authorization`, et `Access-Control-Expose-Headers: WWW-Authenticate`.

`Permissions-Policy` doit autoriser `microphone=(self)`, et `camera=(self)` pour la vidéo.

**`sw.js` n'est pas requis par le noyau.** Le service worker de Trix sert son interface :
afficher une notification quand la page s'endort, et garder le client en cache hors ligne. Si
votre interface veut la même alerte, il lui faut son propre service worker. Une notification
lancée depuis une page gelée n'est jamais affichée.

## 10. Monter de version

Le contrat est ce qu'exporte `trix/core`, et rien d'autre. Les versions suivent semver sur ce
contrat, à partir de la 1.0.0 : une version mineure ajoute, seule une version majeure rompt.

Avant de changer d'étiquette, lisez la rubrique **« API noyau »** de chaque version dans
[`CHANGELOG.md`](../../CHANGELOG.md).

Un champ ajouté à la vue n'est pas une rupture : ne supposez pas que la vue a une forme
fermée.

`trix.debug` donne accès aux automates eux-mêmes, pour la console et les rapports de bogue.
Il est **hors contrat** : rien de ce qu'il montre n'est promis d'une version à l'autre.
