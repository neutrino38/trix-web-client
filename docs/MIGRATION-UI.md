# Plan de migration — refonte de l'écran d'appel

**Maquette cible :** `docs/mockups/trix-call-screen-mockups.html` (options 1a → 1g)
**Maquette de départ :** `docs/mockups/mockup.html` (état implémenté, phases 0 à 3)
**Périmètre :** code des phases 2 et 3 (écran d'appel, appels sortants, appels entrants)
**Dernière mise à jour :** 2026-08-16 (lot L3)

---

## 1. Ce que change la maquette

| Réf. | Écran | Changement par rapport au code actuel |
|---|---|---|
| 1a | Hors appel (référence) | Recréation fidèle de `desktop.ts`. Deux écarts : le logo est une **image** (`<img alt="Trix">`) et non le SVG LSF inline ; la sidebar au repos ne porte **plus** la barre média, le chrono à 00:00:00 ni le bandeau « Tchat — phase 4 » |
| 1b | En communication | **Chrono déplacé dans la barre haute** · **commandes média en surimpression sur la vidéo** (pastille arrondie, boutons ronds 44 px) · **micro coupé = bouton rouge plein + icône barrée** · **DTMF actif** · nouveau bouton **replier le panneau** · sidebar = Raccrocher + **colonne tchat/RTT** (l'historique et le champ d'adresse disparaissent pendant l'appel) · **poignée de redimensionnement**, largeur plafonnée à 33 % de la fenêtre |
| 1c | En communication, panneau replié | La scène occupe toute la largeur ; le bouton de repli passe en état actif (violet, `aria-pressed`), une infobulle « Afficher le tchat et l'historique » l'accompagne, et un **Raccrocher rond rouge 56 px** s'ajoute à droite de la barre de surimpression |
| 1f | Appel sans vidéo | **Le tchat distant occupe toute la scène** (fond sombre, texte 18 px) · ni caméra ni self-view · **pas de panneau latéral** · préférences (A−/A+/thème) en bas à gauche, commandes média + Raccrocher en bas à droite · la pastille d'état porte le mode : « En communication — **audio + texte** — paul@… » |
| 1e | Appel vidéo entrant | **Popup modale centrée** (carte blanche 520 px, ombre portée, voile sombre) **au-dessus** de l'écran d'appel, à la place de la carte incrustée dans la scène. Badge vert, sur-titre « APPEL VIDÉO ENTRANT », nom en 34 px, URI, puis trois boutons pleine largeur : Répondre en vidéo / Répondre en audio / Refuser, et une phrase d'explication de l'offre. Le cadre clignotant est conservé |
| 1g | Appel audio entrant | Même popup avec **une seule réponse** (« Répondre en audio ») quand l'offre ne contient pas de vidéo |
| 2a | Grille RGAA 4.1 (AA) | 9 familles de critères, chaque ligne marquée ✓ déjà tenu · → règle de maquette · ! à ajouter. Voir §6 |

### Ce qui ne change pas

Palette FSL et thème clair/foncé, barre haute (logo, pastilles d'état, Paramètres/Déconnexion désactivés
en appel), scène vidéo (self-view 25 % en haut à gauche, vu-mètres à droite, double-clic plein écran),
composeur hors appel (adresse + bouton scindé + menu de mode), historique chiffré hors appel,
préférences A−/A+/thème, alerte multi-canal d'appel entrant (cadre, onglet, favicon, notification,
vibration, wake lock).

---

## 2. Points à trancher avant de coder

| # | Question | Recommandation |
|---|---|---|
| D1 | Le DTMF est actif dans la maquette mais il est **phase 4** | Garder le bouton dans la barre de surimpression, **désactivé**, jusqu'à la phase 4 — mais sans le badge « ph. 4 » qui n'existe plus dans la maquette : l'infobulle « Clavier DTMF — disponible en phase 4 » suffit |
| D2 | La colonne tchat suppose le **texte temps réel**, lui aussi phase 4 | Livrer en phases 2-3 **le gabarit, la mise en page et l'état UI** de la colonne (repli, redimensionnement, défilement, champ de saisie désactivé avec un mot d'explication), et brancher le transport data channel en phase 4. C'est ce qui débloque 1b et 1c sans attendre |
| D3 | 1c annonce « Afficher le tchat **et l'historique** », mais 1b ne montre que le tchat | Trancher : soit l'historique revient sous le tchat pendant l'appel, soit l'infobulle devient « Afficher le tchat ». Recommandation : **infobulle « Afficher le tchat »** en phases 2-3, l'historique reste réservé au hors-appel (la place manque à 300 px) |
| D4 | 1f introduit les modes **audio + texte** et **texte seul**, et les dit « permutables en cours d'appel » | Le typage (`CallMedia.text`) et les entrées de menu sont du ressort de ce chantier ; la **permutation en cours d'appel exige un re-INVITE** (renégociation SDP) — hors périmètre, à porter en phase 4/5 |
| D5 | 1a supprime la barre média et le chrono de la sidebar au repos | Suivre la maquette : hors appel, la sidebar ne garde que adresse + appel + historique + alertes + préférences. Les commandes média n'existent que là où elles servent |
| D6 | `trix-icon.svg` et `trix-logo.svg` pèsent 263 Ko chacun | **Tranché (L0)** : mesuré à **12 Ko une fois gzippé** — le poids réseau n'est pas un problème, ma réserve initiale était pessimiste. Reste la vraie raison de les servir en `<img>` et **jamais en SVG inline** : le gabarit est reconstruit à chaque notification de la machine, ce qui réinjecterait 263 Ko dans le DOM à chaque rendu. Pas besoin de version simplifiée |
| D7 | « Activer les alertes système » occupe une ligne de la sidebar d'appel | **Déplacer dans l'écran de paramètres** et renommer **« Activer les notifications »** (voir L1b). Faisable : `Notification.requestPermission()` exige un geste utilisateur, et un clic dans le formulaire en est un. Contrepartie à assumer : l'invite n'est plus vue que par qui ouvre les paramètres — d'où la ligne d'état permanente qui l'accompagne |
| D8 | Thème et taille de texte vivent dans le pied de la sidebar d'appel | **Thème → paramètres** (avec un troisième état « Système », impossible à retrouver aujourd'hui), **A− / A+ reste dans l'écran d'appel** : c'est le seul réglage qu'on ajuste en cours de conversation, pour lire un RTT qui défile. Voir L1b |

