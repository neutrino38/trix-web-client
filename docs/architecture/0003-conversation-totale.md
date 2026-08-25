# ADR 0003 — L'expérience de conversation totale

**Statut :** accepté — 2026-08-25
**Portée :** `sip/port.ts`, `sip/sdp.ts`, `sip/rtt*.ts`, `machines/call.ts`,
`ui/screens/call/*`, `docs/CONCEPTION.md` §4.4 et §4.9
**Référence normative :** ITU-T F.703 (11/2000), *Multimedia conversational services*

## Contexte

Trix sait aujourd'hui passer un appel audio ou vidéo, faire entrer et sortir la vidéo
en cours d'appel (§4.4), et porter du texte T.140 sur canal de données ou WebSocket
(§4.9). Ce qui manque n'est pas une fonction de plus : c'est **une règle unique** qui
dise, pour les trois médias, ce qu'un appel transporte, qui peut le changer, et
comment cela se voit.

Cet ADR pose cette règle, la confronte à F.703 — le texte qui définit la conversation
totale — et en tire un plan d'implémentation.

Un mot sur le vocabulaire, parce qu'il compte pour la suite. F.703 §3.2.7 réserve le
nom *total conversation service* à un seul cas : **audio + vidéo + texte**. Un appel
audio + texte est de la téléphonie textuelle (§3.2.8, profil 3c), un appel texte seul
aussi (profil 3a), un appel audio + vidéo est de la visiophonie (§3.2.6). Trix les
propose tous — c'est même tout l'intérêt — mais un seul de ces modes est une
conversation totale au sens de la norme, et les documents ne doivent pas laisser
croire le contraire.

## 1. Ce que dit F.703

### 1.1 Les six passages qui nous engagent

| § | Ce que la norme exige | Où cela tombe dans Trix |
|---|---|---|
| 5.3.1 | L'audio est normalement établi au début et présent tout du long, **mais peut être temporairement interrompu**. Au moins un autre média doit être présent. | Retirer l'audio en cours d'appel est explicitement prévu. |
| 6.2.2 | Le changement de mode en cours d'appel **doit être permis** dès que les deux terminaux en ont la capacité. | Ajout / retrait de média par re-INVITE. |
| **6.2.4** | **Tout participant peut temporairement empêcher son terminal d'émettre l'audio ou la vidéo. Une vidéo suspendue est remplacée par un avis explicite. Le terminal indique visuellement que son audio est coupé ou sa vidéo inhibée.** | La fonction est exigée, jamais deux boutons — et l'audio et la vidéo y sont groupés. C'est la Pause (D6, D7). |
| 6.1.2 | L'appel entrant est annoncé par un moyen perceptible — sonore, visuel **ou** tactile, de préférence choisi par l'utilisateur. La progression de l'appel est annoncée à l'appelant par des signaux **visuels et sonores**. | Alerte entrante : les trois canaux sont là (`ui/alert.ts`). Retour d'appel sonore : manquant. |
| 5.2.2 | Écart audio / vidéo inférieur à 120 ms, **de préférence sous 100 ms** — le seuil de la langue des signes et de la lecture labiale (H-series Suppl. 1). | À mesurer, pas seulement à espérer. |
| 8.1 / 8.3.5 | Deux terminaux utilisent **le mode commun** ; tout média que les deux portent est présent, au plus bas des deux niveaux de qualité. Un terminal de conversation totale interopère avec les autres terminaux multimédias **sur un sous-ensemble** de ses fonctions. | Une capacité manquante dégrade l'appel, elle ne le refuse pas. |

Un septième passage, §5.1.2.2, ne parle que du délai mais énonce le principe qui
gouverne tous les autres : *« quand aucun moyen ne permet de satisfaire cette
condition, l'appel ne doit pas être refusé »*. **Dégrader, jamais refuser.**

### 1.2 Les profils, et ce que Trix en offre

