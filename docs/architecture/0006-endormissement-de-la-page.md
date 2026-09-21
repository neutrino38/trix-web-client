# ADR 0006 — L'endormissement de la page

**Statut :** accepté — 2026-09-21 · **implémenté** — 2026-09-21 (SC-1 à SC-9)
Restent à vérifier en réel, et seulement en réel (§5) : que l'unREGISTER parte avant la
suspension des tâches, qu'une notification posée dans `freeze` survive, ce que `localStorage`
contient après un déchargement, et dans quel ordre la WSS livre ce qu'elle a mis en attente.
**Portée :** `ui/lifecycle.ts`, `ui/reachability.ts` (nouveau), `storage/session.ts` (nouveau),
`machines/phone.ts`, `machines/events.ts`, `ui/alert.ts`, `ui/screens/call/*`, `ui/screens/config.ts`,
`i18n/locales/*`, `docs/CONCEPTION.md` §4.1 et §4.13, `USERGUIDE.md`
**Hors périmètre :** le push SIP (RFC 8599, service worker, Web Push) — **étape 2**, plus tard,
dans son propre ADR. Rien ici n'en dépend.
**Références normatives :** W3C Page Lifecycle (`freeze`, `resume`, `document.wasDiscarded`),
Page Visibility, RFC 3261 §10 (REGISTER, expiration du contact), ITU-T F.703, RGAA 3.1

## Contexte

Un téléphone qui ment sur sa joignabilité est pire qu'un téléphone éteint : l'onglet Trix est
toujours dans la barre, avec son titre et son icône, et personne ne peut plus vous appeler. Le
navigateur en décide seul, sans rien demander, et c'est un comportement par défaut — l'Économiseur
de mémoire et l'Économiseur d'énergie de Chrome sont actifs chez tout le monde.

Trix traite déjà deux cas : la **veille machine**, détectée après coup par le saut d'horloge d'un
heartbeat (`ui/lifecycle.ts`), et la **perte du transport** (`sip:disconnected` → `reconnecting`).
Les deux partagent le même angle mort : ils ne disent rien à qui ne regarde pas l'onglet, et le
heartbeat se tait dès que l'onglet est caché — à raison, puisque les timers y sont bridés à environ
un réveil par minute et qu'un retard n'y prouve plus rien. Or c'est précisément l'onglet caché que
le navigateur endort.

Le sujet se traite en **deux étapes**, et cet ADR ne couvre que la première :

1. **L'endormissement lui-même** — le détecter, le dire, se désenregistrer proprement, reprendre au
   réveil. C'est l'objet de ce document, et ça se fait sans rien changer au serveur.
2. **Le push** — rester joignable page fermée, ce qui demande un service worker, un abonnement Web
   Push et un proxy qui suive RFC 8599. Plus tard, dans son propre ADR, et sur une infrastructure
   qui n'existe pas encore.

La seule chose que l'étape 1 doit à l'étape 2 est de ne pas lui fermer la porte : c'est dit en D1 et
en D7, et ça ne coûte rien à écrire maintenant.

Cet ADR pose donc ce qu'on détecte, ce qu'on en dit, et comment on reprend.

## 1. Ce que le navigateur fait, et ce qu'on en voit

