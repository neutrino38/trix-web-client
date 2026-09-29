# ADR 0008 — La messagerie instantanée

**Statut :** accepté — 2026-09-29 · **implémenté** — 2026-09-29 (M-1 à M-10) ; validation
réelle à faire (§5)
**Maquette :** le segment Messages et le champ d'écriture du fil sont ceux du canevas « Trix —
Présence » ([docs/mockups/trix-presence.html](../mockups/trix-presence.html)) ; la fenêtre
« Message d'un inconnu », la pastille de l'écran d'appel et le menu Bloquer sont **à dessiner**
avant M-6 et M-7.
**Portée :** `sip/message.ts` (nouveau), `sip/port.ts`, `storage/store.ts`,
`machines/messaging.ts` (nouveau), `machines/presencesignals.ts`, `machines/phone.ts`,
`machines/call.ts`, `main.ts`, `ui/thread.ts`, `ui/screens/call/*`, `ui/notify.ts`,
`ui/title.ts`, `ui/favicon.ts`, `ui/announce.ts`, `deployment.ts`, `i18n/locales/*`,
`docs/CONCEPTION.md`, `docs/utilisation/deploiement.md`, `USERGUIDE.md`
**Hors périmètre :** CPIM (RFC 3862) et les accusés IMDN (RFC 5438), qui viendront dans un second
temps (D1) ; les conversations de groupe (MSRP, RFC 4975, et les conférences) ; les fichiers et
images ; la synchronisation entre appareils (D9).
**Références normatives :** RFC 3428 (SIP MESSAGE), RFC 3261 (transactions non-INVITE, §17),
RFC 4320 (réponses provisoires aux non-INVITE), RGAA 3.1

## Contexte

La phase 6 du README annonce « historique convergé, messagerie instantanée, présence ». L'ADR 0007
a livré la présence et le fil **Échanges** en laissant la place aux messages : le segment Messages
et le champ d'écriture « ne sont pas rendus » tant que la messagerie n'existe pas (ADR 0007, D10).
Cet ADR les remplit.

Deux messageries ne doivent pas se confondre. Le **tchat de l'appel** est du texte temps réel
T.140 : il naît avec le canal de l'appel et meurt avec lui (ADR 0001, ADR 0003,
`CONCEPTION.md` §4.9). La **messagerie** de cet ADR est faite de messages entiers, envoyés par
SIP MESSAGE hors de tout appel, et gardés dans le fil.

Il y a aussi un défaut à corriger. JsSIP annonçait MESSAGE dans l'en-tête `Allow` de chaque requête
alors qu'un MESSAGE entrant recevait 405, faute d'écouteur `newMessage`. Le commit
`sip: Allow no longer announces MESSAGE` (branche `fix/message-405`) retire MESSAGE de
`ALLOWED_METHODS` en attendant cet ADR ; M-1 l'y remet.

## 1. Ce que la pile donne, et ce qui manque

| Besoin | JsSIP 3.13 |
|---|---|
| Envoyer un MESSAGE hors dialogue | **oui** — `ua.sendMessage(target, body, { contentType, eventHandlers })`, avec `succeeded` / `failed` |
| Recevoir un MESSAGE hors dialogue | **oui** — événement `newMessage` ; `accept()` / `reject()` choisissent la réponse, 200 par défaut |
| Répondre 415 avec le bon `Accept` | **en partie** — le 415 porte `Accept: ${C.ACCEPTED_BODY_TYPES}`, qui ne cite que `application/sdp, application/dtmf-relay` |
| Recevoir un MESSAGE **dans le dialogue d'un appel** | **non** — `RTCSession.receiveRequest` répond 501 |
| Garder la transaction ouverte longtemps | **non, et SIP non plus** — voir D5 |

La greffe se limite donc aux constantes que JsSIP utilise pour écrire ses en-têtes, sur le modèle
du correctif du 405 : `ALLOWED_METHODS` regagne MESSAGE, `ACCEPTED_BODY_TYPES` gagne `text/plain`.

