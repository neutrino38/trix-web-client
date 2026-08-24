# ADR 0002 — Deux comptes SIP, un seul enregistré à la fois

**Statut :** accepté — 2026-08-24
**Portée :** `storage/store.ts`, `machines/phone.ts`, `machines/events.ts`,
`ui/screens/home.ts`, `ui/screens/config.ts`, `ui/screens/call/` (en-tête)

## Contexte

Trix ne connaît qu'un compte. Le coffre chiffré tient un enregistrement, `account` ;
l'accueil propose un bouton, « Utiliser le compte » ; le formulaire de paramètres
modifie celui-là et pas un autre. Qui possède deux identités SIP — une professionnelle
et une personnelle, une de préproduction et une de production — n'a d'autre recours que
de ressaisir son mot de passe à chaque changement, puisque seul le HA1 est conservé et
qu'il ne survit pas au remplacement du compte.

Le besoin est d'en garder deux. Il n'est **pas** de s'enregistrer deux fois : un seul
compte est actif, l'autre attend, et rien de ce qui appartient à l'un ne doit
apparaître dans l'autre.

Cette contrainte-là, l'application la tient déjà. `PhoneMachine` a pour invariant que
l'UA SIP ne vit que dans `connecting → registering → ready → in_call → unregistering`,
et que toute sortie de ce couloir passe par `stopSip()`. Changer de compte, c'est
emprunter un chemin qui existe : arrêter l'UA, puis repartir en `connecting` avec une
autre configuration. Il n'y a pas de second UA à faire cohabiter, et il ne faut surtout
pas en inventer un.

Ce qui manque est ailleurs — dans la forme du coffre, qui ne sait compter que jusqu'à
un, et dans deux ou trois endroits où le code dit « le compte » là où il faudra dire
« lequel ».

## Décision

**1. Le coffre tient une liste, dans un seul enregistrement chiffré.** La clé `account`
laisse la place à `accounts`, qui porte les comptes dans l'ordre et l'identifiant de
celui qui est actif. Un seul enregistrement, et non un par compte : l'écriture reste
atomique, et un index séparé aurait de toute façon porté des adresses SIP, donc aurait
dû être chiffré lui aussi. Quelques centaines d'octets pèsent moins qu'un invariant à
tenir entre deux clés.

**2. Chaque compte porte un identifiant opaque**, tiré à sa création
(`crypto.randomUUID()`), et c'est lui — non l'adresse SIP — qui nomme son historique
(`history:<id>`). L'adresse redevient une propriété du compte comme les autres.

**3. Deux comptes au plus, et l'interface seule le sait.** Le stockage et la machine
manipulent une liste ; c'est l'accueil qui cesse de proposer « Ajouter un compte »
quand le second existe. Le jour où la limite bouge, elle bouge à un endroit.

**4. La bascule se fait depuis l'en-tête de l'écran d'appel**, à côté des boutons
Paramètres et Se déconnecter. Elle arrête l'UA et repart en `connecting` sur l'autre
compte.

**4 bis. Elle est interdite dès qu'un appel est en cours**, de la première sonnerie au
raccroché — et pas seulement en communication établie. Le bouton est grisé comme le
sont déjà Paramètres et Se déconnecter, et `CallBlock` consomme l'événement sans effet
s'il lui parvient malgré tout : la garantie ne repose pas sur l'état d'un bouton.

**5. Le compte édité n'est pas le compte actif.** `PhoneMachine` gagne un
`ctx.editing` : l'identifiant du compte que le formulaire modifie, `null` pour une
création. Toute la validation s'y adosse — conservation du HA1 quand le mot de passe
est laissé vide, comparaison du domaine, reprise du mot de passe TURN.

**6. Une adresse SIP ne peut pas être enregistrée deux fois.** Le formulaire refuse un
compte dont l'adresse est déjà celle de l'autre, avec un message dédié.

**7. Un compte se supprime**, depuis le formulaire qui le modifie. L'opération efface
l'enregistrement du compte **et son historique**.

