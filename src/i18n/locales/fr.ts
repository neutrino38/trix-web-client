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

  // ---------------------------------------------------------------------
  // Écran d'accueil
  // ---------------------------------------------------------------------
  "home.tagline": "Webphone conversation totale",
  "home.useAccount": "Utiliser le compte",
  "home.newAccount": "Configurer un nouveau compte",
  /** Version du logiciel, en pied de l'accueil — voir `src/version.ts`. */
  "home.version": "Version {version}",
  "fsl.aria": "Powered by FSL — finite-state-language sur GitHub (nouvelle fenêtre)",

  // ---------------------------------------------------------------------
  // Écran de configuration
  // ---------------------------------------------------------------------
  "config.title": "Paramètres",
  "config.section.account": "Compte SIP",
  "config.proxy": "Serveur SIP",
  "config.proxyPlaceholder": "wss://sip.example.fr:8443/ws",
  "config.uri": "Adresse SIP",
  "config.uriPlaceholder": "sip:alice@example.fr",
  "config.uriHint":
    "Avec ou sans le préfixe « sip: ». Le domaine sert de realm pour l'authentification.",
  "config.displayName": "Votre nom",
  /** `{user}` est un fragment HTML (le userpart en gras, suivi à la saisie). */
  "config.authToggle": "Identifiant d'authentification (si différent de {user})",
  "config.authUserDefault": "l'utilisateur de l'adresse",
  "config.password": "Mot de passe",
  "config.passwordSet": "•••••• (déjà défini)",
  "config.passwordKeep": "Laisser vide pour conserver le mot de passe actuel.",
  "config.ha1Note":
    "Le mot de passe n'est pas conservé : seule une empreinte (HA1) est stockée, chiffrée, dans ce navigateur.",

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

  // ---------------------------------------------------------------------
  // État de l'appel
  // ---------------------------------------------------------------------
  "call.dialing": "Appel en cours",
  "call.ringing": "Sonnerie",
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
  "chat.strip": "Tchat — disponible en phase 4",

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

  // ---------------------------------------------------------------------
  // Commandes média (barre de surimpression)
  // ---------------------------------------------------------------------
  "ctrl.mic.aria": "Micro",
  "ctrl.mic.mute": "Couper le micro",
  "ctrl.mic.unmute": "Rétablir le micro",
  "ctrl.cam.aria": "Caméra",
  "ctrl.cam.mute": "Couper la caméra",
  "ctrl.cam.unmute": "Rétablir la caméra",
  "ctrl.selfview.aria": "Self-view",
  "ctrl.selfview.hide": "Masquer le self-view",
  "ctrl.selfview.show": "Afficher le self-view",
  "ctrl.speaker.aria": "Haut-parleur",
  "ctrl.speaker.mute": "Couper le son",
  "ctrl.speaker.unmute": "Rétablir le son",
  "ctrl.dtmf.aria": "Clavier DTMF",
  "ctrl.dtmf.label": "Clavier DTMF — disponible en phase 4",
  "ctrl.fullscreen": "Plein écran",
  "ctrl.hangup": "Raccrocher",

  // ---------------------------------------------------------------------
  // Panneau latéral
  // ---------------------------------------------------------------------
  "panel.aria": "Panneau latéral",
  "panel.showChat": "Afficher le tchat",
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
  "incoming.answerVideo": "Répondre en vidéo",
  "incoming.answerAudio": "Répondre en audio",
  "incoming.reject": "Refuser",

  // ---------------------------------------------------------------------
  // Alerte d'appel entrant (titre d'onglet, notification système)
  // ---------------------------------------------------------------------
  "alert.title": "📞 Appel entrant — {caller}",
  "alert.notifTitle": "Appel entrant",
  "alert.notifVideo": "{caller} — appel vidéo",
  "alert.notifAudio": "{caller} — appel audio",

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
  "stats.copied": "Copié",
  "stats.copyFailed": "Copie refusée",

  // ---------------------------------------------------------------------
  // Erreurs des automates (écrites dans le contexte, rendues par l'UI)
  // ---------------------------------------------------------------------
  "error.invalidUri": "Adresse SIP invalide (attendu : utilisateur@domaine)",
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
  "reason.callFailed": "Appel impossible : {detail}",
  /** Cause SIP brute assortie de son code — les deux restent en clair. */
  "reason.sip": "{cause} (SIP {code})",

  /**
   * Texte technique qui n'a pas de traduction (cause JsSIP, historique
   * enregistré avant l'i18n) : rendu tel quel, sans être perdu.
   */
  "misc.raw": "{text}",
};

export default messages;
