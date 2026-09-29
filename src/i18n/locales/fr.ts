/**
 * Dictionnaire français — **la langue de référence**.
 *
 * Ce fichier n'est pas une traduction parmi d'autres : son type est le
 * contrat que toutes les autres langues doivent honorer (`Dictionary`,
 * dérivé de `typeof messages` dans `../types.ts`). Une clé ajoutée ici et
 * oubliée ailleurs fait échouer `npm run build` — c'est le seul filet qui
 * empêche une langue de partir en lambeaux au fil des évolutions.
 *
 * Conventions :
 *
 * - clés plates en notation pointée, groupées par écran ou par domaine ;
 * - variables entre accolades — `{caller}` — substituées par `t()` ;
 * - pluriels en couples `.one` / `.other`, résolus par `tn()` via
 *   `Intl.PluralRules` : les langues qui comptent autrement déclarent leurs
 *   propres formes — l'arabe en a six (voir `ar.ts`) — sans que celle-ci
 *   bouge.
 *
 * Ce que l'on ne traduit **pas** : « Trix », « Powered by FSL », les codes
 * techniques (SIP 486, WSS_LOST) et les causes brutes remontées par JsSIP.
 * Un code d'erreur qui change de langue n'est plus cherchable.
 */

const messages = {
  // ---------------------------------------------------------------------
  // Choix de la langue
  // ---------------------------------------------------------------------
  "lang.label": "Langue de l'interface",
  "lang.auto": "Automatique (langue du navigateur)",
  /** Complète « Automatique » une fois la détection faite : « … — Français ». */
  "lang.autoDetected": "Automatique — {name}",
  "lang.hint": "« Automatique » suit la langue de votre navigateur.",

  // ---------------------------------------------------------------------
  // Titres d'onglet des écrans sans état de téléphone
  // ---------------------------------------------------------------------
  "screen.settings": "Paramètres",
  "screen.saving": "Enregistrement…",
  "screen.deleting": "Suppression…",

  // ---------------------------------------------------------------------
  // Écran d'accueil
  // ---------------------------------------------------------------------
  "home.tagline": "Webphone conversation totale",
  "home.useAccount": "Utiliser le compte",
  "home.newAccount": "Configurer un nouveau compte",
  "home.addAccount": "Ajouter un compte",
  "home.editAccount": "Modifier",
  /** Version du logiciel, en pied de l'accueil — voir `src/version.ts`. */
  "home.version": "Version {version}",
  "fsl.aria": "Powered by FSL — finite-state-language sur GitHub (nouvelle fenêtre)",

  // ---------------------------------------------------------------------
  // Écran de configuration
  // ---------------------------------------------------------------------
  "config.title": "Paramètres",
  "config.titleNew": "Nouveau compte",
  "config.section.account": "Compte SIP",
  "config.proxy": "Serveur SIP",
  "config.proxyPlaceholder": "wss://sip.example.fr:8443/ws",
  "config.uri": "Adresse SIP",
  "config.uriPlaceholder": "sip:alice@example.fr",
  "config.uriHint":
    "Avec ou sans le préfixe « sip: ». Le domaine sert de realm pour l'authentification.",
  /** Domaine imposé par le déploiement (`config.json`) : c'est le seul accepté. */
  "config.uriHintDomain":
    "Seules les adresses du domaine {domain} sont acceptées ici. Ce domaine sert de realm pour l'authentification.",
  "config.displayName": "Votre nom",
  /** `{user}` est un fragment HTML (le userpart en gras, suivi à la saisie). */
  "config.authToggle": "Identifiant d'authentification (si différent de {user})",
  "config.authUserDefault": "l'utilisateur de l'adresse",
  "config.password": "Mot de passe",
  "config.passwordSet": "•••••• (déjà défini)",
  "config.passwordKeep": "Laisser vide pour conserver le mot de passe actuel.",
  "config.share": "Partage du compte",
  "config.shareCopy": "Copier le lien de partage",
  "config.shareWarn":
    "Utiliser ce lien pour migrer votre compte vers un autre appareil.",
  "config.shareCopied": "Lien de partage copié",
  "config.shareManual": "Lien de partage, à copier",

  "config.advanced": "Réglages avancés",
  "config.section.nat": "Traversée de NAT",
  "config.natHint":
    "Serveurs permettant l'établissement des communications quand on appelle depuis un réseau privé relié à Internet via un NAT.",
  "config.stun": "Serveur STUN",
  "config.stunPlaceholder": "stun.example.fr:3478",
  "config.stunHint": "Facultatif. Hôte seul ou hôte:port — sans port, 3478 est utilisé.",
  "config.turn": "Serveur TURN",
  "config.turnPlaceholder": "turn.example.fr:3478",
  "config.turnHint":
    "Relais des flux média quand la connexion directe échoue. Laisser vide pour ne pas en utiliser.",
  "config.turnUser": "Identifiant TURN",
  "config.turnPass": "Mot de passe TURN",
  "config.turnPassKeep": "Laisser vide pour conserver le mot de passe actuel.",
  "config.turnTlsLabel": "TURN sur TLS",
  "config.turnTlsDesc":
    " — relais chiffré (« turns: »), qui passe là où seul le trafic TLS est autorisé",
  "config.turnTlsHint": "Sans port explicite, 5349 est alors utilisé au lieu de 3478.",

  "config.section.rtt": "Texte en temps réel",
  "config.rttHint": "Le texte s'écrit et se lit caractère par caractère pendant l'appel.",
  "config.rttTransport": "Transport",
  "config.rttNone": "Aucun",
  "config.rttNoneDesc": " — texte en temps réel désactivé",
  "config.rttWs": "Sur WebSocket",
  "config.rttWsDesc": " — le texte en temps réel est échangé sur une WebSocket (non standard)",
  "config.rttDc": "Sur canal de données",
  "config.rttDcDesc": " — texte en temps réel au standard RFC 8865",

  "config.section.alerts": "Alertes et affichage",
  "config.flashLabel": "Flash visuel à l'appel entrant",
  "config.flashDesc":
    " — l'écran clignote pendant la sonnerie, pour être alerté sans le son",
  "config.flashHint": "Enregistré avec le compte : il vous suit d'un poste à l'autre.",
  "config.notifications": "Notifications système",
  "config.notifEnable": "Activer les notifications",
  "config.notifHint":
    "Sans elles, Trix ne peut pas vous alerter quand la fenêtre est masquée ou réduite.",
  "config.notifOn": "Notifications activées",
  "config.notifBlocked": "Notifications bloquées par le navigateur",
  "config.notifBlockedHint":
    "À rétablir dans les réglages de site du navigateur : Trix ne peut pas redemander l'autorisation lui-même.",
  "config.theme": "Thème",
  "config.themeHint": "« Système » suit le réglage clair/sombre de votre appareil.",
  "theme.system": "Système",
  "theme.light": "Clair",
  "theme.dark": "Sombre",

  // Diagnostic — réglages locaux, jamais enregistrés avec le compte
  "config.section.diag": "Diagnostic",
  "config.traceLabel": "Tracer les échanges SIP",
  "config.traceDesc":
    " — chaque paquet envoyé et reçu, et les états par lesquels l'appel passe, s'affichent dans la console du navigateur",
  "config.traceHint":
    "Effet immédiat, même en pleine communication : ouvrez la console (F12) pour lire les paquets. Chaque appel garde aussi les siens dans son historique, chiffrés, jusqu'à ce que vous l'effaciez. Ils portent votre adresse SIP et celle de vos correspondants — à retirer d'un rapport de bogue public.",
  "config.save": "Enregistrer et se connecter",
  "config.saving": "Enregistrement…",
  "config.cancel": "Annuler",
  "config.delete": "Supprimer ce compte",
  "config.deleteConfirm": "Confirmer : supprimer {address} et son historique",

  // ---------------------------------------------------------------------
  // État du téléphone (pastille de la barre d'en-tête, titre d'onglet)
  // ---------------------------------------------------------------------
  "status.connecting": "Connexion…",
  "status.registering": "Enregistrement…",
  "status.ready": "Enregistré",
  "status.reconnecting": "Reconnexion…",
  "status.sleeping": "En veille",
  "status.sleepingSeen": "En veille — vos contacts vous voient hors ligne",
  "status.regFailed": "Échec d'enregistrement",
  "status.unregistering": "Déconnexion…",
  "status.switching": "Changement de compte…",
  "presence.available": "Disponible",
  "presence.busy": "Occupé",
  "presence.onThePhone": "En communication",
  "presence.away": "Absent",
  "presence.dnd": "Ne pas déranger",
  "presence.offline": "Hors ligne",
  "presence.unknown": "Présence inconnue",
  "presence.invisible": "Invisible",
  "presenceMenu.label": "Mon statut",
  "presenceMenu.seen": "Ce que voient vos contacts",
  "presenceMenu.busyHint": "Les appels arrivent normalement",
  "presenceMenu.dndHint": "Les appels entrants sont refusés et notés dans l'historique",
  "presenceMenu.invisibleHint": "Vous apparaissez hors ligne, mais restez joignable",
  "presenceMenu.note": "Note affichée à vos contacts",
  "presenceMenu.clearNote": "Effacer la note",
  "presenceMenu.auto": "Automatiquement",
  "presenceMenu.onThePhone": "« En communication » pendant un appel",
  "presenceMenu.onThePhoneHint": "Puis retour au statut choisi au raccroché",
  "presenceMenu.awayWhenIdle": "« Absent » après 10 min sans activité",
  "presenceMenu.sleepHint": "En veille, la page se désenregistre : vos contacts vous voient alors hors ligne, quel que soit ce choix.",
  "presenceMenu.noPublish": "Ce serveur ne diffuse pas votre statut : vos contacts ne le voient pas.",
  "announce.statusChanged": "Statut : {status}",
  "thread.title": "Échanges",
  "thread.subtitle": "contacts et appels",
  "thread.search": "Rechercher un contact",
  "thread.add": "Ajouter un contact",
  "thread.group.today": "Aujourd'hui",
  "thread.group.yesterday": "Hier",
  "thread.group.week": "Cette semaine",
  "thread.group.older": "Plus ancien",
  "thread.group.none": "Sans échange",
  "thread.notContact": "Pas dans vos contacts",
  "thread.addToContacts": "Ajouter aux contacts",
  "thread.stale": "{status}, vu à {time} — non actualisé",
  "thread.pending": "En attente de son accord",
  "thread.call": "Appeler {name}",
  "thread.noMatch": "Aucun échange ne correspond à cette recherche.",
  "thread.firstContact": "Ajoutez un contact pour savoir s'il est disponible avant d'appeler.",
  "thread.addLast": "Ajouter {name}",
  "thread.noPresence": "Ce serveur ne transmet pas la présence. Vos contacts restent disponibles pour appeler.",
  "thread.noCalls": "Aucun appel avec ce contact pour l'instant.",
  "thread.form.name": "Nom",
  "thread.form.address": "Adresse SIP ou numéro",
  "thread.form.save": "Ajouter",
  "thread.form.cancel": "Annuler",
  "thread.rename": "Renommer",
  "thread.renameSave": "Enregistrer",
  "thread.remove": "Retirer du carnet",
  "thread.yesterday": "hier",
  "call.contactHint": "{name} · {status}",

  // ---------------------------------------------------------------------
  // Joignabilité (ADR 0006) : ce que Trix dit quand il ne peut plus
  // recevoir d'appel — dans la page, dans l'onglet, et hors de la page
  // ---------------------------------------------------------------------
  "reach.none": "Vous ne pouvez pas recevoir d'appel.",
  "reach.title": "Injoignable — Trix",
  "reach.notifTitle": "Trix ne peut plus recevoir d'appel",
  "reach.notifFreeze":
    "Le navigateur a mis cet onglet en veille. Vous resterez injoignable tant que vous n'y reviendrez pas.",
  "reach.notifSystem":
    "L'ordinateur s'est mis en veille. Vous resterez injoignable jusqu'à son réveil.",
  "reach.notifOffline":
    "La connexion réseau est perdue. Vous resterez injoignable tant qu'elle ne sera pas rétablie.",
  "reach.notifDiscard":
    "Le navigateur a déchargé cet onglet pour libérer de la mémoire. Revenez sur Trix pour vous réenregistrer.",
  "reach.notifLost":
    "L'enregistrement est perdu. Vous resterez injoignable tant qu'il ne sera pas rétabli.",
  "reach.backTitle": "Trix peut de nouveau recevoir vos appels",
  "reach.back": "L'enregistrement a repris : vous êtes de nouveau joignable.",
  "reach.discarded":
    "Le navigateur a mis Trix en veille pour économiser de la mémoire : vous n'avez pas pu recevoir d'appel de {from} à {to}.",
  "reach.pinHint":
    "Pour l'éviter : épinglez cet onglet, et ajoutez Trix aux « sites toujours actifs » de votre navigateur.",
  "reach.dismiss": "Masquer ce message",

  // ---------------------------------------------------------------------
  // État de l'appel
  // ---------------------------------------------------------------------
  "call.dialing": "Appel en cours",
  "call.ringing": "Sonnerie",
  "call.earlyMedia": "Message du réseau",
  "call.ringingIn": "Appel entrant",
  "call.answering": "Connexion…",
  "call.connected": "En communication",
  "call.hangingup": "Fin d'appel",

  // ---------------------------------------------------------------------
  // Écran d'appel
  // ---------------------------------------------------------------------
  "call.targetLabel": "Adresse SIP",
  "call.callerLabel": "Appelant",
  "call.domainHint": "Sans « @ » : appellera &lt;adresse&gt;@{domain}",
  "call.idle": "Aucun appel en cours — saisissez une adresse SIP",
  "call.sleeping": "Veille — l'enregistrement reprendra au réveil",
  "call.sleepingShort": "Veille — reprise au réveil",
  "call.retryIn": "Nouvelle tentative de connexion dans 10 s…",
  "call.chooseMode": "Choisir le mode d'appel",
  "mode.audio.label": "Appel audio",
  "mode.audio.button": "Appeler en audio",
  "mode.video.label": "Appel vidéo",
  "mode.video.button": "Appeler en vidéo",
  "mode.text.label": "Appel texte",
  "mode.text.button": "Appeler en texte",
  "chat.strip": "Le tchat s'ouvre avec l'appel",
  "chat.stripRefused": "Texte temps réel non accepté par le correspondant",
  // ---------------------------------------------------------------------
  // Tchat texte temps réel (T.140)
  // ---------------------------------------------------------------------
  "chat.tab": "Tchat",
  "chat.aria": "Conversation avec {peer}",
  "chat.you": "Vous",
  "chat.typing": "en cours de frappe",
  /** Bulle figée annoncée aux lecteurs d'écran — jamais la bulle vivante. */
  "chat.announce": "{who} : {text}",
  "chat.jump.one": "Descendre — {n} message",
  "chat.jump.other": "Descendre — {n} messages",
  "chat.composerAria": "Message en texte temps réel",
  "chat.placeholder": "Écrivez — le texte part au fil de la frappe",
  "chat.placeholderClosed": "Texte indisponible sur cet appel",
  "chat.placeholderEarly": "Lecture seule tant que l'appel n'est pas décroché",
  "chat.enterHint": "Entrée fige la bulle",
  "chat.state.open": "Part au fil de la frappe",
  "chat.state.connecting": "Ouverture du texte temps réel…",
  "chat.state.lost": "Lien rompu — reprise en cours",
  "chat.state.closed": "Texte temps réel fermé",
  "chat.state.refused": "Ce correspondant ne prend pas le texte temps réel",
  "chat.state.pending": "Correction dans {s} s",
  "chat.note.opened": "Texte temps réel ouvert",
  "chat.note.lost": "Texte perdu pendant la coupure",
  "chat.note.broken": "Lien texte rompu — reprise en cours",
  "chat.note.closed": "Texte temps réel fermé",
  "chat.note.refused": "Ce correspondant ne prend pas le texte temps réel",
  "chat.note.alert": "Alerte reçue",

  /** Relecture de la conversation depuis l'historique (§4.9). */
  "chat.log.open": "Relire la conversation de cet appel",
  "chat.log.title": "Conversation — {target}",
  "chat.log.count.one": "{n} message",
  "chat.log.count.other": "{n} messages",
  "chat.log.copy": "Copier",
  "chat.log.copied": "Copié",
  "chat.log.copyFailed": "Copie refusée",
  "chat.log.export": "Exporter",
  "chat.log.exportFailed": "Export refusé",
  "chat.log.close": "Fermer",
  "chat.log.vttBase": "Temps comptés depuis le début de la communication — appel du {at}.",
  "chat.log.cut": "Début de la conversation non conservé",

  // ---------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------
  "action.settings": "Paramètres",
  "action.logout": "Se déconnecter",
  "action.retry": "Réessayer",
  "action.retryNow": "Réessayer maintenant",
  "action.fixSettings": "Corriger les paramètres",
  /** Suffixe d'infobulle des commandes désactivées pendant un appel. */
  "action.unavailableInCall": " (indisponible en appel)",
  "action.switchAccount": "Passer au compte {address}",

  // ---------------------------------------------------------------------
  // Commandes média (barre de surimpression)
  // ---------------------------------------------------------------------
  "ctrl.mic.aria": "Audio",
  "ctrl.mic.add": "Ajouter l'audio",
  "ctrl.mic.remove": "Retirer l'audio",
  "ctrl.cam.aria": "Vidéo",
  "ctrl.cam.add": "Ajouter la vidéo",
  "ctrl.cam.remove": "Retirer la vidéo",
  /**
   * **Le partage d'écran** (ADR 0005). Le bouton n'existe que là où la
   * machine sait capturer un écran — c'est la capacité qui décide, jamais
   * le gabarit (D8).
   */
  "ctrl.share.aria": "Partage d'écran",
  "ctrl.share.start": "Partager l'écran",
  "ctrl.share.stop": "Arrêter le partage",
  /**
   * **Un seul partage à la fois dans l'appel** (D9) : le bouton est grisé
   * pendant que le correspondant partage, et le libellé dit pourquoi — un
   * bouton grisé sans un mot est une porte fermée sans écriteau.
   */
  "ctrl.share.busy": "Le correspondant partage déjà son écran",
  "ctrl.media.pending": "Changement de média en cours…",
  "ctrl.media.last": "Impossible : l'appel ne transporterait plus rien",
  "ctrl.selfview.aria": "Self-view",
  "ctrl.selfview.hide": "Masquer le self-view",
  "ctrl.selfview.show": "Afficher le self-view",
  /**
   * **La permutation de la scène** (ADR 0005, D11). L'écran partagé prend
   * la grande surface, et le visage passe en vignette : remettre l'un ou
   * l'autre en grand est une bascule **locale** — rien ne part sur le fil,
   * et le correspondant continue de recevoir exactement la même chose.
   *
   * Le geste tactile — un appui sur la vignette — ne suffit pas : au
   * clavier il n'existe pas (RGAA 7.3), d'où ce bouton.
   */
  "share.stageAria": "Écran partagé par {peer}",
  /**
   * **Le zoom sur un écran reçu** (ADR 0005, question ouverte 3). Un écran
   * de bureau ramené à 360 px reste illisible : rien n'y est coupé, tout y
   * est trop petit. L'agrandissement est **local** — rien ne part sur le
   * fil, et le correspondant continue d'envoyer la même image.
   */
  "share.zoomGroup": "Zoom sur l'écran partagé",
  "share.zoomIn": "Agrandir l'écran partagé",
  "share.zoomOut": "Réduire l'écran partagé",
  "share.zoomReset": "Revenir à la taille d'origine",
  "share.zoomLevel": "{n} %",
  "share.zoomHint": "Pincez pour agrandir ; flèches du clavier pour déplacer",
  "ctrl.swap.aria": "Permuter l'écran et le visage",
  "ctrl.swap.screen": "Mettre l'écran en grand",
  "ctrl.swap.face": "Mettre le visage en grand",
  /**
   * L'écoute **sur ce poste**, et rien d'autre : le correspondant continue
   * de parler dans un appel intact. « Couper le son » ne disait pas de quel
   * son il s'agissait, et se confondait avec le retrait de l'audio, qui,
   * lui, se négocie et se voit d'en face (ADR 0003, D6).
   */
  "ctrl.speaker.aria": "Écoute sur ce poste",
  "ctrl.speaker.mute": "Couper l'écoute",
  "ctrl.speaker.unmute": "Rétablir l'écoute",
  "ctrl.dtmf.aria": "Clavier DTMF",
  "ctrl.dtmf.show": "Afficher le clavier DTMF",
  "ctrl.dtmf.hide": "Masquer le clavier DTMF",
  "ctrl.chat.aria": "Tchat",
  "ctrl.chat.show": "Afficher le tchat",
  "ctrl.chat.hide": "Masquer le tchat",
  "ctrl.chat.unavailable": "Texte temps réel non accepté par le correspondant",
  "ctrl.fullscreen": "Plein écran",
  "ctrl.hangup": "Raccrocher",
  "ctrl.pause": "Mettre en pause",
  "ctrl.pause.aria": "Pause",
  "ctrl.resume": "Reprendre",
  "pause.banner": "Vous êtes en pause",
  "pause.hint": "Votre micro et votre image sont arrêtés. Le texte, lui, continue de passer.",
  "pause.resume": "Reprendre",
  "pause.peer": "{peer} est en pause",
  /**
   * Les deux côtés du trait de la barre : ce qui change l'appel, et ce qui
   * ne change que ce poste. Intitulés de groupe, annoncés à la tabulation —
   * un séparateur visuel seul ne dirait rien à un lecteur d'écran.
   */
  "ctrl.group.call": "Médias de l'appel",
  "ctrl.group.device": "Ce poste",
  "ctrl.more": "Autres commandes",
  "sheet.title": "Autres commandes de l'appel",

  // ---------------------------------------------------------------------
  // Clavier DTMF
  // ---------------------------------------------------------------------
  "dtmf.aria": "Clavier DTMF",
  "dtmf.sent": "Tonalités envoyées",
  "dtmf.hint": "Composez sur les touches ou au clavier",
  "dtmf.keyAria": "Touche {key}",
  "dtmf.star": "étoile",
  "dtmf.hash": "dièse",

  // ---------------------------------------------------------------------
  // Vidéo demandée en cours d'appel
  // ---------------------------------------------------------------------
  "mediaask.video.title": "{peer} souhaite ajouter la vidéo",
  "mediaask.video.body": "Accepter allumera votre caméra.",
  "mediaask.video.accept": "Accepter la vidéo",
  "mediaask.audio.title": "{peer} souhaite ajouter l'audio",
  "mediaask.audio.body": "Accepter allumera votre micro.",
  "mediaask.audio.accept": "Accepter l'audio",
  "mediaask.both.title": "{peer} souhaite ajouter l'audio et la vidéo",
  "mediaask.both.body": "Accepter allumera votre micro et votre caméra.",
  "mediaask.both.accept": "Accepter les deux",
  /**
   * **L'écran partagé qui arrive** (ADR 0005, D5). La question ne se pose
   * pas pour la même raison que les autres : accepter n'allume aucun
   * capteur ici. Elle se pose pour une raison plus forte — un écran
   * partagé **prend la place de la langue des signes**, et sur un
   * téléphone il n'y a pas deux grandes surfaces.
   */
  "mediaask.share.title": "{peer} souhaite partager son écran",
  "mediaask.share.body": "Son écran prendra la grande surface, et son image passera en vignette. Refuser ne change rien à l'appel.",
  "mediaask.share.accept": "Voir l'écran",
  "mediaask.reject": "Refuser",

  // ---------------------------------------------------------------------
  // Messages fugaces de l'appel
  // ---------------------------------------------------------------------
  "notice.videoDeclined": "{peer} n'a pas accepté la vidéo",
  "notice.videoRefused": "{peer} refuse d'ajouter la vidéo à cet appel",
  "notice.videoAdded": "{peer} a ajouté la vidéo",
  "notice.videoRemoved": "{peer} a retiré la vidéo",
  "notice.videoDeclinedHere": "Vidéo refusée",
  "notice.videoUnavailable": "Impossible d'ajouter la vidéo pour le moment",
  /**
   * Le partage a sa propre phrase : rien de ce que l'appel transporte n'a
   * bougé, et parler de « la vidéo » ici ferait croire à la caméra qui
   * vient de s'éteindre (ADR 0005, D3).
   */
  "notice.shareRefused": "{peer} n'a pas accepté le partage d'écran",
  "notice.shareUnavailable": "Impossible de partager l'écran pour le moment",
  "notice.sharePeerStarted": "{peer} partage son écran",
  "notice.sharePeerStopped": "{peer} a cessé de partager son écran",
  "notice.shareDeclinedHere": "Partage refusé",
  "notice.audioDeclined": "{peer} n'a pas accepté l'audio",
  "notice.audioRefused": "{peer} refuse d'ajouter l'audio à cet appel",
  "notice.audioAdded": "{peer} a ajouté l'audio",
  "notice.audioRemoved": "{peer} a retiré l'audio",
  "notice.audioDeclinedHere": "Audio refusé",
  "notice.audioUnavailable": "Impossible d'ajouter l'audio pour le moment",
  "notice.dtmfFailed": "La tonalité {tone} n'a pas pu être envoyée",

  // ---------------------------------------------------------------------
  // Panneau latéral
  // ---------------------------------------------------------------------
  "panel.aria": "Panneau latéral",
  "panel.showChat": "Afficher le tchat",
  "panel.show": "Afficher le panneau latéral",
  "panel.hide": "Masquer le panneau latéral",
  "panel.handleAria": "Largeur du panneau",
  "panel.handleTitle": "Élargir le panneau — 33 % de la largeur au maximum",

  // ---------------------------------------------------------------------
  // Préférences d'affichage en cours d'appel
  // ---------------------------------------------------------------------
  "prefs.fontSize": "Taille du texte",
  "prefs.fontDown": "Réduire la taille du texte",
  "prefs.fontUp": "Augmenter la taille du texte",

  // ---------------------------------------------------------------------
  // Appel entrant (popup modale)
  // ---------------------------------------------------------------------
  "incoming.kicker.video": "APPEL VIDÉO ENTRANT",
  "incoming.kicker.audio": "APPEL AUDIO ENTRANT",
  "incoming.kicker.audioText": "APPEL AUDIO + TEXTE ENTRANT",
  "incoming.kicker.videoText": "APPEL VIDÉO + TEXTE ENTRANT",
  "incoming.kicker.text": "APPEL TEXTE ENTRANT",
  "incoming.answerVideo": "Répondre en vidéo",
  "incoming.answerAudio": "Répondre en audio",
  "incoming.answerText": "Répondre en texte",
  "incoming.reject": "Refuser",

  // ---------------------------------------------------------------------
  // Alerte d'appel entrant (titre d'onglet, notification système)
  // ---------------------------------------------------------------------
  "alert.title": "📞 Appel entrant — {caller}",
  "alert.notifTitle": "Appel entrant",
  "alert.notifVideo": "{caller} — appel vidéo",
  "alert.notifAudio": "{caller} — appel audio",
  "alert.notifText": "{caller} — appel texte",

  // ---------------------------------------------------------------------
  // Annonces aux lecteurs d'écran
  // ---------------------------------------------------------------------
  "announce.inCall.one": "En communication depuis {n} minute",
  "announce.inCall.other": "En communication depuis {n} minutes",

  // ---------------------------------------------------------------------
  // Historique d'appels
  // ---------------------------------------------------------------------
  "history.clear": "Effacer",
  "history.entryTitle": "{target} — {outcome}",

  // Carnet d'un appel : les paquets SIP gardés quand la trace était active
  "trace.open": "Voir les traces SIP de cet appel",
  "trace.title": "Traces SIP — {target}",
  "trace.count.one": "{n} paquet",
  "trace.count.other": "{n} paquets",
  "trace.sent": "envoyé",
  "trace.received": "reçu",
  "trace.error": "erreur WebRTC",
  "trace.copy": "Copier",
  "trace.copied": "Copié",
  "trace.copyFailed": "Copie refusée",
  "trace.close": "Fermer",
  "trace.clipped": "… (paquet tronqué)",
  "trace.truncated": "Trace interrompue : l'appel a dépassé ce qui est gardé par appel.",
  "outcome.answered": "Répondu",
  "outcome.missed": "Manqué",
  "outcome.failed": "Échec",
  "outcome.canceled": "Annulé",
  "outcome.dropped": "Interrompu",
  "outcome.declined": "Refusé",
  "endedBy.local": "raccroché par vous",
  "endedBy.remote": "raccroché par le correspondant",
  "endedBy.network": "coupé par le réseau",
  "duration.minSec": "{m} min {s} s",
  "duration.sec": "{s} s",

  // ---------------------------------------------------------------------
  // Statistiques média (survol de la pastille « En communication »)
  // ---------------------------------------------------------------------
  "stats.hint": "Statistiques média de l'appel",
  "stats.title": "Statistiques média",
  "stats.window": "moyenne sur {s} s",
  "stats.recv": "Reçu",
  "stats.sent": "Émis",
  "stats.audio": "Audio",
  "stats.video": "Vidéo",
  /**
   * **L'écran partagé a sa propre ligne** (ADR 0005, SC-5). Fondu dans
   * « Vidéo », son débit ferait passer pour excellente une caméra qui
   * n'envoie plus rien — et c'est exactement la question qu'on pose à cet
   * encart quand l'image hache.
   */
  "stats.share": "Écran partagé",
  "stats.text": "Texte",
  "stats.missing": "Texte manquant",
  "stats.codec": "Codec",
  "stats.bitrate": "Débit",
  "stats.loss": "Perte",
  "stats.rtt": "Aller-retour",
  "stats.sync": "Écart audio / vidéo",
  "stats.syncHint": "Sous {n} ms, la lecture labiale et la langue des signes restent confortables (F.703 §5.2.2).",
  "stats.lossNote": "Perte à l'émission d'après les rapports de réception du correspondant.",
  "stats.pending": "Mesure en cours…",
  "stats.none": "Aucun flux média mesuré",
  "stats.kbps": "{n} kbit/s",
  "stats.percent": "{n} %",
  "stats.ms": "{n} ms",
  "stats.khz": "{n} kHz",
  "stats.spanCall": "moyenne sur {d} mesurées",
  "stats.open": "Statistiques média de cet appel",
  "stats.callTitle": "Statistiques média — {target}",
  "stats.close": "Fermer",
  "stats.copy": "Copier",
  "stats.copied": "Copié",
  "stats.copyFailed": "Copie refusée",
  "selftest.section": "Micro et caméra",
  "selftest.open": "Tester mon micro et ma caméra",
  "selftest.sectionHint": "Un essai hors appel : mieux vaut découvrir un micro muet maintenant que pendant une conversation.",
  "selftest.title": "Test du micro et de la caméra",
  "selftest.sub": "Rien n'est envoyé : ce test reste sur cet appareil.",
  "selftest.close": "Fermer",
  "selftest.starting": "Ouverture des périphériques…",
  "selftest.hint": "Parlez : la barre doit bouger. Vous devez vous voir dans l'image.",
  "selftest.levelAria": "Niveau du micro",
  "selftest.mic": "Micro",
  "selftest.cam": "Caméra",
  "selftest.unnamed": "périphérique sans nom",
  "selftest.absent": "aucun",
  "selftest.noCamera": "Aucune caméra : le micro seul est testé.",
  "selftest.denied": "L'accès au micro et à la caméra a été refusé. Autorisez-le dans le navigateur, puis relancez le test.",
  "selftest.missing": "Aucun micro ni caméra détecté sur cet appareil.",
  "selftest.busy": "Le micro ou la caméra est déjà utilisé par une autre application.",
  "selftest.failed": "Test impossible : {detail}",

  // ---------------------------------------------------------------------
  // Erreurs des automates (écrites dans le contexte, rendues par l'UI)
  // ---------------------------------------------------------------------
  "error.invalidUri": "Adresse SIP invalide (attendu : utilisateur@domaine)",
  "error.wrongDomain": "Cette adresse doit être du domaine {domain}",
  "error.duplicateAccount": "{address} est déjà enregistré dans l'autre compte",
  "error.passwordRequired": "Mot de passe requis",
  "error.saveFailed": "Sauvegarde impossible : {detail}",
  "error.invalidProxy": "Nom du proxy invalide — vérifiez l'adresse WSS",
  "error.wssRefused": "Impossible de se connecter au proxy (connexion WSS refusée)",
  "error.wssTimeout": "Le proxy ne répond pas (timeout WebSocket)",
  "error.badCredentials": "Adresse SIP, mot de passe ou identifiant d'authentification incorrect",
  "error.missingSha256":
    "Ce serveur demande une authentification SHA-256, dont ce compte n'a pas l'empreinte. Ressaisissez le mot de passe pour la calculer.",
  "error.regRefused": "Enregistrement refusé : {cause}",
  "error.wssLostDuringReg": "Connexion perdue pendant l'enregistrement",
  "error.registrarTimeout": "Le registrar ne répond pas",
  "error.regLost": "Enregistrement perdu : {cause}",
  "error.proxyLost": "Connexion au proxy perdue",
  "error.proxyLostDuringCall": "Connexion au proxy perdue pendant l'appel",
  "error.callDropped": "Appel interrompu — connexion au proxy perdue",
  "error.stunInvalid": "Serveur STUN invalide (attendu : hôte ou hôte:port)",
  "error.turnInvalid": "Serveur TURN invalide (attendu : hôte ou hôte:port)",
  "error.turnUserRequired": "Identifiant TURN requis (le relais est toujours authentifié)",
  "error.turnPasswordRequired": "Mot de passe TURN requis",

  // ---------------------------------------------------------------------
  // Motifs de fin d'appel (affichés près du champ d'adresse et en historique)
  // ---------------------------------------------------------------------
  "reason.hungUp": "raccroché",
  "reason.sleep": "Mise en veille",
  "reason.noAnswer": "Pas de réponse",
  "reason.declined": "Appel refusé",
  "reason.missed": "Appel manqué",
  "reason.missedNoAnswer": "Appel manqué (sans réponse)",
  "reason.setupFailed": "Établissement de l'appel impossible",
  "reason.offerUnsupported": "Offre média sans {detail} : incompatible avec WebRTC",
  "reason.callFailed": "Appel impossible : {detail}",
  /** Cause SIP brute assortie de son code — les deux restent en clair. */
  "reason.sip": "{cause} (SIP {code})",

  /**
   * Texte technique qui n'a pas de traduction (cause JsSIP, historique
   * enregistré avant l'i18n) : rendu tel quel, sans être perdu.
   */
  // ---------------------------------------------------------------------
  // Page de partage d'un compte (share_account.html)
  // ---------------------------------------------------------------------
  "share.title": "Compte partagé",
  "share.intro":
    "Ce lien contient les paramètres d'un compte SIP. Vérifiez-les, puis créez le compte sur cet appareil.",
  "share.address": "Adresse SIP",
  "share.displayName": "Nom affiché",
  "share.proxy": "Serveur SIP",
  "share.authUsername": "Identifiant d'authentification",
  "share.ice": "Traversée de NAT",
  "share.rtt": "Texte en temps réel",
  "share.none": "Aucun",
  "share.warn":
    "Ce lien contient de quoi s'authentifier sur ce compte. Une fois le compte créé, ne le conservez pas et ne le retransmettez pas.",
  "share.create": "Créer ce compte",
  "share.creating": "Création…",
  "share.open": "Ouvrir Trix",
  "share.noLink": "Ce lien ne contient aucun compte.",
  "share.malformed":
    "Ce lien est illisible : il a sans doute été coupé en chemin. Demandez qu'on vous le renvoie en entier.",
  "share.version":
    "Ce lien vient d'une version plus récente de Trix. Mettez l'application à jour pour l'ouvrir.",
  "share.wrongDomain":
    "Ce compte est du domaine {domain}, que cette installation de Trix n'accepte pas.",
  "share.exists": "{address} est déjà enregistré sur cet appareil. Rien n'a été modifié.",
  "share.full":
    "Cet appareil garde déjà {max} comptes. Supprimez-en un dans les paramètres avant d'ajouter celui-ci.",
  "share.saveFailed": "Le compte n'a pas pu être enregistré : {detail}",

  "misc.raw": "{text}",
};

export default messages;
