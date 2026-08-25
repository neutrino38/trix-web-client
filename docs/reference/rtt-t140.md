# Texte temps réel T.140 sur canal de données — référence

Le protocole tel qu'il est **implémenté**, et ce qui ne l'est pas. La conception et ses
raisons sont en [CONCEPTION.md §4.9](../CONCEPTION.md) ; le choix de ne pas toucher au
SDP est l'[ADR 0001](../architecture/0001-t140-hors-sdp.md).

Normes : RFC 8865 (T.140 sur data channel), UIT-T T.140 et son addendum 1.

## Le canal

| | |
|---|---|
| Label | `t140` |
| Sous-protocole (`protocol`) | `t140` — annoncé par DCEP, jamais en SDP |
| `negotiated` | `false` : négociation in-band, aucun `id` imposé |
| `ordered` | `true` |
| `maxRetransmits`, `maxPacketLifeTime` | **jamais renseignés** — RFC 8865 §4.1 les interdit |
| Créé par | l'offrant (l'appelant), jamais le répondant |
| Créé quand | à l'établissement de l'appel, avant la première offre |
| Un canal | par correspondant : T.140 ne transporte aucune indication de source |

Le canal est reconnu à son sous-protocole ; à défaut, à son label, pour les piles qui
laissent `protocol` vide.

**Collision.** Si les deux extrémités en créent un, celui dont l'`id` est le plus petit
est retenu, l'autre est fermé. Les deux calculent le même résultat. Pendant
l'arbitrage, le texte est lu sur tous les canaux `t140` et n'est émis sur aucun tant
qu'il n'est pas tranché : aucun caractère n'est perdu ni dédoublé.

**Perte.** Détectée sur `connectionstatechange` et sur la fermeture du canal, jamais
par un délai d'inactivité. L'offrant recrée le canal (dix tentatives au plus) dès que
la connexion est revenue. **Rien de ce qui est parti n'est réémis** (RFC 8865 §5.4) ; à
la reprise, un `U+FFFD` est inséré dans le flux reçu et l'état du lien passe par
`lost`, visible dans l'interface.

## Le flux

UTF-8, `channel.send(string)` — pas d'encodage manuel. **Il n'y a aucune notion de
message** : une frontière de message SCTP ne signifie rien, le récepteur concatène.

| Caractère | Émission | Réception |
|---|---|---|
| Texte | oui | oui, par graphème |
| `U+FEFF` signature de session | en tête de chaque canal ouvert | consommée, jamais affichée |
| `U+0008` retour arrière | dérivé de l'édition locale | efface un graphème entier |
| `U+2028` séparateur de ligne | oui | oui ; `CR`, `LF`, `CRLF` acceptés en entrée |
| `U+FFFD` texte manquant | inséré localement à la reprise | affiché comme marqueur |
| Autre code de commande | non émis | ignoré, le flux continue (RFC 8865 §5.2) |

Le découpage en messages se fait sur des **frontières de graphèmes**
(`Intl.Segmenter`) : jamais au milieu d'une paire de substitution, d'une marque
combinante ou d'une séquence ZWJ. La même unité vaut à l'émission et à la réception —
un `U+0008` efface un graphème.

## Émission

- Tampon de **300 ms** (`RTT_HOLD_MS`), sous le plafond de 0,5 s de T.140 §6.1.1.
- Envoi immédiat au-delà de **quatre** caractères en attente : la frappe rapide et le
  collage ne subissent aucune latence.
- Rien ne part si le canal n'est pas ouvert ; ce qui attend part à l'ouverture.
- File d'attente plafonnée à 4 000 caractères sur un fil rompu.

**Aucun plafond de débit.** RFC 8865 §5.3 recommande un `cps` moyenné sur dix
secondes ; nous ne l'appliquons pas, délibérément (§4.9).

**Effacement.** `RttChannel.backspace(n)` distingue les deux cas, et c'est le point le
plus délicat de l'implémentation :

- le caractère est **encore dans le tampon** → il en est retiré, rien n'est émis ;
- il est **déjà parti** → un `U+0008` est émis.

Émettre un retour arrière pour un caractère que le distant n'a jamais vu efface un des
siens.

## Paramètres de session

| Paramètre | Valeur | D'où elle vient |
|---|---|---|
| Direction | `sendrecv` | défaut RFC ; `recvonly` et `inactive` non gérés |
| Langue | aucune | non annoncée, non consommée |
| `cps` | sans objet | aucun plafond appliqué |

