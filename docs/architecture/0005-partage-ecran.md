# ADR 0005 — Le partage d'écran

**Statut :** accepté — 2026-08-27 · **implémenté** — 2026-09-07 (SC-1 à SC-5)
**Portée :** `sip/port.ts`, `sip/sdp.ts`, `sip/stats.ts`, `machines/call.ts`,
`machines/events.ts`, `ui/screens/call/*`, `i18n/locales/*`, `docs/CONCEPTION.md` §4.12
et §5.4
**Références normatives :** RFC 8829 (JSEP), RFC 3264, RFC 4796 (`a=content`),
RFC 5888 (`a=mid`), RFC 9143 (BUNDLE), RFC 3261 §14.1, ITU-T F.703

## Contexte

Trix sait faire entrer et sortir l'audio et la vidéo d'un appel en cours (ADR 0003,
§4.4). Le partage d'écran ressemble à « ajouter la vidéo », et c'est précisément le
piège : ce n'en est pas un. Un partage d'écran est **un second flux vidéo qui coexiste
avec la caméra**, pas un remplacement — sans quoi partager reviendrait à disparaître de
l'écran de son correspondant, ce qui, pour deux personnes qui signent, revient à
raccrocher.

Deux flux vidéo dans un appel, c'est exactement ce que le modèle Unified Plan de
RFC 8829 est fait pour décrire, et c'est aussi ce qui casse la plupart des hypothèses
du port SIP d'aujourd'hui — toutes écrites quand « la vidéo » désignait un flux unique.

Cet ADR pose le modèle SDP, les décisions d'interface, et le plan pour y arriver.

## 1. Ce que la norme impose

### 1.1 Unified Plan : une piste, une m-section, un MID

RFC 8829 §5.2.1 et §5.2.2 tiennent tout le raisonnement :

- **une m-section par piste**. Deux flux vidéo, c'est deux `m=video`. Il n'y a pas
  d'autre façon de les décrire — Plan B est mort, et le navigateur ne l'offre plus ;
- **l'ordre des m-sections ne change jamais** d'une offre à la suivante, et leur nombre
  ne décroît pas. On ajoute en fin de liste, ou on **recycle** une m-section rendue
  inerte ;
- **le `a=mid` (RFC 5888) est l'identité** d'une m-section, et la seule qui survive à
  une renégociation. Ni l'ordre, ni le `msid`, ni le fait d'être « la deuxième vidéo »
  ne sont des identités : le MID l'est.

Corollaire pour BUNDLE (RFC 9143) : la nouvelle m-section rejoint le groupe déjà
négocié, et le navigateur s'en charge. Un distant qui ne sait pas grouper ouvrira en
revanche un second couple de candidats ICE — coût réel derrière un TURN, mentionné ici
pour qu'il ne surprenne pas dans une trace.

### 1.2 Dire ce qu'est le flux : `a=content` (RFC 4796)

Deux `m=video` dans un SDP ne disent pas d'elles-mêmes laquelle est le visage et
laquelle est l'écran. RFC 4796 définit l'attribut qui le dit, avec ses valeurs :
`main`, `slides`, `speaker`, `alt`, et — la norme le prévoit expressément — `sl` pour
la langue des signes. C'est l'équivalent SDP de ce que H.239 fait en visioconférence,
et c'est un attribut **informatif** : un terminal qui ne le connaît pas l'ignore sans
que rien n'échoue.

L'ordre des m-sections ne peut pas remplacer cet attribut : un appel audio auquel on
ajoute un partage sans jamais avoir eu de caméra a son partage en **première** `m=video`.

### 1.3 Ce que F.703 en dit, et ce qu'il n'en dit pas

F.703 ne connaît pas le partage d'écran — c'est une recommandation de conversation, pas
de collaboration. Deux de ses règles s'y appliquent quand même, et ce sont celles qui
tranchent les décisions difficiles :

