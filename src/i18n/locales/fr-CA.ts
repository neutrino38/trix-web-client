/**
 * Dictionnaire français canadien — le français d'ici, pas celui de France.
 *
 * **C'est une vraie traduction, pas une parodie.** Le Québec ne parle pas
 * un français de France avec un accent : le vocabulaire de l'informatique
 * y est souvent plus francisé qu'en Europe, l'Office québécois de la
 * langue française ayant tranché tôt et pour de bon. D'où « clavardage »
 * là où la France dit « tchat », « fermer la session » pour « se
 * déconnecter », et le couple **ouvrir / fermer** appliqué à tout ce qui
 * s'allume et s'éteint — on ferme le son, on ouvre la caméra.
 *
 * Le reste — les tournures qui font sourire — est placé **là où une
 * lecture de travers ne coûte rien** : l'état vide de l'historique, les
 * textes d'aide, la ligne qui raconte comment un appel s'est terminé.
 * Jamais dans un message d'erreur, jamais sur un bouton dont dépend un
 * appel en cours. Un « pantoute » bien placé fait sourire ; un « pantoute »
 * dans « Adresse SIP invalide » ferait perdre un appel.
 *
 * Le glossaire, pour qui n'est pas d'ici :
 *
 * - **placoter** — bavarder de tout et de rien ;
 * - **achaler** — importuner, déranger ;
 * - **pantoute** — pas du tout (de « pas en tout ») ;
 * - **tiguidou** — parfait, ça marche ;
 * - **prendre une débarque** — tomber, se planter ;
 * - **écornifler** — regarder ce qui ne nous regarde pas ;
 * - **fermer la ligne** — raccrocher ;
 * - **tantôt** — dans un moment ;
 * - **se brancher** — se connecter.
 *
 * La typographie suit la Banque de dépannage linguistique, qui diffère de
 * l'usage français sur un point visible : **pas d'espace devant `!` ni
 * `?`**, mais une espace devant `:`, et les guillemets restent « ».
 *
 * Les pluriels sont ceux du français (`.one` / `.other`), et ce qui ne se
 * traduit nulle part ne se traduit pas ici non plus : « Trix », « Powered
 * by FSL », les codes techniques (SIP 486, WSS_LOST) et les causes brutes
 * de JsSIP.
 */

import type { Translation } from "../types.js";

