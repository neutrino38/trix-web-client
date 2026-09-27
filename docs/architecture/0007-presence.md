# ADR 0007 — La présence

**Statut :** proposé — 2026-09-27
**Maquette :** [docs/mockups/trix-presence.html](../mockups/trix-presence.html) (export du canevas
« Trix — Présence » : bureau en fil unifié, menu de statut, mobile, glyphes, états limites)
**Portée :** `sip/pidf.ts`, `sip/publish.ts`, `sip/presence.ts` (nouveaux), `sip/port.ts`,
`storage/store.ts`, `machines/phone.ts`, `machines/events.ts`, `machines/presence.ts`,
`machines/presencesignals.ts` (nouveaux), `main.ts`, `ui/activity.ts`,
`ui/presence.ts` (nouveaux), `ui/screens/call/*`, `ui/theme.css`, `deployment.ts`,
`i18n/locales/*`, `docs/CONCEPTION.md`, `USERGUIDE.md`
**Hors périmètre :** la messagerie hors appel (SIP MESSAGE, RFC 3428), qui remplira la partie
« messages » du fil unifié, dans son propre ADR ; l'autorisation des observateurs (watcher-info,
RFC 3857/3858) ; la liste de contacts côté serveur (RFC 4662, XCAP RFC 4825).
**Références normatives :** RFC 3856 (présence SIP), RFC 6665 (SUBSCRIBE/NOTIFY), RFC 3863
(PIDF), RFC 4480 (RPID), RFC 3903 (PUBLISH), RGAA 3.1

## Contexte

La phase 6 du README annonce « historique convergé, messagerie instantanée, présence ». Le canevas
en donne la forme : au repos, la scène vidéo laisse la place à un fil **Échanges** — un contact par
ligne, sa présence, son dernier événement ; déplié, ses appels et ses messages mêlés et filtrables.
La sidebar ne garde que la composition d'appel. Le statut de l'utilisateur remplace la pastille
« Enregistré » de l'en-tête.

Cet ADR couvre la présence et la part du fil qui n'en dépend pas d'autre chose : les contacts, leur
état, le statut publié, et l'historique des appels regroupé par contact. La messagerie viendra
remplir le même fil ; rien ici ne doit lui fermer la porte.

## 1. Ce que la pile donne, et ce qui manque

| Besoin | Méthode SIP | JsSIP 3.13 |
|---|---|---|
| Voir l'état d'un contact | SUBSCRIBE `Event: presence`, NOTIFY en PIDF | **oui** — `Subscriber` (`ua.subscribe()`) |
| Publier son propre état | PUBLISH `Event: presence`, `SIP-ETag` / `SIP-If-Match` | **non** — aucune classe, aucun crochet |
| Être observé directement (sans serveur de présence) | répondre aux SUBSCRIBE entrants | oui — `Notifier`, non retenu (D1) |

Côté serveur, tout dépend du déploiement :

- **Kamailio / OpenSIPS** avec leur module `presence` : PUBLISH et SUBSCRIBE, agrégation des
  terminaux. C'est la cible.
- **Asterisk (PJSIP)** : répond aux SUBSCRIBE sur les *hints* (état des postes, dont « en
  communication »), mais n'accepte en général pas le PUBLISH d'un client. On y verra les autres ;
  son propre statut choisi ne partira pas.
- **Un registrar nu** : 489 *Bad Event* ou 405 au premier SUBSCRIBE. Pas de présence du tout.

Les trois cas doivent tenir sans configuration : c'est l'objet de D8.

## 2. Décisions

### D1 — Le modèle standard : un serveur de présence, PUBLISH et SUBSCRIBE

Trix publie son état au serveur (PUBLISH) et s'abonne à celui de chaque contact (SUBSCRIBE). Il ne
répond pas lui-même aux SUBSCRIBE entrants : dans une page qui s'endort (ADR 0006), un observateur
servi en direct perdrait l'état à chaque gel, alors que le serveur de présence agrège, persiste et
répond à notre place. Un SUBSCRIBE entrant reçoit 489.

### D2 — PUBLISH est greffé sur les internes de JsSIP, comme le Digest SHA-256