Côté serveur, la messagerie demande un proxy qui route MESSAGE vers les contacts enregistrés, et
qui **garde les messages** d'un destinataire désinscrit pour les lui remettre à son retour (D8).
Kamailio le fait avec le module `msilo` ; Asterisk (PJSIP) route MESSAGE par le plan de numérotation
(`MessageSend`) mais ne garde rien.

## 2. Décisions

### D1 — `text/plain` seul, CPIM et IMDN plus tard

Trix envoie et reçoit `text/plain; charset=UTF-8`. Une réponse 2xx dit **« remis au serveur »**,
et l'écran ne dit rien de plus : ni distribué, ni lu. CPIM et IMDN viendront dans un ADR suivant,
avec le choix du format par correspondant ; rien dans le stockage (D6) ne doit leur fermer la porte.

En réception :

- `text/plain`, avec `charset` absent, `UTF-8` ou `US-ASCII` : accepté ;
- **tout autre type**, ou un autre `charset` : **415**, avec `Accept: text/plain` (§1). On lit le
  type annoncé et rien d'autre ; un corps XML annoncé en `text/plain` s'affiche en texte ;
- un corps vide : 200, et rien n'entre dans le fil.

Le texte s'affiche comme du texte, jamais interprété en HTML, avec `dir="auto"` : un message en
arabe dans une interface en français, ou l'inverse, garde son sens d'écriture.

### D2 — La taille : 1 000 octets UTF-8 par message, sans découpage

RFC 3428 §8 interdit un MESSAGE de plus de 1 300 octets quand le transport n'est pas contrôlé de
bout en bout, ce que Trix ne peut pas savoir au-delà de son proxy. Le corps est plafonné à
**1 000 octets UTF-8**, ce qui laisse la place aux en-têtes. Le champ d'écriture affiche un compteur
à l'approche de la limite et refuse d'envoyer au-delà. Pas de découpage automatique : deux MESSAGE
peuvent arriver dans le désordre, et rien en `text/plain` ne permet de les recoller.

### D3 — L'envoi : une file, des états, pas de réessai automatique

Un message écrit a un état, toujours dit par un mot et une forme, jamais par la couleur seule :

| État | Quand | Dit à l'écran |
|---|---|---|
| `pending` | pas encore parti (hors enregistrement), ou en attente de réponse | « En attente » |
| `sent` | 2xx, 202 compris | « Remis au serveur », ou rien (état normal) |
| `failed` | 4xx, 5xx, 6xx, délai dépassé | « Non remis » et la raison, bouton Réessayer |

- **Hors enregistrement** (page endormie, réseau perdu, compte en veille), le message reste
  `pending` dans le coffre et part au retour de `ready`, dans l'ordre d'écriture. Il survit à un
  rechargement de la page.
- **Raisons** traduites comme les issues d'appel : 404 « Adresse inconnue », 480 « Injoignable »,
  403 et 603 « Refusé », 408 et délai « Pas de réponse », 415 « Format refusé », le reste « Échec
  (code) ».
- **Pas de réessai automatique** après un échec : un 480 répété ne deviendra pas un 200, et un
  message parti deux fois n'a rien pour se dédoublonner en `text/plain`.

### D4 — Qui peut écrire : contacts, inconnus, bloqués

Chaque MESSAGE entrant est classé par l'URI de son `From` (et jamais par un nom affiché), normalisée
par `sip/uri.ts` :

| Expéditeur | Réponse | Ce qui se passe |
|---|---|---|
| **contact** | 200 | le message entre dans le fil, non lu |
| **bloqué** (D7) | 603 | rien : ni fil, ni notification, une ligne dans la trace SIP |
| **inconnu** | 202 | quarantaine (D5) |
| **inconnu, quarantaine pleine** | 480 | rien |

### D5 — Les inconnus : 202, puis une quarantaine locale