F.703 §7.2 classe les appels en profils, avec pour chacun le niveau minimal de chaque
média. Les modes de Trix s'y rangent exactement :

| Mode proposé par Trix | Médias | Profil F.703 | Nom dans la norme |
|---|---|---|---|
| Appel texte | T | **3a** | Text telephone service |
| Appel audio, compte avec texte | A + T | **3c** | Good text conversation with simultaneous usable audio |
| Appel audio, compte sans texte | A | — | Téléphonie (service monomédia, note du §7.2) |
| Appel vidéo, compte avec texte | A + V + T | **4a / 4b** | **Total conversation service** |
| Appel vidéo, compte sans texte | A + V | 1b / 1c | Videophone service |

Deux enseignements. D'abord, **le texte est ce qui fait la conversation totale** : sans
lui, l'appel vidéo de Trix n'est qu'un visiophone. Ensuite, la seule différence entre
4a et 4b est la qualité vidéo (V0 contre V2) : c'est une affaire d'encodeur et de
débit, pas d'interface, et Trix n'a rien à décider là-dessus.

## 2. Décisions

### D1 — Le texte est un média, pas un vide

`CallMedia` devient `{ audio, video, text }`.

Aujourd'hui un appel texte s'écrit `{ audio: false, video: false }` : le texte est
défini par l'absence des deux autres. Cela tient tant que le texte est un réglage de
compte, et cède dès qu'on veut distinguer un appel audio d'un appel audio + texte, ou
dire à l'écran d'appel entrant ce qui est offert. Le tableau des profils du §7.2 met
le texte sur la même ligne que l'audio et la vidéo ; le type doit le faire aussi.

Une nuance à tenir : `media.text` dit que **le texte est négocié**, pas qu'il passe.
L'état du lien (`connecting`, `open`, `lost`, `closed`) reste porté par `RttChannel`,
et lui seul. Sur canal de données, l'ouverture DCEP arrive après le 200 OK : un appel
peut être `text: true` avec un canal encore `connecting`, et c'est normal.

### D2 — L'appelant choisit un profil, pas une liste de cases

Les trois modes existants restent, et signifient :

- **Appel audio** → offre A (+ T si le compte porte le texte)
- **Appel vidéo** → offre A + V (+ T)
- **Appel texte** → offre T seul

Le texte n'est jamais un choix de l'appelant : il est là si le compte le porte. C'est
ce que voulait dire « le texte est considéré comme acquis — s'il est négocié », et
c'est aussi ce qui évite un menu à six entrées.

### D3 — La réponse est un sous-ensemble de l'offre, jamais un sur-ensemble

F.703 §8.1 : les deux terminaux utilisent le mode commun. L'appelé ne peut donc rien
ajouter au décroché — ajouter, cela se fait après, par re-INVITE (D5).

| Offre reçue | Réponses proposées |
|---|---|
| A V T | A V T · A T · T |
| A V | A V · A |
| A T | A T · T |
| V T | V T · T |
| A | A |
| V | V |
| T | T |

`answerChoices()` tient déjà cette règle pour l'audio et la vidéo ; elle s'étend au
texte sans exception nouvelle. Le texte n'apparaît jamais comme un choix : il est
dans toutes les réponses de la ligne, ou dans aucune.

### D4 — Le texte ne se retire pas ; il pourra s'ajouter

Le plan initial interdisait les deux. Je recommande de dissocier.

**Le retrait reste interdit**, et c'est un écart assumé au §6.2.2 (qui autorise tout
changement de mode). La raison est que le texte n'est pas un média comme les autres
pour le public de Trix : c'est le repli qui rend l'appel possible. Le retirer, c'est
pouvoir couper la parole à quelqu'un pour de bon, en un clic, sans qu'il puisse
répondre. Le coût est de toute façon nul : un canal T.140 inactif ne consomme rien.