**La signalisation applicative Trix ↔ Kelixip n'existe pas.** Trix ne parle que SIP,
via JsSIP, et le SDP est hors du champ de ce transport (ADR 0001). Ces paramètres n'ont
donc aujourd'hui aucun véhicule, et aucun canal de contrôle applicatif n'a été inventé
pour les porter. Le jour où une telle signalisation existera, elle se branchera sur
`negotiateRttOverDc()` : `recvonly` et `inactive` couperont la saisie dans l'interface,
la langue servira à l'affichage.

## Modules

| Module | Rôle |
|---|---|
| `sip/rtt.ts` | le canal commun aux deux transports : tampon, découpage, effacement, file, états |
| `sip/rttdc.ts` | le fil RFC 8865 : création, arbitrage, reprise |
| `sip/rttsip.ts` | le branchement sur la session JsSIP, pour les deux transports |
| `sip/rttws.ts` | le fil WebSocket des passerelles déployées (hors RFC 8865) |
| `sip/t140.ts` | le codec, sans DOM : décodage du flux en événements, différentiel d'émission |
| `sip/transcript.ts` | le modèle des bulles, et son scellement pour l'historique |
| `ui/screens/call/chat.ts` | le panneau : fil, bulles, composeur, projection |
| `ui/chatdialog.ts` | la relecture d'une conversation passée, depuis l'historique |

États du lien, tels que l'interface les voit : `connecting`, `open`, `lost`, `closed`.

## Appel texte seul

Une connexion qui ne porte qu'un canal de données est valide : le SDP n'a qu'une
section `m=application`. Aucun `getUserMedia`, donc aucune autorisation micro ou
caméra. Le mode « appel texte » n'est proposé que si le compte transporte le texte.

Le maintien de la connexion sans RTP est assuré par les couches basses — consentement
ICE, allocation TURN, HEARTBEAT SCTP (RFC 8865 §6) : **aucun keepalive applicatif.**

**À la réception**, une offre sans `m=audio` ni `m=video` n'est pas refusée pour
autant : le contrôle de recevabilité (`sdp.unsupportedOffer`) accepte une offre qui ne
porte qu'un canal de données — ou qu'une section `m=text` — dès lors que le compte
transporte le texte **sous cette forme-là**. Un poste sans texte, ou branché sur
l'autre transport, refuse en 488 avant de sonner : il n'aurait ni parole, ni image, ni
texte. La popup d'appel entrant propose alors « Répondre en texte », seul bouton de
réponse, et n'ouvre ni micro ni caméra.

**Limite connue, hors périmètre.** En mode passerelle vers l'IMS, un appel texte seul
peut être refusé par le réseau : 3GPP TS 26.114 impose qu'une description média de
canal de données ne précède pas la première description média de parole. Le profil
suppose donc une jambe audio. C'est l'affaire de la passerelle, pas de Trix.

## Le décodage, tel qu'il est écrit

`sip/t140.ts` est un décodeur **incrémental** : il rend une liste d'événements par
fragment reçu (`text`, `erase`, `break`, `alert`, `attrs`, `lost`) et garde ce qu'il ne
peut pas encore lire. Les frontières de message ne voulant rien dire, une séquence de
commande coupée en deux — un `CSI 3` suivi d'un `1m`, un `CR` suivi d'un `LF` — est
recollée au fragment suivant plutôt qu'affichée en morceaux.

| Reçu | Effet |
|---|---|
| `CSI Ps m` | attributs, **remappés sur la palette du thème** (voir plus bas) |
| `CSI` autre finale | séquence avalée en entier, rien ne s'affiche |
| `SOS … ST` | extension avalée en entier ; formes 8 bits et 7 bits acceptées |
| `ESC x` | ignorée — Trix n'a pas de bascule de mode |
| `U+0000`–`U+001F`, `U+007F`–`U+009F` non traités | filtrés avant l'affichage |
| séquence sans fin | abandonnée au-delà de 4 000 caractères en attente |

**Les couleurs sont remappées, jamais appliquées telles quelles** (T.140 §8.8) : `31`
devient `var(--red)`, `34` et `36` deux teintes ajoutées au thème (`--t140-blue`,
`--t140-cyan`) pour rester lisibles sur les deux fonds, et un fond reçu (`40`–`47`) est
dilué à 22 %. La plage claire (`90`–`97`) rejoint la même palette : une fois remappé,
« rouge vif » ne veut plus rien dire.

## Le panneau

`ui/screens/call/chat.ts` tient le **modèle** du fil et sa projection à l'écran — le
modèle est la source, le DOM n'en est qu'une vue, ce qui rendra l'export en sous-titres
possible sans relire la page. Un caractère reçu devient un nœud texte, jamais du
balisage.