JsSIP n'a pas de PUBLISH. `sip/publish.ts` le construit avec `jssip/lib/SIPMessage.js`
(`OutgoingRequest`) et `jssip/lib/RequestSender.js`, qui gèrent déjà la transaction et le défi
d'authentification — y compris la greffe SHA-256 de `sip/digest.ts`. Même justification, même
précaution : le chemin interne est importé tel quel, et un test vérifie qu'un PUBLISH défié trouve
réponse.

Le cycle RFC 3903 est entièrement dans ce module :

- publication initiale sans `SIP-If-Match`, qui rend un `SIP-ETag` ;
- rafraîchissement avant `Expires` (à 80 %), corps vide, `SIP-If-Match` ;
- modification : même `SIP-If-Match`, nouveau corps ;
- **412** *Conditional Request Failed* : l'ETag est perdu (serveur redémarré) ; on republie depuis
  zéro, une fois ;
- retrait à la désinscription : `Expires: 0`, avant l'unREGISTER.

### D3 — Un abonnement par contact

Un `Subscriber` par contact, `Accept: application/pidf+xml`, `Expires` 3600, rafraîchi par JsSIP.
Pas de liste de ressources (RFC 4662) : peu de serveurs l'exposent au client, et à l'échelle d'un
carnet personnel (quelques dizaines d'entrées) le coût est négligeable. Un plafond de 200
abonnements est posé ; au-delà, les contacts restent affichés en « présence inconnue ».

`Subscription-State: pending` donne l'état **inconnu, en attente de son accord** ; `terminated`
avec `reason=rejected` donne **inconnu** et on ne réessaie pas ; avec `retry-after`, on réessaie à
l'échéance.

### D4 — Un modèle à sept états, et un seul endroit qui lit le PIDF

`sip/pidf.ts`, pur et sans DOM global (un `DOMParser` injecté, pour les tests), convertit dans les
deux sens entre PIDF+RPID et :

```ts
type Presence =
  | "available" | "busy" | "on-the-phone" | "away" | "dnd"
  | "offline" | "unknown";
interface PresenceInfo { state: Presence; note: string | null; since: number | null }
```

| État | PIDF / RPID | Glyphe |
|---|---|---|
| Disponible | `basic open` | disque vert, coche |
| Occupé | `open` + `<rpid:busy/>` | disque rouge, nu |
| En communication | `open` + `<rpid:on-the-phone/>` | disque rouge, combiné |
| Absent | `open` + `<rpid:away/>` | disque orange, aiguilles |
| Ne pas déranger | `open` + `<rpid:busy/>` + note `dnd` (voir ci-dessous) | disque rouge, barre |
| Hors ligne | `basic closed`, ou abonnement actif sans tuple | anneau vide |
| Inconnu | pas d'abonnement, en attente, refusé | anneau pointillé |

RPID n'a pas d'activité « ne pas déranger ». Trix publie `busy` avec un élément d'extension
`<trix:dnd/>` dans son propre espace de noms : un client tiers voit « occupé », ce qui est juste ;
un Trix voit « ne pas déranger ». La note libre voyage dans `<note>`, toujours.

**Plusieurs terminaux** (plusieurs tuples, ou plusieurs `<person>` agrégées par le serveur) : on
retient le plus contraignant — `on-the-phone` > `dnd` > `busy` > `away` > `available` > `offline`.
Quelqu'un qui est en communication sur son poste fixe n'est pas « disponible » parce que son
navigateur l'est.

Le **statut Invisible** n'est pas un état vu des autres : Trix publie `closed`, et l'affiche avec
son propre glyphe (anneau et point) à lui seul.

### D5 — Le statut de l'utilisateur : choisi, puis corrigé par deux règles automatiques

Le statut **choisi** (Disponible, Occupé, Absent, Ne pas déranger, Invisible) et la note sont
gardés **par compte**, hors coffre (`storage/session.ts`) : ce ne sont pas des secrets, et ils
doivent survivre au rechargement de D4 (ADR 0006) sans attendre le déchiffrement.

Le statut **publié** en dérive, par deux règles cochables dans le menu :

1. **En communication** pendant un appel (entrée dans `in_call`), puis retour au statut choisi au
   raccroché. Ne s'applique pas à Invisible ni à Ne pas déranger.
2. **Absent** après 10 minutes sans activité (`ui/activity.ts` : clavier, pointeur, toucher,
   onglet au premier plan). Ne s'applique qu'à Disponible.

### D6 — Ne pas déranger refuse les appels, et les note

C'est ce que montre la maquette (l'appel de David Kone, 486 *Busy Here*). En `ready`, un
`sip:incoming` avec le statut Ne pas déranger est refusé en **486** sans alerte, et consigné dans
l'historique comme **appel refusé** — une issue nouvelle (`CallOutcome` gagne `declined`), distincte
de l'appel manqué : personne n'a laissé sonner. La ligne du menu le dit : « Les appels entrants
sont refusés et notés dans l'historique ».

