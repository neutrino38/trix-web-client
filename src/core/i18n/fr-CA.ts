/**
 * The core's messages — Québécois (ADR 0011, D9). Typed against the French
 * reference: a key missing here fails the build.
 */

import type { CoreDictionary } from "../../i18n/types.js";

const messages: CoreDictionary = {
  // ---------------------------------------------------------------------
  // Errors of the machines and of the SIP port (`errors.last`)
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
  "error.offline": "Pas de réseau — vos paramètres ne sont pas en cause",
  "error.proxyLostDuringCall": "Connexion au proxy perdue pendant l'appel",
  "error.callDropped": "Appel interrompu — connexion au proxy perdue",
  "error.stunInvalid": "Serveur STUN invalide (attendu : hôte ou hôte:port)",
  "error.turnInvalid": "Serveur TURN invalide (attendu : hôte ou hôte:port)",
  "error.turnUserRequired": "Identifiant TURN requis (le relais est toujours authentifié)",
  "error.turnPasswordRequired": "Mot de passe TURN requis",

  // ---------------------------------------------------------------------
  // Why a call ended (`CallLogEntry.reason`, `errors.call`)
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

  // ---------------------------------------------------------------------
  // Why a message did not leave (ADR 0008, D3)
  // ---------------------------------------------------------------------
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
  // Passing messages of the call (`CallView.notice`)
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
  // Real-time text: the thread's notes and the transcript (`core/conversation.ts`)
  // ---------------------------------------------------------------------
  "chat.you": "Vous",
  "chat.note.opened": "Texte temps réel ouvert",
  "chat.note.lost": "Texte perdu pendant la coupure",
  "chat.note.broken": "Lien texte coupé — on reprend",
  "chat.note.closed": "Texte temps réel fermé",
  "chat.note.refused": "Ce correspondant ne prend pas le texte temps réel",
  "chat.note.alert": "Alerte reçue",
  "chat.log.title": "Conversation — {target}",
  "chat.log.vttBase": "Temps comptés depuis le début de la communication — appel du {at}.",
  "chat.log.cut": "Début de la conversation non conservé",

  // ---------------------------------------------------------------------
  // Reachability (ADR 0006): the sentence of `reachSentence`
  // ---------------------------------------------------------------------
  "reach.none": "Vous ne pouvez pas recevoir d'appel.",

  // ---------------------------------------------------------------------
  // Raw text
  // ---------------------------------------------------------------------
  /**
   * Technical text with no translation (a JsSIP cause, a history entry
   * older than the i18n): shown as it is, rather than lost.
   */
  "misc.raw": "{text}",
};

export default messages;