- **Une bulle vivante par côté**, la dernière ; le séparateur la fige et en ouvre une
  neuve. Un séparateur reçu sur une bulle vide ne crée rien, et un retour arrière reçu
  sur une bulle vide **refusionne la bulle figée précédente** (§8.2).
- **Le fil ne saute jamais sous les yeux de qui relit** : le défilement automatique
  s'arrête dès que l'utilisateur remonte, et un bouton « descendre » compte les bulles
  figées arrivées depuis.
- **Le champ de saisie** suit la règle des deux secondes : écrire ou effacer à la fin
  part tout de suite, une correction au milieu attend 2 s de silence puis remonte d'un
  coup jusqu'au point de divergence. La bulle locale montre ce qui est **réellement
  parti** (§7), et l'écart se lit dans la ligne d'état.
- **Le `BEL` reçu** réemploie les canaux de l'appel entrant — cadre, salve, vibration —
  en un seul battement (`ui/alert.ts`, `pulseAlert`).
- **Rien n'est rendu par un temporisateur** : l'affichage du texte reçu est piloté par
  l'arrivée du fragment. Les deux seuls temporisateurs servent l'émission différée et
  son décompte.
- **Lecteurs d'écran** : le fil est un `log` sans `aria-live` — une bulle vivante change
  à chaque caractère. C'est la bulle **figée** qui est annoncée, une fois, par la région
  d'état de l'application.

**Où le fil se pose dépend de l'appel** (`chatOnStage`). Un appel sans image — audio +
texte, ou texte seul — lui donne la **scène** : le fil occupe le centre de l'écran, à la
place de la vidéo, et la barre de commandes média le coiffe au lieu de flotter dessus,
là où elle couvrirait le composeur et où le clavier virtuel l'emporterait avec
Raccrocher. L'élément média distant y reste, invisible : c'est lui qui porte le son.

Un appel **vidéo** garde l'image au centre, et le fil revient sur le côté : la sidebar
sous les commandes d'appel sur bureau — **l'historique disparaît pendant l'appel**, à
300 px les deux ne tiennent pas côte à côte — et sous la vidéo sur mobile, le bouton de
la barre de surimpression rendant la place à l'image. La bascule vaut en cours d'appel :
ajouter la caméra rend la scène à l'image, la retirer la rend au fil.

## Après l'appel

Le fil rejoint la ligne d'historique de l'appel, **chiffré avec le reste du compte** —
vider l'historique efface donc aussi les conversations. Sans condition, contrairement à
la trace SIP et au bilan média : ce n'est pas une pièce de mise au point. Un appel où
personne n'a écrit ne laisse rien.

Ce qui est gardé est scellé en fin d'appel (`sip/transcript.ts`) : bulles vivantes
closes, copie du modèle, et un plafond (32 000 caractères, 400 bulles) au-delà duquel
c'est le **début** du fil qui tombe — une remarque en tête le dit. La ligne
d'historique porte alors une bulle « T » qui rouvre la conversation en lecture seule,
avec « Copier ».

## L'export en sous-titres

La conversation se relit, se copie, et s'exporte en **WebVTT** (`ui/subtitles.ts`) depuis
le même popup. Le zéro du fichier est le **décroché**, pas l'heure du jour : il se pose
tel quel sur un enregistrement de l'appel. Un appel jamais établi n'a pas de
communication à caler — son propre début fait alors office d'origine.

Une bulle figée devient une entrée, du premier caractère au séparateur qui l'a close ; le
locuteur est balisé `<v Bob>`, jamais préfixé. Les entrées sont **triées par début** — le
fil, lui, est dans l'ordre des figeages, et deux personnes qui écrivent en même temps
figent à contretemps — et les recouvrements sont gardés tels quels : c'est ce que WebVTT
sait faire et SubRip non. Les remarques du fil (lien ouvert, rompu, refusé, début non
conservé) deviennent des commentaires `NOTE` horodatés : personne ne les a dites, aucun
lecteur ne les montrera, mais elles expliquent un trou à qui relit le fichier.

Ce qui vient du réseau ne peut pas s'y relire comme du balisage : `&`, `<` et `>` passent
par une entité, et les fins de ligne — qu'une bulle ne devrait pas porter — redeviennent
des espaces, une ligne vide fermant une entrée. Une bulle collée d'un bloc, figée dans la
milliseconde où elle s'est ouverte, dure une seconde au minimum : VTT veut une fin après
son début, et un sous-titre plus court ne se lit pas.