| Situation | Signal reçu par la page | Effet SIP | Joignable ? |
|---|---|---|---|
| Onglet caché | `visibilitychange` | aucun, la WSS vit | **oui** |
| Onglet **gelé** (5 min cachés + CPU, Économiseur d'énergie) | `freeze`, puis `resume` | plus rien n'est traité ; le REGISTER n'est plus rafraîchi | non |
| Onglet **déchargé** (Économiseur de mémoire) | **aucun** ; au retour, rechargement avec `document.wasDiscarded` | tout est perdu | non |
| Onglet quitté ou fermé | `pagehide` | idem | non |
| Retour arrière / bfcache | `pagehide` puis `pageshow`, `persisted` | comme le gel | non pendant |
| Veille machine | saut d'horloge | WSS morte en général | non |
| WSS coupée | `sip:disconnected` | contact perdu chez le registrar | non |

### 1.1 Le gel : le seul cas qu'on voit venir

Le gel suspend les files de tâches de la page : timers, rappels réseau, tout s'arrête et reprend
plus tard, avec les variables intactes. C'est le seul endormissement **annoncé** — l'événement
`freeze` s'exécute avant la suspension —, donc le seul où Trix peut encore parler au proxy.

### 1.2 Le déchargement n'est pas une fermeture

L'onglet reste dans la barre, avec son titre et son favicon ; c'est le document qui disparaît. Au
retour de l'utilisateur, l'onglet **se recharge tout seul** depuis son URL et `document.wasDiscarded`
vaut `true`. Rien n'est annoncé, rien ne survit en mémoire : il n'y a aucun moyen de désenregistrer
avant, et aucun moyen de savoir, depuis la page morte, qu'elle est morte.

### 1.3 Pendant un appel, on est protégé

Une connexion WebRTC ouverte ou des pistes `MediaStream` actives figurent parmi les exemptions de
gel, au même titre que la capture micro, caméra ou écran. Autrement dit, la vulnérabilité de Trix
est exactement là où un téléphone doit être le plus fiable : **enregistré, en attente d'appel**.

### 1.4 Ce qu'on ne saura jamais

Ni combien de temps il reste avant un gel, ni si un déchargement approche, ni si un appel a été
perdu pendant l'absence. Tout ce qu'on peut faire, c'est dire la vérité sur la période écoulée.

## 2. Décisions

### D1 — Trois niveaux de joignabilité, pas un booléen

L'application expose un état dérivé, et un seul, que tout le reste consomme :

| Niveau | Condition | Ce que l'utilisateur lit |
|---|---|---|
| `direct` | enregistré, page vivante (`ready`, `in_call`) | « Enregistré » |
| `deferred` | page endormie ou déchargée, **abonnement push actif** | « En veille — vous serez prévenu si on vous appelle » |
| `none` | ni l'un ni l'autre | « Vous ne pouvez pas recevoir d'appel » |

À l'étape 1, **rien ne produit jamais `deferred`** : aucun code ne l'écrit, aucun écran ne l'affiche,
et le niveau se lit comme un booléen. Il figure quand même dans le type, parce que le jour où
l'étape 2 arrivera, « la page dort » cessera de vouloir dire « vous êtes injoignable » : le prévoir
coûte une branche morte, ne pas le prévoir coûterait la reprise de toute la logique d'alerte et de
ses six traductions.

### D2 — Avertir hors de la page, et seulement quand ça se voit

Les canaux sont ceux déjà écrits pour l'appel entrant (`ui/alert.ts`), pour les mêmes raisons
d'accessibilité — rien ne repose sur le son, et rien ne repose sur la couleur seule (RGAA 3.1) :

- **dans la page** : l'état affiché, immédiatement, avec une phrase entière et non une pastille ;
- **titre d'onglet et favicon** : pour l'onglet d'arrière-plan, sans clignotement — une alerte
  permanente qui bat serait une alarme, or il n'y a rien à décrocher ;
- **notification système** : seulement si l'onglet n'est pas visible, après **10 s** d'injoignabilité
  continue, une seule par épisode (`tag: "trix-reachability"`, `requireInteraction: true`).

Le seuil existe pour qu'une reconnexion de trois secondes ne réveille personne. Il est la seule
défense contre le bruit, et c'est aussi lui qui garantit que la notification de retour (D8) reste
rare.

### D3 — Au gel, Trix se désenregistre

`freeze` est le dernier instant où du JS tourne : Trix y envoie `sys:sleep`, ce qui produit un
unREGISTER et ferme le transport — le chemin que l'état `sleeping` emprunte déjà pour la veille
machine. Laisser le contact vivant chez un registrar qui n'a plus personne au bout du fil est le
pire des deux mondes : l'appelant entend sonner dans le vide, et le proxy n'a aucune raison de
router ailleurs. Un contact retiré est une information exploitable ; un contact mort ne l'est pas.

La même règle vaut pour `pagehide`, persisté ou non : un seul chemin, qu'on quitte la page, qu'on
la ferme ou qu'elle parte en bfcache. `beforeunload` n'est pas employé — il n'apporte rien ici et
disqualifierait la page du bfcache.

**À valider en réel** : que l'unREGISTER parte effectivement avant la suspension des tâches. Le
handler est synchrone et l'émission est déjà en file côté socket, mais rien ne le garantit. En cas
d'échec, le filet reste l'expiration du contact côté registrar, puis le push (ADR 0007).

### D4 — Au chargement, Trix reprend l'enregistrement sans rien demander

Le coffre sait quel compte est actif ; on lui adjoint, **hors du coffre**, le fait que ce compte
*doit* être enregistré : un marqueur posé au premier enregistrement réussi, effacé par
« Déconnexion ». Au démarrage, quel que soit le motif du chargement — déchargement, F5, redémarrage
du navigateur —, Trix repart en `connecting` au lieu de s'arrêter sur l'accueil.

Faire dépendre cette reprise de `document.wasDiscarded` aurait été plus discret, mais aurait fait
reposer la joignabilité sur un drapeau qu'on ne peut vérifier qu'en provoquant un déchargement, et
aurait donné deux comportements différents à deux rechargements que l'utilisateur ne distingue pas.
`wasDiscarded` ne sert donc plus qu'à **expliquer** : « le navigateur a mis Trix en veille, vous
étiez injoignable de 14:05 à 14:52 », la borne basse étant lue sur un horodatage « dernier instant
joignable » écrit périodiquement.

Ce marqueur va dans `localStorage` et non dans le coffre : il ne contient rien de secret (un
identifiant opaque et un horodatage), il n'impose pas de migration du format chiffré, et il reste
lisible même si le coffre échoue à s'ouvrir — cas où l'on a justement besoin de dire pourquoi on
n'est pas joignable.

Deux effets de bord assumés : **F5 réenregistre** au lieu de revenir à l'accueil, et **deux onglets
Trix s'enregistrent tous les deux**, chacun avec son contact. Le second était déjà possible, le SIP
le prévoit (le proxy sonne les deux), et ce sera le comportement normal le jour du push.

### D5 — Un REGISTER de contrôle à chaque retour

`resume`, `pageshow`, retour au premier plan, `online`, réveil machine : tous mènent à `sys:wake`,
donc à `handle.refresh()` — même Call-ID, CSeq suivant, aucun nouveau contact — et à
`goto("connecting")` si le transport est déjà fermé. C'est la seule façon de trancher entre « mon
enregistrement a tenu » et « il a expiré pendant que je dormais », et ça ne coûte qu'un paquet.

### D6 — Aucune astuce pour échapper au gel

Pas de piste audio muette en boucle, pas de `MediaStream` fantôme, pas de Web Lock détourné : ce
sont des moyens connus de tomber dans les exemptions, et ils consomment la batterie de l'utilisateur
pour contourner une décision qu'il a prise. Trix fait l'inverse : il **réduit** ce qu'il consomme en
arrière-plan — le heartbeat n'est plus armé quand l'onglet est caché, puisqu'il n'y sert à rien — et
il **dit** à l'utilisateur ce qui dépend de lui : épingler l'onglet, ajouter le site aux « sites
toujours actifs » de Chrome. C'est le guide utilisateur qui l'explique, et l'application qui le
rappelle une fois, au premier endormissement constaté.

### D7 — L'ancienneté d'un appel n'est jamais un critère

Au dégel, la WSS peut livrer d'un coup un INVITE vieux de plusieurs minutes, son CANCEL juste
derrière : Trix sonne, la sonnerie s'éteint aussitôt, et l'historique garde une ligne « appel
manqué » — c'est la vérité, et c'est l'information la plus utile de l'épisode.

Filtrer les entrants sur leur fraîcheur aurait deux torts. Le premier vaut dès aujourd'hui :
raccrocher au nez d'un appelant encore en ligne quand le gel vient de commencer. Le second est un
garde-fou pour l'étape 2 — sous RFC 8599, le proxy envoie le push, attend le réenregistrement,
**puis** relaie l'INVITE : « l'appel qui arrive juste après un réveil » y devient le cas nominal, et
une règle qui l'écarterait saboterait le push au moment précis où il ferait son travail. Autant ne
jamais l'écrire.

Rien n'est ajouté à l'historique pour dire « reçu pendant la veille » : le bandeau de D4 donne déjà
la période, et les horodatages des appels manqués tombent dedans.

### D8 — Le retour à la normale se notifie aussi

Dès lors qu'une notification d'absence a été posée pendant l'épisode, le retour en `direct` en pose
une seconde, **avec le même `tag`**. Deux raisons, dont une purement technique.

L'alerte d'absence est `requireInteraction` — sans quoi elle s'efface en quelques secondes et le
message est perdu pour qui n'était pas devant l'écran. Si la page est ensuite déchargée, l'objet
`Notification` meurt avec le document : plus personne ne peut la fermer, et sans service worker,
`getNotifications()` n'existe pas. Poster sur le même tag est alors le **seul** moyen de faire
disparaître une alerte devenue fausse.

L'autre raison tient au public : une personne sourde qui vient de lire « vous ne pouvez plus
recevoir d'appels » n'a, dans le silence qui suit, aucun moyen de distinguer une application
rétablie d'une application morte. Une alarme qui sait s'allumer doit savoir dire qu'elle s'est
éteinte. Le marqueur « une alerte est en cours » vit dans `localStorage` : il survit au
déchargement, donc le retour se notifie même après un rechargement complet.

Quand le service worker du push existera, `getNotifications()` permettra le nettoyage direct et
cette seconde notification pourra redevenir facultative.

### D9 — Où s'arrête l'étape 1

Tant que l'étape 2 n'est pas faite, **une page endormie ne reçoit pas d'appel**, et c'est ce que
Trix dit. Aucun développement de cet ADR ne suppose un service worker, un abonnement push ou une
évolution du proxy ; aucun ne devient inutile quand ils arriveront. Ce que l'étape 2 trouvera en
place : le niveau `deferred` de D1, la reprise d'enregistrement automatique et sans geste de D4 —
exactement ce dont un réveil par notification a besoin —, et la règle de D7 qui l'empêche de se
tirer une balle dans le pied.

## 3. Plan d'implémentation — étape 1

**SC-1 — `storage/session.ts`.** L'état de session hors coffre, dans `localStorage` : le compte à
reprendre, l'horodatage du dernier instant joignable, le fait qu'une alerte d'absence soit en cours.
Lecture tolérante (stockage indisponible, valeur illisible : on se comporte comme sans). Tests
unitaires.

**SC-2 — Reprise au chargement (D4).** `phone.ts` : le marqueur est posé à l'entrée de `ready`,
effacé par `ui:logout` ; à l'amorçage, `initial_state` part en `connecting` si le marqueur désigne
un compte présent dans le coffre, et sur `home` sinon. Test : coffre + marqueur ⇒ `connecting` sans
aucun événement d'interface.

**SC-3 — `ui/lifecycle.ts` étendu.** Aux deux signaux actuels s'ajoutent `freeze`, `resume`,
`pagehide`, `pageshow`, `visibilitychange` et `online`, chacun porteur d'une **raison** (`freeze`,
`system`, `offline`, `discard`) qui servira au message. Le heartbeat n'est armé que lorsque l'onglet
est visible (D6). L'horodatage « dernier instant joignable » est écrit à chaque battement et sur
passage en caché.

