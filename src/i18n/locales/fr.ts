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
  "config.ha1Note":
    "Le mot de passe n'est pas conservé : seule une empreinte (HA1) est stockée, chiffrée, dans ce navigateur.",
  "config.share": "Partage du compte",
  "config.shareCopy": "Copier le lien de partage",
  "config.shareWarn":
    "Ce lien contient de quoi s'authentifier sur ce compte : il vaut le mot de passe. Ne le transmettez qu'à qui doit s'en servir, et par un moyen sûr.",
  "config.shareCopied": "Lien de partage copié",
  "config.shareManual": "Lien de partage, à copier",

  "config.section.nat": "Traversée de NAT",
  "config.natHint":
    "Serveurs fournis par votre opérateur SIP. Sans eux, un appel entre deux réseaux privés peut aboutir sans qu'aucun son ne passe.",
  "config.stun": "Serveur STUN",
  "config.stunPlaceholder": "stun.example.fr:3478",
  "config.stunHint": "Facultatif. Hôte seul ou hôte:port — sans port, 3478 est utilisé.",
  "config.turn": "Serveur TURN",
  "config.turnPlaceholder": "turn.example.fr:3478",
  "config.turnHint":
    "Facultatif — relais des flux média quand la connexion directe échoue. Laisser vide pour ne pas en utiliser.",
  "config.turnUser": "Identifiant TURN",
  "config.turnPass": "Mot de passe TURN",
  "config.turnPassKeep": "Laisser vide pour conserver le mot de passe actuel.",
  "config.turnTlsLabel": "TURN sur TLS",
  "config.turnTlsDesc":
    " — relais chiffré (« turns: »), qui passe là où seul le trafic TLS est autorisé",
  "config.turnTlsHint": "Sans port explicite, 5349 est alors utilisé au lieu de 3478.",
  "config.turnNote":
    "Le mot de passe TURN, lui, est conservé (chiffré) : le relais réclame le secret lui-même à chaque appel, une empreinte n'y suffirait pas.",

  "config.section.rtt": "Texte en temps réel",
  "config.rttHint":
    "Le texte s'écrit et se lit caractère par caractère pendant l'appel. Le chemin qu'il emprunte dépend de la plateforme que vous appelez.",
  "config.rttTransport": "Transport",
  "config.rttNone": "Aucun",
  "config.rttNoneDesc":
    " — l'appel se passe comme avant : rien n'est ajouté à ce qui est négocié",
  "config.rttWs": "Sur WebSocket",
  "config.rttWsDesc":
    " — le format non standard des passerelles déjà déployées : c'est ce que comprennent les services en place",
  "config.rttDc": "Sur canal de données",
  "config.rttDcDesc":
    " — la norme (RFC 8865), à choisir pour parler à un client de texte en temps réel standard",
  "config.rttNote":
    "Enregistré avec le compte. Dans le doute, laissez « Aucun » : proposer du texte modifie l'offre de tous vos appels, et un serveur qui ne l'attend pas peut mal le prendre.",

  "config.section.alerts": "Alertes et affichage",
  "config.alertsHint":
    "Ces réglages prennent effet immédiatement, sans attendre l'enregistrement — sauf le flash, qui suit le compte.",
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
  "status.regFailed": "Échec d'enregistrement",
  "status.unregistering": "Déconnexion…",
  "status.switching": "Changement de compte…",

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
  "ctrl.media.pending": "Changement de média en cours…",
  "ctrl.media.last": "Impossible : l'appel ne transporterait plus rien",
  "ctrl.selfview.aria": "Self-view",
  "ctrl.selfview.hide": "Masquer le self-view",
  "ctrl.selfview.show": "Afficher le self-view",
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
  "history.title": "Historique",
  "history.clear": "Effacer",
  "history.empty": "Aucun appel enregistré",
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