**8. Le compte déjà enregistré est migré au premier démarrage** : il devient le premier
de la liste, et l'actif. Son historique est recopié de `history:<user@domaine>` vers
`history:<id>`, puis les deux anciennes clés sont effacées.

## Conséquences

- **L'étanchéité est fonctionnelle, pas cryptographique.** La clé AES-GCM reste unique
  pour l'origine : ce qui déchiffre un compte déchiffre l'autre. C'est la limite déjà
  assumée en CONCEPTION §6 — le second compte ne l'aggrave pas, mais il ne faut pas
  laisser croire à un cloisonnement qui n'existe pas. Ce qui est garanti, c'est qu'un
  compte ne voit jamais les appels, les identifiants ni les réglages de l'autre.

- **L'historique suit le compte, et non son adresse.** Corriger une adresse mal saisie,
  ou en changer parce que l'opérateur l'a changée, ne fait plus disparaître le journal
  d'appels de l'écran. C'est un défaut du modèle précédent que la liste réparait
  d'elle-même — autant le réparer.

- **Deux comptes de même adresse sur deux proxys différents auraient partagé un même
  historique** si la clé était restée l'adresse : la préproduction aurait montré les
  appels de la production. La décision 2 rend le cas impossible, la décision 6 le rend
  inutile.

- **Le HA1 ne peut pas fuir d'un compte vers l'autre.** C'était le seul vrai risque de
  mélange du portage : la conservation du mot de passe se fait par comparaison avec le
  compte enregistré, et cette comparaison portait sur le compte *actif*. Modifier le
  compte au repos pendant que l'autre est enregistré lui aurait attribué le HA1 de
  l'autre — silencieusement, et avec un enregistrement qui échoue ensuite sans que rien
  n'en dise la cause. Le `ctx.editing` de la décision 5 est là pour cela.

- **Changer de compte pendant un appel n'a pas de forme acceptable.** Ce serait
  raccrocher au nom de l'utilisateur, ou laisser un appel vivre sur un compte qui n'est
  plus enregistré : la première est une décision qui ne se prend pas à sa place, la
  seconde rompt l'invariant de `PhoneMachine`. L'interdiction vaut dès la sonnerie —
  sortante comme entrante — parce qu'un appel qui n'a pas encore abouti est tout aussi
  vivant qu'un appel établi, et que le distant, lui, attend une réponse.

- **Rien ne change côté SIP.** `sip/port.ts` reçoit un `AccountConfig` en argument de
  `start()` et n'a jamais su d'où il venait ; `CallBlock`, le texte temps réel, la
  trace, les statistiques et ICE ne sont pas concernés. La phase 4 en cours n'est pas
  touchée.

- **La migration est le point de fragilité, et doit être irréprochable** : idempotente,
  et sans perte du compte existant si elle est interrompue. L'effacement des anciennes
  clés n'est pas de la cosmétique : sans lui, un compte supprimé plus tard laisserait
  son HA1 chiffré dans la base, sous une clé que plus personne ne lit.

- **Les réglages du navigateur restent communs aux deux comptes** : thème, langue,
  taille de police, largeur du panneau, mode d'appel par défaut, trace SIP, permission
  de notification. Aucun ne porte de donnée identifiante, et les séparer demanderait de
  ranger dans le coffre chiffré des préférences d'affichage qui n'y ont rien à faire.
  Ce qui appartient au compte — flash à l'appel entrant, serveurs STUN/TURN, transport
  du texte temps réel — y est déjà et le reste.

- **Le déploiement s'applique à chaque compte.** Proxy, serveurs ICE et transport texte
  imposés écrasent ceux de tous les comptes relus ; un compte d'un autre domaine que le
  domaine imposé est écarté de la liste comme il l'était seul. Si l'actif disparaît
  ainsi, l'accueil repart sur ce qui reste — ou sur un formulaire vide.

- **`SecureStore` reste le point d'abstraction Tauri.** Ses méthodes changent de forme
  (`load()` rend un coffre, l'historique se demande par identifiant), pas de nature :
  une implémentation sur trousseau OS s'y substituera comme prévu en CONCEPTION §6.