**L'ajout, lui, doit exister** — et l'interdire serait le vrai manquement. F.703 §4.5
décrit précisément la situation qui l'exige : *une conversation où l'un des deux au
moins entend mal, par handicap ou à cause d'un environnement bruyant*. Un appel
commencé en audio qui ne peut pas basculer vers le texte laisse exactement cette
personne sans recours. Sur canal de données, l'ajout ne coûte même pas une
renégociation : le canal `t140` se greffe sur l'association SCTP déjà là. Phase CT-6.

### D5 — L'audio entre et sort de l'appel comme la vidéo

Le bouton caméra n'est pas une sourdine : il met la vidéo dans l'appel ou l'en retire,
par re-INVITE, et le distant le voit (§4.4). L'audio doit se comporter pareil —
§5.3.1 le prévoit noir sur blanc.

Trois conséquences que le plan initial ne nommait pas :

1. **Un seul verrou de renégociation.** `videoPending` devient un état de l'appel, pas
   du média : une renégociation à la fois, quel que soit le média qu'elle porte. Deux
   re-INVITE en vol sur la même boîte de dialogue, c'est un 491 garanti.
2. **Le glare a une règle.** Les deux bouts qui renégocient en même temps produisent un
   491 Request Pending. RFC 3261 §14.1 : on reprend après un délai aléatoire — 2,1 à
   4 s côté UAS, 0 à 2 s côté UAC. **Une seule reprise**, puis on abandonne avec un
   avis ; s'entêter ferait boucler deux clients face à face.
3. **L'invariant tient dans le bloc, pas dans l'interface.** « On ne retire pas le
   dernier média » se vérifie une fois, dans `machines/call.ts`, et le bouton n'est
   grisé qu'en conséquence. Écrit dans l'UI, il serait à réécrire dans les deux
   gabarits — et à oublier dans un.

Ajouter l'audio **reçu** pose la même question que la vidéo : allumer un micro demande
l'accord de son propriétaire. L'état `video_offer` se généralise en `media_offer`.

### D6 — Deux axes, et jamais deux gestes sur le même axe

C'est ici que le plan initial et la norme se heurtent, et la solution n'est ni de
supprimer la sourdine ni de la garder telle quelle.

D'abord ce que dit F.703, parce que le texte exact compte :

> *Any participant may temporarily prevent his terminal from sending out audio **or**
> video signals. […] A terminal should provide a visual indication when its audio is
> muted or its video inhibited.* — §6.2.4

La norme exige **la fonction**, jamais deux boutons, et **groupe l'audio et la vidéo**
dans la même phrase. Elle laisse donc exactement la place qu'il faut.

Le vrai risque du plan initial n'était pas de supprimer la sourdine : c'était de la
remplacer par un geste — la mise en attente — qui ressemble à un contrôle média sans en
être un. Deux gestes de même forme sur le même axe, et personne ne les distingue.

**Décision : deux axes, chacun avec sa place, sa forme et son vocabulaire.**

**Axe 1 — de quoi l'appel est fait.** Deux boutons dans la pastille, audio et vidéo,
**strictement symétriques** : chacun ajoute ou retire son média par re-INVITE, et le
correspondant le voit (D5). C'est l'expérience primaire de la conversation totale, et
elle ne partage sa place avec rien.

**Axe 2 — est-ce que je suis là, à l'instant.** **Un seul bouton**, hors de la pastille,
qui coupe d'un coup **tout ce que j'émets** — micro et image. C'est la sourdine du
§6.2.4, prise au mot : une fonction, un geste, les deux médias ensemble. Voir D7.

Rien ne les distingue sur la même dimension, et c'est ce qui garantit qu'on ne les
confondra pas :

| | Boutons média | Pause |
|---|---|---|
| Combien | deux, un par média | **un seul**, pour tout |
| Où | dans la pastille | **hors de la pastille**, près du raccrochage |
| Forme | rond, 44 px | carré arrondi, 52 px, cerclé d'ambre |
| Ça parle de | l'appel | **moi** |
| Ça change | la nature de l'appel, durablement | rien — l'instant d'une pause |
| Ça se signale par | une icône barrée | **un bandeau plein écran** |
| Sur le fil | un re-INVITE, qui peut être refusé | rien : instantané, jamais en échec |
| Pour revenir | renégocier le média | un appui |