**Pourquoi pas la transaction ouverte.** Garder la requête sans réponse finale pendant que
l'utilisateur décide, en envoyant des 100 Trying, n'est pas possible : l'expéditeur abandonne sa
transaction non-INVITE au bout de 32 s (Timer F, RFC 3261 §17.1.2.2), que des réponses provisoires
arrivent ou non, et le proxy répond 408 avant lui (Kamailio : `fr_timer`, 30 s par défaut). Une
réponse envoyée ensuite ne serait plus reçue par personne, et RFC 4320 restreint même le 100 sur
les requêtes non-INVITE.

**Ce qui est fait.** Le message d'un inconnu reçoit **202 Accepted** tout de suite. RFC 3428 le
définit comme « accepté pour traitement », sans promesse de remise, ce qui est exactement le cas.
Le message attend ensuite **en mémoire seulement** (jamais dans le coffre), hors du fil, et une
fenêtre le montre :

> **sip:carla@example.org** vous écrit :
> « Bonjour, c'est Carla, du service client… »
> [Ajouter aux contacts] [Refuser] [Bloquer]

- **Ajouter aux contacts** : le contact est créé (nom tiré du `From`, modifiable ensuite), et les
  messages en attente entrent dans le fil à leur heure d'arrivée, non lus.
- **Refuser**, ou délai écoulé : les messages sont effacés. L'expéditeur n'en sait rien, et c'est
  voulu : un 603 tardif ne peut plus partir (voir plus haut), et un spammeur n'apprend rien de plus
  que ce qu'un 200 lui aurait appris.
- **Bloquer** : effacés, et l'adresse est bloquée (D7).

**Le délai : 2 minutes, comptées à partir de l'affichage.** Aucune tentative n'expire sans avoir
été montrée. L'affichage, c'est la fenêtre ouverte **dans un onglet visible**
(`document.visibilityState`) : un onglet caché ne compte pas.

**Pendant un appel,** la fenêtre n'apparaît pas ; le traitement est le même (202, quarantaine), la
pastille de l'écran d'appel le dit (D10), et la fenêtre s'ouvre au raccrochage.

**Plusieurs messages.** Ceux d'un même inconnu se rangent dans la même fenêtre, qui les montre
tous ; une décision vaut pour tous. Plusieurs inconnus : une fenêtre à la fois, dans l'ordre
d'arrivée. La quarantaine tient **20 expéditeurs** au plus ; au-delà, 480. Un rechargement de la
page la vide.

### D6 — Les messages vivent dans le coffre, à côté de l'historique

`SecureStore` gagne `loadMessages(id)`, `saveMessages(id, entries)`, `deleteMessages(id)`, chiffrés
comme l'historique et les contacts. Une entrée :

```ts
interface MessageEntry {
  id: string;            // local, stable ; servira d'appui à l'identifiant IMDN
  key: string;           // addressKey du correspondant (sip/uri.ts)
  uri: string;           // l'URI telle qu'elle est arrivée ou partie
  direction: "outgoing" | "incoming";
  text: string;
  at: number;            // epoch ms : en-tête Date s'il y en a un (D8), sinon réception ou écriture
  state: "pending" | "sent" | "failed" | "received";
  reason?: Msg;          // raison de l'échec, en message différé
  read: boolean;         // entrants seulement
}
```

- **1 000 messages par correspondant** au plus ; les plus anciens tombent.
- La suppression d'un compte supprime ses messages. Le **lien de partage** (ADR 0004) ne les
  emporte pas, comme l'historique.
- Le fil reste une vue (ADR 0007, D10) : il lit l'historique des appels **et** les messages,
  regroupés par `key`. Rien n'est dupliqué.

### D7 — Bloquer un contact refuse ses appels et ses messages

`Contact` gagne `blocked: boolean`. Bloquer une adresse qui n'est pas au carnet crée un contact
bloqué, nommé d'après l'adresse.

- **Appels** : un INVITE d'un contact bloqué est refusé en **603 Decline**, sans sonnerie, avant
  même la règle Ne pas déranger (qui répond 486). Pendant un appel, le second INVITE d'un bloqué
  reçoit aussi 603, et non le 486 réservé aux autres.