- **§8.3.5, dégrader jamais refuser** : un correspondant qui ne sait pas afficher un
  second flux vidéo doit rester en communication, sans le voir ;
- **§6.2.4 et §4.5** : la vidéo de l'appel est, pour le public de Trix, le canal de la
  langue des signes. Tout ce qui la chasse de l'écran est un acte de conversation, pas
  un réglage d'affichage — c'est ce qui justifie D5.

## 2. Décisions

### D1 — Le partage est une seconde `m=video`, jamais un `replaceTrack`

La solution facile — remplacer la piste caméra par la piste d'écran sur le même
émetteur — ne coûte aucune renégociation, et c'est son seul mérite. Elle rend le partage
**invisible à la signalisation** : rien à refuser, rien à tracer, rien qui distingue
l'écran du visage chez le récepteur, et la caméra qui s'éteint sans que personne l'ait
demandé.

Le partage est donc un **transceiver de plus**, `sendonly`, ajouté par
`addTransceiver("video", { direction: "sendonly" })` et négocié par re-INVITE — le même
chemin que l'ajout d'un média (§4.4), à ceci près que ce qu'il ajoute n'est pas un média
de l'appel (D3).

`sendonly` et non `sendrecv` : rien n'est attendu en retour sur cette m-section, et un
`sendrecv` promettrait une réciprocité que D9 refuse.

### D2 — Le port raisonne en **rôles**, plus en `kind`

C'est le refactor structurant, et il précède tout le reste.

`transceiverOf(pc, kind)` (`sip/port.ts:718`) rend **le premier** transceiver du média
demandé. Avec deux `m=video`, cette fonction devient un générateur de bugs silencieux :
`stopSending` éteindrait la mauvaise caméra, `applySilence` laisserait un flux émettre
avant le décrochage, `setPaused` ne suspendrait que la moitié de ce que j'émets, et
`blockInAnswer` refuserait la mauvaise m-section. Aucun de ces cas ne lève d'exception :
ils rendent l'appel faux.

Le port gagne donc un rôle explicite :

```ts
type StreamRole = "audio" | "camera" | "share";
```

et `transceiverFor(pc, role)` remplace `transceiverOf`. La résolution :

- `audio`, `camera` — le premier transceiver du média qui **n'est pas** celui du partage ;
- `share` — le nôtre par identité d'objet (nous l'avons créé), celui du distant par son
  **MID**, retenu à la lecture de son offre (D4).

`negotiatedMedia` (`sip/port.ts:733`) suit la même règle : elle calcule ce que l'appel
transporte **en ignorant le rôle `share`**, et rend le partage à part. Sans cela,
retirer sa caméra pendant un partage laisserait `media.video` à vrai — l'appel se
dirait en vidéo alors que plus personne ne se voit.

### D3 — Le partage n'est pas un média de l'appel

`CallMedia` reste `{ audio, video, text }` et `MediaKind` reste `"audio" | "video"`.

Trois conséquences, et elles sont toutes voulues :

1. **`isLastMedia` ne compte pas le partage.** On ne peut pas retirer l'audio et la
   vidéo d'un appel sous prétexte qu'un écran y passe encore : un appel dont il ne reste
   que le partage n'est pas une conversation, et l'invariant de §4.4 tient tel quel ;
2. **l'historique ne consigne pas le partage.** Un partage est un épisode dans un appel,
   pas une nature d'appel — `CallLogEntry.media` ne bouge pas ;
3. **les réponses à un appel entrant ne changent pas.** On ne décroche pas « en
   partage » : le partage arrive toujours en cours de conversation.

L'état vit donc à côté, dans `CallView` :

```ts
sharing: "off" | "starting" | "on";   // ce que j'émets
peerSharing: boolean;                 // ce que je reçois
```