const messages: Translation = {
  // ---------------------------------------------------------------------
  // Choix de la langue
  // ---------------------------------------------------------------------
  "lang.label": "Langue de l'interface",
  "lang.auto": "Automatique (langue du navigateur)",
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
  "home.tagline": "Téléphone Web en conversation totale",
  "home.useAccount": "Prendre ce compte-là",
  "home.newAccount": "Configurer un nouveau compte",
  "home.addAccount": "Ajouter un compte",
  "home.editAccount": "Modifier",
  "home.version": "Version {version}",
  /** Écran du coffre illisible (`ui/screens/vaulterror.ts`). */
  "vault.title": "Comptes illisibles",
  "vault.explain": "Vos comptes enregistrés n'ont pas pu être lus. Ils sont peut-être toujours là : réessayez avant toute autre chose.",
  "vault.retry": "Réessayer",
  "vault.reset": "Effacer les comptes enregistrés",
  "vault.resetConfirm": "Confirmer : effacer tous les comptes",
  "fsl.aria": "Powered by FSL — finite-state-language sur GitHub (nouvelle fenêtre)",

  // ---------------------------------------------------------------------
  // Écran de configuration
  // ---------------------------------------------------------------------
  "config.title": "Paramètres",
  "config.titleNew": "Nouveau compte",
  "config.section.account": "Compte SIP",
  "config.proxy": "Serveur SIP",
  "config.proxyPlaceholder": "wss://sip.exemple.qc.ca:8443/ws",
  "config.uri": "Adresse SIP",
  "config.uriPlaceholder": "sip:alice@exemple.qc.ca",
  "config.uriHint":
    "Avec ou sans le préfixe « sip: ». Le domaine sert de royaume (realm) pour l'authentification.",
  /** Domaine imposé par le déploiement (`config.json`) : c'est le seul accepté. */
  "config.uriHintDomain":
    "Seules les adresses du domaine {domain} sont acceptées ici. Ce domaine sert de royaume (realm) pour l'authentification.",
  "config.displayName": "Votre nom",
  "config.authToggle": "Identifiant d'authentification (s'il diffère de {user})",
  "config.authUserDefault": "l'utilisateur de l'adresse",
  "config.password": "Mot de passe",
  "config.passwordSet": "•••••• (déjà défini)",
  "config.passwordKeep": "Laissez vide pour garder le mot de passe actuel.",
  "config.share": "Partage du compte",
  "config.shareCopy": "Copier le lien de partage",
  "config.shareWarn":
    "Utiliser ce lien pour migrer ton compte vers un autre appareil.",
  "config.shareCopied": "Lien de partage copié",
  "config.shareManual": "Lien de partage, à copier",

  "config.advanced": "Réglages avancés",
  "config.section.nat": "Traversée de NAT",
  "config.natHint":
    "Serveurs qui permettent d'établir les communications quand on appelle depuis un réseau privé relié à Internet par un NAT.",
  "config.stun": "Serveur STUN",
  "config.stunPlaceholder": "stun.exemple.qc.ca:3478",
  "config.stunHint": "Facultatif. Hôte seul ou hôte:port — sans port, c'est 3478.",
  "config.turn": "Serveur TURN",
  "config.turnPlaceholder": "turn.exemple.qc.ca:3478",
  "config.turnHint":
    "Relais des flux média quand la connexion directe ne passe pas. Laissez vide pour vous en passer.",
  "config.turnUser": "Identifiant TURN",
  "config.turnPass": "Mot de passe TURN",
  "config.turnPassKeep": "Laissez vide pour garder le mot de passe actuel.",
  "config.turnTlsLabel": "TURN sur TLS",
  "config.turnTlsDesc":
    " — relais chiffré (« turns: »), qui passe là où seul le trafic TLS a le droit de circuler",
  "config.turnTlsHint": "Sans port explicite, c'est 5349 au lieu de 3478.",

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
    " — l'écran clignote pendant la sonnerie : on est averti même quand le son est fermé",
  "config.flashHint": "Enregistré avec le compte : il vous suit d'un poste à l'autre.",
  "config.notifications": "Notifications système",
  "config.notifEnable": "Activer les notifications",
  "config.notifHint":
    "Sans elles, Trix ne peut pas vous achaler quand la fenêtre est cachée ou réduite.",
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
    " — chaque paquet envoyé et reçu, et les états par lesquels l'appel passe, s'affichent dans la console du navigateur, pour qui veut écornifler",
  "config.traceHint":
    "Effet immédiat, même en pleine conversation : ouvrez la console (F12) pour lire les paquets. Chaque appel garde aussi les siens dans son historique, chiffrés, tant que vous ne l'effacez pas. Ils portent votre adresse SIP et celle de vos correspondants — à retirer d'un rapport de bogue public.",
  "config.save": "Enregistrer et se brancher",
  "config.saving": "Enregistrement…",
  "config.cancel": "Annuler",
  "config.delete": "Supprimer ce compte-là",
  "config.deleteConfirm": "Confirmer : supprimer {address} et son historique",

  // ---------------------------------------------------------------------
  // État du téléphone (pastille de la barre d'en-tête, titre d'onglet)
  // ---------------------------------------------------------------------
  "status.connecting": "Branchement…",
  "status.registering": "Enregistrement…",
  "status.ready": "Enregistré",
  "status.reconnecting": "On se rebranche…",
  "status.sleeping": "En veille",
  "status.sleepingSeen": "En veille — vos contacts vous voient hors ligne",
  "status.regFailed": "Échec d'enregistrement",
  "status.unregistering": "Fermeture de la session…",
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
  "thread.subtitleMessages": "contacts, appels et messages",
  "thread.segments": "Afficher",
  "thread.segment.all": "Tout",
  "thread.segment.calls": "Appels",
  "thread.segment.messages": "Messages",
  "thread.expand": "Agrandir la conversation",
  "thread.collapse": "Revenir aux échanges",
  "thread.noEvents": "Aucun échange avec ce contact pour l'instant.",
  "thread.noMessages": "Aucun message pour l'instant.",
  "thread.unread.one": "{n} message non lu",
  "thread.unread.other": "{n} messages non lus",
  "thread.blocked": "Bloqué",
  "thread.block": "Bloquer",
  "thread.unblock": "Débloquer",
  "thread.noMessaging": "Ce serveur ne transmet pas les messages. L'écriture reprendra à la prochaine connexion.",
  "message.you": "Vous : {text}",
  "message.from": "{name} :",
  "message.mine": "Vous :",
  "message.compose": "Message à {name}",
  "message.placeholder": "Écrire un message…",
  "message.send": "Envoyer",
  "message.count": "{n} / {max} octets",
  "message.state.pending": "En attente",
  "message.state.sent": "Remis au serveur",
  "message.state.delivered": "Distribué",
  "message.state.displayed": "Lu",
  "message.state.failed": "Non remis : {reason}",
  "message.retry": "Réessayer",
  "message.offline": "Hors ligne : le message partira à la prochaine connexion.",
  "message.badge.one": "{n} message — {name}",
  "message.badge.other": "{n} messages — {name}",
  "message.badgeMany.one": "{n} message",
  "message.badgeMany.other": "{n} messages",
  "message.badgeStranger": "Message d'une adresse inconnue en attente",
  "message.announce": "Nouveau message de {name}",
  "message.announceText": "{name} : {text}",
  "message.notifyStranger": "Ouvrez Trix pour l'accepter ou le refuser.",
  "stranger.title": "Message d'une adresse inconnue",
  "stranger.named": "{address} (se présente comme « {name} »)",
  "stranger.intro": "{who} vous écrit :",
  "stranger.expiry": "Sans réponse de votre part, ces messages seront effacés dans deux minutes, sans que l'expéditeur le sache. Échap refuse.",
  "stranger.accept": "Ajouter aux contacts",
  "stranger.refuse": "Refuser",
  "stranger.block": "Bloquer",
  "thread.form.name": "Nom",
  "thread.form.address": "Adresse SIP ou numéro",
  "thread.form.save": "Ajouter",
  "thread.form.cancel": "Annuler",
  "thread.rename": "Renommer",
  "thread.renameSave": "Enregistrer",
  "thread.remove": "Retirer du carnet",
  "thread.clear.all": "Effacer les échanges",
  "thread.clear.calls": "Effacer les appels",
  "thread.clear.messages": "Effacer les messages",
  "thread.clearConfirm.all": "Confirmer : effacer les échanges avec {name}",
  "thread.clearConfirm.calls": "Confirmer : effacer les appels avec {name}",
  "thread.clearConfirm.messages": "Confirmer : effacer les messages avec {name}",
  "thread.clearAllConfirm": "Confirmer : effacer tous les appels et messages",
  "thread.clearCallsConfirm": "Confirmer : effacer tous les appels",
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
  "call.ringing": "Ça sonne",
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
  "call.domainHint": "Sans « @ » : ça appellera &lt;adresse&gt;@{domain}",
  "call.idle": "Pas d'appel en cours — entrez une adresse SIP",
  "call.sleeping": "Veille — l'enregistrement reprendra au réveil",
  "call.sleepingShort": "Veille — reprise au réveil",
  "call.retryIn": "On réessaye tantôt — dans 10 s…",
  "call.chooseMode": "Choisir le mode d'appel",
  "mode.audio.label": "Appel audio",
  "mode.audio.button": "Appeler en audio",
  "mode.video.label": "Appel vidéo",
  "mode.video.button": "Appeler en vidéo",
  "mode.text.label": "Appel texte",
  "mode.text.button": "Appeler en texte",
  "chat.strip": "Le clavardage s'ouvre avec l'appel",
  "chat.stripRefused": "Texte temps réel non accepté par le correspondant",
  // ---------------------------------------------------------------------
  // Clavardage en temps réel (T.140)
  // ---------------------------------------------------------------------
  "chat.tab": "Clavardage",
  "chat.aria": "Conversation avec {peer}",
  "chat.you": "Vous",
  "chat.typing": "en train d'écrire",
  "chat.announce": "{who} : {text}",
  "chat.jump.one": "Descendre — {n} message",
  "chat.jump.other": "Descendre — {n} messages",
  "chat.composerAria": "Message en texte temps réel",
  "chat.placeholder": "Écrivez — le texte part au fur et à mesure",
  "chat.placeholderClosed": "Texte non disponible pour cet appel",
  "chat.placeholderEarly": "Lecture seule tant que l'appel n'est pas décroché",
  "chat.enterHint": "Entrée fige la bulle",
  "chat.state.open": "Part au fur et à mesure",
  "chat.state.connecting": "Ouverture du texte temps réel…",
  "chat.state.lost": "Lien coupé — on reprend",
  "chat.state.closed": "Texte temps réel fermé",
  "chat.state.refused": "Ce correspondant ne prend pas le texte temps réel",
  "chat.state.pending": "Correction dans {s} s",
  "chat.note.opened": "Texte temps réel ouvert",
  "chat.note.lost": "Texte perdu pendant la coupure",
  "chat.note.broken": "Lien texte coupé — on reprend",
  "chat.note.closed": "Texte temps réel fermé",
  "chat.note.refused": "Ce correspondant ne prend pas le texte temps réel",
  "chat.note.alert": "Alerte reçue",

  /** Relecture de la conversation depuis l'historique (§4.9). */
  "chat.log.open": "Relire la conversation de cet appel",
  "chat.log.title": "Conversation — {target}",
  "chat.log.count.one": "{n} message",
  "chat.log.count.other": "{n} messages",
  "chat.log.copy": "Copier",
  "chat.log.copied": "Copié, tiguidou!",
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
  "action.logout": "Fermer la session",
  "action.retry": "Réessayer",
  "action.retryNow": "Réessayer tout de suite",
  "action.fixSettings": "Corriger les paramètres",
  "action.unavailableInCall": " (pas disponible en appel)",
  "action.switchAccount": "Passer au compte {address}",

  // ---------------------------------------------------------------------
  // Commandes média (barre de surimpression)
  // ---------------------------------------------------------------------
  "ctrl.mic.aria": "Audio",
  "ctrl.mic.add": "Ajouter l'audio",
  "ctrl.mic.remove": "Retirer l'audio",
  "ctrl.cam.aria": "Vidéo",
  "ctrl.cam.add": "Ajouter la vidéo",
  "ctrl.cam.remove": "Enlever la vidéo",
  "ctrl.share.aria": "Partage d'écran",
  "ctrl.share.start": "Partager l'écran",
  "ctrl.share.stop": "Arrêter le partage",
  "ctrl.share.busy": "Le correspondant partage déjà son écran",
  "ctrl.media.pending": "Changement de média en cours…",
  "ctrl.media.last": "Impossible : l'appel ne transporterait plus rien",
  "ctrl.selfview.aria": "Image de soi",
  "ctrl.selfview.hide": "Cacher l'image de soi",
  "ctrl.selfview.show": "Montrer l'image de soi",
  "share.stageAria": "Écran partagé par {peer}",
  "share.zoomGroup": "Zoom sur l'écran partagé",
  "share.zoomIn": "Agrandir l'écran partagé",
  "share.zoomOut": "Réduire l'écran partagé",
  "share.zoomReset": "Revenir à la taille d'origine",
  "share.zoomLevel": "{n} %",
  "share.zoomHint": "Pincez pour agrandir ; flèches du clavier pour déplacer",
  "ctrl.swap.aria": "Permuter l'écran et le visage",
  "ctrl.swap.screen": "Mettre l'écran en grand",
  "ctrl.swap.face": "Mettre le visage en grand",
  "ctrl.speaker.aria": "Écoute sur ce poste",
  "ctrl.speaker.mute": "Fermer l'écoute",
  "ctrl.speaker.unmute": "Ouvrir l'écoute",
  "ctrl.dtmf.aria": "Clavier DTMF",
  "ctrl.dtmf.show": "Afficher le clavier DTMF",
  "ctrl.dtmf.hide": "Masquer le clavier DTMF",
  "ctrl.chat.aria": "Clavardage",
  "ctrl.chat.show": "Afficher le clavardage",
  "ctrl.chat.hide": "Masquer le clavardage",
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
  "dtmf.hash": "carré",

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
  "notice.videoRemoved": "{peer} a enlevé la vidéo",
  "notice.videoDeclinedHere": "Vidéo refusée",
  "notice.videoUnavailable": "Impossible d'ajouter la vidéo pour l'instant",
  "notice.shareRefused": "{peer} n'a pas accepté le partage d'écran",
  "notice.shareUnavailable": "Impossible de partager l'écran pour l'instant",
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
  "panel.showChat": "Afficher le clavardage",
  "panel.show": "Afficher le panneau latéral",
  "panel.hide": "Cacher le panneau latéral",
  "panel.handleAria": "Largeur du panneau",
  "panel.handleTitle": "Étirez le panneau — 33 % de la largeur au maximum",

  // ---------------------------------------------------------------------
  // Préférences d'affichage en cours d'appel
  // ---------------------------------------------------------------------
  "prefs.fontSize": "Taille du texte",
  "prefs.fontDown": "Rapetisser le texte",
  "prefs.fontUp": "Grossir le texte",

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
  // Annonces aux lecteurs d'écran — le sérieux reprend ses droits
  // ---------------------------------------------------------------------
  "announce.inCall.one": "En communication depuis {n} minute",
  "announce.inCall.other": "En communication depuis {n} minutes",

  // ---------------------------------------------------------------------
  // Historique d'appels
  // ---------------------------------------------------------------------
  "history.clear": "Tout effacer",
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
  "trace.copied": "Copié, tiguidou!",
  "trace.copyFailed": "Copie refusée",
  "trace.close": "Fermer",
  "trace.clipped": "… (paquet coupé)",
  "trace.truncated": "Trace interrompue : l'appel a dépassé ce qui est gardé par appel.",
  "outcome.answered": "Répondu",
  "outcome.missed": "Manqué",
  "outcome.failed": "Échec",
  "outcome.canceled": "Annulé",
  "outcome.dropped": "Interrompu",
  "outcome.declined": "Refusé",
  "endedBy.local": "vous avez fermé la ligne",
  "endedBy.remote": "le correspondant a fermé la ligne",
  "endedBy.network": "le réseau a pris une débarque",
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
  "stats.copied": "Copié, tiguidou!",
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
  // Erreurs des automates — ici, on parle clair et net
  // ---------------------------------------------------------------------
  "error.invalidUri": "Adresse SIP invalide (attendu : utilisateur@domaine)",
  "error.wrongDomain": "Cette adresse doit être du domaine {domain}",
  "error.duplicateAccount": "{address} est déjà enregistré dans l'autre compte",
  "error.passwordRequired": "Mot de passe requis",
  "error.saveFailed": "Sauvegarde impossible : {detail}",
  "error.vaultUnreadable": "Lecture des comptes impossible : {detail}",
  "error.invalidProxy": "Nom du proxy invalide — vérifiez l'adresse WSS",
  "error.wssRefused": "Impossible de se brancher au proxy (connexion WSS refusée)",
  "error.wssTimeout": "Le proxy ne répond pas (délai WebSocket dépassé)",
  "error.badCredentials": "Adresse SIP, mot de passe ou identifiant d'authentification incorrect",
  "error.missingSha256":
    "Ce serveur demande une authentification SHA-256, dont ce compte n'a pas l'empreinte. Ressaisissez le mot de passe pour la calculer.",
  "error.regRefused": "Enregistrement refusé : {cause}",
  "error.wssLostDuringReg": "Connexion perdue pendant l'enregistrement",
  "error.registrarTimeout": "Le registraire ne répond pas",
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
  "reason.hungUp": "ligne fermée",
  "reason.sleep": "Mise en veille",
  "reason.noAnswer": "Personne n'a répondu",
  "reason.declined": "Appel refusé",
  "reason.missed": "Appel manqué",
  "reason.missedNoAnswer": "Appel manqué (personne n'a répondu)",
  "reason.setupFailed": "L'appel n'a pas pu s'établir",
  "reason.offerUnsupported": "Offre média sans {detail} : incompatible avec WebRTC",
  "reason.callFailed": "Appel impossible : {detail}",
  "reason.sip": "{cause} (SIP {code})",
  "message.reason.noAnswer": "Aucune réponse",
  "message.reason.notFound": "Adresse inconnue",
  "message.reason.unreachable": "Injoignable",
  "message.reason.refused": "Refusé",
  "message.reason.format": "Format refusé",
  "message.reason.unsupported": "Le serveur ne transmet pas les messages",
  "message.reason.failed": "Échec (SIP {code})",
  "message.reason.tooLong": "Message trop long",
  "message.reason.invalid": "Adresse invalide",
  "message.reason.interrupted": "Connexion perdue avant la réponse",

  // ---------------------------------------------------------------------
  // Page de partage d'un compte (share_account.html)
  // ---------------------------------------------------------------------
  "share.title": "Compte partagé",
  "share.intro":
    "Ce lien-là contient les paramètres d'un compte SIP. Vérifie-les, puis crée le compte sur cet appareil-ci.",
  "share.address": "Adresse SIP",
  "share.displayName": "Nom affiché",
  "share.proxy": "Serveur SIP",
  "share.authUsername": "Identifiant d'authentification",
  "share.ice": "Traversée de NAT",
  "share.rtt": "Texte en temps réel",
  "share.none": "Aucun",
  "share.warn":
    "Ce lien-là contient de quoi s'authentifier sur le compte. Une fois le compte créé, garde-le pas et renvoie-le pas.",
  "share.create": "Créer ce compte-là",
  "share.creating": "Création…",
  "share.open": "Ouvrir Trix",
  "share.noLink": "Ce lien-là contient aucun compte.",
  "share.malformed":
    "Ce lien-là est illisible : il a sûrement été coupé en chemin. Demande qu'on te le renvoie au complet.",
  "share.version":
    "Ce lien-là vient d'une version plus récente de Trix. Mets l'application à jour pour l'ouvrir.",
  "share.wrongDomain":
    "Ce compte-là est du domaine {domain}, que cette installation de Trix accepte pas.",
  "share.exists": "{address} est déjà enregistré sur cet appareil-ci. Rien a été changé.",
  "share.full":
    "Cet appareil-ci garde déjà {max} comptes. Supprimes-en un dans les paramètres avant d'ajouter celui-là.",
  "share.saveFailed": "Le compte a pas pu être enregistré : {detail}",

  "misc.raw": "{text}",
};

export default messages;