*À l'implémentation*, trois écarts assumés. Le premier : `lifecycle.ts` ne rapporte que les deux
raisons qu'il **observe** (`freeze`, `system`) ; `offline` se lit sur `navigator.onLine` et
`discard` sur `document.wasDiscarded`, tous deux dans `reachability.ts`, qui est aussi le seul à
savoir si l'épisode mérite une phrase. Le deuxième : il a fallu un cinquième motif, `lost`, pour le
cas le plus courant de tous — l'enregistrement est tombé et rien ne dit pourquoi. Le faire passer
pour une veille machine aurait été plus court que juste. Le troisième, pour la même raison que le premier : c'est `reachability.ts` qui
écrit l'horodatage, parce que lui seul sait si l'on **était** joignable — un onglet caché sans
enregistrement n'a pas de dernier instant joignable à consigner. Les deux modules écoutent donc
`visibilitychange`, `freeze` et `pagehide`, chacun pour sa propre raison, et `main.ts` pose les
écouteurs de la joignabilité en premier pour que l'horodatage précède le désenregistrement.

**SC-4 — Désenregistrement propre (D3).** `freeze` et `pagehide` envoient `sys:sleep` ; vérifier sur
une trace réelle que l'unREGISTER part.

**SC-5 — REGISTER de contrôle (D5).** `resume`, `pageshow`, retour au premier plan et `online`
envoient `sys:wake`. Le comportement existant de `ready` (`refresh()` puis repli sur `connecting`)
est conservé tel quel.