### D7 — Les contacts vivent dans le coffre, à côté de l'historique

```ts
interface Contact { id: string; name: string; uri: string; addedAt: number }
```

Un enregistrement chiffré par compte (`contacts:<accountId>`), comme `history:<accountId>` (§6),
avec `loadContacts`/`saveContacts` sur `SecureStore`. L'URI est normalisée par `sip/uri.ts` : c'est
la clé qui rattache un appel de l'historique à un contact, et qui porte l'abonnement. Le partage de
compte par lien (ADR 0004) n'emporte pas les contacts, pour la même raison que l'historique.

Une liste côté serveur (RFC 4662 ou XCAP) remplacerait ce stockage sans toucher au reste : la
machine ne voit qu'un tableau de `Contact`.

### D8 — Trois niveaux de prise en charge, découverts et jamais configurés

| Découverte | Conséquence à l'écran |
|---|---|
| SUBSCRIBE et PUBLISH acceptés | tout |
| SUBSCRIBE accepté, PUBLISH refusé (489, 405, 501) | glyphes des contacts ; le menu de statut ne garde que la note et les règles automatiques, avec une phrase : « Ce serveur ne diffuse pas votre statut » |
| SUBSCRIBE refusé (489, 405) | bandeau unique, contacts sans glyphe mais appelables, pastille « Enregistré » d'avant (maquette, états limites, cas 1) |

La découverte est refaite à chaque enregistrement ; son résultat n'est pas gardé.

`config.json` gagne une clé `presence: "no"` qui éteint tout, pour l'exploitant qui sait que son
serveur n'en veut pas et ne souhaite pas voir partir de SUBSCRIBE (§2.1 de `CONCEPTION.md`).

### D9 — Une présence n'est fraîche que tant qu'on est enregistré

Les abonnements naissent à l'entrée dans `ready` et meurent avec l'UA (`stopSip`). En `sleeping`,
`reconnecting` ou `reg_failed`, les états connus sont gardés mais marqués **périmés** : glyphe en
anneau pointillé, et la ligne dit l'âge de ce qu'on sait (« Disponible il y a 12 min — non
actualisé »). C'est la règle de l'ADR 0006 appliquée aux autres : on ne ment pas plus sur eux que
sur soi. La pastille dit « En veille — vos contacts vous voient hors ligne ».

### D10 — Le fil Échanges remplace la scène au repos

Suivant la maquette :