---

## 3. Impacts par couche

### 3.1 Types et machines

| Fichier | Impact |
|---|---|
| `src/sip/port.ts` | `CallMedia` gagne `text: boolean` (D4). Signature inchangée ailleurs, mais tout littéral `{audio, video}` du code et des tests doit être complété |
| `src/sip/sdp.ts` | Détection du média texte dans l'offre entrante (`m=application … webrtc-datachannel`) pour alimenter `offered.text` |
| `src/machines/events.ts` | `CallView` gagne l'état du tchat (`messages`, `composing`) en phase 4 ; **aucun** nouvel événement pour le repli/la largeur du panneau (UI pure) ; `ui:dtmf` en phase 4 |
| `src/machines/call.ts` | Inchangée pour les lots L1 à L4. Touchée seulement par le tchat et le DTMF (phase 4) |
| `src/machines/phone.ts` | Inchangée |
| `src/storage/store.ts` | `CallLogEntry.media` hérite du champ `text` → lecture rétro-compatible (`text: m.text ?? false`), comme déjà fait pour `authUsername` et `flashAlert` |

**Conséquence importante :** les lots L0 à L4 — c'est-à-dire l'essentiel de la refonte visuelle —
**ne touchent aucune machine à états**. `docs/DIAGRAMS.md` et le test qui le garde restent verts.

### 3.2 UI