*À surveiller* : « retour au premier plan » est pris au pied de la lettre, sans seuil. Quelqu'un
qui bascule d'onglet vingt fois par minute enverra vingt REGISTER. C'est un paquet chacun et le
registrar les attend, mais si cela se voyait dans une trace, le remède tiendrait en une ligne :
n'émettre que si l'onglet est resté caché assez longtemps pour avoir pu geler.

**SC-6 — `ui/reachability.ts` (D1, D2, D8).** Le niveau de joignabilité dérivé de l'état de la
machine, le seuil de 10 s, le titre, le favicon, la notification et sa jumelle de retour. Un seul
point d'entrée, idempotent, appelé depuis `main.ts` comme l'est déjà `watchSystemLifecycle`.

**SC-7 — Le dire dans la page (D1, D4).** Les deux niveaux atteignables sur l'écran d'appel, phrase
entière (`deferred` n'a pas d'écran : rien ne le produit) ; le
message d'après-déchargement avec ses deux bornes horaires ; le rappel unique sur l'épinglage de
l'onglet (D6). Clés ajoutées dans les six langues — le français fait référence et le build échoue si
l'une manque.

**SC-8 — Réglage (D2).** Une ligne dans les paramètres pour couper l'avertissement système, à côté
de la permission de notification déjà demandée pour les appels entrants : même permission, réglages
distincts.