- **Messages** : 603 (D4).
- **Présence** : plus d'abonnement pour un contact bloqué.
- **Pas d'historique** des refus : bloquer sert à ne plus entendre parler de quelqu'un. Seule la
  trace SIP les garde, comme toute requête.
- **Le fil** garde la ligne, marquée « Bloqué », sans bouton Appeler ni champ d'écriture ; son
  menu propose Débloquer. Le même menu, sur toute autre ligne, propose Bloquer.

### D8 — Page endormie : le serveur garde et renvoie, c'est une exigence

Quand la page dort (ADR 0006), Trix est désinscrit. Un message envoyé pendant ce temps doit être
**gardé par le serveur** et remis au réenregistrement. Trix ne peut rien y faire de son côté :
c'est une **exigence de déploiement**, écrite dans `docs/utilisation/deploiement.md`, avec la
configuration Kamailio `msilo`.

- Un message remis en différé porte souvent un en-tête `Date` (ou, avec `msilo`, une date en tête
  du corps, à désactiver dans la configuration conseillée). Trix range le message à la date de
  `Date` quand elle existe et qu'elle n'est pas dans le futur ; sinon à l'heure de réception.
- Un inconnu dont le message est remis au réveil passe par la quarantaine comme les autres (D5).
- Sans stockage côté serveur, l'expéditeur reçoit 480 pendant la veille, et son client le lui dit.
  Trix ne le verra jamais ; `deploiement.md` le dit aussi.

### D9 — Un seul appareil voit ce qu'il a envoyé

Un message reçu est distribué par le proxy à tous les appareils enregistrés du compte. Un message
**envoyé** depuis un autre appareil, lui, n'arrive jamais ici : SIP n'a pas l'équivalent des copies
de XMPP (*carbons*). C'est une **limite acceptée**, dite dans `USERGUIDE.md` : un fil peut montrer
les réponses du correspondant sans la question posée depuis le téléphone.

### D10 — Pendant un appel : le fil, et une pastille

Le tchat de l'appel reste le texte temps réel. Un MESSAGE reçu pendant l'appel **va seulement dans
le fil**, qui n'est pas visible à ce moment-là. En haut de l'écran d'appel, une **pastille** le
signale : « 1 message — Bob Martin », « 3 messages », ou « Message d'un inconnu en attente ».

- La pastille n'ouvre rien et ne quitte pas l'appel : elle dit qu'il y a à lire au raccrochage.
- Elle est annoncée une fois par message aux lecteurs d'écran (`ui/announce.ts`, poli) : un
  message s'adresse à l'utilisateur, ce qui n'est pas le cas d'un changement de présence
  (ADR 0007, D11).
- Aucun son pendant l'appel : il couvrirait le correspondant.
- Au raccrochage, la pastille disparaît, le fil montre les non-lus, et les fenêtres d'inconnus
  s'ouvrent (D5).

Un MESSAGE envoyé **dans le dialogue** de l'appel reçoit toujours 501 de JsSIP : les clients
courants écrivent hors dialogue, et il faudrait greffer `RTCSession.receiveRequest` pour faire
autrement (§3).

### D11 — Hors appel : non-lus, notification, annonce

- **Non-lu** jusqu'à ce que la ligne soit dépliée ou agrandie, dans un onglet visible.
- Le nombre de non-lus s'affiche sur la ligne, dans le titre de l'onglet (`ui/title.ts`) et sur
  l'icône (`ui/favicon.ts`).
- Onglet caché : notification système (`ui/notify.ts`) avec le nom et le début du texte ; pour un
  inconnu, « Message d'une adresse inconnue », sans le texte.
- Ligne ouverte : le message entrant est annoncé (poli). Autres lignes : rien n'est annoncé, pour
  éviter le bruit ; le nombre de non-lus suffit.

### D12 — Une machine de messagerie à part, comme la présence

