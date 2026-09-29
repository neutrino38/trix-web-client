# ADR 0010 — Les accusés de distribution et de lecture (IMDN)

**Statut :** accepté — 2026-09-29 · **implémenté** — 2026-09-29 ; validation réelle à faire (§4)
**Portée :** `sip/imdn.ts` (nouveau), `sip/cpim.ts`, `sip/message.ts`, `sip/port.ts`,
`storage/store.ts`, `machines/messaging.ts`, `ui/screens/call/thread.ts`, `i18n/locales/*`,
`docs/CONCEPTION.md`, `USERGUIDE.md`
**Hors périmètre :** un réglage pour couper les accusés de lecture ; les accusés négatifs
(`negative-delivery`, échec de distribution) ; les accusés de traitement (`processing`, RFC 5438
§5.1.3) ; les conversations de groupe.
**Références normatives :** RFC 5438 (IMDN), RFC 3862 (CPIM)

## Contexte

L'ADR 0009 enveloppe les messages dans CPIM pour Linphone, mais sans accusés : nos messages
restaient « remis au serveur », et ceux de Linphone n'étaient jamais marqués « lus » chez lui.
Les accusés IMDN voyagent eux-mêmes en CPIM : un MESSAGE dont la partie intérieure est un XML
`message/imdn+xml`, qui nomme le message par son `imdn.Message-ID`.

Un accusé de lecture dit à l'autre **quand** on a lu. La règle retenue : **les accusés de
lecture sont envoyés aux contacts**, et à eux seuls.

## 1. Décisions

### D1 — Ce que nous demandons

Chaque message CPIM porte `imdn.Disposition-Notification: positive-delivery, display`. Un
message parti en texte brut (repli de l'ADR 0009, D3) n'a pas d'identifiant et ne peut rien
demander.

### D2 — Ce que nous devons, et à qui

| Expéditeur | Distribué | Lu |
|---|---|---|
| **contact** | à la réception | quand la ligne est lue |
| quelqu'un à qui l'on a écrit, **hors carnet** | à la réception | jamais |
| **inconnu en quarantaine** | à l'acceptation, jamais s'il est refusé ou expire | quand la ligne est lue, s'il est devenu contact |
| **bloqué** | jamais | jamais |

- Un accusé n'est dû que s'il a été demandé, et seulement pour un message qui a un
  `imdn.Message-ID`.
- « Lu » suit exactement le passage à lu de l'ADR 0008, D11 : la ligne dépliée ou agrandie, dans
  un onglet visible.
- La règle est évaluée **au moment de la lecture** : un correspondant devenu contact entre-temps
  reçoit l'accusé, un contact bloqué entre-temps ne le reçoit pas. Un accusé de lecture qui n'est
  pas dû à ce moment-là est abandonné, pas remis à plus tard.
- **Rien ne va à un inconnu** : l'ADR 0008, D5, lui répond 202 et rien de plus, pour qu'un
  spammeur n'apprenne pas qu'il a touché quelqu'un. Un accusé le lui apprendrait.
- `<datetime>` reprend la date du message d'origine (RFC 5438 §7.2.1.2), c'est-à-dire son
  `DateTime` ; l'accusé a son propre `imdn.Message-ID`, et ne demande rien.

### D3 — Ce qui est dû hors ligne attend dans le coffre

`MessageEntry` gagne `deliveryOwed` et `displayWanted`, posés à la réception selon la demande, et
effacés quand l'accusé part ou n'est plus dû. Une ligne lue alors que Trix n'est pas enregistré
garde sa dette, et l'accusé part au prochain enregistrement, comme la file d'envoi (ADR 0008, D3).

Un accusé envoyé ne rapporte rien : perdu, il laisse le message de l'autre une étape en arrière,
et le renvoyer ne dirait rien de plus.

### D4 — Ce que nous recevons

Un MESSAGE CPIM dont la partie est `message/imdn+xml`, ou un `multipart/mixed` qui n'en contient
que ça (un client peut regrouper ses accusés), reçoit **200**, de qui que ce soit. Chaque accusé
positif devient un `sip:receipt`.

- Il ne compte que venant de **celui à qui l'on a écrit**, et pour **un message qu'on lui a
  écrit** : l'`imdn.Message-ID` de nos messages est l'`id` de l'entrée (ADR 0009, D3).
- `MessageEntry.receipt` passe à `delivered`, puis à `displayed`, **jamais en arrière** : les
  accusés peuvent arriver dans le désordre.
- Un accusé prouve que le message est arrivé : un message en échec faute de réponse (408, délai,
  connexion perdue) repasse à « envoyé », et un délai qui tombe après l'accusé ne le fait pas
  échouer.
- Les accusés négatifs (`failed`, `forbidden`, `error`) sont lus comme rien : le message garde
  l'état que sa réponse SIP lui a donné.

### D5 — Ce que dit l'écran

Sous un message envoyé, l'état est toujours un mot (ADR 0008, D3) :

| État | Dit à l'écran |
|---|---|
| 2xx, pas d'accusé | rien (« Remis au serveur » pour les lecteurs d'écran) |
| accusé de distribution | « Distribué » |
| accusé de lecture | « Lu » |

## 2. Écarts assumés

- Pas de réglage : les accusés de lecture partent vers tous les contacts. Un réglage par compte
  pourra venir si on le demande.
- Un accusé de lecture qui n'est pas dû au moment de la lecture est abandonné (D2).
- Aucun accusé en texte brut, ni vers un correspondant qui a refusé CPIM.

## 3. Mise en œuvre

`sip/imdn.ts` écrit et lit le XML (analyseur injecté, comme pour PIDF), lit la demande et
dépouille un `multipart/mixed`. `sip/cpim.ts` gagne l'en-tête de demande et l'enveloppe d'un
accusé (`Content-Disposition: notification`). `MessagingLink` gagne `receipt()`, et le lien émet
`sip:receipt`. `MessagingMachine` tient les dettes (`settleReceipts`, appelé à la réception, à
l'acceptation, au changement de carnet, à la lecture, au chargement du coffre et à
l'enregistrement) et range les accusés reçus.

## 4. Validation

Tests automatiques : demande lue et écrite, XML écrit relu, accusé de Linphone lu, préfixe de
namespace, accusés négatifs ignorés, `multipart/mixed` ; chaque ligne du tableau de D2 ; la
lecture hors ligne ; les accusés reçus dans le désordre, d'un autre expéditeur, avant ou après
l'échec.

En réel, avec Linphone :

1. un message de Trix passe à « Distribué » puis à « Lu » quand Linphone l'ouvre ;
2. un message de Linphone passe à « lu » chez lui quand la ligne est ouverte dans Trix, et pas
   avant ;
3. Linphone hors carnet (mais à qui l'on a écrit) : « distribué » chez lui, jamais « lu » ;
4. Linphone inconnu : rien tant que la fenêtre n'est pas acceptée.

Reste à confirmer en réel : que Linphone regroupe ou non ses accusés en `multipart/mixed` dans
une conversation à deux, et qu'il accepte un IMDN sans `<recipient-uri>`.

## Références

- RFC 5438 — Instant Message Disposition Notification (IMDN)
- ADR 0008 — La messagerie instantanée ; ADR 0009 — CPIM