- **Au repos**, la scène vidéo est occupée par le fil : recherche (nom, adresse ; les messages
  quand la messagerie existera), bouton « Ajouter un contact », groupes par ancienneté du dernier
  échange (Aujourd'hui, Hier, Cette semaine, Plus ancien, Sans échange).
- **Une ligne** = un correspondant : avatar à initiales et glyphe, nom, statut et note, dernier
  événement, heure, non-lus, bouton Appeler (plein quand le contact est disponible).
- **Dépliée**, ses événements par jour, filtrables par segments (Tout, Appels, Messages) ; chaque
  appel garde ses boutons actuels (transcription temps réel, trace SIP), qui ouvrent les dialogues
  existants (`ui/chatdialog.ts`, `ui/tracedialog.ts`). Déplier une ligne remplit l'adresse SIP.
- **Agrandie**, la conversation prend toute la surface du fil.
- **Un numéro hors contacts** a sa propre ligne, avec « Ajouter aux contacts ».
- **La sidebar** ne garde que la composition d'appel ; l'indication sous l'adresse nomme le
  contact et son état (« Bob Martin · Disponible »).
- **En appel**, rien ne change : la scène redevient la vidéo, la sidebar reprend le tchat.

L'historique actuel devient donc une vue du fil, regroupée par URI normalisée ; il n'est ni migré
ni dupliqué. Tant que la messagerie n'existe pas, le segment Messages et le champ d'écriture ne
sont pas rendus.

Sur mobile, le fil est l'écran d'accueil sous le champ d'adresse ; la maquette mobile, dessinée
avant le fil unifié, est à reprendre dans ce sens.

### D11 — Jamais la couleur seule, et pas d'annonce à chaque changement

Chaque état a une forme et un mot (RGAA 3.1) ; le mot est toujours écrit dans la ligne, jamais
seulement dans un `title`. Les trois teintes des glyphes sont assombries d'un cran par rapport à
`--green`, `--orange`, `--red`, pour que la marque blanche tienne 3:1 : ce sont trois jetons
nouveaux dans `theme.css` (`--presence-*`), clair et sombre.

Les changements d'état des contacts **ne sont pas annoncés** aux lecteurs d'écran : une liste de
vingt contacts qui bougent serait un bruit continu. Seul le changement de son propre statut est
annoncé (`ui/announce.ts`), parce qu'il répond à un geste.

### D12 — Une machine de présence à part, paire de PhoneMachine

La présence est tenue par `PresenceMachine` (`machines/presence.ts`), une seconde instance que
`main.ts` démarre à côté de PhoneMachine. Ce n'est ni un état de PhoneMachine, ni un enfant.

**Pas dans PhoneMachine.** La présence ne fait pas partie du cycle d'enregistrement : elle se
déroule en parallèle, et les NOTIFY arrivent à tout moment. Pendant un appel, ils tomberaient dans
`CallBlock`, qui consomme tout ce qui arrive (`machines/call.ts`) et devrait alors savoir les
traiter. Hors de `ready`, ils rempliraient la file d'attente (32 places par défaut) d'événements
qu'aucun état ne consomme.

**Pas un enfant (`fx.spawn`).** FSL n'expose pas l'instance d'un enfant. L'écran ne pourrait lire
la présence qu'à travers un miroir tenu dans le contexte du parent et mis à jour par `child:msg`,
c'est-à-dire le miroir que `CallBlock` a été écrit pour éviter. Les messages `parent:msg` et
`child:msg` portent un `payload: unknown` qui échappe au typage des événements. Enfin, le relais
par le parent repasserait par la boîte aux lettres que `CallBlock` occupe pendant l'appel.

**Deux pairs et une colle.** Les deux machines ne se voient pas ; `main.ts` les relie.

- *Du téléphone vers la présence.* `main.ts` observe PhoneMachine (`subscribe`) et traduit ses
  transitions par une fonction pure, testée à part (`presenceSignals(before, after, ctx)`) :
  - `phone:up { handle, accountId, uris }` à l'entrée dans `ready` depuis hors du couloir ;
  - `phone:down` à la sortie de `ready` ou de `in_call` vers tout autre état que ces deux-là ;
  - `phone:callStarted` à l'entrée dans `in_call`, `phone:callEnded` au retour en `ready` ;
  - `phone:contacts { uris }` quand `ctx.contacts` change.
- *De la pile vers la présence.* Les événements des abonnements et de la publication ne passent
  pas par PhoneMachine. `SipHandle` gagne `presence(send)`, sur le modèle de
  `SipPort.start(cfg, send)` : cet appel rend un `PresenceLink` (`watch(uri)`, `unwatch(uri)`,
  `publish(info)`) dont les événements (`sip:presence`, `sip:presenceSupport`) vont au `send` de
  celui qui l'a ouvert. `PhoneEvent` n'en voit aucun.
- *De la présence vers le téléphone.* Il n'y a qu'un besoin, D6. PhoneMachine reçoit un argument
  `doNotDisturb: () => boolean`, lu au `sip:incoming`, sur le modèle de `transcript` ; `main.ts` le
  branche sur le statut choisi de PresenceMachine.

**Ce qui reste où.**

| | PhoneMachine | PresenceMachine |
|---|---|---|
| Contacts (D7) | oui : ils sont dans le coffre, comme l'historique | ne connaît que leurs URI |
| Refus 486 et issue `declined` (D6) | oui | fournit `doNotDisturb` |
| Statut choisi, note, règles (D5) | | oui, persistés par `storage/session.ts` injecté |
| Présence des contacts et fraîcheur (D9) | | oui |
| Niveau de prise en charge (D8) | | oui |
| `ui:setStatus`, `ui:setNote`, `sys:idle`, `sys:active` | | oui |
| `ui:addContact`, `ui:renameContact`, `ui:removeContact` | oui | |

Le retrait de la publication avant l'unREGISTER (D2) se fait dans `SipHandle.stop()`, pas dans une
machine : l'ordre des deux requêtes est une affaire de pile, et `stopSip()` reste la seule porte de
sortie du couloir. Après `stop()`, le `PresenceLink` ne fait plus rien. La colle est notifiée
avant l'`enter()` du nouvel état de PhoneMachine, mais rien n'oblige PresenceMachine à avoir
traité `phone:down` à ce moment-là.

**Les états.**

| État | Sens | Sorties |
|---|---|---|
| `off` | pas encore enregistré depuis le chargement de la page ; rien de connu | `phone:up` → `live` |
| `live` | enregistré ; abonnements et publication en cours | SUBSCRIBE refusé → `no_watch` ; `phone:down` → `stale` |
| `no_watch` | enregistré, SUBSCRIBE refusé (489, 405) : plus aucun SUBSCRIBE jusqu'au prochain enregistrement | `phone:down` → `stale` |
| `stale` | états connus gardés, marqués périmés (D9) | `phone:up` → `live` |
| `disabled` | `presence: "no"` dans `config.json` (D8) | aucune |

`phone:up` refait la découverte (D8). Si le compte a changé, le contexte est vidé avant tout
réabonnement. Le refus du PUBLISH n'est pas un état mais un drapeau du contexte
(`support.publish`) : il ne change rien aux abonnements, seulement au menu, et la machine cesse de
publier jusqu'au prochain enregistrement.

Le statut publié n'est pas un état non plus. Une fonction pure, `publishedPresence(chosen, rules,
inCall, idle)`, le recalcule quand l'une de ses entrées change, et la machine ne publie que si le
résultat diffère. En faire des états multiplierait `live` par l'appel et l'inactivité, sans aucune
différence de comportement au-delà de cette valeur.

## 3. Écarts assumés

- Pas de liste de ressources ni de XCAP (D3, D7).
- Pas d'autorisation des observateurs : c'est la politique du serveur qui décide qui nous voit.
  La maquette (états limites, cas 3) dessine la demande d'accès ; elle attendra watcher-info.
- Pas de `Notifier` : Trix ne sert pas sa présence en direct (D1).
- Ne pas déranger ressemble à « occupé » pour un client qui n'est pas Trix (D4).

## 4. Plan d'implémentation

Chaque phase se livre testée ; les phases PR-1 à PR-5 ne touchent aucun écran.

**PR-1 — `sip/pidf.ts`.** Lecture et écriture PIDF+RPID, extension `trix:dnd`, agrégation des
tuples (D4). Tests sur des corps réels : Kamailio, Asterisk (hints), un PIDF à plusieurs tuples, un
corps illisible (→ `unknown`, jamais une exception).

**PR-2 — `sip/publish.ts`.** Le PUBLISH greffé et son cycle ETag (D2). Tests avec un faux
`RequestSender` : publication, rafraîchissement, modification, 412, retrait ; et le PUBLISH défié
en SHA-256 (même vérification que `test/digest.test.ts`).

**PR-3 — `sip/presence.ts` et le port.** Les abonnements (D3), la découverte (D8), le refus des
SUBSCRIBE entrants (D1). Le port reste la seule frontière : `SipHandle` gagne `presence(send)`, qui
rend un `PresenceLink` (`watch(uri)`, `unwatch(uri)`, `publish(info)`, sans effet après `stop()`).
Ses événements, `sip:presence { uri, info, pending }` et `sip:presenceSupport { subscribe, publish }`,
forment un type à part, hors de `SipEvent` (D12). `stop()` retire la publication avant
l'unREGISTER.

**PR-4 — Contacts dans le coffre (D7).** `Contact`, `loadContacts`/`saveContacts`, rattachement
par URI normalisée. Tests de `store` sur `fake-indexeddb`.

**PR-5 — PresenceMachine et PhoneMachine (D12).** `machines/presence.ts` : les cinq états, le
statut choisi et la note persistés, `publishedPresence`, la présence des contacts avec `fresh`,
`support`. Événements `phone:*`, `sip:presence*`, `ui:setStatus`, `ui:setNote`. Tests avec un faux
`PresenceLink`, découverte des trois niveaux comprise. `machines/presencesignals.ts` : la
traduction pure des transitions de PhoneMachine, testée sur chaque sortie du couloir. Côté
PhoneMachine : `ctx.contacts`, `ui:addContact`, `ui:renameContact`, `ui:removeContact`, l'argument
`doNotDisturb`, le refus 486 et l'issue `declined` (D6). Branchement dans `main.ts`. Diagrammes des
deux machines régénérés (`npm run diagrams`).

**PR-6 — `ui/activity.ts` (D5, règle 2).** `sys:idle` après 10 min, `sys:active` au premier geste,
envoyés à PresenceMachine. Branché dans `main.ts` comme `watchSystemLifecycle`.

**PR-7 — Glyphes et statut.** `ui/presence.ts` : les sept glyphes plus Invisible, leur mot, les
jetons `--presence-*`. Le bouton de statut de l'en-tête et son menu (motif ARIA *menu button*,
`menuitemradio`, flèches, Échap), la note, les deux règles. Le bouton reste la pastille
d'enregistrement quand on n'est pas `ready`.

**PR-8 — Le fil Échanges (D10).** Construction du fil à partir de `contacts` + `history` ; lignes,
dépliage, segments, agrandissement, recherche ; réemploi des dialogues de transcription et de
trace ; la sidebar réduite à la composition. Vue bureau d'abord.

**PR-9 — Mobile et états limites.** Le fil sur mobile ; bandeau serveur sans présence ; lignes
périmées ; fil vide avec « Ajouter <dernier correspondant> » ; ajout depuis une ligne de numéro.

**PR-10 — Déploiement et réglages.** Clé `presence` de `config.json` (D8), documentée dans
`docs/utilisation/deploiement.md`.

**PR-11 — Langues et documentation.** Clés dans les six langues (le build échoue si l'une
manque). `CONCEPTION.md` : §4.14 « La présence », §5.7 « PUBLISH hors JsSIP » ;
`USERGUIDE.md` ; case Phase 6 du README partiellement cochée.

## 5. Validation

Tests automatiques (`npm test`) : PIDF dans les deux sens, cycle ETag, agrégation, péremption à
chaque sortie du couloir, refus en Ne pas déranger, découverte des trois niveaux.

En réel, trois serveurs :

1. **Kamailio + module `presence`** : deux instances Trix qui s'observent ; changer de statut d'un
   côté, le voir de l'autre ; appel entre les deux (En communication des deux côtés) ; geler un
   onglet (`edge://discards`) et vérifier que l'autre voit Hors ligne à l'expiration de la
   publication.