`MessagingMachine` (`machines/messaging.ts`) est une paire de PhoneMachine et de PresenceMachine,
pour les raisons de l'ADR 0007, D12 : les MESSAGE arrivent à tout moment, `CallBlock` ne doit pas
les voir, et l'écran lit la machine directement.

- **De la pile.** `SipHandle` gagne `messaging(send)`, qui rend un `MessagingLink` :
  `send(uri, text, id)`, dont les issues reviennent en `sip:messageSent { id, ok, code }`, et
  l'événement `sip:message { from, name, text, date, answer(code) }`. `PhoneEvent` n'en voit aucun.
- **Du téléphone.** Les signaux existants (`machines/presencesignals.ts`) servent tels quels :
  `phone:up` et `phone:down` ouvrent et ferment la file ; `phone:contacts` porte désormais les
  contacts avec leur drapeau `blocked` ; `phone:callStarted` et `phone:callEnded` règlent la
  pastille et le report des fenêtres.
- **Vers le téléphone.** Ajouter un inconnu, bloquer, débloquer : `ui:addContact` et un nouvel
  `ui:blockContact` vont à PhoneMachine, qui garde le carnet (ADR 0007, D7). `main.ts` relie.
- **Le choix de la réponse** (200, 202, 480, 603) est pris par la machine au `sip:message`, de façon
  synchrone : la réponse part dans le même tour.

### D13 — Découverte et déploiement

- `messaging: "no"` dans `config.json` éteint tout : pas d'écouteur, pas de MESSAGE dans `Allow`,
  et les MESSAGE entrants reçoivent 405, ce qui est alors vrai. C'est exactement l'état du
  correctif du 405.
- Un envoi qui reçoit **405 ou 501** du proxy veut dire que le serveur ne route pas MESSAGE : un
  bandeau le dit dans le fil (« Ce serveur ne transmet pas les messages »), et le champ d'écriture
  se ferme jusqu'au prochain enregistrement, comme la découverte de l'ADR 0007, D8.

## 3. Écarts assumés

- Pas de CPIM ni d'IMDN : « remis au serveur » est le seul accusé (D1). Viendront plus tard.
- Pas de dédoublonnage : un expéditeur qui renvoie après un 408 fera deux messages (D3).
- Pas de copie des messages envoyés ailleurs (D9).
- La quarantaine est en mémoire : un rechargement de page la perd, et l'expéditeur a reçu 202 (D5).
- Un inconnu refusé ne le sait pas (D5).
- MESSAGE dans le dialogue d'un appel : 501 (D10).
- Rien n'est gardé côté client pour un destinataire désinscrit : c'est le rôle du serveur (D8).

## 4. Plan d'implémentation

Chaque phase se livre testée ; M-1 à M-4 ne touchent aucun écran.

**M-1 — `sip/message.ts` et le port.** Envoi, réception, filtrage du type (D1), plafond (D2),
`MessagingLink` (D12). `ALLOWED_METHODS` regagne MESSAGE et `ACCEPTED_BODY_TYPES` gagne
`text/plain`, sauf `messaging: "no"` (D13). Tests avec le `Parser` de JsSIP, comme
`test/allow.test.ts` : réponses 200, 202, 415 et son `Accept`, 480, 603 ; issues d'envoi.

**M-2 — Le coffre.** `MessageEntry`, `loadMessages` / `saveMessages` / `deleteMessages`, plafond par
correspondant, suppression avec le compte (D6). `Contact.blocked` (D7), relu à faux dans un coffre
ancien. Tests `store` sur `fake-indexeddb`.

**M-3 — MessagingMachine.** File d'envoi et états (D3), classement des expéditeurs (D4),
quarantaine et délai compté à l'affichage (D5), report pendant l'appel (D10), non-lus (D11),
découverte (D13). Tests avec un faux `MessagingLink` et une horloge factice. Branchement dans
`main.ts`, diagrammes régénérés (`npm run diagrams`).