`starting` est le temps de la renégociation, distinct de `mediaPending` par ce qu'il
affiche, confondu avec lui par ce qu'il verrouille (D7 de l'ADR 0003 : **un seul verrou**,
et le bouton de partage est grisé pendant toute renégociation, quelle qu'elle soit).

### D4 — Le flux se nomme sur le fil : `a=content:slides`

Le navigateur n'écrit pas `a=content`. Le port l'ajoute à la m-section du partage dans
l'offre locale, exactement là où `sdp.withoutMedia()` retouche déjà les réponses — le
port reste le seul endroit du programme où l'on écrit du SDP.

En lecture, `sdp.ts` gagne `sharedVideoMid(sdp)` :

1. le MID de la première `m=video` active portant `a=content:slides` ;
2. à défaut, le MID de la **seconde** `m=video` active. C'est le repli pour les
   terminaux qui ne posent pas l'attribut, et il suffit dans le cas courant.

La caméra, elle, ne reçoit **pas** de `a=content:main` : ce serait retoucher une
m-section qui fonctionne aujourd'hui contre des passerelles qu'on ne maîtrise pas, pour
un gain nul — l'absence d'attribut vaut déjà « flux principal » partout où on a vu la
question se poser. À revoir si un terminal tiers s'y perd.

### D5 — Le partage se demande, et le refus laisse l'appel intact

Accepter un partage n'allume aucun capteur chez le récepteur : la raison qui fait poser
la question pour le micro et la caméra (ADR 0003, D5) ne s'applique pas ici. La question
se pose quand même, pour une autre raison, et elle est plus forte :

**un écran partagé prend la place de la langue des signes.** Sur un téléphone, il n'y a
pas deux grandes surfaces : accepter, c'est reléguer le visage de son correspondant dans
une vignette. Personne d'autre que le récepteur ne peut décider cela pour lui — c'est
F.703 §4.5 et §6.2.4 lus ensemble.

Le refus est un **488 Not Acceptable Here** sur le re-INVITE, comme pour un média
refusé : la session revient à ce qu'elle était (RFC 3261 §14.1), l'appel reprend son
cours, et rien ne s'est perdu. Le silence vaut refus au bout de 25 s, comme en
`media_offer`.

Côté machine, la question réutilise **l'état `media_offer` existant** — pas d'état de
plus, pas de minuterie de plus, pas de diagramme à refaire. `CallBlock` gagne un drapeau
`offerShare` à côté de `offerAdds` (`machines/call.ts:112`), et c'est la popup qui change
de phrase. Une offre qui ajouterait un média **et** un partage pose une question unique,
et l'acceptation vaut pour tout ce qu'elle porte : c'est déjà la sémantique de
`offerAdds`.

### D6 — Une m-section retirée n'est pas supprimée : elle est recyclée

Arrêter de partager, c'est `direction = "inactive"`, piste arrêtée, re-INVITE — et le
transceiver **reste**, avec son MID. On ne l'arrête pas (`transceiver.stop()`).

La raison est dans RFC 8829 §5.2.2 : les m-sections ne disparaissent pas d'une offre à
la suivante. Un transceiver arrêté laisse une m-section à port 0 dans toutes les offres
suivantes, et un nouveau partage en ajouterait une de plus — un SDP qui grandit à chaque
partage sur un appel qui dure. Le garder inactif le rend recyclable pour le partage
suivant, sans rien ajouter, et son MID reste l'identité que D2 utilise.

### D7 — Le rollback ne défait pas `addTransceiver` : il faut l'arrêter à la main

Le piège de cette phase, et il ne se voit pas en test manuel.

Quand notre offre est refusée, `abandon()` (`sip/port.ts:1054`) ramène la connexion à
`stable` par un rollback. Le rollback retire les transceivers créés par
`setRemoteDescription` — **pas ceux que l'application a créés**. Le transceiver du
partage survit donc au refus, sans MID, et la **prochaine** offre, fût-elle un simple
ajout d'audio, réoffrira le partage que le distant vient de refuser.

