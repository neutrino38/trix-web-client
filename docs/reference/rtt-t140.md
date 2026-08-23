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

États du lien, tels que l'interface les voit : `connecting`, `open`, `lost`, `closed`.

## Appel texte seul

Une connexion qui ne porte qu'un canal de données est valide : le SDP n'a qu'une
section `m=application`. Aucun `getUserMedia`, donc aucune autorisation micro ou
caméra. Le mode « appel texte » n'est proposé que si le compte transporte le texte.

Le maintien de la connexion sans RTP est assuré par les couches basses — consentement
ICE, allocation TURN, HEARTBEAT SCTP (RFC 8865 §6) : **aucun keepalive applicatif.**

**Limite connue, hors périmètre.** En mode passerelle vers l'IMS, un appel texte seul
peut être refusé par le réseau : 3GPP TS 26.114 impose qu'une description média de
canal de données ne précède pas la première description média de parole. Le profil
suppose donc une jambe audio. C'est l'affaire de la passerelle, pas de Trix.

## Ce qui reste à faire

Le codec (`sip/t140.ts`) et le panneau de tchat (`ui/screens/call/chat.ts`) décrits en
§4.9 ne sont pas écrits : le flux reçu remonte tel quel aux abonnés de `RttChannel`,
commandes comprises. L'affichage incrémental par correspondant, l'interprétation des
commandes de présentation et l'historique en dépendent.