Le mot « sourdine » disparaît de l'interface ; la fonction reste. Le haut-parleur,
lui, ne relève d'aucun des deux axes — c'est de la réception locale, hors du champ de
la norme : il va dans la feuille (D8), inchangé.

*Variantes écartées :* une sourdine **par média**, à côté de boutons média — c'est
précisément le piège, deux gestes de même forme sur le même axe. L'appui long pour
distinguer les deux, et le push-to-talk : illisibles, et hors de portée d'une motricité
réduite.

**Maquette :** <https://claude.ai/code/artifact/1602bd09-72a6-442c-aff1-0e4fe46a5933>
— cinq états à 360 px, dont la comparaison directe entre « vidéo retirée » (une icône
barrée) et « en pause » (l'écran entier).

### D7 — La Pause est locale, pas un re-INVITE

Le plan initial voulait un bouton unique remplaçant la sourdine. C'était juste. Ce qui
change ici, c'est **ce qu'il y a dessous** : une mise en attente SIP, non ; une coupure
locale, oui.

- **Sur le fil : rien.** `replaceTrack(null)` sur les deux émetteurs. Aucune
  négociation, aucun aller-retour, aucun 488, aucun 491 — donc **aucun échec
  possible**, ce qui est toute la valeur du geste. Quelqu'un dont on sonne à la porte
  n'a pas le temps d'un aller-retour SIP.
- **Le correspondant continue de vivre.** Il parle, il est vu, il écrit, et il reçoit
  tout cela de son côté. Une mise en attente `sendonly` l'aurait suspendu lui aussi :
  pour rien, puisque le besoin est de me retirer, moi.
- **Le texte n'est jamais coupé**, dans aucun sens. C'est la même raison qu'en D4 : une
  pause qui couperait le texte reviendrait, pour un usager sourd, à raccrocher sans le
  dire — alors que c'est justement le média qui permet d'écrire « deux minutes ».
- **Le distant le voit, sans SIP.** La piste arrêtée passe `muted` chez lui : son client
  affiche « Emmanuel est en pause » au lieu d'une image figée. C'est exactement l'*avis
  explicite* que le §6.2.4 réclame pour une vidéo suspendue, rendu par le récepteur. Un
  client tiers verra une image gelée — dégradation acceptable (§8.3.5), pas un refus.
- **Impossible à oublier : le bandeau.** En pause, l'écran entier le dit, les commandes
  média s'éteignent derrière, et « Reprendre » est le seul geste offert. C'est ce qui
  supprime le « tu étais en sourdine » — mieux qu'une icône rouge de 44 px.
- **Un appel texte seul n'a pas de bouton Pause** : il n'y a rien à suspendre, et le
  texte ne se coupe pas.

**La mise en attente SIP sort du plan.** Elle n'est pas interdite pour toujours — elle
redeviendra utile le jour où il faudra transférer un appel — mais elle ne répond à
aucun besoin actuel que la Pause ne couvre mieux.

### D8 — La barre mobile : quatre commandes et une feuille

Le diagnostic d'abord. En communication avec texte, la pastille mobile porte
aujourd'hui micro, caméra, self-view, haut-parleur, DTMF, tchat, plus le rond rouge —
sept cibles, et la Pause en ajoute une. À 44 px de cible (WCAG 2.5.5) et 6 px d'écart :
`8 × 44 + 7 × 6 + 16 = 410 px`. L'écran fait 390 px, souvent 360. Ça déborde, et ce
n'est pas rattrapable au CSS.

**La pastille porte quatre icônes ; la Pause et le raccrochage vivent dehors.** Cette
séparation n'est pas qu'une affaire de place : c'est le rendu visuel des deux axes (D6).

| | Contenu | Largeur |
|---|---|---|
| Pastille | **audio**, **vidéo**, **tchat** (ou haut-parleur si l'appel ne porte pas de texte), **⋯** | `4 × 44 + 3 × 6 + 16 = 210 px` |
| Dehors | **Pause** (52 px), **Raccrocher** (56 px) | `108 px + 20 px d'écarts` |

Soit **338 px** : ça tient à 360 px. Dans la feuille : haut-parleur, self-view, DTMF,
plein écran, statistiques.

Quatre règles, et elles font tout le travail :

1. **Un état coupé ne se cache jamais.** Toute commande dont l'état est *coupé* (rouge)
   remonte dans la pastille. C'est aussi pourquoi la feuille ne contient que des
   commandes locales et réversibles : rien de ce qui coupe un flux ne peut y tomber.
2. **Rien ne bouge sous le pouce pendant l'appel.** La répartition barre / feuille est
   décidée au décroché, à partir des médias de l'appel, et n'en bouge plus — sauf par
   la règle 1, qui ne fait que promouvoir.
3. **Ni Raccrocher ni Pause n'entrent dans la feuille.** Un geste d'urgence ne se
   cherche pas, et un geste qui doit être instantané ne demande pas deux appuis.
4. **La feuille porte des libellés, pas des icônes seules.** C'est un gain net :
   la pastille est muette aujourd'hui, et Trix s'affiche en six langues.

La forme est une **feuille du bas** (icône + libellé, une ligne par commande), pas un
menu déroulant : atteignable au pouce, lisible, et annonçable — `aria-expanded` sur le
« ⋯ », région étiquetée, fermeture à l'échappement et sur toute action. **Le bureau ne
change pas** : la sidebar a la place.

*Variantes écartées :* le défilement horizontal de la pastille (aucune affordance
visible, RGAA), et la réduction des cibles sous 44 px (pour un public âgé ou à
motricité réduite, non — 24 px est le plancher WCAG 2.5.8, pas une cible).

### D9 — Une capacité qui manque dégrade l'appel, elle ne le refuse pas

§8.1 et §8.3.5. Une offre portant un média que Trix ne sait pas traiter — un `m=text`
dans un transport que le compte n'a pas — est répondue **sur le sous-ensemble commun**,
port 0 sur le reste. Le 488 est réservé au cas où il ne reste rien
(`unsupportedOffer`, déjà en place). Cela vaut aussi pour les re-INVITE : un refus de
média est un non, pas une fin d'appel.

## 3. Écarts assumés à la norme

| § | Ce que la norme dit | Ce que Trix fait | Pourquoi |
|---|---|---|---|
| 6.2.2 | Tout changement de mode est permis si les deux terminaux le peuvent | Le texte, une fois négocié, ne se retire pas | Le texte est le repli d'accessibilité ; le retirer coupe la parole sans recours (D4) |
| 6.2.2 | *Un changement de mode augmentant le coût ne peut être engagé que du côté facturé* | Sans objet | Pas de facturation à la minute sur Internet |
| 7.2 | Profils 4a / 4b distingués par la qualité vidéo (V0 / V2) | Non distingués | Affaire d'encodeur et de débit, pas d'interface |
| 4.3 / 6.2.3 | Conférence multipoint par MCU (F.702) | Point à point uniquement | Hors périmètre — Trix reste léger (README) |

## 4. Ce que la norme demande et que Trix ne fait pas encore

Relevé fait en confrontant F.703 au code, hors du périmètre du plan initial :

- **§6.1.2 — retour d'appel sonore.** L'appelant voit « Sonnerie… », il n'entend rien
  tant que le distant n'envoie pas de média précoce. La norme demande *visible **et**
  sonore*. `ui/ring.ts` a déjà le nécessaire ; il manque une tonalité locale sur
  `sip:progress`, arrêtée dès qu'un flux distant arrive.
- **§5.3.2.3 — la qualité du texte a une unité de mesure**, et c'est celle de T.140 :
  caractères corrompus, caractères perdus, marqueurs de texte manquant. `rttdc.ts`
  insère déjà un `U+FFFD` à chaque reprise de canal — il suffit de les compter et de
  les porter dans les statistiques et l'historique.
- **§5.2.2 — l'écart audio / vidéo n'est pas mesuré.** Le seuil de 100 ms est celui de
  la langue des signes et de la lecture labiale : c'est *la* métrique du public de
  Trix, et `stats.ts` mesure tout sauf elle.
- **§4.4 note — pas d'autotest hors appel.** *« Il devrait être possible de mettre un
  terminal hors ligne en autotest »* : un « tester mon micro et ma caméra » dans les
  réglages, avec aperçu et vu-mètre. Découvrir un micro muet pendant l'appel est le
  scénario que la norme cherche justement à éviter.
- **§6.1.2 — l'alerte entrante est *« de préférence »* choisie par l'utilisateur.**
  Les trois canaux sont là — sonnerie, flash, vibration, plus la notification système
  (`ui/alert.ts`) — mais **seul le flash est débrayable** (`AccountConfig.flashAlert`),
  et c'est délibéré : les autres sont le filet de sécurité. L'écart au « de préférence »
  est mineur ; à revoir seulement si un usager demande à couper la sonnerie.
- Points **déjà conformes**, pour mémoire : alerte entrante sonore, visuelle et tactile
  (§6.1.2), retour arrière T.140 compté en graphèmes et non en unités UTF-16
  (§5.3.2.3, `t140.ts` §8.2), self-view (§4.4), avis explicite au retrait de la vidéo
  (§6.2.4).

## 5. Plan d'implémentation

Six phases. L'ordre n'est pas négociable sur les trois premières : CT-1 type ce que les
autres manipulent, et **CT-2 doit précéder CT-3 et CT-4** — la Pause et le retrait de
l'audio font déborder la barre mobile tant qu'elle n'a pas été redécoupée. CT-2 porte
d'ailleurs bien plus que de la mise en page : c'est là que les deux axes de D6
deviennent visibles.

### Phase CT-1 — Le texte devient un média

`CallMedia { audio, video, text }` de bout en bout : `sip/port.ts`, `sip/sdp.ts`,
`machines/call.ts`, historique, écran d'appel entrant. `callKind()` cesse de déduire le
texte d'un vide. Le libellé de l'appel entrant dit les médias offerts.

*Critère de sortie :* un compte `rtt: "none"` se comporte exactement comme avant, test
de non-régression à l'appui. `DIAGRAMS.md` régénéré. Aucun changement visible.

*Risque :* confondre « négocié » et « ouvert ». La nuance est dans D1 ; un test doit la
tenir (`text: true` + canal `connecting`).

### Phase CT-2 — Les deux axes deviennent visibles

D6 et D8. Pastille à quatre icônes, Pause et raccrochage dehors, feuille du bas, règle
du « coupé ne se cache pas ». Le bouton Pause est en place et inerte : c'est CT-4 qui
lui donne son effet. Bureau inchangé.

*Critère de sortie :* rendu à 320, 360 et 390 px sans débordement ; toute commande
atteignable au clavier et annoncée ; la feuille se ferme sur action, sur échappement,
et au raccrochage.

### Phase CT-3 — L'audio entre et sort de l'appel

D5. `setAudio(on)` sur le chemin de `setVideo` (`_sendReinvite`, rollback,
488 = non). `videoPending` devient un verrou d'appel. `video_offer` devient
`media_offer`. Reprise unique sur 491 avec délai aléatoire. Invariant « au moins un
média » dans le bloc.

*Critère de sortie :* la matrice ajout / retrait passe pour A, V, T, AV, AT, VT, AVT —
y compris les refus et les 491.

### Phase CT-4 — La Pause

D6 et D7. `setPaused(on)` dans le port : `replaceTrack(null)` sur les deux émetteurs,
texte intact. État `paused` dans `CallView`, bandeau sur la scène, pastille éteinte
derrière. Pause **reçue** détectée sur le passage à `muted` de la piste distante, et
affichée à la place de l'image figée. Pas de bouton sur un appel texte seul.

Bien plus légère que la mise en attente SIP qu'elle remplace : rien à négocier, donc ni
état de renégociation, ni glare, ni échec à rattraper.

*Critère de sortie :* la reprise rétablit les deux médias sans renégociation ; le texte
passe dans les deux sens pendant toute la pause ; un client tiers ne voit jamais l'appel
tomber.

### Phase CT-5 — Les manques de conformité

Les quatre points actionnables du §4 : retour d'appel sonore, compteur de texte perdu, écart
audio / vidéo dans les statistiques avec le seuil de 100 ms, autotest micro / caméra
hors appel. Indépendants les uns des autres, livrables séparément.

### Phase CT-6 — Ajouter le texte en cours d'appel (optionnelle)

D4. Sur canal de données, l'ajout ne coûte pas de renégociation. Sur WebSocket, il
demande un re-INVITE portant `m=text`. Le retrait reste interdit.

*À faire seulement si le besoin se présente en usage réel* — c'est la seule phase dont
la valeur n'est pas certaine d'avance.

## 6. Conséquences

- `docs/CONCEPTION.md` §4.4 s'élargit à l'audio et cesse de parler de la seule vidéo.
- L'écran d'appel entrant dit trois médias au lieu de deux ; les six locales suivent.
- `sip/port.ts` gagne `setAudio` et `setPaused` : le port reste le seul endroit où l'on
  écrit du SDP — et la Pause, justement, n'en écrit pas.
- Le mot « sourdine » disparaît de l'interface, la fonction survit sous une autre forme,
  et la raison en est écrite (D6) — pour que le débat ne soit pas rouvert dans six mois.
- Trix devient conforme au §6.2.4 et au §6.2.2 sur l'audio comme sur la vidéo, avec
  un écart unique et documenté sur le retrait du texte.

## 7. Questions ouvertes

1. **La feuille du bas doit-elle exister sur bureau étroit ?** Une fenêtre de bureau
   réduite à 400 px tombe dans le gabarit mobile — à vérifier au rendu avant de trancher.
2. **La Pause doit-elle se lever toute seule ?** Au bout de quelques minutes, ou jamais.
   Jamais est plus prévisible ; se lever toute seule évite d'émettre sans le savoir. Le
   bandeau plein écran rend le second risque très faible — je penche pour « jamais ».
3. **Faut-il un avis quand le distant coupe son micro ?** §6.2.4 n'exige l'indication
   que localement. La signaler au distant demanderait un canal hors bande — le lien
   T.140 pourrait le porter, mais rien dans T.140 ne le prévoit.

## Références

- ITU-T F.703 (11/2000), *Multimedia conversational services* — §3.2.7 (définition),
  §5.3.1, §5.2.2, §6.1.2, §6.2.2, §6.2.4, §7.2 (profils), §8.1 et §8.3.5 (interopérabilité)
- ITU-T F.700 (2000), *Framework Recommendation for audiovisual/multimedia services* —
  annexes A (composants média) et B (tâches de communication)
- ITU-T T.140 (1998), *Protocol for multimedia application text conversation*
- ITU-T H-series Suppl. 1 (1999), *Sign language and lip-reading real-time conversation*
- RFC 3261 §14.1 (491 et glare), RFC 8865 (T.140 sur canal de données), RFC 3264 §8.4
  (mise en attente — écartée, voir D7)
- `docs/CONCEPTION.md` §4.4 (négociation en cours d'appel) et §4.9 (texte temps réel)
- ADR 0001 (T.140 hors SDP), ADR 0002 (deux comptes SIP)