Le partage est donc le seul cas où l'abandon doit faire plus qu'un rollback :
`stop()` sur le transceiver créé pour rien, puis oubli de la référence. C'est le seul
endroit où D6 ne s'applique pas — la m-section n'a jamais été négociée, il n'y a rien à
recycler.

### D8 — La capacité décide, pas le gabarit

Le bouton de partage apparaît si et seulement si
`typeof navigator.mediaDevices?.getDisplayMedia === "function"`.

C'est ce qui rend vraie la règle « le partage n'existe que sur bureau » sans jamais la
câbler : aucun navigateur mobile n'expose cette API. Et c'est plus juste que de lire
`layoutMode()`, qui est une **largeur de fenêtre** : une fenêtre de bureau réduite à
400 px bascule en gabarit mobile (ADR 0003, question ouverte 1) et perdrait le partage
sans raison, alors que la machine sait parfaitement le faire.

La réception, elle, ne demande aucune capacité particulière : elle marche partout, et
c'est tout l'intérêt.

Place du bouton : dans la barre du bureau, **du côté axe 1** (avant le trait) — il
change ce que l'appel transporte, et le correspondant le voit. La pastille mobile n'est
pas concernée : le budget de quatre icônes de D8 (ADR 0003) reste intact, puisque le
bouton n'y apparaît jamais.

### D9 — Un seul partage à la fois dans l'appel

Si le distant partage, notre bouton est grisé, et réciproquement. Deux écrans partagés
simultanément, ce sont deux m-sections de plus, deux surfaces à caser sur un téléphone,
et une question de préséance que rien ne tranche.

Le glare est déjà couvert : deux partages lancés en même temps produisent un 491, la
reprise unique de §4.4 s'applique, et à la reprise on constate que le distant partage —
la nôtre est abandonnée avec un avis, sans autre traitement particulier.

### D10 — La Pause coupe le partage

ADR 0003 D7 promet que **rien de ce que j'émets ne part** pendant une pause. Un écran
qui continue de s'afficher pendant que je suis parti ouvrir la porte casse cette
promesse, et il la casse de la façon la plus coûteuse : un écran de travail montre des
notifications, des courriels, des noms.

La pause pose donc `replaceTrack(null)` sur les trois émetteurs, la reprise rattache les
trois pistes. C'est une ligne de plus dans `setPaused`, une fois D2 en place.

*Variante écartée :* laisser le partage vivre pendant la pause, pour qu'on puisse
continuer à lire un document pendant que son auteur s'absente. C'est un usage réel, mais
il ne vaut pas une promesse de confidentialité à laquelle on ne pourrait plus se fier.

### D11 — La scène : le partage prend la grande surface

À la réception d'un partage, l'écran partagé prend la scène et la caméra distante passe
en vignette. Trois règles, et elles valent pour les deux gabarits :

- **`object-fit: contain`, jamais `cover`.** Recadrer un écran partagé coupe du texte —
  c'est-à-dire tout ce qu'il transportait ;
- **la permutation est offerte**, pour remettre le visage en grand sans refuser le
  partage : un appui sur la vignette, **et** une entrée dans la feuille du bas ou la
  barre. Le geste tactile seul ne suffit pas (RGAA 7.3, la même leçon que le double-clic
  du plein écran) ;
- **le self-view se replie** quand le partage arrive : trois images sur un téléphone
  n'en font aucune lisible. Le bouton reste, l'utilisateur peut le rouvrir.

## 3. Écarts assumés

| Ce que la norme prévoit | Ce que Trix fait | Pourquoi |
|---|---|---|
| RFC 4796 : `a=content:main` sur le flux principal | Seul le partage est marqué | Ne pas toucher une m-section qui marche contre des passerelles non maîtrisées (D4) |
| RFC 4796 : valeur `sl` pour la langue des signes | Non posée | La caméra de Trix porte de la langue des signes ou un visage, sans que le poste sache lequel |
| RFC 8829 : rien n'interdit plusieurs partages | Un seul (D9) | Préséance indécidable, et une seule grande surface sur un téléphone |
| `getDisplayMedia({ audio: true })` — l'audio d'onglet | Hors périmètre | Une quatrième m-section, un mixage avec le micro que rien ne décrit, aucun besoin exprimé |