| Fichier | Impact |
|---|---|
| `src/ui/logo.ts` | Réécrit : `<img src="/trix-icon.svg" alt="Trix">` (ou `trix-logo.svg` sur l'accueil) au lieu du SVG LSF inline |
| `src/ui/screens/call/desktop.ts` | Refonte majeure : chrono en barre haute, scène avec surimpression, panneau repliable, colonne tchat |
| `src/ui/screens/call/mobile.ts` | Alignement : la vue mobile a **déjà** les commandes en surimpression — elles deviennent le tronc commun ; la popup d'appel entrant remplace `.mincoming` |
| `src/ui/screens/call/parts.ts` | 500 lignes aujourd'hui, à découper : `icons.ts`, `history.ts`, `overlay.ts` (barre média commune), `incoming.ts` (popup), `chat.ts`, `wire.ts` |
| `src/ui/screens/config.ts` | Formulaire scindé en deux sections : compte SIP (chiffré) et alertes/affichage (localStorage, effet immédiat) — accueille les notifications et le thème (L1b) |
| `src/ui/prefs.ts` | Trois réglages de plus : `trix-panel` (replié/déplié), `trix-panel-width` (px, plafonné à 33 %), et le thème qui passe à trois états (clair / sombre / système) — `toggleTheme()` devient `setTheme(mode)` |
| `src/ui/screens/call/panel.ts` | **Nouveau (L3)** : icône, intitulés, poignée et câblage du panneau repliable — repli, glisser, pilotage clavier |
| `src/ui/theme.css` | Classes nouvelles (`.overlaybar`, `.panel-handle`, `.chatcol`, `.incoming-dialog`), et `.mediabar`/`.incoming-card`/`.chat-strip` retirées. **Palette étendue** pour la conformité AA : `--green-surface`, `--red-surface`, `--*-signal`, `--field-border` (§7.2) |
| `index.html` | Déclaration du favicon, `<h1>` et régions ARIA (§6) |

### 3.3 Tests

`test/call.test.ts` et `test/phone.test.ts` : compléter les littéraux `CallMedia` (L6 seulement).
`test/store.test.ts` : un cas de lecture d'une entrée d'historique sans `text`.
`test/diagrams.test.ts` : à régénérer uniquement si les machines bougent (donc pas avant la phase 4).
Aucun test ne couvre le rendu DOM aujourd'hui — la recette des lots L1 à L5 est visuelle.

---

## 4. Lots de migration

Ordonnés par dépendance. Chaque lot est livrable et vérifiable seul.

### L0 — Identité visuelle et assets ✅ *fait*

1. Créer `public/` et y déplacer `trix-favicon.svg`, `trix-favicon-192.png`, `trix-icon.svg`,
   `trix-logo.svg`. **Nécessaire** : Vite ne copie pas dans `dist/` les fichiers laissés à la racine —
   ils fonctionneraient en dev et disparaîtraient au build.
2. `index.html` : `<link rel="icon" href="/trix-favicon.svg" type="image/svg+xml">` +
   `<link rel="apple-touch-icon" href="/trix-favicon-192.png">`.
3. `src/ui/logo.ts` : `<img>` à la place du SVG LSF inline, `alt="Trix"` dans la barre haute,
   `alt=""` partout où le logo est décoratif (RGAA 1.1/1.2).
4. Accueil : `trix-icon.svg` en 120 px + le nom en **texte** dans un `<h1>`.
   *Piège rencontré :* `trix-logo.svg` porte le mot-marque, ce qui semblait permettre de supprimer
   le titre texte — mais le mot y est peint en violet foncé et devient illisible dès que le thème
   sombre s'active, sans qu'aucune règle CSS puisse l'atteindre. Le texte d'un logo ne suit pas le
   thème : garder un vrai titre reste la seule option tenable tant qu'il n'existe pas de variante
   claire du logo. Le fichier reste dans `public/` pour les supports à fond clair.
5. Crédit **« Powered by FSL »** en pied d'accueil : `fsl-icon.svg` (36 px — en dessous, le
   diagramme d'états du logo n'est plus lisible) + lien vers le dépôt du framework, ouvert dans un
   onglet séparé (quitter la page couperait l'enregistrement SIP), l'intitulé accessible signalant
   la destination et la nouvelle fenêtre.
6. Vérifier `src/ui/alert.ts` : maintenant qu'un `<link rel="icon">` existe, `baseFavicon` n'est plus
   nul et `stopBlink()` **restaure** l'icône Trix au lieu de supprimer le lien. Garder les pastilles
   pleines vert/rouge pendant la sonnerie (plus lisibles qu'un logo à 16 px). Aucune ligne
   d'`alert.ts` n'était à changer : il lui manquait seulement quelque chose à restaurer.

*Recette (passée) :* les quatre assets sont dans `dist/` après build ; la séquence
capture → battement → restauration rend bien `/trix-favicon.svg` ; accueil et barre d'en-tête
vérifiés dans les deux thèmes ; le crédit FSL est atteignable au clavier, avec focus visible.

### L1 — Barre haute : chrono et annonces ✅ *fait*

1. Déplacer le chrono de la sidebar vers la barre haute (icône horloge + `00:04:12`, 16,8 px, gras),
   après les pastilles d'état. Supprimer `.time-row` et `.mute-flag` (le micro coupé se lit
   désormais sur le bouton rouge de la barre de surimpression).
2. Le titre de page reflète l'état : « Appel entrant — Paul », « En communication — 04:12 » (RGAA 8.9).
   Attention : `alert.ts` manipule déjà `document.title` pendant la sonnerie — un seul propriétaire du
   titre, sinon les deux se marchent dessus.
3. Zone `aria-live="polite"` pour l'état d'enregistrement et l'état d'appel ; le chrono n'est annoncé
   qu'à la minute, pas à la seconde.

*Recette (passée) :* le chrono tourne en barre haute ; la région d'annonce est `role="status"`
`aria-live="polite"`, invisible mais présente dans l'arbre d'accessibilité, et idempotente.
Scénario clé rejoué en console — décrocher **pendant** un battement de l'alerte laisse
« En communication — 00:00:01 » quand le clignotement rend la main, et non le titre figé au début
de la sonnerie : c'est exactement ce que l'ancien code aurait restauré.

### L1b — Regrouper les réglages dans l'écran de paramètres ✅ *fait*

L'écran d'appel porte aujourd'hui trois réglages qui n'ont rien à y faire : l'invite de permission,
le thème et la taille du texte. Ce lot en remonte deux dans `config.ts` et n'y laisse que celui qui
s'ajuste en situation.

1. **Structurer le formulaire en deux sections**, parce qu'elles n'obéissent pas aux mêmes règles :
   - *Compte SIP* — serveur, URI, display name, identifiant d'authentification, mot de passe.
     Persisté **chiffré** dans `AccountConfig`, appliqué à la validation du formulaire.
   - *Alertes et affichage* — persisté en **localStorage** (`prefs.ts`) ou porté par le navigateur,
     **appliqué immédiatement au clic**, jamais par « Enregistrer et se connecter ».
   Le dire explicitement dans l'UI : sans cette distinction, on laisse croire qu'annuler le
   formulaire annule aussi le changement de thème.
2. **« Activer les notifications »** (ex-« Activer les alertes système », retiré de la sidebar
   d'appel et de `.mdial`). Bouton + ligne d'état permanente selon `alertPermission()` :
   - `default` → bouton actif + « Sans notification, Trix ne peut pas vous alerter quand la fenêtre
     est masquée »
   - `granted` → « Notifications activées » (pas de bouton)
   - `denied` → « Notifications bloquées par le navigateur — à rétablir dans ses réglages de site »
   - `unsupported` → ligne masquée

   Le libellé « notifications » vaut mieux que « alertes système » : c'est le mot qu'emploie le
   navigateur dans sa propre invite, donc celui que l'utilisateur reconnaîtra. `requestAlertPermission()`
   exige un geste utilisateur — un clic dans le formulaire en est un, rien à changer côté `alert.ts`.
3. **Thème clair / sombre** : le sélecteur quitte `.sidefoot` et rejoint cette section. Passer de
   deux états à **trois** — Clair / Sombre / Système — car `prefs.ts` distingue déjà « aucun choix
   explicite » (on suit `prefers-color-scheme`) de « choix forcé », mais l'interrupteur actuel ne
   permet pas de **revenir** au suivi système une fois qu'on y a touché.
4. **Rassembler les alertes** : la case « Flash visuel à l'appel entrant » (déjà dans le formulaire)
   rejoint la même section que les notifications. Attention, elle reste l'exception qui confirme la
   règle du point 1 : c'est un réglage **du compte** (chiffré avec lui, il suit l'utilisateur d'un
   poste à l'autre) et non du navigateur — le signaler dans l'aide du champ.
5. **A− / A+ reste dans l'écran d'appel.** C'est le seul des trois qu'on ajuste *en situation* — pour
   lire un RTT qui défile, on agrandit pendant l'appel, pas avant. Le pied de sidebar ne garde donc
   que lui, désormais intitulé « Taille du texte ».
6. **Deux colonnes** (le formulaire dépassait la hauteur d'écran une fois enrichi) : coupure avant
   « Alertes et affichage », donc entre ce qui appartient au **compte** et ce qui appartient au
   **navigateur**. Réalisée en `columns: 2` avec un `break-before: column` explicite plutôt qu'en
   deux conteneurs : l'ordre de lecture, la tabulation et le lien titre → réglages restent ceux du
   DOM, seule la mise en page se scinde. Une colonne en dessous de 800 px.
7. **Vocabulaire** : « URI SIP » → **« Adresse SIP »**, « Display name » → **« Votre nom »**.
   Harmoniser partout, y compris les **messages d'erreur** de `phone.ts` (« Adresse SIP invalide »,
   « Adresse SIP, mot de passe ou identifiant d'authentification incorrect ») et les tests qui les
   vérifient — trois tests de `phone.test.ts` ont attrapé l'oubli.

*Conséquence à assumer :* le bouton Paramètres étant désactivé pendant un appel, thème et
notifications deviennent inaccessibles en communication. Acceptable pour deux réglages qu'on règle
une fois — et A− / A+, lui, reste sous la main.

*Recette (passée) :* thème appliqué au clic (`data-theme` + `localStorage`), **conservé après
« Annuler »** alors que le compte n'a pas bougé ; « Système » efface les deux et redevient
sélectionnable ; l'écran d'appel ne contient plus ni invite de permission ni sélecteur de thème, et
son pied annonce « Taille du texte ».

### L2 — Commandes média en surimpression ✅ *fait*

1. Nouveau module `overlay.ts` : barre de commandes commune aux vues bureau et mobile — pastille
   arrondie `rgba(255,255,255,.12)` + bordure claire, boutons ronds **44 px**, dégradé sombre en pied
   de scène. Fond opaque à 12 % minimum pour tenir 3:1 sur n'importe quelle image (RGAA 3.2).
2. Ordre : micro, caméra, self-view, haut-parleur, DTMF (désactivé, D1), repli du panneau (L3).
3. **Micro coupé** : fond `#E94E3C` plein + **icône barrée** + `aria-pressed="true"` + libellé
   « Rétablir le micro » — trois signaux, jamais la couleur seule (RGAA 3.3).
4. Supprimer `.mediabar` de la sidebar (bureau) et `.mcontrols` (mobile) au profit de ce module.
5. Vu-mètres : `bottom: 78px` pour ne pas passer sous la barre.

*Recette (passée) :* un seul module (`overlay.ts`) sert les deux vues ; le micro coupé reste
identifiable en niveaux de gris (icône barrée) ; le bouton Plein écran donne au clavier ce que seul
le double-clic offrait.

*Écarts par rapport au plan initial :*
- **`--red-surface` n'est pas nécessaire ici.** Le bouton « micro coupé » porte une **icône**, pas du
  texte : le seuil applicable est 3:1 (non-textuel), et `--red` mesure 3,74:1 sur blanc. Le rouge
  d'origine convient donc, et la palette corrigée (§7.2) reste due à L7 pour les boutons **à
  libellé**.
- **Une règle d'état à deux couleurs** est apparue, absente de la maquette qui ne montrait que le cas
  du micro : rouge = un flux coupé (micro, caméra, son), violet = une bascule locale (self-view).
  Sans elle, « self-view masqué » et « micro coupé » auraient partagé le même violet alors que l'un
  n'affecte que soi et l'autre toute la conversation.
- Le **badge « ph. 4 »** du DTMF disparaît (D1) : l'infobulle porte l'information.

### L3 — Panneau latéral repliable et redimensionnable ✅ *fait*

1. Bouton de repli en fin de barre de surimpression, infobulle qui annonce l'action à venir
   (« Afficher le tchat » replié, « Masquer le panneau latéral » déplié — D3).
2. État dans `prefs.ts` (`trix-panel`, `trix-panel-width`) — **pas** dans la machine : le format
   d'affichage ne change rien au protocole SIP, comme déjà tranché pour mobile/bureau
   (`docs/CONCEPTION.md` §4.5).
3. Poignée `col-resize` sur le bord gauche du panneau, largeur bornée `[300 px, 33 % de la fenêtre]`.
   Doubler le glisser d'un pilotage clavier (flèches quand la poignée a le focus) — sans quoi le
   redimensionnement est inaccessible au clavier.
4. Panneau replié : Raccrocher devient un rond rouge 56 px en fin de barre. **Raccrocher doit rester
   atteignable dans tous les états** — c'est la règle qui justifie ce bouton.

*Recette (passée) :* repli et largeur survivent au rechargement ; le glisser et les flèches donnent
la même chose, bornées à `[300 px, 33 %]` (`Origine`/`Fin` vont d'un bout à l'autre) ; l'ordre de
tabulation en communication est commandes média → repli → poignée → Raccrocher → historique →
préférences, avec un focus visible sur la poignée ; à 918 px de large (l'équivalent d'un zoom 200 %
sur un écran de 1845 px) la largeur retenue est ramenée à 306 px, la scène garde 612 px et **rien
ne déborde**. Recette jouée sur un banc de rendu jetable (faux `PhoneInstance` en communication),
faute de compte SIP sous la main ; les deux maquettes correspondantes sont dans `mockup.html`
(écrans 4 et 4bis).

*Écarts par rapport au plan initial :*
- **`aria-expanded`, et non `aria-pressed`.** Les deux sur le même bouton se contrediraient :
  « enfoncé » y voudrait dire « replié », donc « non déployé ». §7.4 demandait déjà `aria-expanded`,
  qui est le bon rôle — le bouton montre et masque une région, il ne bascule pas un réglage.
  Le violet de l'état actif (maquette 1c) reste porté par la seule classe CSS.
- **Le repli ne re-rend pas l'écran** : il bascule une classe sur la racine et le CSS fait le reste
  (sidebar masquée, rond rouge révélé). L'écran d'appel est reconstruit à chaque notification de la
  machine, mais un clic sur ce bouton n'en est pas une — passer par un rendu aurait demandé un
  chemin de re-rendu « UI pure » qui n'existe pas, et qui n'aurait servi qu'à ça.
- **Pas d'annonce vocale au repli.** La région `aria-live` appartient au chrono pendant la
  communication : y écrire ferait ré-annoncer « en communication depuis N minutes » à la seconde
  suivante (`announce()` ne filtre que la répétition immédiate). `aria-expanded` sur le bouton
  qu'on vient d'activer dit déjà l'état.
- **À 200 % de zoom, le panneau ne se replie pas tout seul** — il se ramène à sa borne basse et la
  vidéo n'est pas tronquée pour autant (elle est en `object-fit: contain`). Replier d'autorité
  écraserait une préférence explicite de l'utilisateur ; en dessous de 720 px, c'est de toute façon
  la vue mobile — sans panneau — qui prend le relais. L'esprit du critère (aucune perte de contenu)
  est tenu, la lettre du plan non.
- **Le repli n'est offert qu'en communication.** Hors appel le panneau porte le composeur, et
  pendant la sonnerie les boutons de réponse : le masquer laisserait un écran sans issue, puisque
  la barre de surimpression — donc le bouton pour le rouvrir — n'existe pas dans ces deux états.

*Piège rencontré :* le rond rouge fait de **Raccrocher la première action à exister en double** dans
un même gabarit. Le câblage de `wireCallScreen` prenait le premier `data-act` trouvé
(`querySelector`) : le rond capturait l'écouteur et le bouton de la sidebar restait inerte, déplié.
`on()` câble désormais **toutes** les occurrences (`querySelectorAll`) — un seul événement par clic,
et la règle « Raccrocher atteignable dans tous les états » redevient vraie dans les deux états.
À retenir pour L4 et L5, qui vont eux aussi doubler des commandes entre popup, sidebar et scène.

### L4 — Appel entrant en popup modale *(indépendant)*

1. Nouveau module `incoming.ts`, partagé bureau/mobile : voile `rgba(13,10,18,.55)` + carte 520 px
   (pleine largeur sur mobile), badge vert 64 px avec halo, sur-titre, nom 34 px, URI, boutons
   pleine largeur, phrase d'explication de l'offre.
2. Supprimer `.incoming-card` (scène bureau) et `.mincoming` (mobile).
3. Accessibilité (RGAA 7.x) : `role="dialog" aria-modal="true"`, focus déplacé sur la popup à
   l'ouverture, **focus piégé**, Échap = refuser, focus rendu au déclencheur à la fermeture.
4. Les réponses restent dérivées de `answerChoices(offered)` — 1g n'est que le cas « offre sans
   vidéo » de la même fonction. **Aucune règle nouvelle à écrire.**
5. Le cadre clignotant (`.callflash`) et les autres canaux d'alerte sont inchangés — vérifier
   seulement que la popup passe **au-dessus** du voile et **en dessous** du cadre.
6. L'invite de permission quitte l'écran d'appel — voir **L1b**.

*Recette :* la popup s'ouvre sur `ringing_in`, le focus y entre, Échap refuse, et le rendu est
identique sur les deux formats.

### L5 — Colonne tchat (gabarit seul) *(dépend de L3, D2)*

1. Structure : en-tête à icône, liste défilante (`<ul>`, RGAA 9.1), champ « Écrire un message… » +
   bouton rond Envoyer.
2. Bulles : distant = texte nu avec pastille d'initiale `#C9A9E0`, local = bulle `#EFEAF6` avec
   pastille `#7B54A0`. Dernière bulle distante en cours de composition marquée ✏️ (RTT).
3. Défilement : remonter suspend le suivi automatique, revenir en bas le rétablit, sans voler le focus.
4. Tant que la phase 4 n'est pas là : champ désactivé et mot d'explication à la place du bandeau
   « Tchat — disponible en phase 4 » supprimé de la sidebar.
5. `aria-live="polite"` sur la liste, annonce **par message achevé**, jamais par caractère.

*Recette :* la colonne se comporte comme une vraie conversation avec des messages de démonstration ;
elle défile, se replie et se redimensionne correctement.

### L6 — Modes sans vidéo *(dépend de L5)*

1. `CallMedia.text` (§3.1) et rétro-compatibilité de l'historique.
2. `CALL_MODES` : audio, audio + texte, vidéo, texte seul — le registre existe déjà et absorbe ces
   entrées sans toucher au reste de la chaîne.
3. Gabarit 1f : scène = tchat plein cadre sur fond sombre (texte 18 px), pas de self-view, pas de
   panneau, préférences en bas à gauche, commandes + Raccrocher en bas à droite.
4. La pastille d'état affiche le mode négocié : « En communication — audio + texte — … ».
5. **Hors périmètre :** permuter de mode en cours d'appel (re-INVITE) — phase 4/5.

*Recette :* un appel audio pur affiche la scène tchat et non un rectangle noir vide ; l'historique
d'un appel « texte seul » se relit correctement.

### L7 — Mise en conformité RGAA *(transverse — voir §7 pour le détail chiffré)*

Ce lot n'est pas une passe finale : chacune de ses corrections a un lot d'accueil naturel
(tableau §7.5). Ce qui ne se rattache à aucun autre lot et forme le résidu de L7 :

1. **Palette corrigée** (§7.2) — deux couleurs de fond de bouton et une bordure de champ à changer,
   plus un jeu de variables `--*-surface` / `--*-signal` pour ne plus confondre « fond qui porte du
   texte blanc » et « pastille qui porte un signal ».
2. **Structure** : un `<h1>` par écran, régions `<header>` / `<main>` / `<aside>`, historique et
   tchat en `<ul>`.
3. **Messages d'état** : `aria-live="polite"` pour l'état d'enregistrement, l'état d'appel et le
   chrono (annonce à la minute).
4. **Raccourcis** M / C / T / Échap, documentés, non conflictuels, **toujours doublés d'un bouton
   visible**, et désactivés quand le focus est dans un champ de saisie.
5. **Ordre de tabulation** : bandeau → scène → commandes média → raccrocher → tchat → préférences.

### L8 — Documentation et maquettes *(clôture)*

1. `docs/SPECS.md` et `docs/CONCEPTION.md` : décrire la nouvelle disposition, le panneau repliable,
   la popup d'appel entrant, et acter D1 à D6 dans « Questions ouvertes ».
2. `docs/mockups/mockup.html` : le remettre au niveau du code après chaque lot — c'est la maquette
   « telle qu'implémentée », le nouveau fichier reste la cible.
3. `README.md` : la phase 3 gagne « appel entrant en popup accessible » ; la phase 4 précise le RTT
   en colonne.

---

## 5. Ordre conseillé et risques

```
L0 ──> L2 ──> L3 ──> L5 ──> L6
   └─> L1                          (L7 en continu, L8 en clôture)

L1b ─┐                             indépendants : peuvent partir en parallèle,
L4 ──┘                             mais L1b avant L4 (l'invite doit avoir sa
                                   nouvelle place avant de quitter l'ancienne)
```

| Risque | Portée | Parade |
|---|---|---|
| `parts.ts` devient ingérable pendant la refonte | Élevée | Découper **avant** L2, pas pendant |
| Deux propriétaires de `document.title` (L1 vs `alert.ts`) | Moyenne | Un seul module écrit le titre ; `alert.ts` empile son état et le rend |
| `CallMedia.text` casse tous les littéraux du code et des tests | Moyenne | Champ optionnel à la lecture, requis à l'écriture ; le compilateur liste les sites |
| Poids des SVG (263 Ko) sur le premier rendu | Faible | `<img>` + cache, jamais d'inline (D6) |
| Aucun test de rendu : les régressions visuelles passent | Moyenne | Recette manuelle par lot sur `mockup.html`, mis à jour à chaque étape |
| Le vert et le rouge conformes (§7.2) sont plus sombres : la maquette validée change d'aspect | Faible | Écart volontaire et mesuré ; répercuter les nouvelles valeurs dans `trix-call-screen-mockups.html` pour que maquette et code restent d'accord |

## 6. Reste en phase 4

Transport RTT sur data channel (T.140), DTMF, permutation de mode en cours d'appel (re-INVITE),
et l'historique éventuellement réaffiché pendant l'appel (D3).

---

## 7. Conformité RGAA — modifications de design

### 7.1 Quel niveau

Le RGAA n'a pas de niveau qui lui soit propre : il transpose WCAG 2.1 et se lit en niveaux **A** et
**AA**. Deux repères pour trancher :

- **Le minimum opposable en France est AA**, pas A (article 47 de la loi 2005-102, décret 2019-768) —
  c'est aussi ce que vise la maquette (écran 2a).
- Le niveau **A** est le socle sans lequel l'application est *inutilisable* pour une partie du public,
  pas seulement non conforme.

Ce document marque donc chaque correction **[A]** ou **[AA]**. Si vous voulez le strict minimum
d'abord, faites tout le **[A]** — c'est peu de travail et cela couvre les vrais blocages. Le **[AA]**
est presque entièrement une affaire de couleurs, donc bon marché aussi, et c'est lui qui est exigible.

Rappel de contexte : Trix s'adresse d'abord à des personnes sourdes. Les critères qui portent le
risque réel ici ne sont pas les alternatives audio (peu applicables) mais **l'alerte d'appel entrant,
le clavier, et le texte temps réel**.

### 7.2 Contrastes — mesures et correctifs

Ratios calculés sur la palette FSL de `theme.css` (formule WCAG 2.x). **Ce qui échoue :**

| Élément | Mesuré | Requis | Verdict |
|---|---|---|---|
| Texte blanc sur `--green` `#36AD45` — *Appeler, Répondre* | **2,91:1** | 4,5:1 | ✗ échoue même au seuil 3:1 du texte large |
| Texte blanc sur `--red` `#E94E3C` — *Raccrocher, Refuser* | **3,74:1** | 4,5:1 | ✗ (passe seulement en ≥ 18,7 px gras) |
| Texte blanc sur `--accent` `#A97FD1` — **thème sombre** | **3,16:1** | 4,5:1 | ✗ *Enregistrer et se connecter* |
| Bordure de champ `--border` sur `--panel` (clair / sombre) | **1,40:1** / 1,30:1 | 3:1 | ✗ les champs n'ont pas de contour perceptible |
| Pastilles `.dot.ok` / `.dot.warn` sur `--panel-2` — **thème clair** | **2,46:1** | 3:1 | ✗ (atténué : le libellé texte accompagne la pastille) |

Tout le reste passe, et souvent largement : `--ink` 10,6 à 12,6:1 · `--ink-soft` 5,1 à 6,1:1 même à
11,5 px · `--accent` en lien 5,3 à 5,8:1 · toute la scène vidéo (`#8f83a3` 5,56:1, `#cfc4de` 11,8:1) ·
tout le thème sombre côté texte. **La palette est saine ; ce sont les surfaces d'action qui pèchent.**

**Correctif de design — séparer « surface » et « signal ».** La même variable sert aujourd'hui à
peindre un fond de bouton (qui doit porter du texte blanc, 4,5:1) et une pastille de 9 px (qui doit
seulement se détacher, 3:1). Deux besoins, deux variables :

```css
/* fond d'action portant du texte blanc — 4,5:1 */
--green-surface: #2A8736;   /* 4,55:1 (remplace #36AD45 sous du texte) */
--red-surface:   #E22E19;   /* 4,53:1 (remplace #E94E3C sous du texte) */
/* signal coloré sans texte : pastilles, icônes d'historique, bordures — 3:1 */
--green-signal:  #309B3E;   /* 3,02:1 sur --panel-2 clair */
--orange-signal: #C27520;   /* 3,03:1 sur --panel-2 clair */
--red-signal:    #E94E3C;   /* 3,16:1 — inchangé, il passait déjà */
/* contour des champs et boutons secondaires, distinct des séparateurs décoratifs */
--field-border:  #9C83BE;   /* 3,00:1 sur --ground, 3,28:1 sur --panel */
```

En **thème sombre**, `--green-surface` / `--red-surface` conviennent tels quels, et deux ajustements
propres au thème :

```css
--field-border: #795AA3;    /* 3,01:1 sur --panel, 3,37:1 sur --ground */
/* bouton primaire : texte foncé sur accent clair plutôt que blanc */
.btn.primary { color: var(--panel); }   /* #241933 sur #A97FD1 = 5,26:1 */
```

`--border` reste tel quel pour les **séparateurs décoratifs** (1.4.11 ne s'y applique pas) ; seuls les
contours de champs, de boutons secondaires et la poignée de redimensionnement passent à
`--field-border`.

**Variante possible pour le rouge :** `#E94E3C` atteint 3,74:1, donc suffit **si le libellé est en
≥ 18,7 px gras** — ce que fait déjà la popup 1e (19 px / 600). Vous pouvez donc garder le rouge
d'origine sur les gros boutons et n'utiliser `--red-surface` que sur les petits. Je recommande
l'inverse — une seule valeur, conforme partout — parce que la règle « ça dépend de la taille du
libellé » ne survit jamais longtemps à la maintenance.

### 7.3 Défauts structurels du code actuel

Repérés dans le code, indépendamment de la maquette :

| # | Constat | Critère | Correctif de design |
|---|---|---|---|
| C1 | `#f-auth` (identifiant d'authentification) **n'a aucune étiquette** : le `<label for="f-auth-toggle">` désigne la case, pas le champ | 3.3.2 **[A]** | Un `<label for="f-auth">` propre — « Identifiant d'authentification » — la case gardant le sien |
| C2 | Les lignes d'historique sont des `<div>` cliquables : **inatteignables au clavier** | 2.1.1 **[A]** | Chaque ligne devient un `<button>` (ou `role="button" tabindex="0"` + Entrée/Espace), avec un intitulé explicite « Rappeler paul@… » |
| C3 | Le plein écran n'existe **qu'au double-clic** sur la vidéo | 2.1.1 **[A]** | Bouton « Plein écran » dans la barre de surimpression (L2), le double-clic restant un raccourci |
| C4 | Le champ fautif du formulaire n'est signalé que par une **bordure rouge** | 1.4.1 **[A]** | Message texte sous le champ + `aria-invalid="true"` + `aria-describedby` vers ce message |
| C5 | `.error-banner` apparaît sans être annoncé | 3.3.1 **[A]** / 4.1.3 **[AA]** | `role="alert"` sur la bannière, focus porté sur le premier champ fautif |
| C6 | Aucun `<h1>` ; l'écran de config commence à `<h2>` | 1.3.1 **[A]** | Un `<h1>` par écran (« Écran d'appel », « Configuration du compte SIP »), visible ou en classe `.visually-hidden` |
| C7 | `.dot.warn` et `.dot.live` **clignotent indéfiniment** (`pulse … infinite`) | 2.2.2 **[A]** | Supprimer l'animation, ou la borner à ~5 s. Le clignotement n'apporte rien : le libellé dit déjà « Reconnexion… ». **Le flash d'appel entrant, lui, reste** : il relève de l'exception « essentiel », il est débrayable dans les paramètres, il s'arrête à la réponse et il respecte `prefers-reduced-motion` |
| C8 | Le menu de mode d'appel n'a pas de `role="menu"` ni `aria-haspopup` sur le déclencheur | 4.1.2 **[A]** | Compléter : `aria-haspopup="true"` sur le caret, `role="menu"` sur `.dropdown`, navigation par flèches |
| C9 | Le titre de page ne reflète pas l'état (sauf pendant la sonnerie) | 2.4.2 **[A]** | Voir L1 — **un seul propriétaire du titre** |
| C10 | Aucune zone `aria-live` : changements d'état silencieux | 4.1.3 **[AA]** | Voir L7 |
| C11 | `:focus-visible` n'est stylé que sur `.btn`, `.iconbtn`, `.field input` | 2.4.7 **[AA]** | Étendre à `.linkbtn`, `.switch`, `.fontsize button`, `.dropdown button`, lignes d'historique, poignée de panneau. Contour 2 px `--accent` + `outline-offset: 2px`, déjà en place ailleurs |

### 7.4 Règles à appliquer aux écrans nouveaux de la maquette

| Écran | Règle |
|---|---|
| Popup d'appel entrant (1e/1g) | `role="dialog" aria-modal="true"` + `aria-labelledby` sur le nom de l'appelant · focus déplacé dans la popup, **piégé** tant qu'elle est ouverte, rendu au déclencheur ensuite · Échap = refuser · le voile ne ferme pas au clic (une erreur de clic ne doit pas raccrocher) **[A]** |
| Commandes en surimpression (1b/1c/1f) | Fond opaque ≥ 12 % pour tenir 3:1 sur n'importe quelle image **[AA]** · micro coupé signalé par **trois** moyens — fond rouge, icône barrée, `aria-pressed="true"` — jamais la couleur seule **[A]** · libellé qui décrit l'action à venir (« Rétablir le micro ») |
| Panneau repliable (1b/1c) | La poignée est **atteignable au clavier** et pilotable aux flèches ; sans cela le redimensionnement est réservé à la souris **[A]** · le bouton de repli porte `aria-expanded` · Raccrocher reste atteignable dans les deux états |
| Colonne tchat (1b/1f) | Champ de saisie **étiqueté** (le placeholder ne suffit pas) **[A]** · liste en `<ul>` **[A]** · `aria-live="polite"` annonçant **par message achevé, jamais par caractère** — sinon le RTT rend le lecteur d'écran inutilisable **[AA]** · remonter suspend le suivi automatique sans voler le focus |
| Barre haute (1b) | Chrono annoncé à la minute, pas à la seconde **[AA]** |
| Cibles tactiles | Les 44 px de la maquette relèvent du **AAA** (WCAG 2.5.5) ; le seuil exigible est **24 px** (2.5.8, AA). Les `iconbtn` à 38 px et les A−/A+ à 30×26 px sont donc **déjà conformes** — les 44 px restent un gain de confort mobile, pas une obligation |

### 7.5 Où chaque correction atterrit

| Lot | Corrections rattachées |
|---|---|
| L0 | `alt="Trix"` sur le logo de bandeau, `alt=""` sur les logos décoratifs **[A]** |
| L1 | C9 (titre de page), amorce de la zone `aria-live` |
| L1b | C4, C5 (erreurs de formulaire), C1 (étiquette manquante), C11 sur les nouveaux contrôles |
| L2 | C3 (bouton plein écran), micro coupé à trois signaux, contraste de la barre en surimpression |
| L3 | Poignée au clavier, `aria-expanded` du repli |
| L4 | Popup modale complète (§7.4) |
| L5 | Étiquette du champ tchat, `<ul>`, `aria-live` par message |
| L6 | Rien de spécifique |
| L7 | Palette §7.2, C2, C6, C7, C8, C10, C11, raccourcis, ordre de tabulation |

**Recette de conformité :** parcourir chaque écran **au clavier seul** (aucun piège, tout atteignable,
focus toujours visible), puis en **niveaux de gris** (aucune information perdue), puis à **200 % de
zoom** (aucune perte de contenu). Ces trois passes attrapent l'essentiel de ce qui précède.
