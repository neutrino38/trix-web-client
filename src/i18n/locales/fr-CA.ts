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

  // ---------------------------------------------------------------------
  // Écran d'accueil
  // ---------------------------------------------------------------------
  "home.tagline": "Téléphone Web en conversation totale",
  "home.useAccount": "Prendre ce compte-là",
  "home.newAccount": "Configurer un nouveau compte",
  "home.version": "Version {version}",
  "fsl.aria": "Powered by FSL — finite-state-language sur GitHub (nouvelle fenêtre)",

  // ---------------------------------------------------------------------
  // Écran de configuration
  // ---------------------------------------------------------------------
  "config.title": "Paramètres",
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
  "config.ha1Note":
    "Le mot de passe n'est pas gardé : seule une empreinte (HA1) est stockée, chiffrée, dans ce navigateur.",

  "config.section.nat": "Traversée de NAT",
  "config.natHint":
    "Des serveurs fournis par votre fournisseur SIP. Sans eux, un appel entre deux réseaux privés peut aboutir sans qu'on s'entende pantoute.",
  "config.stun": "Serveur STUN",
  "config.stunPlaceholder": "stun.exemple.qc.ca:3478",
  "config.stunHint": "Facultatif. Hôte seul ou hôte:port — sans port, c'est 3478.",
  "config.turn": "Serveur TURN",
  "config.turnPlaceholder": "turn.exemple.qc.ca:3478",
  "config.turnHint":
    "Facultatif — relais des flux média quand la connexion directe ne passe pas. Laissez vide pour vous en passer.",
  "config.turnUser": "Identifiant TURN",
  "config.turnPass": "Mot de passe TURN",
  "config.turnPassKeep": "Laissez vide pour garder le mot de passe actuel.",
  "config.turnTlsLabel": "TURN sur TLS",
  "config.turnTlsDesc":
    " — relais chiffré (« turns: »), qui passe là où seul le trafic TLS a le droit de circuler",
  "config.turnTlsHint": "Sans port explicite, c'est 5349 au lieu de 3478.",
  "config.turnNote":
    "Le mot de passe TURN, lui, est gardé (chiffré) : le relais redemande le secret lui-même à chaque appel, une empreinte ne ferait pas l'affaire.",

  "config.section.rtt": "Texte en temps réel",
  "config.rttHint":
    "Le texte s'écrit et se lit caractère par caractère pendant l'appel. Le chemin qu'il prend dépend de la plateforme que vous appelez.",
  "config.rttTransport": "Transport",
  "config.rttNone": "Aucun",
  "config.rttNoneDesc":
    " — l'appel se passe comme avant : rien n'est ajouté à ce qui est négocié",
  "config.rttWs": "Sur WebSocket",
  "config.rttWsDesc":
    " — le format non standard des passerelles déjà déployées : c'est ce que comprennent les services en place",
  "config.rttDc": "Sur canal de données",
  "config.rttDcDesc":
    " — la norme (RFC 8865), à prendre pour parler à un client de texte en temps réel standard",
  "config.rttNote":
    "Gardé avec le compte. Dans le doute, laissez « Aucun » : proposer du texte change l'offre de tous vos appels, et un serveur qui ne s'y attend pas peut mal le prendre.",

  "config.section.alerts": "Alertes et affichage",
  "config.alertsHint":
    "Ces réglages prennent effet tout de suite, sans attendre l'enregistrement — sauf le flash, qui suit le compte.",
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

  // ---------------------------------------------------------------------
  // État du téléphone (pastille de la barre d'en-tête, titre d'onglet)
  // ---------------------------------------------------------------------
  "status.connecting": "Branchement…",
  "status.registering": "Enregistrement…",
  "status.ready": "Enregistré",
  "status.reconnecting": "On se rebranche…",
  "status.sleeping": "En veille",
  "status.regFailed": "Échec d'enregistrement",
  "status.unregistering": "Fermeture de la session…",

  // ---------------------------------------------------------------------
  // État de l'appel
  // ---------------------------------------------------------------------
  "call.dialing": "Appel en cours",
  "call.ringing": "Ça sonne",
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

  // ---------------------------------------------------------------------
  // Commandes média (barre de surimpression)
  // ---------------------------------------------------------------------
  "ctrl.mic.aria": "Micro",
  "ctrl.mic.mute": "Fermer le micro",
  "ctrl.mic.unmute": "Ouvrir le micro",
  "ctrl.cam.aria": "Caméra",
  "ctrl.cam.add": "Ajouter la vidéo",
  "ctrl.cam.remove": "Enlever la vidéo",
  "ctrl.cam.pending": "Changement de média en cours…",
  "ctrl.selfview.aria": "Image de soi",
  "ctrl.selfview.hide": "Cacher l'image de soi",
  "ctrl.selfview.show": "Montrer l'image de soi",
  "ctrl.speaker.aria": "Haut-parleur",
  "ctrl.speaker.mute": "Fermer le son",
  "ctrl.speaker.unmute": "Ouvrir le son",
  "ctrl.dtmf.aria": "Clavier DTMF",
  "ctrl.dtmf.show": "Afficher le clavier DTMF",
  "ctrl.dtmf.hide": "Masquer le clavier DTMF",
  "ctrl.chat.aria": "Clavardage",
  "ctrl.chat.show": "Afficher le clavardage",
  "ctrl.chat.hide": "Masquer le clavardage",
  "ctrl.fullscreen": "Plein écran",
  "ctrl.hangup": "Raccrocher",

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
  "videoask.title": "{peer} veut ajouter la vidéo",
  "videoask.body": "Accepter va ouvrir ta caméra.",
  "videoask.accept": "Accepter la vidéo",
  "videoask.reject": "Refuser",

  // ---------------------------------------------------------------------
  // Messages fugaces de l'appel
  // ---------------------------------------------------------------------
  "notice.videoDeclined": "{peer} n'a pas accepté la vidéo",
  "notice.videoRefused": "{peer} refuse d'ajouter la vidéo à cet appel",
  "notice.videoAdded": "{peer} a ajouté la vidéo",
  "notice.videoRemoved": "{peer} a enlevé la vidéo",
  "notice.videoDeclinedHere": "Vidéo refusée",
  "notice.videoUnavailable": "Impossible d'ajouter la vidéo pour l'instant",
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
  "history.title": "Historique",
  "history.clear": "Effacer",
  "history.empty": "Pas un appel, pantoute",
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
  "stats.codec": "Codec",
  "stats.bitrate": "Débit",
  "stats.loss": "Perte",
  "stats.rtt": "Aller-retour",
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

  // ---------------------------------------------------------------------
  // Erreurs des automates — ici, on parle clair et net
  // ---------------------------------------------------------------------
  "error.invalidUri": "Adresse SIP invalide (attendu : utilisateur@domaine)",
  "error.wrongDomain": "Cette adresse doit être du domaine {domain}",
  "error.passwordRequired": "Mot de passe requis",
  "error.saveFailed": "Sauvegarde impossible : {detail}",
  "error.invalidProxy": "Nom du proxy invalide — vérifiez l'adresse WSS",
  "error.wssRefused": "Impossible de se brancher au proxy (connexion WSS refusée)",
  "error.wssTimeout": "Le proxy ne répond pas (délai WebSocket dépassé)",
  "error.badCredentials": "Adresse SIP, mot de passe ou identifiant d'authentification incorrect",
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

  "misc.raw": "{text}",
};

export default messages;