**SC-9 — Documentation.** `docs/CONCEPTION.md` §4.1 (le cycle de vie complet, en remplacement du
paragraphe sur le seul réveil) et un §4.13 pour la joignabilité ; `USERGUIDE.md` : ce que fait le
navigateur, et les deux gestes qui l'en empêchent. Diagrammes régénérés (`npm run diagrams`).

## 4. Étape 2 — plus tard

Hors périmètre, listé ici pour que l'étape 1 ne soit pas conçue contre : abonnement Web Push et
service worker côté client, paramètres RFC 8599 dans le `Contact` du REGISTER, et un proxy capable
de retenir l'INVITE le temps que le client réveillé se réenregistre. Deux questions attendront leur
ADR : ce qu'une page réveillée par un clic sur notification a le droit de faire sans activation
utilisateur (la sonnerie, pas l'alerte visuelle), et le nettoyage des notifications, que
`getNotifications()` rendra enfin direct (D8).

## 5. Validation

Tests automatiques (`npm test`) : la reprise au chargement, le passage `sys:sleep`/`sys:wake` depuis
chaque état, le seuil de 10 s, le calcul de la période d'injoignabilité.

Manuellement, dans `chrome://discards` : **Freeze** sur l'onglet Trix, vérifier l'unREGISTER dans la
trace SIP et la notification ; **Urgent Discard**, revenir sur l'onglet, vérifier le réenregistrement
automatique et le message avec les deux bornes. Puis un appel entrant émis pendant chacun des deux
états, pour observer ce qui arrive au dégel.

Quatre points ne seront tranchés que par ces essais, et cet ADR ne prétend pas les avoir résolus :
si l'unREGISTER part avant le gel (D3) ; si une notification posée dans `freeze` survit à la
suspension ; ce que `localStorage` contient réellement après un déchargement ; et dans quel ordre la
WSS livre ce qu'elle a mis en attente.

## Références

- W3C Page Lifecycle — états `frozen` et `discarded`, événements `freeze` et `resume`,
  `document.wasDiscarded`
- Chrome for Developers — *Memory Saver and Energy Saver mode*, *Freezing on Energy Saver* (critères
  de gel et exemptions : WebRTC, pistes actives, capture, Web Locks, IndexedDB)
- RFC 3261 §10 — REGISTER, expiration du contact ; §14 (renégociation, pour mémoire)
- RFC 8599 — *Push Notification with SIP* (étape 2, hors périmètre)
- ITU-T F.703 — conversation totale ; RGAA 3.1 — l'information ne repose jamais sur la couleur seule
- ADR 0003 (les deux axes, la pastille d'état), `docs/CONCEPTION.md` §4.1 et §4.5