2. **Asterisk** : le glyphe d'un poste suit son état ; le PUBLISH est refusé et le menu le dit.
3. **Un registrar sans présence** : bandeau, contacts appelables, aucun SUBSCRIBE rejoué en boucle.

Points que seuls ces essais trancheront : le code exact rendu par Asterisk au PUBLISH ; si
l'expiration de la publication (et non un `closed` explicite) suffit à faire passer un onglet gelé
hors ligne chez les autres dans un délai raisonnable ; et ce qu'Asterisk met dans le PIDF d'un
poste en communication.

## 6. Questions ouvertes

- **Contacts locaux ou serveur ?** Cet ADR choisit le coffre local (D7). La question du canevas
  reste ouverte pour une plateforme qui fournirait un annuaire.
- **Watcher-info** : quand, et si la demande d'accès mérite une notification système.
- **Le seuil d'absence** : fixe à 10 min, ou réglable ?
- **L'aperçu mobile** est antérieur au fil unifié ; à redessiner avant PR-9.

## Références

- RFC 3856 — A Presence Event Package for SIP
- RFC 6665 — SIP-Specific Event Notification
- RFC 3863 — Presence Information Data Format (PIDF)
- RFC 4480 — RPID: Rich Presence Extensions to PIDF
- RFC 3903 — SIP Extension for Event State Publication
- RFC 4662 — Event Notification Extension for Resource Lists (écarté)
- RFC 3857 / 3858 — Watcher Information (plus tard)
- ADR 0004 (partage de compte), ADR 0006 (endormissement de la page)
