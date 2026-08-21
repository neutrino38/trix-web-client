# Spécification — Trix Communicator (Webphone conversation totale)

**Statut :** Brouillon
**Propriétaire :** Emmanuel Buu / IVèS
**Créée le :** 2026-08-15
**Dernière mise à jour :** 2026-08-20

## Vue d'ensemble

Trix Communicator est un webphone SIP « conversation totale » (audio + vidéo + texte temps réel)
fonctionnant dans un navigateur. Il s'inspire du layout de l'écran d'appel d'Elioz Connect,
rebrandé aux couleurs du projet FSL/LSF (palette violette du logo `fsl-logo.svg`).

La logique applicative est structurée en machines à états avec le framework
[finite-state-language](https://github.com/neutrino38/finite-state-language/) (FSL),
la signalisation SIP repose sur JsSIP (SIP sur WebSocket sécurisé).


## Public visé et contrainte majeure

L'application s'adresse **a des développeurs de service**. Elle sert de bac à sable pour tester
des service télécom en conception universelle. Conséquence
directe sur la conception : **aucune information ne peut reposer sur le son seul**. La
sonnerie d'appel entrant n'est qu'un canal d'appoint ; l'alerte véritable est visuelle
(et haptique sur mobile). Voir « Alerte d'appel entrant » ci-dessous.

## Objectifs

- Webphone SIP complet : enregistrement, appels sortants puis entrants, audio et vidéo.
- **Alerte d'appel entrant perceptible sans le son**, y compris application en arrière-plan.
- Trois écrans : accueil, configuration, appel.
- Stockage local du compte SIP **sans stocker le mot de passe** (HA1 uniquement), chiffré.
- Logique 100 % pilotée par machines à états FSL, observables (`toMermaid()`, logs de transitions).
- UI aux couleurs FSL, sans aucune référence visuelle ou textuelle à Elioz.

## Non-objectifs

- Intégration / packaging Tauri : **reportée** (perspective future, contraintes documentées dans `CONCEPTION.md`).
- Tchat en phases 1–3 (désactivé/grisé ; ajouté en phase 4 via data channel).
- Annuaire, transfert d'appel, enregistrement de conversation.
- Multi-comptes (un seul compte SIP configuré à la fois).
- Support de navigateurs sans WebRTC.

## User Stories

### En tant qu'utilisateur, je veux configurer mon compte SIP afin de m'enregistrer sur mon proxy

**Critères d'acceptation :**
- [ ] Formulaire : proxy SIP (URL WSS), domaine, display name, username, mot de passe.
- [ ] À l'enregistrement du formulaire, le HA1 (`MD5(username:realm:password)`) est calculé et stocké ; le mot de passe n'est **jamais** persisté.
- [ ] Le stockage local est chiffré (voir `CONCEPTION.md` §6).
- [ ] Les champs sont pré-remplis si un compte existe déjà (mot de passe affiché comme « déjà défini »).

### En tant qu'utilisateur, je veux voir l'état d'enregistrement SIP afin de savoir si je peux appeler

**Critères d'acceptation :**
- [ ] Indicateur permanent sur l'écran d'appel : Enregistré (vert) / Enregistrement… (orange) / Échec (rouge).
- [ ] En cas d'échec : cause affichée + bouton « Réessayer ».

### En tant qu'utilisateur, je veux appeler une adresse SIP en audio ou en vidéo

**Critères d'acceptation :**
- [ ] Champ de saisie d'adresse SIP sur l'écran d'appel.
- [ ] Une saisie sans `@` est complétée implicitement : `adresse` → `adresse@<domaine configuré>`.
- [ ] Bouton principal « Appeler » = appel **audio** ; menu déroulant accolé proposant « Appel vidéo ».
- [ ] Pendant l'appel : chrono, mute micro, ajout/retrait de la vidéo, masquage self-view, raccrocher.

### En tant qu'utilisateur, je veux recevoir un appel (phase 3)

**Critères d'acceptation :**
- [x] Notification d'appel entrant avec identité de l'appelant.
- [x] Refuser.
- [x] Répondre en audio + vidéo (uniquement si la vidéo est proposée par l'appelant).
- [x] Répondre en audio seul (sauf si l'appelant ne propose **que** la vidéo).
- [x] Alerte perceptible sans le son (voir « Alerte d'appel entrant »).

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
- [x] Le flash est désactivable dans la configuration du compte (activé par défaut) ; le réglage
      est stocké chiffré **avec le compte**, il suit donc l'utilisateur et non le navigateur.
      Les autres canaux restent actifs — ils ne perturbent pas l'écran.

### En tant qu'utilisateur, je veux me déconnecter proprement

**Critères d'acceptation :**
- [ ] Bouton de déconnexion sur l'écran d'appel : unREGISTER + fermeture WS → retour à l'écran d'accueil.
- [ ] Bouton « Paramètres » sur l'écran d'appel : retour à l'écran de configuration (désenregistrement préalable).

## Conception UI/UX

Mockup interactif : `docs/mockups/mockup.html` (les 3 écrans + variante en communication).

### Palette 

| Rôle | Elioz (avant) | FSL (après) |
|---|---|---|
| Accent principal / texte fort | `#422D4C` | `#3E2A56` |
| Accent secondaire (icônes, liens) | — | `#7B54A0` |
| Fond panneaux | `#F3F5FB` | `#F6F4FA` |
| Bordures, touches | `#D8DBE7` | `#DFD7EA` |
| Surbrillance | — | `#C9A9E0` |
| Bouton Appeler | `#36AD45` | conservé |
| Bouton Raccrocher | `#E94E3C` | conservé |
| Fond vidéo | `#000` | conservé |

Polices : Poppins / Nunito Sans / Segoe UI / system-ui (comme le wordmark FSL).
Thèmes clair et sombre (interrupteur, comme Elioz Connect).

### Écran 1 — Accueil

- Logo du projet centré placeholder FSL en attendant).
- Bouton primaire « Utiliser le compte » (affiché seulement si un compte est stocké, avec le
  display name / username en rappel).
- Bouton secondaire « Configurer un nouveau compte ».

### Écran 2 — Configuration

Formulaire vertical centré, 5 champs :

| Champ | Format / validation |
|---|---|
| Proxy SIP | URL WebSocket sécurisée, ex. `wss://sip.example.fr:8443/ws` |
| Domaine | nom de domaine SIP, ex. `example.fr` (sert aussi de realm pour le HA1) |
| Display name | texte libre |
| Username | user SIP (sans domaine) |
| Mot de passe | masqué ; converti en HA1 à l'enregistrement, jamais stocké |
| Flash visuel à l'appel entrant | case à cocher, **activée par défaut** ; réglage du compte (accessibilité) |

Réglages **locaux**, à effet immédiat et hors du compte : thème, langue, notifications
système, et « Tracer les échanges SIP » (section Diagnostic) — les paquets envoyés et
reçus s'affichent dans la console du navigateur, y compris en pleine communication
(CONCEPTION §5.2). La même case ouvre les **statistiques média** de l'appel en cours,
découvertes depuis la pastille « En communication » (CONCEPTION §5.4).

Boutons : « Enregistrer et se connecter » (primaire), « Annuler » (retour accueil).
Note visible : « Le mot de passe n'est pas conservé ; seule une empreinte (HA1) est stockée chiffrée. »

### Écran 3 — Appel 

Structure 2 zones 

- **Barre d'en-tête** : logo (retour accueil), **indicateur d'enregistrement** (pastille + libellé),
  bouton « Paramètres » (engrenage → écran 2), bouton « Se déconnecter » (→ écran 1).
  En communication s'y ajoute la pastille d'appel ; trace SIP cochée, elle découvre au
  survol (ou au focus, ou au clic qui la fixe) les **statistiques média** — codec, débit
  et perte de chaque sens, sur une fenêtre glissante de 10 s (CONCEPTION §5.4).
  L'appel terminé, le même bilan — mesuré sur toute sa durée — reste accessible depuis
  la **loupe** de sa ligne d'historique, avec un bouton « Copier ».
- **Zone centrale (flexible)** : vidéo distante plein cadre sur fond noir ; self-view incrusté
  en haut-gauche (~25 % de hauteur, coins arrondis 10px) ; vu-mètres verticaux discrets ;
  overlay « Connexion… » pendant l'établissement. Double-clic = plein écran.
- **Barre inférieure (48px)** : ajouter/retirer la vidéo, masquer self-view, haut-parleur, (DTMF — phase 4).
- **Sidebar droite (300px)** :
  - champ « Adresse SIP » (complétion `@domaine` implicite),
  - bouton **« Appeler » (vert, audio) + menu déroulant « Appel vidéo »**,
  - bouton « Raccrocher » (rouge, visible uniquement en communication),
  - chrono HH:MM:SS + mute micro,
  - zone tchat **grisée** avec mention « disponible en phase 4 »,
  - pied : A-/A+ et interrupteur thème clair/foncé.

États des boutons inactifs : opacité 0,5 (convention Elioz conservée).

### Suppression du branding Elioz

Aucune reprise de : titre « Elioz Connect », logos/icônes Elioz, liens elioz.fr /
eliozconnect-eu.dev.ives.fr, textes « Vous contactez », « Annuaire Connect »,
« Contacter Elioz », popup qualité de traduction, realm `visioassistance.net`.
Seul le **layout** (structure, dimensions, ergonomie) est repris.

## Plan d'implémentation

### Phase 0 : Specs & conception (ce document)
- [x] Spécifications fonctionnelles + mockups
- [x] Conception technique (`CONCEPTION.md`)
- [x] Contraintes de compatibilité Tauri documentées (intégration reportée)

### Phase 1 : Accueil + Configuration + REGISTER
- [x] Bootstrap Vite + TypeScript + FSL + JsSIP
- [x] Écrans accueil et configuration
- [x] Stockage chiffré (HA1), machine `PhoneMachine`, REGISTER OK avec indicateur d'état

### Phase 2 : Écran d'appel, sortant uniquement
- [x] Écran d'appel complet (tchat désactivé), vues bureau et mobile
- [x] `CallBlock` sortant (audio + vidéo), entré depuis `PhoneMachine` (`fx.sbb`)
- [x] Observabilité : export `toMermaid()` des machines + log des transitions

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
- [ ] DTMF (RFC 4733)
- [ ] Analyse `../generique/composants/tchat3`, composant équivalent sur data channel WebRTC

### Phase 5 (future) : Tauri
- [ ] Option d'embarquement Tauri + paquet Ubuntu — **reportée**, contraintes en `CONCEPTION.md` §8

## Stratégie de tests

- Tests unitaires Vitest des machines FSL avec pile SIP factice
  (modèle : `fsl-typescript/typescript/test/webphone.test.ts`).
- Tests unitaires du stockage chiffré et du calcul HA1.
- Tests manuels E2E contre un proxy SIP réel (Kamailio/Elixip) : register, appels A/V, DTMF.

## Métriques & critères de succès

- REGISTER réussi en < 3 s sur réseau nominal ; état toujours reflété à l'écran.
- Établissement d'appel sortant < 5 s après décroché.
- Diagrammes Mermaid générés depuis le code (`toMermaid()`) conformes aux diagrammes de conception.

## Dépendances

- `finite-state-language` (npm, v0.1.x, ESM only, zéro dépendance runtime)
- `jssip` (SIP over WebSocket)
- Vite + TypeScript
- Un proxy SIP WSS de test

## Risques & mitigations

| Risque | Impact | Probabilité | Mitigation |
|------|--------|------------|------------|
| Realm du serveur ≠ domaine configuré → HA1 invalide | Élevé | Moyenne | Champ realm optionnel ; en cas de 401 avec realm différent, redemander le mot de passe une fois et recalculer le HA1 |
| FSL v0.1.0, API « encore molle » | Moyen | Moyenne | Ce projet est le premier consommateur réel ; épingler la version, remonter les besoins au framework |
| Stockage navigateur non inviolable (XSS) | Moyen | Faible | Clé WebCrypto non-extractible + CSP stricte ; voir `CONCEPTION.md` §6 |

## Questions ouvertes

- [x] Icône/logo définitif du projet LSF (le propriétaire dispose d'une icône — à intégrer).
   Intégré : la marque Trix vit dans `public/` — `trix-icon.svg` (accueil en 120 px et barre
   d'en-tête en 38 px), `trix-favicon.svg` + `trix-favicon-192.png` (onglet). Le nom du produit
   reste du **texte** et non une image : le mot-marque de `trix-logo.svg` est peint en violet
   foncé, illisible sur le fond du thème sombre. Ce fichier reste disponible dans `public/` pour
   les supports à fond clair. `fsl-icon.svg` sert de crédit « Powered by FSL » en pied d'accueil
   (lien vers le dépôt du framework). Le placeholder « arcs LSF » de `src/ui/logo.ts` est supprimé.
- [x] Faut-il un champ « realm » distinct du domaine dans la configuration ? (défaut : realm = domaine)
   non. domain = realm
- [x] Texte temps réel : T.140 sur data channel 
- [x] Nom produit définitif affiché dans l'UI.
 « Trix Communicator » (nom court « Trix ») 
 s'appelle `trix-web-client` et le code n'emploie que le nom court `trix`.

## Références

- `docs/CONCEPTION.md` (conception technique)
- `docs/mockups/mockup.html` (maquettes) - validé !
- Framework FSL : https://github.com/neutrino38/finite-state-language/
- JsSIP : https://jssip.net/