## 4. Plan d'implémentation

Cinq phases. **SC-1 précède tout le reste** : elle est le refactor sur lequel les quatre
autres s'appuient, et elle est aussi ce qui rend le poste inoffensif face à un partage
qu'il ne sait pas encore afficher.

### Phase SC-1 — Le rôle vidéo dans le port

D2. `transceiverOf` → `transceiverFor(pc, role)` ; `negotiatedMedia` ignore le rôle
`share` ; `sharedVideoMid()` dans `sdp.ts` (D4, lecture seule) ; tous les appelants du
port passés en revue — `stopSending`, `openTrack`, `closeTrack`, `applySilence`,
`setPaused`, `blockInAnswer`, `dtmfSender`.

Le garde-fou de la phase : une seconde `m=video` **reçue** est répondue `inactive` et
n'est jamais prise pour la caméra. Le poste ne l'affiche pas encore, mais il ne
s'égare pas non plus — dégrader, jamais refuser (ADR 0003, D9).

*Fichiers :* `sip/port.ts`, `sip/sdp.ts`, `test/renegotiate.test.ts` (les transceivers
factices gagnent un `mid`).

*Critère de sortie :* toute la suite passe sans modification de comportement ; un test
neuf injecte une offre à deux `m=video` et vérifie que `media.video` reste celui de la
caméra, et que la seconde m-section est répondue inactive.

*Risque :* un appelant du port oublié. Le compilateur ne le dira pas si la signature
garde un défaut — d'où l'absence de valeur par défaut sur `role`.

### Phase SC-2 — Émettre

D1, D4, D6, D7, D8. `startShare()` / `stopShare()` dans `MediaControl` et `CallSession` :
`getDisplayMedia`, `addTransceiver` en `sendonly`, `a=content:slides` posé sur l'offre
locale, re-INVITE par le chemin existant, `inactive` + recyclage au retrait, `stop()` du
transceiver sur refus.

Deux détails qui ne s'inventent pas au moment du test :

- **la barre native du navigateur** (« Cesser de partager ») arrête la piste sans rien
  dire à l'application : `track.onended` doit déclencher le retrait par re-INVITE, sinon
  le distant garde une m-section vivante sur une image gelée ;
- **le partage n'existe pas avant le décrochage.** Comme les commandes média, il est sans
  effet en `ringing` et `early_media` (ADR 0003, CT-5 §3) : pas de dialogue confirmé où
  poser un re-INVITE.

Bouton dans la barre du bureau, côté axe 1, grisé si `mediaPending` ou si le distant
partage (D9).

*Fichiers :* `sip/port.ts`, `sip/sdp.ts`, `machines/call.ts`, `machines/events.ts`,
`ui/screens/call/overlay.ts`, `ui/screens/call/parts.ts`, `i18n/locales/*` (6 langues).

*Critère de sortie :* démarrer, arrêter, redémarrer un partage dans le même appel
n'ajoute **qu'une** `m=video` au SDP — la deuxième fois recycle la première (D6). Un
refus (488) laisse l'appel intact et le re-INVITE suivant ne réoffre pas le partage
(D7). Le partage arrêté depuis la barre du navigateur est retiré de l'appel.

*Risque :* un B2BUA qui réécrit les SDP. Une seconde `m=video` est exactement ce qu'un
SBC peut fusionner, réordonner ou rejeter — et le comportement derrière un proxy qui
réécrit n'a jamais été observé sur ce dépôt. La trace SIP de l'appel est l'outil : elle
montre les deux SDP.

