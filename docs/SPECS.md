# Spécification — Trix Communicator (Webphone conversation totale)

**Statut :** phases 0 à 4bis livrées, présence (phase 6) livrée, messagerie à faire
**Propriétaire :** Emmanuel Buu / IVèS
**Créée le :** 2026-08-15
**Dernière mise à jour :** 2026-09-29 (plan d'implémentation : deuxième compte, partage, présence)

## Vue d'ensemble

Trix Communicator est un webphone SIP « conversation totale » (audio + vidéo + texte temps réel)
fonctionnant dans un navigateur, aux couleurs du projet FSL/LSF (palette violette).

La logique applicative est structurée en machines à états avec le framework
[finite-state-language](https://github.com/neutrino38/finite-state-language/) (FSL),
la signalisation SIP repose sur JsSIP (SIP sur WebSocket sécurisé). L'appel est un
**bloc de service** (SBB) autonome, entré et rendu par la machine hôte.

Documentation associée : `docs/CONCEPTION.md` (conception technique),
`docs/DIAGRAMS.md` (diagrammes générés depuis le code), `docs/mockups/mockup.html`
(maquettes vivantes, qui chargent la feuille de style de l'application),
`USERGUIDE.md` (guide utilisateur, en anglais).

## Public visé et contrainte majeure

L'application s'adresse **à des développeurs de services**. Elle sert de bac à sable pour
tester des services télécom en conception universelle. Conséquence directe sur la
conception : **aucune information ne peut reposer sur le son seul**. La sonnerie d'appel
entrant n'est qu'un canal d'appoint ; l'alerte véritable est visuelle (et haptique sur
mobile). Voir « Alerte d'appel entrant » ci-dessous.

La même règle vaut pour la couleur : tout état signalé par une couleur l'est aussi par
une forme (icône barrée) ou par un mot (RGAA 3.1).

## Objectifs

- Webphone SIP complet : enregistrement, appels sortants et entrants, audio et vidéo.
- **Alerte d'appel entrant perceptible sans le son**, y compris application en arrière-plan.
- Trois écrans : accueil, configuration, appel — ce dernier en deux gabarits (bureau, mobile).
- Stockage local du compte SIP **sans stocker le mot de passe** (HA1 MD5 et SHA-256
  uniquement), chiffré, ainsi que de l'historique d'appels.
- Traversée de NAT configurable : STUN et TURN (TURN sur TLS compris).
- Interface multilingue (anglais, français, arabe moderne standard) avec écriture
  droite-à-gauche.
- Logique 100 % pilotée par machines à états FSL, observables (`toMermaid()`, journal
  de transitions, trace SIP).
- Outillage de diagnostic intégré : trace des paquets SIP, carnet de l'appel dans
  l'historique, statistiques média en direct et bilan de l'appel terminé.

## Non-objectifs

- Intégration / packaging Tauri : **reportée** (perspective future, contraintes documentées dans `CONCEPTION.md` §8).
- Tchat en phases 1–3 (bandeau grisé ; ajouté en phase 4 via data channel).
- Annuaire, transfert d'appel, enregistrement de conversation.
- Multi-comptes (un seul compte SIP configuré à la fois) et multi-appels
  (un seul appel à la fois, les autres sont refusés en 486 / 480).
- Support de navigateurs sans WebRTC.

## User Stories

### En tant qu'utilisateur, je veux configurer mon compte SIP afin de m'enregistrer sur mon proxy

**Critères d'acceptation :**
- [x] Formulaire : serveur SIP (URL WSS), **adresse SIP** (`user@domaine`, en un seul champ),
      nom affiché, identifiant d'authentification optionnel, mot de passe.
- [x] Le domaine est déduit de l'adresse SIP et sert de realm ; pas de champ séparé.
- [x] L'identifiant d'authentification ne se saisit qu'une fois la case cochée ; la mention
      « si différent de … » suit le userpart en cours de frappe.
- [x] À l'enregistrement, le HA1 (`MD5(identifiant:realm:mot de passe)`) est calculé et
      stocké ; le mot de passe n'est **jamais** persisté.
- [x] La **même** empreinte est calculée en SHA-256 (RFC 8760) et stockée à côté : c'est
      le serveur qui choisit l'algorithme de son défi, et les deux se rencontrent.
- [x] Un compte enregistré avant cette empreinte n'en a pas, et rien ne peut la lui
      fabriquer. Un défi SHA-256 reste alors **sans réponse**, et l'échec le dit en
      clair — « ressaisissez le mot de passe » — au lieu d'accuser les identifiants.
- [x] Le stockage local est chiffré (voir `CONCEPTION.md` §6).
- [x] Les champs sont pré-remplis si un compte existe déjà (mot de passe affiché comme
      « déjà défini » ; le laisser vide conserve le HA1 en place).
- [x] Le champ fautif est surligné et la cause affichée en clair au retour d'erreur.

### En tant qu'utilisateur, je veux traverser les NAT afin que le son passe entre deux réseaux privés

**Critères d'acceptation :**
- [x] Champs STUN et TURN (hôte ou hôte:port), identifiant et mot de passe TURN, case
      « TURN sur TLS » (`turns:`, port 5349 par défaut au lieu de 3478).
- [x] Les trois champs dépendants de TURN sont désactivés tant qu'aucun serveur n'est saisi.
- [x] Le mot de passe TURN, lui, est **conservé** chiffré : le relais réclame le secret
      lui-même à chaque appel, une empreinte n'y suffirait pas.
- [x] Réglage du compte (fourni par l'opérateur SIP au même titre que le proxy), donc
      persisté chiffré avec lui.

### En tant qu'utilisateur, je veux voir l'état d'enregistrement SIP afin de savoir si je peux appeler

**Critères d'acceptation :**
- [x] Indicateur permanent sur l'écran d'appel : pastille + libellé — Connexion…,
      Enregistrement…, Enregistré (vert), Reconnexion…, En veille, Échec (rouge),
      Déconnexion…
- [x] En cas d'échec : cause en clair, code SIP en petit, boutons « Réessayer » et
      « Corriger les réglages ».
- [x] Perte de connexion : reconnexion automatique périodique, sans action de l'utilisateur.
- [x] Veille / réveil de la machine : détectés par saut d'horloge, l'enregistrement est
      relâché puis repris (`ui/lifecycle.ts`).

### En tant qu'utilisateur, je veux appeler une adresse SIP en audio ou en vidéo

**Critères d'acceptation :**
- [x] Champ de saisie d'adresse SIP sur l'écran d'appel ; `Entrée` lance l'appel.
- [x] Une saisie sans `@` est complétée implicitement : `adresse` → `adresse@<domaine configuré>`.
- [x] Bouton principal scindé : le menu accolé choisit le **mode** (audio / vidéo) ; le
      mode retenu est mémorisé et rebaptise le bouton principal. L'appel ne part que par
      le bouton principal.
- [x] Pendant l'appel : chrono, mute micro, coupure caméra, masquage self-view,
      coupure du haut-parleur, plein écran, raccrocher.
- [x] DTMF (RFC 4733) : pavé 12 touches sur la scène vidéo, clavier physique, retour
      tonal local et écho à l'écran des tonalités réellement émises.

### En tant qu'utilisateur, je veux recevoir un appel

**Critères d'acceptation :**
- [x] Popup **modale** d'appel entrant avec identité de l'appelant (nom affiché du `From`,
      URI sinon) et sur-titre disant le média offert.
- [x] Refuser (bouton, ou Échap).
- [x] Répondre en audio + vidéo (uniquement si la vidéo est proposée par l'appelant).
- [x] Répondre en audio seul (sauf si l'appelant ne propose **que** la vidéo).
- [x] Les réponses proposées sont dérivées de la seule offre SDP de l'INVITE (`sip/sdp.ts`).
- [x] Le reste de l'écran est `inert` pendant la sonnerie ; le focus est piégé dans la popup.
- [x] Alerte perceptible sans le son (voir ci-dessous).

### En tant qu'utilisateur, je veux que la vidéo entre et sorte de l'appel de façon symétrique

En conversation totale, la vidéo est **dans** l'appel ou elle n'y est pas : elle n'est
jamais reçue par l'un sans être acceptée par l'autre.

**Critères d'acceptation :**
- [x] Un appel vidéo décroché en audio seul devient un appel audio **des deux côtés** :
      l'appelé ne reçoit pas l'image de l'appelant.
- [x] L'appelant en est informé par un message fugace : « Bob n'a pas accepté la vidéo ».
- [x] L'icône de la caméra est barrée tant que l'appel n'a pas de vidéo.
- [x] Un clic sur cette icône ajoute la vidéo à l'appel (re-INVITE) ; un clic quand elle
      est présente l'en retire. Il n'y a pas de « couper sa caméra » : cesser d'émettre
      son image, c'est retirer la vidéo de l'appel.
- [x] Si le distant refuse (488), message fugace « X refuse d'ajouter la vidéo à cet
      appel » — et l'appel continue tel qu'il était.
- [x] Recevoir une demande d'ajout de vidéo pose la question avant d'allumer la caméra
      (« X souhaite ajouter la vidéo » — Accepter / Refuser) ; refuser répond 488, ne pas
      répondre en 25 s aussi.

### Alerte d'appel entrant (accessibilité sourds et malentendants)

**Critères d'acceptation :**
- [x] Flash visuel pendant toute la sonnerie, sans masquer ni bloquer les boutons de réponse.
- [x] Cadence du flash très inférieure à trois flashs par seconde et sans rouge saturé (WCAG 2.3.1) ;
      sous `prefers-reduced-motion`, cadre permanent au lieu du clignotement.
- [x] Application en arrière-plan : titre d'onglet et favicon clignotants.
- [x] Fenêtre masquée ou minimisée : notification système persistante avec l'identité de
      l'appelant, permission demandée explicitement par l'utilisateur (jamais à l'improviste).
- [x] Mobile : vibration rythmée pendant la sonnerie.
- [x] L'écran ne s'éteint pas pendant la sonnerie (wake lock) — un flash sur écran éteint n'alerte personne.
- [x] Sonnerie audio de complément, synthétisée (WebAudio), à la cadence française.
- [x] Le flash est désactivable dans la configuration du compte (activé par défaut) ; le réglage
      est stocké chiffré **avec le compte**, il suit donc l'utilisateur et non le navigateur.
      Les autres canaux restent actifs — ils ne perturbent pas l'écran.

### En tant qu'utilisateur, je veux retrouver mes appels passés

**Critères d'acceptation :**
- [x] Historique par compte, chiffré, 50 entrées au plus, dans le panneau latéral.
- [x] Chaque ligne : sens (flèche), correspondant, caméra si vidéo, date/heure, durée et
      motif de fin (raccroché par vous / par le correspondant / coupé par le réseau) ou
      cause d'échec.
- [x] Issues distinguées : répondu, manqué, échec, annulé, interrompu.
- [x] Un clic sur une ligne pré-remplit le champ d'adresse pour rappeler.
- [x] Bouton « Effacer » de l'historique.
- [x] Les motifs sont stockés comme **messages différés** (clé + variables) : l'historique
      se relit dans la langue courante, même pour des appels passés dans une autre.

### En tant que développeur, je veux diagnostiquer un appel

**Critères d'acceptation :**
- [x] Case « Tracer les échanges SIP » (section Diagnostic des paramètres) : réglage
      **local**, à effet immédiat, y compris en pleine communication.
- [x] Cochée, chaque paquet envoyé et reçu est imprimé dans la console — entête sur une
      ligne, corps dans un groupe replié — et les transitions de machines avec.
- [x] Le **carnet** de l'appel (paquets + états traversés) est gardé avec sa ligne
      d'historique et se relit dans un dialogue modal, avec un bouton « Copier ».
- [x] Les **statistiques média** se découvrent depuis la pastille « En communication »
      (survol, focus **ou** clic, qui les fixe) : codec, débit et perte de chaque sens,
      sur une fenêtre glissante de 10 s.
- [x] L'appel terminé, le même bilan — mesuré sur toute sa durée — reste accessible depuis
      la **loupe** de sa ligne d'historique, avec un bouton « Copier ».
- [x] Trace et statistiques sont sous la même case : décochée, rien n'est prélevé et
      rien n'est conservé.

### En tant qu'utilisateur, je veux l'interface dans ma langue

**Critères d'acceptation :**
- [x] Anglais, français, arabe moderne standard ; « Automatique » suit la langue du
      navigateur et nomme la langue détectée.
- [x] Le sélecteur est présent à l'accueil (avant tout le reste) et dans les paramètres.
- [x] L'arabe retourne toute la mise en page (`dir="rtl"`), panneau latéral et poignée de
      redimensionnement compris.
- [x] Ajouter une langue = déposer un fichier dans `src/i18n/locales/` nommé d'après son
      tag BCP-47 ; la compilation échoue si un message de la référence française manque.

### En tant qu'utilisateur, je veux me déconnecter proprement

**Critères d'acceptation :**
- [x] Bouton de déconnexion sur l'écran d'appel : unREGISTER + fermeture WS → retour à l'écran d'accueil.
- [x] Bouton « Paramètres » sur l'écran d'appel : retour à l'écran de configuration (désenregistrement préalable).
- [x] Les deux sont désactivés pendant un appel.

## Conception UI/UX

Maquettes vivantes : `docs/mockups/mockup.html` — elles chargent `src/ui/theme.css` et
recopient le balisage de `src/ui/screens/`, elles ne peuvent donc pas diverger du rendu.

### Palette

Définie en variables CSS dans `src/ui/theme.css`, en deux jeux (clair et sombre).

| Rôle | Variable | Clair | Sombre |
|---|---|---|---|
| Fond général | `--ground` | `#F6F4FA` | `#17101F` |
| Panneaux | `--panel` / `--panel-2` | `#FFFFFF` / `#EFEAF6` | `#241933` / `#2E2140` |
| Texte fort / atténué | `--ink` / `--ink-soft` | `#3E2A56` / `#6E5A86` | `#EDE6F5` / `#B4A5C8` |
| Accent (icônes, liens) | `--accent` | `#7B54A0` | `#A97FD1` |
| Surbrillance | `--accent-soft` | `#C9A9E0` | `#6B4487` |
| Bordures | `--border` | `#DFD7EA` | `#3A2B4E` |
| Fond vidéo | `--video-bg` | `#0D0A12` | identique |
| Bouton Appeler | `--green` | `#36AD45` | identique |
| Avertissement | `--orange` | `#D98324` | identique |
| Bouton Raccrocher | `--red` | `#E94E3C` | identique |

Polices : Poppins / Nunito Sans / Segoe UI / system-ui.
Thème : trois choix — **Système** (défaut, suit le réglage de l'appareil), Clair, Sombre.
« Système » est une préférence à part entière, à laquelle on peut revenir.

États des boutons inactifs : opacité 0,5.

### Écran 1 — Accueil

- Logo du projet centré placeholder FSL en attendant).
- **La liste des comptes enregistrés — deux au plus** (ADR 0002). Chacun s'affiche avec son
  display name et son `user@domaine`, et porte deux actions : « Utiliser le compte »
  (primaire, s'enregistre et va à l'écran d'appel) et « Modifier » (écran 2 sur ce
  compte-là). Le premier compte de la liste est celui qui a servi en dernier.
- Bouton secondaire « Ajouter un compte » (écran 2, formulaire vide) — **absent dès que
  le second compte existe** : la limite se voit, elle ne se découvre pas sur un refus.
- Aucun compte enregistré : ni liste ni bouton « Utiliser », seul « Configurer un
  nouveau compte » en primaire, comme avant.

### Écran 2 — Configuration

Formulaire en **trois colonnes** (une seule en dessous de 800 px). La coupure sépare ce
qui appartient au compte (chiffré, appliqué à la validation) de ce qui appartient au
navigateur (immédiat).

**Colonne 1 — Compte SIP**

| Champ | Format / validation |
|---|---|
| Serveur SIP | URL WebSocket sécurisée, ex. `wss://sip.example.com:8443/ws` |
| Adresse SIP | `user@domaine`, avec ou sans préfixe `sip:` ; le domaine sert de realm |
| Votre nom | texte libre (nom affiché) |
| Identifiant d'authentification | facultatif, activé par une case ; par défaut le userpart de l'adresse |
| Mot de passe | masqué ; converti en HA1 (MD5 et SHA-256) à l'enregistrement, jamais stocké |

**Colonne 2 — Traversée de NAT**

| Champ | Format / validation |
|---|---|
| Serveur STUN | facultatif ; hôte ou hôte:port (3478 par défaut) |
| Serveur TURN | facultatif ; hôte ou hôte:port |
| Identifiant TURN | requis dès qu'un TURN est saisi |
| Mot de passe TURN | requis dès qu'un TURN est saisi ; **conservé** chiffré |
| TURN sur TLS | case à cocher ; `turns:` et port 5349 par défaut |

**Colonne 3 — Alertes, affichage et diagnostic**

| Réglage | Portée |
|---|---|
| Flash visuel à l'appel entrant | **compte** (chiffré), activé par défaut |
| Notifications système | navigateur ; bouton de demande de permission, état affiché |
| Thème (Système / Clair / Sombre) | navigateur, effet immédiat |
| Langue de l'interface | navigateur, effet immédiat |
| Tracer les échanges SIP | navigateur, effet immédiat, y compris en appel |

Le formulaire sert la **création** comme la **modification**, et dit lequel des deux : titre
« Nouveau compte » ou « Modifier le compte », ce dernier suivi du `user@domaine` concerné —
avec deux comptes, savoir lequel on est en train de changer n'est plus une évidence. Le compte
modifié n'est pas forcément celui qui est enregistré : on peut corriger le compte au repos
sans quitter l'autre (ADR 0002).

Une adresse SIP déjà prise par l'autre compte est **refusée** : deux entrées se disputeraient
le même registrar et le même correspondant à l'écran. Le message le dit et surligne le champ.

Boutons : « Enregistrer et se connecter » (primaire), « Annuler » (retour accueil), et —
sur un compte existant — **« Supprimer ce compte »**, qui efface son enregistrement chiffré
**et son historique d'appels**, conversations comprises. La suppression demande confirmation
et n'est proposée que là : l'UA y est déjà arrêté.
Note visible : « Le mot de passe n'est pas conservé ; seules ses empreintes (HA1 MD5 et SHA-256) sont stockées chiffrées. »

### Écran 3 — Appel (vue bureau)

- **Barre d'en-tête** : icône + nom, **indicateur d'enregistrement** (pastille + libellé,
  `user@domaine` quand enregistré), et en communication la **pastille d'appel** puis le
  **chrono** ; à droite, boutons « Paramètres » et « Se déconnecter », désactivés en appel.
  Trace SIP cochée, la pastille d'appel devient un bouton qui découvre les **statistiques
  média** au survol, au focus ou au clic (qui les fixe) — CONCEPTION §5.4.
- **Scène vidéo (flexible)** : vidéo distante plein cadre sur fond noir ; self-view incrusté
  en haut-gauche (~25 % de hauteur, coins arrondis) ; vu-mètres verticaux (distant et local,
  WebAudio) courant sur toute la hauteur ; overlay « Appel en cours… » / « Sonnerie… »
  pendant l'établissement. Double-clic = plein écran.
  Hors appel, la scène porte le message de repos, ou le diagnostic d'échec
  d'enregistrement et ses boutons d'action.
- **Barre de commandes en surimpression** (sur la scène, la même que la vue mobile) :
  micro, caméra, self-view, haut-parleur, DTMF, tchat, plein écran, repli
  du panneau ; le rond rouge « Raccrocher » à sa droite.
  Règle d'état : **rouge + icône barrée** quand un flux est coupé (micro, caméra, son) ;
  **violet** pour une bascule purement locale (self-view masqué). Le haut-parleur s'allume
  en vert quand le correspondant parle — indice visuel de son entrant.
- **Panneau latéral droit**, repliable et redimensionnable (300 px au minimum, un tiers de
  la fenêtre au maximum ; poignée pilotable à la souris **et** aux flèches du clavier) :
  - champ « Adresse SIP » (complétion `@domaine` implicite), figé pendant l'appel,
  - bouton scindé **« Appeler » + menu de mode (audio / vidéo)**,
  - bouton « Raccrocher » (rouge, en communication seulement),
  - **historique d'appels** (parchemin = carnet de trace, loupe = bilan média),
  - **fil de tchat temps réel** (T.140) pendant l'appel, à la place de l'historique,
    masqué tant que l'appel dure,
  - pied : taille du texte (A− / A+) — le seul réglage qu'on ajuste en cours de conversation.

- **Barre d'en-tête** : logo (retour accueil), **indicateur d'enregistrement** (pastille + libellé,
  suivi du `user@domaine` enregistré), bouton « Paramètres » (engrenage → écran 2),
  bouton « Se déconnecter » (→ écran 1). Deux comptes enregistrés : s'y ajoute le
  **bouton de bascule** vers l'autre, qui désenregistre puis enregistre celui-là (ADR 0002).
  Comme les deux précédents, il est **grisé dès qu'un appel est en cours** — de la première
  sonnerie au raccroché.
  En communication s'y ajoute la pastille d'appel ; trace SIP cochée, elle découvre au
  survol (ou au focus, ou au clic qui la fixe) les **statistiques média** — codec, débit
  et perte de chaque sens, sur une fenêtre glissante de 10 s (CONCEPTION §5.4).
  L'appel terminé, le même bilan — mesuré sur toute sa durée — reste accessible depuis
  la **loupe** de sa ligne d'historique, avec un bouton « Copier ».
- **Zone centrale (flexible)** : vidéo distante plein cadre sur fond noir ; self-view incrusté
  en haut-gauche (~25 % de hauteur, coins arrondis 10px) ; vu-mètres verticaux discrets ;
  overlay « Connexion… » pendant l'établissement. Double-clic = plein écran.
- **Barre inférieure (48px)** : ajouter/retirer la vidéo, masquer self-view, haut-parleur, clavier DTMF.
- **Sidebar droite (300px)** :
  - champ « Adresse SIP » (complétion `@domaine` implicite),
  - bouton **« Appeler » (vert, audio) + menu déroulant « Appel vidéo »**,
  - bouton « Raccrocher » (rouge, visible uniquement en communication),
  - chrono HH:MM:SS + mute micro,
  - zone tchat : le fil du texte temps réel pendant l'appel, à la place de
    l'historique — qui est masqué tant que l'appel dure (phase 4) ; hors appel, la
    mention « le tchat s'ouvre avec l'appel »,
  - pied : A-/A+ et interrupteur thème clair/foncé.

### Écran 3 — Appel (vue mobile)

Sous 720 px de large (ou `?layout=mobile`), et sans couper l'appel au basculement :

- barre haute réduite : pastille d'état, libellé, Paramètres, Déconnexion ;
- hors appel : champ d'adresse, bouton scindé, historique — ni vidéo ni contrôles média ;
- en appel : la vidéo prend l'écran, chrono incrusté, contrôles média en surimpression,
  raccrochage en rond rouge.

### Appel entrant (les deux vues)

Une **seule** popup modale, partagée bureau et mobile : sur-titre du média offert, nom de
l'appelant, URI si le nom ne la répète pas, boutons de réponse dérivés de l'offre, bouton
« Refuser ». Empilement : la popup passe au-dessus du voile et **en dessous** du cadre
clignotant de l'alerte, qui reste le signal principal.

## Plan d'implémentation

### Phase 0 : Specs & conception
- [x] Spécifications fonctionnelles + maquettes
- [x] Conception technique (`CONCEPTION.md`)
- [x] Contraintes de compatibilité Tauri documentées (intégration reportée)

### Phase 1 : Accueil + Configuration + REGISTER
- [x] Bootstrap Vite + TypeScript + FSL + JsSIP
- [x] Écrans accueil et configuration
- [x] Stockage chiffré (HA1), machine `PhoneMachine`, REGISTER avec indicateur d'état
- [x] Diagnostic d'erreurs d'enregistrement en clair + code SIP

### Phase 2 : Écran d'appel, sortant uniquement
- [x] Écran d'appel complet (tchat désactivé), vues bureau et mobile
- [x] `CallBlock` sortant (audio + vidéo), entré depuis `PhoneMachine` (`fx.sbb`)
- [x] Historique d'appels chiffré, reconnexion automatique, veille / réveil
- [x] Observabilité : export `toMermaid()` des machines + journal des transitions

### Phase 3 : Appels entrants
- [x] Refus / réponse audio+vidéo (si vidéo proposée) / réponse audio seul (sauf vidéo pure)
- [x] Réponses proposées dérivées de l'offre SDP de l'INVITE (`sip/sdp.ts`)
- [x] Un appel à la fois : INVITE refusé occupé en communication, indisponible ailleurs
- [x] Appels entrants dans l'historique (répondu / manqué / refusé)
- [x] Alerte multi-canal accessible : flash, onglet, notification système, vibration, wake lock
- [x] Flash désactivable depuis la configuration du compte, réglage persisté avec lui

### Phase 3bis : la vidéo entre et sort de l'appel
- [x] Réponse audio à une offre vidéo : flux vidéo refusé dans la réponse SDP (`sdp.withoutVideo`)
- [x] Médias réellement négociés lus sur la connexion, publiés par `sip:mediaChanged`
- [x] Ajout / retrait de la vidéo en cours d'appel par re-INVITE (`renegotiating`)
- [x] Demande d'ajout reçue : décision de l'utilisateur avant le 200 OK, 488 sinon (`video_offer`)
- [x] Messages fugaces de l'appel (`ui/toast.ts`), refus compris

### Phase 4 : DTMF + Tchat data channel
- [x] DTMF (RFC 4733) : pavé 12 touches sur la scène vidéo, clavier physique, retour
      sonore local, et **écho à l'écran des seules tonalités réellement parties**
      (accessibilité sourds — un DTMF ne s'entend ni ne se lit nulle part ailleurs)
- [x] Analyse `../generique/composants/tchat3`, composant équivalent sur data channel WebRTC
- [x] Texte temps réel T.140 : transport WebSocket (passerelles déployées) et canal de
      données RFC 8865, au choix du compte (`sip/rtt.ts`, `rttws.ts`, `rttdc.ts`, `rttsip.ts`)
- [x] Codec T.140 sans DOM : décodage incrémental du flux, couleurs reçues **remappées
      sur la palette du thème**, différentiel d'émission en graphèmes (`sip/t140.ts`)
- [x] Panneau de tchat : une bulle vivante par côté, champ de saisie et règle des deux
      secondes, alerte `BEL` sur les canaux de la phase 3, défilement jamais imposé
      (`ui/screens/call/chat.ts`) — appel sans image : le fil prend la place de la vidéo ;
      appel vidéo : sidebar sur bureau, sous l'image sur mobile
- [x] Historique des conversations : le fil rejoint la ligne d'appel, chiffré avec le
      compte, et se relit depuis sa bulle « T » avec « Copier » (`sip/transcript.ts`,
      `ui/chatdialog.ts`)
- [x] Export WebVTT de la conversation (`ui/subtitles.ts`) : calé sur le début de la
      communication, une bulle figée par entrée, locuteur balisé `<v …>`, remarques du
      fil en commentaires — le fichier se pose tel quel sur un enregistrement de l'appel

### Phase 4bis : deuxième compte SIP

- [x] Coffre en liste : `Vault { accounts, activeId }` en un enregistrement chiffré, historique
      nommé par l'identifiant du compte, migration du compte existant (CONCEPTION §6, ADR 0002)
- [x] `PhoneMachine` multi-comptes : compte actif, compte édité (`ctx.editing`), bascule,
      suppression d'un compte avec son historique
- [x] Écrans : liste à l'accueil (deux comptes au plus), formulaire création/modification
      avec suppression, bouton de bascule dans l'en-tête — grisé pendant l'appel

- [x] Partage d'un compte par lien : le compte entier dans une URL, créé sur l'autre appareil
      après confirmation, jamais l'historique (ADR 0004)

### Phase 6 : présence et fil Échanges
- [x] Contacts chiffrés avec le compte, ajoutés depuis l'historique ou à la main (ADR 0007, D7)
- [x] Présence des contacts : SUBSCRIBE/NOTIFY (RFC 6665, RFC 3856), PIDF + RPID lus par un
      seul module (`sip/pidf.ts`), cinq états et un « inconnu », glyphe toujours doublé du mot
- [x] Statut publié par PUBLISH greffé sur JsSIP (RFC 3903) : Disponible, Occupé, Absent,
      Ne pas déranger (appels refusés et notés « Refusé »), Invisible ; note ; deux règles
      automatiques (En communication, Absent après 10 min d'inactivité)
- [x] Prise en charge découverte à chaque enregistrement, jamais configurée : tout, abonnements
      seuls, rien (bandeau) ; un refus venu d'un autre domaine ne vaut que pour ce domaine ;
      `presence: "no"` dans `config.json` éteint tout
- [x] Présence périmée hors enregistrement : anneau pointillé, heure de la dernière nouvelle
- [x] Fil **Échanges** : un correspondant par ligne, présence et dernier événement, dépliable
      sur ses appels, bureau et mobile
- [ ] Messagerie instantanée (SIP MESSAGE, RFC 3428) dans le même fil — ADR à venir

### Hors phase — livré en cours de route
- [x] Internationalisation : anglais / français / québécois / japonais / chinois simplifié /
      arabe, détection automatique, RTL
- [x] Traversée de NAT : STUN, TURN, TURN sur TLS
- [x] Panneau latéral repliable et redimensionnable (souris et clavier)
- [x] Trace SIP en console, carnet de l'appel dans l'historique
- [x] Statistiques média en direct et bilan de l'appel terminé
- [x] Journalisation des défauts de machines sur la console (`ui/diagnostics.ts`)
- [x] Partage d'écran en cours d'appel (ADR 0005)
- [x] Endormissement de la page : désenregistrement et réveil, onglet en arrière-plan (ADR 0006)

### Phase 5 (future) : Tauri
- [ ] Option d'embarquement Tauri + paquet Ubuntu — **reportée**, contraintes en `CONCEPTION.md` §8

## Stratégie de tests

Vitest, exécution par `npm test`. Couverture actuelle (`test/`) :

| Fichier | Objet |
|---|---|
| `phone.test.ts`, `call.test.ts`, `answer.test.ts` | machines FSL, avec pile SIP factice |
| `store.test.ts`, `ha1.test.ts` | stockage chiffré (fake-indexeddb) et calcul des HA1 |
| `digest.test.ts` | réponse à un défi Digest SHA-256, et refus dit quand l'empreinte manque |
| `sdp.test.ts`, `ice.test.ts` | analyse de l'offre SDP, normalisation STUN/TURN |
| `trace.test.ts`, `record.test.ts`, `tracedialog.test.ts` | trace SIP, carnet d'appel, dialogue de relecture |
| `stats.test.ts` | fenêtre glissante et bilan média |
| `i18n.test.ts`, `langpicker.test.ts` | complétude des dictionnaires, sélecteur de langue |
| `diagnostics.test.ts` | remontée des défauts de machines en console |
| `diagrams.test.ts` | `docs/DIAGRAMS.md` conforme au code (échoue s'il diverge) |

Tests manuels E2E contre un proxy SIP réel : register, appels A/V entrants et sortants,
traversée de NAT via TURN.

## Métriques & critères de succès

- REGISTER réussi en < 3 s sur réseau nominal ; état toujours reflété à l'écran.
- Établissement d'appel sortant < 5 s après décroché.
- Diagrammes Mermaid générés depuis le code (`toMermaid()`) conformes aux diagrammes de
  conception — vérifié par `diagrams.test.ts`.

## Dépendances

- `finite-state-language` (npm, ^0.2.0, ESM only, zéro dépendance runtime)
- `jssip` (^3.13.8, SIP over WebSocket)
- Vite ^7 + TypeScript ^5.5, Vitest ^3, `fake-indexeddb` pour les tests
- Un proxy SIP WSS de test

## Risques & mitigations

| Risque | Impact | Probabilité | Mitigation |
|------|--------|------------|------------|
| Realm du serveur ≠ domaine configuré → HA1 invalide | Élevé | Moyenne | Le domaine de l'adresse SIP sert de realm ; en cas de 401, le diagnostic nomme la cause et le champ fautif est surligné |
| Serveur défiant en SHA-256 un compte d'avant cette empreinte | Moyen | Faible | Le défi reste sans réponse plutôt que faussement relevé ; l'échec nomme l'algorithme manquant et désigne le mot de passe à ressaisir (`CONCEPTION.md` §6.2) |
| API FSL encore jeune | Moyen | Moyenne | Ce projet est le premier consommateur réel ; épingler la version, remonter les besoins au framework |
| Stockage navigateur non inviolable (XSS) | Moyen | Faible | Clé WebCrypto non-extractible + CSP stricte ; voir `CONCEPTION.md` §6 |
| Trace et historique portent des adresses SIP | Moyen | Moyenne | Chiffrés au repos, effaçables ; l'aide du champ prévient de les retirer d'un rapport public |

## Questions ouvertes

- [x] Icône/logo définitif du projet. Intégré : la marque Trix vit dans `public/` —
   `trix-icon.svg` (accueil en 200 px et barre d'en-tête en 38 px), `trix-favicon.svg` +
   `trix-favicon-192.png` (onglet). Le nom du produit reste du **texte** et non une image :
   le mot-marque de `trix-logo.svg` est peint en violet foncé, illisible sur le fond du
   thème sombre. Ce fichier reste disponible dans `public/` pour les supports à fond clair.
   `fsl-icon.svg` sert de crédit « Powered by FSL » en pied d'accueil.
- [x] Faut-il un champ « realm » distinct du domaine dans la configuration ? Non :
   domaine = realm. Un identifiant d'authentification distinct est en revanche prévu.
- [x] Texte temps réel : T.140 sur data channel.
- [x] Nom produit définitif affiché dans l'UI : « Trix Communicator » (nom court « Trix »).
   Le dépôt s'appelle `trix-web-client` et le code n'emploie que le nom court `trix`.

## Références

- `docs/CONCEPTION.md` (conception technique)
- `docs/DIAGRAMS.md` (diagrammes générés depuis le code)
- `docs/mockups/mockup.html` (maquettes)
- `USERGUIDE.md` (guide utilisateur, en anglais)
- Framework FSL : https://github.com/neutrino38/finite-state-language/
- JsSIP : https://jssip.net/