**M-4 — Blocage côté appels.** PhoneMachine : `ui:blockContact`, 603 avant Ne pas déranger, 603
pour un bloqué pendant l'appel (`CallBlock`), fin de l'abonnement de présence (D7). Tests
`phone.test.ts` et `call.test.ts`.

**M-5 — Le fil.** `ui/thread.ts` mêle appels et messages : dernier événement, groupes, non-lus,
recherche dans le texte. Segments Tout / Appels / Messages, champ d'écriture (Entrée envoie,
Maj+Entrée va à la ligne), compteur (D2), états et Réessayer (D3), ligne bloquée (D7). Bureau.

**M-6 — Inconnus et blocage.** Fenêtre de quarantaine (D5), menu Bloquer / Débloquer (D7).

**M-7 — Appel et notifications.** Pastille de l'écran d'appel (D10), titre, icône, notification,
annonces (D11).

**M-8 — Mobile.** Le fil et le champ d'écriture sur mobile ; la pastille dans l'en-tête mobile.

**M-9 — Déploiement.** Clé `messaging` (D13), exigence de stockage et configuration `msilo` dans
`docs/utilisation/deploiement.md` (D8).

**M-10 — Langues et documentation.** Clés dans les six langues. `CONCEPTION.md` : « La messagerie
hors appel », à côté de §4.9 ; `USERGUIDE.md`, limite de D9 comprise ; `SPECS.md` et `README.md`,
case Phase 6 cochée.

## 5. Validation

Tests automatiques (`npm test`) : chaque réponse de D4, la quarantaine et ses trois issues, le
délai qui ne court pas dans un onglet caché ni pendant un appel, la file qui part au retour de
`ready`, le plafond de taille et celui du coffre, le 603 d'un bloqué avant Ne pas déranger.

En réel :

1. **Kamailio + `msilo`** : deux instances Trix contacts l'une de l'autre ; message dans chaque
   sens ; geler un onglet (`edge://discards`), écrire, le réveiller, voir le message à sa date.
2. **Inconnu** : une troisième instance écrit ; accepter, refuser, laisser expirer ; même chose
   pendant un appel, fenêtre au raccrochage.
3. **Blocage** : appel et message d'un bloqué, 603 dans la trace des deux côtés.
4. **Un autre client** (Linphone) : qu'il affiche nos messages, et que les siens arrivent en
   `text/plain` ; s'il envoie du CPIM, le 415 et son repli.
5. **Un serveur sans routage de MESSAGE** : le bandeau de D13.

Points que seuls ces essais trancheront : ce que `msilo` met dans `Date` et dans le corps ; si le
proxy de test laisse passer MESSAGE sans réécriture ; le comportement de Linphone face au 415.

## 6. Questions ouvertes

- **Les refus d'un bloqué** : faut-il en garder un compte discret (« 3 appels bloqués cette
  semaine ») plutôt que rien (D7) ?
- **Le texte dans la notification système** (D11) : il s'affiche sur un écran verrouillé.
  Réglable ?
- **Un son** à l'arrivée d'un message hors appel ?
- **Écrire à un inconnu** fait-il de lui un contact, pour que sa réponse ne tombe pas en
  quarantaine ? Proposition : un correspondant à qui l'on a écrit depuis le fil est traité comme
  un contact pour ses réponses, sans être ajouté au carnet.
- **MESSAGE dans le dialogue** d'un appel (D10) : à greffer si un client courant le pratique.

## Références

- RFC 3428 — SIP Extension for Instant Messaging
- RFC 3261 — SIP, §17 (transactions), §21.4.6 (405 et `Allow`)
- RFC 4320 — Actions Addressing Identified Issues with SIP's Non-INVITE Transaction
- RFC 3862 — CPIM Message Format (plus tard)
- RFC 5438 — Instant Message Disposition Notification (plus tard)
- ADR 0003 (conversation totale), ADR 0004 (partage de compte), ADR 0006 (endormissement de la
  page), ADR 0007 (présence)