### Phase SC-3 — Recevoir et demander

D5, D11. Détection du partage entrant par `sharedVideoMid()`, `sip:mediaOffer` enrichi
d'un drapeau `share`, `media_offer` réutilisé, popup « {peer} souhaite partager son
écran » avec « Voir l'écran » / « Refuser », 488 au refus et sur silence de 25 s.

Puis la mise en scène : seconde surface `<video data-ref="share">` dans les deux
gabarits, `attachMedia` étendu pour router les pistes par MID plutôt que par ordre
d'arrivée, permutation scène/vignette, self-view replié, `object-fit: contain`.

*Fichiers :* `sip/port.ts`, `machines/call.ts`, `machines/events.ts`,
`ui/screens/call/{desktop,mobile,parts,mediaask,overlay}.ts`, `ui/theme.css`,
`i18n/locales/*`.

*Critère de sortie :* Trix → Trix, un partage démarré au bureau s'affiche sur mobile,
la langue des signes reste lisible en vignette, la permutation marche au clavier comme
au doigt, et le refus laisse l'appel exactement où il était.

### Phase SC-4 — Les bords

D9, D10. La Pause coupe le partage et la reprise le rétablit ; le partage se retire
proprement au raccrochage (`release()`) ; le glare de deux partages simultanés ;
`sharing` grisé pendant que le distant partage ; le partage abandonné sur délai
(`abandonMedia`, 28 s — le 100 Trying n'est pas garanti sur un re-INVITE, aucune
logique ne doit en dépendre).

*Critère de sortie :* la matrice partage × {pause, retrait caméra, retrait audio, 491,
488, silence, raccrochage} ne laisse jamais de piste d'écran vivante ni de m-section
orpheline.

### Phase SC-5 — Ce qui se mesure et ce qui s'écrit

Les statistiques d'abord, parce qu'elles sont **fausses** dès SC-2 sans correctif :
`sip/stats.ts` agrège par `kind`, donc `video-sent` additionnerait la caméra et
l'écran, et l'écart audio / vidéo de F.703 §5.2.2 — la métrique du public de Trix —
serait mesuré sur le premier flux vidéo venu, partage compris. Les relevés doivent être
séparés par SSRC ou par MID, et le partage exclu du calcul d'écart.

Puis la trace (`sip/record.ts` : « partage démarré », « partage refusé »),
`docs/CONCEPTION.md` §4.12, la régénération de `DIAGRAMS.md`, et le `USERGUIDE.md`.

*Critère de sortie :* un appel avec partage rend un bilan média dont les débits vidéo
sont ceux de la caméra, et `npm run diagrams` ne diverge pas.

### Après SC-5 — ce que le premier essai en réel a corrigé

**2026-09-08, bureau → mobile, à travers le B2BUA Kelixip.** Le partage n'a jamais
atteint le correspondant, et le poste émetteur a annoncé un refus que personne n'avait
prononcé. La trace SIP dit tout en trois lignes :

```
17:35:14.565  ui:toggleShare → renegotiating "partage d'écran"
17:35:39.587  → INVITE (CSeq 7725, a=group:BUNDLE 0 1 2 3)
17:35:42.568  partage d'écran refusé (abandon local)
```

Vingt-cinq secondes séparent le clic de l'offre : c'est le temps que le sélecteur de
Chrome a mis à rendre une réponse — « quelle fenêtre partagez-vous ? » est une question
posée à un humain. Or le délai de 28 s courait depuis l'entrée dans `renegotiating`,
c'est-à-dire depuis le clic : il a fauché l'offre trois secondes après son départ, avant
que le distant ait pu en dire quoi que ce soit.

Le défaut n'est pas propre au partage : `setMedia` ouvre lui aussi son capteur avant
d'offrir. Il ne s'était jamais vu parce que `getUserMedia` rend la main tout de suite sur
une permission déjà accordée, là où le sélecteur d'écran demande une vraie décision.

**Correctif : l'attente a deux temps.** `preparing` — le capteur s'ouvre, le navigateur
rassemble ses candidats ICE, rien n'est parti — n'a aucun délai : ce qu'on y attend est
une décision de l'utilisateur devant une boîte modale. `renegotiating` commence sur
`sip:offering`, que le port émet là où il relit le SDP local d'une renégociation, juste
avant que JsSIP n'écrive le message ; les 28 s ne comptent plus que le silence du
correspondant, et repartent à zéro pour la reprise après un 491. Le verrou unique, lui,
est posé dès le clic dans les deux états (ADR 0003, D7). Corollaire : **toute commande du
port rend un avis**, y compris celle qui ne peut rien faire — sans délai pour rattraper un
silence, un port muet laisserait le verrou posé jusqu'au raccrochage.

## 5. Conséquences

- `sip/port.ts` cesse de croire qu'il n'y a qu'un flux vidéo par appel — c'est la moitié
  du travail, et elle est invisible ;
- le port gagne trois entrées (`startShare`, `stopShare`, le rôle) et reste le seul
  endroit où l'on écrit du SDP ;
- `CallMedia` ne bouge pas : ce qui a été typé en CT-1 continue de dire ce que l'appel
  **transporte**, et le partage n'en est pas ;
- une capacité de plus qui n'existe pas sur mobile, sans qu'aucune ligne ne parle de
  mobile ;
- six locales de plus à tenir, et le build échoue si l'une manque.

## 6. Questions ouvertes

1. **Le partage doit-il survivre au retrait de la vidéo ?** Retirer sa caméra pendant
   qu'on partage est cohérent (D3 le permet), mais un appel qui n'a plus qu'un écran et
   du son est une réunion, pas une conversation. Laisser faire et voir.
2. **Faut-il un cadre d'arrêt visible chez l'émetteur ?** Le navigateur en pose un ;
   Trix pourrait s'en remettre à lui, ou afficher son propre bandeau comme pour la Pause.
   À trancher au rendu.
3. ~~**Le pincement pour zoomer sur un écran reçu**, sur mobile.~~ **Tranchée le
   2026-09-07 : oui, et pas seulement au pincement.** Un écran de bureau ramené à
   360 px reste illisible même en `contain` — rien n'y est coupé, tout y est trop
   petit. L'agrandissement est **local** (rien ne part sur le fil, le correspondant
   envoie la même image), borné à 5 ×, et l'image ne peut pas dériver hors de son
   cadre. Il suit la règle des deux chemins : un **pincement** (et son équivalent
   molette + Ctrl, qui est ce qu'un pavé tactile de portable envoie), un **pavé
   `− / % / +`** posé sur la scène, et le **clavier** — `+`, `−`, `0`, et les flèches
   pour déplacer. Un geste à plusieurs points sans équivalent à un seul point serait
   hors de portée deux fois (WCAG 2.5.1, RGAA 7.3). Le zoom retombe à 100 % quand
   l'écran quitte la scène : une vignette agrandie ne montrerait qu'un coin, et le
   geste pour en sortir n'y serait plus.

## Références

- RFC 8829 (JSEP) — §5.2.1 et §5.2.2 (offres initiales et suivantes, ordre et recyclage
  des m-sections), rollback
- RFC 3264 §6 (réponse par m-section), RFC 5888 (`a=mid`), RFC 9143 (BUNDLE)
- RFC 4796, *The SDP Content Attribute* — `main`, `slides`, `speaker`, `sl`, `alt`
- RFC 3261 §14.1 (491, glare), §14.2
- W3C `webrtc-pc` — `getDisplayMedia`, comportement des transceivers au rollback
- ITU-T F.703 §4.5, §6.2.4, §8.3.5
- ADR 0003 (conversation totale : les deux axes, le verrou unique, la Pause),
  `docs/CONCEPTION.md` §4.4
