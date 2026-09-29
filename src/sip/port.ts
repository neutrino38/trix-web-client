/**
 * Port SIP : la seule frontière entre les machines FSL et JsSIP
 * (docs/CONCEPTION.md §2). Les machines reçoivent des événements
 * `sip:*` et ne voient jamais un type JsSIP ; les tests injectent
 * un port factice.
 */

import JsSIP from "jssip";
import type { AccountConfig, StoredAccount } from "../storage/store.js";
import { iceServers } from "./ice.js";
import {
  answeredMedia,
  midActive,
  offeredMedia,
  sharedVideoMid,
  unsupportedOffer,
  withSharedVideo,
  withoutMedia,
} from "./sdp.js";
import { traceSocket } from "./trace.js";
import { useSha256Ha1 } from "./digest.js";
import {
  jssipWatcher,
  NO_PRESENCE,
  openPresence,
  type OpenPresence,
  type PresenceLink,
  type PresenceSipEvent,
} from "./presence.js";
import { createPublisher, jssipPublishSend, type JsSipUa } from "./publish.js";
import {
  jssipIncoming,
  jssipSender,
  NO_MESSAGING,
  openMessaging,
  type JsSipMessageEvent,
  type MessagingLink,
  type MessagingSipEvent,
  type OpenMessaging,
} from "./message.js";
import { openCallTrace, type CallTraceHandle, type TraceLine } from "./record.js";
import {
  MEDIA_ERROR_EVENTS,
  reportMediaError,
  reportOfferRefused,
  type MediaFailure,
} from "./mediaerror.js";
import { createCallStats, STATS_SAMPLE_MS, type MediaStats } from "./stats.js";
import type { RttChannel, RttTransport } from "./rtt.js";
import { openRttFor, type RttNegotiation } from "./rttsip.js";
import { sipTraceEnabled, traceNote } from "./trace.js";

export type SipEvent =
  | { type: "sip:connected" }
  | { type: "sip:disconnected" }
  | { type: "sip:registered" }
  | { type: "sip:unregistered" }
  | {
      type: "sip:registrationFailed";
      cause: string;
      statusCode?: number;
      /**
       * Le registrar a défié en SHA-256 (RFC 8760) et le compte n'a pas
       * d'empreinte pour cet algorithme-là : le défi est resté sans
       * réponse. À dire tel quel plutôt qu'« identifiants refusés » — le
       * mot de passe est peut-être le bon, il n'a simplement jamais été
       * condensé ainsi (`sip/digest.ts`).
       */
      missingSha256?: boolean;
    }
  /** URL de proxy rejetée par JsSIP avant toute tentative réseau (schéma/syntaxe). */
  | { type: "sip:invalidProxy"; detail: string }
  /** INVITE entrant : la machine décide de répondre ou de refuser. */
  | { type: "sip:incoming"; call: IncomingCall };

/**
 * Combinaison de médias d'un appel — les **trois** de la conversation
 * totale (ADR 0003, D1). F.703 §7.2 met le texte sur la même ligne que
 * l'audio et la vidéo dans son tableau de profils : le type le fait
 * aussi, au lieu de définir l'appel texte par l'absence des deux autres.
 *
 * `text` dit que **le texte est négocié**, pas qu'il passe. L'état du lien
 * (`connecting`, `open`, `lost`, `closed`) reste porté par `RttChannel`, et
 * lui seul : sur canal de données, l'ouverture DCEP arrive après le
 * 200 OK, et un appel peut donc être `text: true` avec un canal encore
 * `connecting`. C'est normal, et c'est la nuance à ne jamais confondre.
 */
export interface CallMedia {
  audio: boolean;
  video: boolean;
  text: boolean;
}

/**
 * Les deux médias qui entrent et sortent de l'appel par re-INVITE (ADR
 * 0003, D5). Le texte n'en est pas : une fois négocié il ne se retire
 * jamais — c'est le repli d'accessibilité, et le retirer reviendrait à
 * pouvoir couper la parole à quelqu'un en un clic, sans qu'il puisse
 * répondre (D4).
 */
export type MediaKind = "audio" | "video";

/** Les deux, dans l'ordre où l'interface les présente. */
export const MEDIA_KINDS: readonly MediaKind[] = ["audio", "video"];

/** Les trois médias, tous absents — point de départ de tout calcul. */
export const NO_MEDIA: CallMedia = { audio: false, video: false, text: false };

/** Deux combinaisons portent-elles exactement les mêmes médias ? */
export function sameMedia(a: CallMedia, b: CallMedia): boolean {
  return a.audio === b.audio && a.video === b.video && a.text === b.text;
}

/** Cette combinaison porte-t-elle quoi que ce soit ? */
export function anyMedia(m: CallMedia): boolean {
  return m.audio || m.video || m.text;
}

/**
 * L'union de deux combinaisons : ce que les deux portent ensemble. Sert au
 * média précoce, qui s'ajoute d'une réponse provisoire à la suivante sans
 * jamais se retirer (`machines/call.ts`, état `early_media`).
 */
export function mergeMedia(a: CallMedia, b: CallMedia): CallMedia {
  return { audio: a.audio || b.audio, video: a.video || b.video, text: a.text || b.text };
}

/**
 * Retirer ce média laisserait-il l'appel sans rien ? F.703 §5.3.1 autorise
 * l'audio à être temporairement interrompu, **pourvu qu'au moins un autre
 * média reste présent** — et un appel qui ne transporte plus rien n'est pas
 * un appel, c'est un dialogue SIP ouvert sur le vide.
 *
 * Le texte compte : c'est tout l'intérêt d'en avoir fait un média (D1).
 * Retirer l'audio d'un appel audio + texte est permis — il reste de quoi se
 * parler, et c'est même le scénario que F.703 §4.5 décrit.
 *
 * La règle est ici, et une seule fois : le bloc la vérifie avant de lancer
 * la renégociation, l'interface ne fait qu'en griser le bouton (ADR 0003,
 * D5). Écrite dans l'interface, elle serait à réécrire dans les deux
 * gabarits — et à oublier dans un.
 */
export function isLastMedia(media: CallMedia, kind: MediaKind): boolean {
  if (!media[kind]) return false; // il n'y est pas : rien à retirer
  return !MEDIA_KINDS.some((k) => k !== kind && media[k]) && !media.text;
}

/**
 * **Ce poste sait-il capturer un écran ?** (ADR 0005, D8)
 *
 * C'est la capacité qui décide de l'existence du bouton de partage, jamais
 * le gabarit. La règle « le partage n'existe que sur bureau » devient vraie
 * sans qu'aucune ligne ne parle de mobile — aucun navigateur mobile
 * n'expose cette API —, et elle est plus juste que de lire une largeur de
 * fenêtre : un bureau réduit à 400 px bascule en gabarit compact et
 * perdrait le partage sans raison, alors que la machine sait parfaitement
 * le faire.
 *
 * La **réception**, elle, ne demande aucune capacité particulière : elle
 * marche partout, et c'est tout l'intérêt.
 */
export function canShareScreen(): boolean {
  return typeof navigator.mediaDevices?.getDisplayMedia === "function";
}

/** Qui est à l'origine de la fin de session, tel que vu par JsSIP. */
export type SipOriginator = "local" | "remote" | "system";

/** Événements d'une session d'appel, envoyés au bloc CallBlock. */
export type CallSipEvent =
  /**
   * Réponse provisoire (180, 183). `media` porte ce que sa description de
   * session déclare actif — **les trois médias**, et pas seulement le son
   * (RFC 3960) : un accueil peut arriver en parole, en langue des signes
   * ou en texte temps réel, et pour le public de Trix les deux derniers
   * sont même les plus vraisemblables. `NO_MEDIA` quand la réponse ne
   * porte pas de SDP — le 180 ordinaire, où rien n'est émis avant le
   * décrochage.
   */
  | { type: "sip:progress"; media: CallMedia }
  | { type: "sip:accepted" }
  | { type: "sip:confirmed" }
  | { type: "sip:ended"; cause: string; originator?: SipOriginator }
  /**
   * Fin de session avant établissement. `detail` porte ce que le
   * navigateur a dit quand l'échec vient du média (`sip/mediaerror.ts`) :
   * la cause JsSIP seule (« WebRTC Error ») ne nomme jamais le vrai
   * problème.
   */
  | {
      type: "sip:failed";
      cause: string;
      statusCode?: number;
      originator?: SipOriginator;
      detail?: string;
    }
  /**
   * Les médias de l'appel viennent d'être négociés — à l'établissement
   * comme après un re-INVITE, dans un sens ou dans l'autre. C'est le
   * **résultat**, lu sur la connexion pair-à-pair : ce que l'appel
   * transporte réellement, et non ce qui avait été demandé.
   */
  | { type: "sip:mediaChanged"; media: CallMedia }
  /**
   * Notre demande de changement n'a pas abouti : l'appel continue tel
   * qu'il était. `by` sépare les deux refus, qui ne se disent pas de la
   * même façon à l'écran — le distant a dit non (488, ou 200 OK dont la
   * réponse SDP désactive le flux), ou bien la demande n'a jamais pu
   * partir d'ici (caméra indisponible, négociation déjà en cours).
   */
  | {
      type: "sip:mediaRefused";
      by: "remote" | "local";
      statusCode?: number;
      /**
       * Le refus porte sur le **partage d'écran** et non sur un média de
       * l'appel (ADR 0005, D3) : ce n'est pas la même phrase à l'écran, et
       * rien de ce que l'appel transporte n'a bougé.
       */
      share?: boolean;
    }
  /**
   * **Notre offre vient d'être écrite, et elle part.** Tout ce qui la
   * précède se passe ici — le sélecteur d'écran attend un choix, la caméra
   * une autorisation, le navigateur rassemble ses candidats ICE —, et le
   * distant n'en sait rien : tant que cet avis n'est pas venu, il n'a
   * **rien reçu** à quoi répondre.
   *
   * C'est ce qui sépare les deux temps d'une renégociation, et c'est le
   * délai qui en dépend : mesuré depuis le clic, il comptait l'hésitation
   * de l'utilisateur devant le sélecteur d'écran comme un silence du
   * correspondant — un partage abandonné trois secondes après avoir été
   * offert (constaté en réel le 2026-09-08). Mesuré depuis ici, il ne
   * compte que ce qu'il prétend compter.
   *
   * Il revient à **chaque** offre, la reprise après un 491 comprise
   * (RFC 3261 §14.1) : celle-là a droit à son délai plein, elle aussi.
   */
  | { type: "sip:offering" }
  /**
   * **Ce que j'émets d'écran vient d'être négocié** (ADR 0005). Un
   * événement à part, parce que le partage n'est pas un média de l'appel :
   * `sip:mediaChanged` continue de ne parler que de la conversation.
   */
  | { type: "sip:sharing"; on: boolean }
  /**
   * **La barre du navigateur a coupé le partage.** « Cesser de partager »
   * arrête la piste sans rien dire à l'application : sans cet avis, le
   * distant garderait une m-section vivante sur une image gelée. Plus rien
   * n'est émis quand il arrive ; il reste à le dire sur le fil, et c'est la
   * machine qui lance ce re-INVITE-là comme les autres.
   */
  | { type: "sip:shareEnded" }
  /**
   * **Ce que je reçois d'écran vient de changer** (ADR 0005, D11). Lu sur
   * la direction négociée de la m-section du partage distant, jamais sur
   * l'ordre des flux : c'est le MID qui l'identifie (RFC 5888), et lui seul
   * survit à une renégociation.
   *
   * Un événement à part, comme `sip:sharing` : ce que l'appel transporte
   * n'a pas bougé, seule la scène change — l'écran prend la grande surface
   * et la caméra du correspondant passe en vignette.
   */
  | { type: "sip:peerSharing"; on: boolean }
  /**
   * Le distant demande à ajouter la vidéo à un appel qui n'en a pas : sa
   * caméra s'allumerait sans que personne l'ait décidé ici, donc la
   * réponse SIP attend la décision de l'utilisateur.
   */
  | {
      type: "sip:mediaOffer";
      media: CallMedia;
      /**
       * **L'offre apporte un écran partagé** (ADR 0005, D5). Il ne compte
       * pas dans `media` — un écran n'est pas un média de l'appel (D3) —,
       * et c'est pourtant lui qui fait poser la question la plus forte :
       * accepter n'allume aucun capteur ici, mais **un écran partagé prend
       * la place de la langue des signes**. Sur un téléphone il n'y a pas
       * deux grandes surfaces : accepter, c'est reléguer le visage de son
       * correspondant dans une vignette, et personne d'autre que le
       * récepteur ne peut décider cela pour lui (F.703 §4.5 et §6.2.4).
       *
       * Une offre qui ajoute un média **et** un partage ne pose qu'une
       * question, et l'acceptation vaut pour tout ce qu'elle porte.
       */
      share: boolean;
      offer: MediaOffer;
    }
  /**
   * Le correspondant s'est mis en pause, ou en est revenu. Rien n'est passé
   * par SIP : ses pistes ont cessé d'émettre, et les nôtres sont passées
   * `muted` en réception. C'est exactement l'*avis explicite* que F.703
   * §6.2.4 réclame pour une vidéo suspendue, rendu par le récepteur — un
   * client tiers, lui, verra une image gelée, dégradation acceptable
   * (§8.3.5) et non un refus.
   */
  | { type: "sip:peerPaused"; paused: boolean };

/**
 * Demande de changement de média venue du distant, en attente de
 * décision. Répondre est obligatoire : tant que ni `accept` ni `reject`
 * n'est appelé, le re-INVITE reste sans réponse finale (le 100 Trying est
 * déjà parti) et l'appelant patiente.
 */
export interface MediaOffer {
  /**
   * 200 OK : la caméra s'allume et la vidéo rejoint l'appel — et l'écran
   * partagé, s'il y en avait un dans l'offre, entre sur la scène.
   */
  accept(): void;
  /**
   * 488 Not Acceptable Here : l'appel continue sans la vidéo, et sans
   * l'écran. **La session revient exactement à ce qu'elle était**
   * (RFC 3261 §14.1) — refuser un partage ne coûte rien à la conversation,
   * et c'est ce qui rend la question posable.
   */
  reject(): void;
}

/**
 * Session d'appel côté machine/UI : la frontière média. `attachMedia`
 * est le seul point où l'UI touche aux flux WebRTC — jamais à JsSIP.
 */
export interface CallSession {
  /** CANCEL / BYE selon l'état ; sans effet si la session est déjà terminée. */
  terminate(): void;
  /**
   * Les paquets SIP de cet appel et les états traversés, quand la trace
   * était active (`sip/record.ts`) — vide sinon. À prendre une fois, la
   * session finie : le carnet se referme en rendant ses lignes.
   */
  trace(): TraceLine[];
  /**
   * Ajoute ou retire un média de l'appel en cours par re-INVITE
   * (docs/CONCEPTION.md §4.4) — il n'y a pas de « couper sa caméra » ni de
   * « couper son micro » en conversation totale : ne plus émettre un flux,
   * c'est le retirer de l'appel, et le distant doit le savoir.
   *
   * **Les deux médias y sont symétriques** (ADR 0003, D5) : F.703 §5.3.1
   * prévoit que l'audio soit temporairement interrompu, pourvu qu'un autre
   * média reste. Se taire un instant sans rien changer à l'appel est un
   * autre geste — la Pause, qui ne passe par aucune signalisation.
   *
   * Ne rend rien : l'issue arrive par événement, `sip:mediaChanged` si le
   * distant a suivi, `sip:mediaRefused` s'il a dit non.
   */
  setMedia(kind: MediaKind, on: boolean): void;
  /**
   * **On cesse d'attendre.** Le re-INVITE parti n'aura pas de conclusion —
   * c'est le délai côté utilisateur qui le décide, et lui seul : le port
   * n'a aucune minuterie propre, et celles de JsSIP ne tranchent pas tous
   * les cas (voir `abandon` dans `mediaControl`).
   *
   * L'appel continue, tel qu'il était avant l'offre : retour arrière sur la
   * connexion, capteur ouvert pour rien refermé, dialogue rendu disponible
   * pour la renégociation suivante. Sans effet si rien n'est en vol.
   */
  abandonMedia(): void;
  /**
   * **La Pause** (ADR 0003, D6 et D7) : tout ce que j'émets s'arrête d'un
   * coup — micro et image ensemble, comme F.703 §6.2.4 les groupe.
   *
   * **Sur le fil : rien.** `replaceTrack(null)` sur les deux émetteurs.
   * Aucune négociation, aucun aller-retour, aucun 488, aucun 491 — donc
   * **aucun échec possible**, ce qui est toute la valeur du geste :
   * quelqu'un dont on sonne à la porte n'a pas le temps d'un aller-retour
   * SIP. La reprise rattache les mêmes pistes, sans rien rouvrir.
   *
   * **Le texte n'est jamais coupé**, dans aucun sens : c'est la même raison
   * qu'en D4 — une pause qui couperait le texte reviendrait, pour un usager
   * sourd, à raccrocher sans le dire, alors que c'est justement le média qui
   * permet d'écrire « deux minutes ».
   *
   * **Le correspondant continue de vivre** : il parle, il est vu, il écrit,
   * et il reçoit tout cela de son côté. Une mise en attente `sendonly`
   * l'aurait suspendu lui aussi, pour rien — le besoin est de me retirer,
   * moi.
   */
  setPaused(on: boolean): void;
  /**
   * **Partager son écran** (ADR 0005) : `getDisplayMedia`, un transceiver
   * `sendonly` de plus, et un re-INVITE — le même chemin qu'un ajout de
   * média (§4.4), à ceci près que ce qu'il ajoute n'est pas un média de
   * l'appel.
   *
   * Le partage est **un second flux vidéo qui coexiste avec la caméra**,
   * jamais un `replaceTrack` sur elle : partager ne doit pas revenir à
   * disparaître de l'écran de son correspondant, ce qui, pour deux
   * personnes qui signent, revient à raccrocher (D1).
   *
   * Ne rend rien : l'issue arrive par événement, `sip:sharing` si le
   * distant a suivi, `sip:mediaRefused` (`share`) s'il a dit non — y
   * compris quand c'est l'utilisateur qui a fermé le sélecteur d'écran.
   */
  startShare(): void;
  /**
   * L'écran quitte l'appel : piste arrêtée, m-section rendue `inactive`,
   * re-INVITE. Le transceiver, lui, **reste** — il se recycle au partage
   * suivant plutôt que de laisser une m-section morte de plus dans chaque
   * offre (D6). Sans effet si rien n'est partagé.
   */
  stopShare(): void;
  /**
   * Envoie une tonalité DTMF (RFC 4733) dans le flux audio de l'appel :
   * `0-9`, `*`, `#`, `A-D`. Rend `false` si elle n'a pas pu partir — appel
   * pas encore établi, tonalité inconnue, ou pas de piste audio émise, le
   * seul chemin qu'un événement RTP `telephone-event` puisse emprunter.
   *
   * Rendre un booléen plutôt que d'émettre un événement est délibéré :
   * l'insertion dans le flux est synchrone et personne n'accuse réception
   * d'un DTMF. Il n'y a donc rien à attendre — ou c'est parti, ou non.
   */
  sendDtmf(tone: string): boolean;
  /**
   * Branche les flux de l'appel sur les surfaces de l'écran — le seul point
   * où l'UI touche à WebRTC.
   *
   * `share` est la surface de **l'écran partagé par le correspondant**
   * (ADR 0005, D11), `null` là où l'écran n'en a pas rendu. Les pistes y
   * sont routées **par MID** et non par ordre d'arrivée : avec deux
   * `m=video` dans l'appel, l'ordre ne dit plus laquelle est le visage.
   */
  attachMedia(
    remote: HTMLVideoElement,
    local: HTMLVideoElement | null,
    share: HTMLVideoElement | null,
  ): void;
  /**
   * L'état du média sur les dix dernières secondes — ce que l'UI affiche
   * pendant la conversation. `null` tant que rien n'a été mesuré, et quand
   * la trace est décochée : c'est la même case qui commande (§5.4).
   */
  mediaStats(): MediaStats | null;
  /**
   * Le bilan de tout ce qui a été mesuré de l'appel, pour l'historique. À
   * prendre une fois la session finie, comme `trace()` — le dernier
   * échantillon date d'au plus une seconde avant le raccrochage, la
   * connexion pair-à-pair ne survivant pas à la fin de session.
   */
  callStats(): MediaStats | null;
  /**
   * Le lien texte en temps réel de l'appel (§4.9), ou `null` quand le
   * compte n'en demande pas. Il existe **dès le début de l'appel** et ne
   * change pas : c'est son état qui dit si le distant a suivi. Ce qui est
   * tapé avant l'ouverture attend dans son tampon.
   */
  rtt(): RttChannel | null;
}

/**
 * Motif de refus d'un appel entrant. Le port seul connaît les codes SIP
 * correspondants — les machines raisonnent en intentions.
 * `incompatible` est le refus qui ne passe pas par l'utilisateur : l'offre
 * ne peut pas être établie ici, le 488 part avant la sonnerie (§4.3).
 */
export type RejectReason = "declined" | "busy" | "timeout" | "incompatible";

/**
 * Appel entrant en attente de décision (docs/CONCEPTION.md §4.3).
 * L'identité et les médias proposés sont figés à l'arrivée de l'INVITE ;
 * `listen` doit être appelé avant toute décision pour ne pas manquer une
 * annulation de l'appelant.
 */
export interface IncomingCall {
  /** URI de l'appelant (`sip:bob@example.fr`). */
  from: string;
  /** Nom affiché porté par l'en-tête From, s'il y en a un. */
  displayName: string | null;
  /** Médias réellement proposés par l'offre SDP de l'INVITE. */
  offered: CallMedia;
  /**
   * Ce qui, dans l'offre, met l'appel hors de portée du navigateur —
   * « ICE, DTLS, SRTP (RTP/AVP) » — ou `null` si rien ne s'y oppose. Lu
   * avant toute décision : un appel qui ne peut pas aboutir ne sonne pas
   * (§4.3). Le port constate, la machine décide.
   */
  offerProblem: string | null;
  /** Branche les événements de la session (annulation comprise) et rend la session. */
  listen(send: (ev: CallSipEvent) => void): CallSession;
  /** 200 OK avec la combinaison de médias choisie (sous-ensemble de `offered`). */
  answer(media: CallMedia): void;
  reject(reason: RejectReason): void;
}

export interface SipHandle {
  /**
   * unREGISTER + fermeture du transport. Les événements continuent
   * d'arriver jusqu'à `sip:disconnected`, après quoi le port se détache.
   */
  stop(): void;
  /**
   * Renvoie un REGISTER sur le transport existant : même Call-ID, CSeq
   * suivant, aucun nouveau contact chez le registrar. Rend `false` si le
   * transport est déjà fermé — il faut alors repartir d'un nouvel UA.
   */
  refresh(): boolean;
  /** INVITE sortant avec la combinaison de médias demandée. Peut lever si la cible est invalide. */
  call(target: string, media: CallMedia, send: (ev: CallSipEvent) => void): CallSession;
  /**
   * Ouvre le lien de présence de cet UA (ADR 0007, D12) : abonnements et
   * publication, dont les événements vont à `send` — celui de
   * PresenceMachine, jamais celui de PhoneMachine. Un second appel rend le
   * même lien, rebranché sur le nouveau `send`. Après `stop()`, le lien ne
   * fait plus rien.
   */
  presence(send: (ev: PresenceSipEvent) => void): PresenceLink;
  /**
   * Opens this UA's messaging link (ADR 0008, D12): its events go to
   * `send` — MessagingMachine's, never PhoneMachine's. A second call
   * returns the same link, rebound to the new `send`. After `stop()`, or
   * with messaging turned off, the link does nothing.
   */
  messaging(send: (ev: MessagingSipEvent) => void): MessagingLink;
}

export interface SipPort {
  /**
   * Un compte **du coffre**, pas une configuration seule : son
   * `instanceId` est le `+sip.instance` de l'appareil (`storage/store.ts`).
   */
  start(cfg: StoredAccount, send: (ev: SipEvent) => void): SipHandle;
}

/**
 * Les méthodes que Trix annonce dans l'en-tête `Allow` de chaque requête,
 * et de la réponse à OPTIONS ou à une méthode refusée.
 *
 * MESSAGE n'y figure que si la messagerie est allumée (ADR 0008, D13) :
 * éteinte, personne n'écoute `newMessage`, un MESSAGE entrant reçoit 405,
 * et ce 405 porterait lui-même un `Allow` qui contredit le refus si la
 * liste de JsSIP restait telle quelle.
 */
export const ALLOWED_METHODS = "INVITE,ACK,CANCEL,BYE,UPDATE,OPTIONS,REFER,INFO,NOTIFY,SUBSCRIBE";
export const ALLOWED_METHODS_WITH_MESSAGE = `${ALLOWED_METHODS},MESSAGE`;

/**
 * Les types de corps annoncés dans `Accept` (réponse à OPTIONS, et 415).
 * Ceux de JsSIP, plus `text/plain` quand la messagerie est allumée : c'est
 * ce que dit le 415 opposé à un MESSAGE d'un autre type (ADR 0008, D1).
 */
export const ACCEPTED_BODY_TYPES = "application/sdp, application/dtmf-relay";
export const ACCEPTED_BODY_TYPES_WITH_TEXT = `${ACCEPTED_BODY_TYPES}, text/plain`;

/**
 * Écrit les deux listes dans les constantes de JsSIP — le même objet que
 * celui qu'importe `SIPMessage` (voir `sip/digest.ts` pour l'identité des
 * modules internes sur les trois chemins de construction).
 */
export function announceMessaging(on: boolean): void {
  const c = JsSIP.C as { ALLOWED_METHODS: string; ACCEPTED_BODY_TYPES: string };
  c.ALLOWED_METHODS = on ? ALLOWED_METHODS_WITH_MESSAGE : ALLOWED_METHODS;
  c.ACCEPTED_BODY_TYPES = on ? ACCEPTED_BODY_TYPES_WITH_TEXT : ACCEPTED_BODY_TYPES;
}

// éteinte tant qu'aucun port ne dit le contraire
announceMessaging(false);

export interface PortOptions {
  /** False for `"messaging": "no"` in `config.json` (ADR 0008, D13). */
  messaging?: boolean;
}

export function createJsSipPort(opts: PortOptions = {}): SipPort {
  const messagingOn = opts.messaging ?? true;
  announceMessaging(messagingOn);
  return {
    start(cfg, send) {
      let ua: JsSIP.UA;
      try {
        // enveloppé sans condition : la trace se décide paquet par paquet
        // (src/sip/trace.ts), pour que cocher la case en cours de
        // communication n'oblige pas à rouvrir le transport
        const socket = traceSocket(new JsSIP.WebSocketInterface(cfg.proxy));
        ua = new JsSIP.UA({
          sockets: [socket],
          uri: `sip:${cfg.username}@${cfg.domain}`,
          display_name: cfg.displayName,
          realm: cfg.domain,
          ha1: cfg.ha1,
          register: true,
          // le même d'un démarrage à l'autre (RFC 5626 §4.1) : sans lui,
          // JsSIP en tire un neuf et chaque réveil passe pour un appareil
          // nouveau (StoredAccount.instanceId)
          instance_id: cfg.instanceId,
          ...(cfg.authUsername ? { authorization_user: cfg.authUsername } : {}),
        });
      } catch (e) {
        // microtask : start() est appelé depuis enter(), l'événement doit
        // arriver une fois la transition vers `connecting` terminée
        queueMicrotask(() =>
          send({ type: "sip:invalidProxy", detail: e instanceof Error ? e.message : String(e) }),
        );
        return {
          stop() {},
          refresh() {
            return false;
          },
          call() {
            // jamais atteint : la machine part en reg_failed avant tout appel.
            // Message technique, non traduit : il rejoint les causes JsSIP
            // comme détail de `reason.callFailed`.
            throw new Error("SIP UA not started (invalid proxy)");
          },
          presence() {
            return NO_PRESENCE;
          },
          messaging() {
            return NO_MESSAGING;
          },
        };
      }

      // L'empreinte SHA-256 du compte, déposée le temps de cet UA : JsSIP
      // ne transmet au calcul d'un défi que ce que porte sa configuration,
      // où il n'y a de place que pour un HA1 (`sip/digest.ts`). Le drapeau
      // retient un défi resté sans réponse, pour que l'échec qui suit
      // aussitôt le dise.
      let missingSha256 = false;
      const releaseSha256 = useSha256Ha1(cfg.authUsername ?? cfg.username, cfg.domain, {
        ha1: cfg.ha1Sha256,
        onMissing: () => {
          missingSha256 = true;
        },
      });

      // Serveurs ICE du compte : JsSIP les attend par session (`pcConfig`),
      // pas sur l'UA — même configuration pour l'appel sortant et la
      // réponse à un entrant.
      const pcConfig: RTCConfiguration = { iceServers: iceServers(cfg.ice) };

      let stopped = false;
      ua.on("connected", () => send({ type: "sip:connected" }));
      ua.on("disconnected", () => {
        send({ type: "sip:disconnected" });
        if (stopped) {
          releaseSha256();
          // UA étend EventEmitter au runtime, mais les types JsSIP ne l'exposent pas
          (ua as unknown as { removeAllListeners(): void }).removeAllListeners();
        }
      });
      ua.on("registered", () => send({ type: "sip:registered" }));
      ua.on("unregistered", () => send({ type: "sip:unregistered" }));
      ua.on(
        "registrationFailed",
        (e: { cause?: string; response?: { status_code?: number } | null }) => {
          // consommé : le défi suivant peut très bien trouver réponse
          const unanswered = missingSha256;
          missingSha256 = false;
          send({
            type: "sip:registrationFailed",
            cause: e.cause ?? "cause inconnue",
            statusCode: e.response?.status_code,
            ...(unanswered ? { missingSha256: true } : {}),
          });
        },
      );
      // INVITE entrant : on ne fait que le signaler, la décision (répondre,
      // refuser) appartient aux machines. Les sessions sortantes passent
      // aussi par cet événement — elles sont déjà pilotées par call().
      // le listener est typé sur une union de deux formes d'événement :
      // on décrit la partie commune dont on a besoin
      ua.on(
        "newRTCSession",
        (e: {
          originator: string;
          session: Session;
          request: { body?: string | null; call_id?: string };
        }) => {
          if (e.originator !== "remote") return;
          send({
            type: "sip:incoming",
            call: wrapIncoming(e.session, e.request, pcConfig, cfg),
          });
        },
      );
      // SUBSCRIBE entrant : Trix ne sert pas sa présence lui-même, c'est le
      // serveur de présence qui répond à notre place (ADR 0007, D1). Sans
      // cet écouteur, JsSIP répondrait 405 — « méthode inconnue », ce qui
      // est faux ; 489 dit « paquet d'événements non pris en charge ».
      ua.on("newSubscribe", (e) => {
        // la déclaration de JsSIP omet reply(), que l'objet porte bien
        (e.request as unknown as { reply(code: number): void }).reply(489);
      });
      // ouvert à la demande, comme la présence
      let messaging: OpenMessaging | null = null;
      // MESSAGE entrant (ADR 0008) : écouté dès le départ, pour qu'un
      // message arrivé avant l'ouverture du lien reçoive 480 et non le 200
      // que JsSIP donnerait de lui-même. Messagerie éteinte : pas
      // d'écouteur, JsSIP répond 405, et `Allow` ne dit plus MESSAGE.
      if (messagingOn) {
        ua.on("newMessage", (e: unknown) => {
          const ev = e as unknown as JsSipMessageEvent;
          if (ev.originator !== "remote") return;
          (messaging ?? NO_MESSAGING).receive(jssipIncoming(ev));
        });
      }
      ua.start();

      // ouvert à la demande : un serveur sans présence ne voit partir aucun
      // SUBSCRIBE tant que PresenceMachine n'en a pas demandé
      let presence: OpenPresence | null = null;

      return {
        stop() {
          stopped = true;
          // avant ua.stop() : JsSIP n'envoie plus rien une fois l'UA en
          // fermeture, alors qu'il attend les transactions déjà parties —
          // le retrait de la publication et les désabonnements partent
          // donc avant l'unREGISTER (ADR 0007, D2)
          presence?.close();
          messaging?.close();
          // l'empreinte SHA-256 reste déposée jusqu'à `disconnected` : les
          // requêtes de fin (unREGISTER, retrait, désabonnements) peuvent
          // encore être défiées, et leur 401 arrive après ce stop()
          ua.stop();
        },
        presence(sendPresence) {
          if (stopped) return NO_PRESENCE;
          if (presence) {
            presence.rebind(sendPresence);
            return presence;
          }
          presence = openPresence({
            watcher: jssipWatcher(ua),
            publisher: (onSupport) =>
              createPublisher({ send: jssipPublishSend(ua as unknown as JsSipUa), onSupport }),
            parser: new DOMParser(),
            entity: `sip:${cfg.username}@${cfg.domain}`,
            // un tuple par UA : c'est lui que le serveur agrège avec ceux de
            // nos autres terminaux (sip/pidf.ts)
            tupleId: crypto.randomUUID(),
            send: sendPresence,
          });
          return presence;
        },
        messaging(sendMessaging) {
          if (stopped || !messagingOn) return NO_MESSAGING;
          if (messaging) {
            messaging.rebind(sendMessaging);
            return messaging;
          }
          messaging = openMessaging({ sender: jssipSender(ua), send: sendMessaging });
          return messaging;
        },
        refresh() {
          if (!ua.isConnected()) return false;
          ua.register();
          return true;
        },
        call(target, media, sendCall) {
          // avant l'INVITE : le carnet adopte le dialogue du premier qui part
          const book = openCallTrace(null);
          const session = ua.call(target, {
            mediaConstraints: { audio: media.audio, video: media.video },
            pcConfig,
          });
          bindSession(session, sendCall, cfg.rtt);
          // le contrôle média naît avant le lien texte — son écouteur `sdp`
          // doit passer avant celui du texte — mais il a besoin de savoir si
          // le texte est négocié : d'où la fonction, résolue plus tard
          let rtt: RttNegotiation | null = null;
          const control = mediaControl(session, sendCall, () => rtt?.negotiated() ?? false);
          // le texte se greffe avant que le premier SDP ne soit rédigé :
          // `ua.call()` a lancé la négociation, elle n'est pas encore
          // arrivée à l'offre (getUserMedia d'abord). C'est nous qui
          // offrons, donc nous qui créons le canal de données (RFC 8865 §5)
          rtt = openRttFor(cfg.rtt, session, "offer");
          return wrapSession(session, book, control, rtt);
        },
      };
    },
  };
}

type Session = ReturnType<JsSIP.UA["call"]>;

/** Seul point de traduction des événements d'une session JsSIP en événements de machine. */
/**
 * **Le 2xx dit où écrire la suite** — RFC 3261 §12.2.1.2 : « the UAC MUST
 * update the dialog's remote target URI with the URI from the Contact
 * header field » de la réponse finale. JsSIP ne le fait pas quand un
 * dialogue précoce existait déjà : son `Dialog.update()` ne reprend que le
 * jeu de routes, et la cible reste celle du **180 Ringing**.
 *
 * Cela ne se voit jamais tant que les deux Contact se valent. Le B2BUA du
 * déploiement, lui, annonce `Contact: sip:xxxx@0.0.0.0` dans ses 180, et
 * porte sa vraie adresse dans le 200 OK. Tout ce que nous envoyons ensuite
 * dans le dialogue part alors vers une Request-URI qui n'existe pas :
 * l'ACK passe — un B2BUA le rattache à sa transaction —, mais le
 * **re-INVITE meurt en silence**. Ni 100, ni 200, ni 488, et le
 * correspondant ne voit jamais la demande de partage (constaté en réel les
 * 2026-09-07 et 2026-09-08 : deux essais, deux re-INVITE partis vers
 * `0.0.0.0`, aucune réponse).
 *
 * On corrige donc ce que la norme exige, à l'endroit où JsSIP l'omet, et
 * seulement quand la réponse porte réellement un Contact. JsSIP émet
 * `accepted` **avant** d'envoyer l'ACK : la correction vaut donc pour tout
 * ce qui suit le 200 OK, ACK compris.
 *
 * Exporté pour les tests : le cas ne se reproduit qu'avec un intermédiaire
 * qui se contredit d'une réponse à l'autre.
 */
export function followRemoteTarget(session: Session, e: unknown): void {
  const response = (e as { response?: { parseHeader?(name: string): unknown } } | undefined)
    ?.response;
  const dialog = (session as unknown as Renegotiable)._dialog;
  if (!dialog || typeof response?.parseHeader !== "function") return;
  try {
    const contact = response.parseHeader("contact") as { uri?: unknown } | undefined;
    if (contact?.uri) dialog._remote_target = contact.uri;
  } catch {
    // un Contact absent ou illisible laisse la cible telle quelle : c'est
    // encore ce qui a le plus de chances de fonctionner
  }
}

function bindSession(
  session: Session,
  send: (ev: CallSipEvent) => void,
  /** Le transport texte du compte : sans lui, une section texte précoce ne se reconnaît pas. */
  carries: RttTransport,
): void {
  // ce que le navigateur a refusé, capté avant que JsSIP ne le réduise à
  // « WebRTC Error » : le dernier échec vu accompagne la fin de session
  let failure: MediaFailure | null = null;
  bindMediaErrors(session, (f) => {
    failure = f;
  });

  // `e` n'est pas typé par JsSIP sur cet événement (l'écouteur y est une
  // union de signatures) : c'est `earlyMediaOf` qui en tire ce qu'il faut
  session.on("progress", (e: unknown) =>
    send({ type: "sip:progress", media: earlyMediaOf(e, carries) }),
  );
  session.on("accepted", (e: unknown) => {
    followRemoteTarget(session, e);
    send({ type: "sip:accepted" });
  });
  session.on("confirmed", () => send({ type: "sip:confirmed" }));
  session.on("ended", (e) =>
    send({ type: "sip:ended", cause: causeOf(e), originator: originatorOf(e) }),
  );
  session.on("failed", (e) => {
    const cause = causeOf(e);
    const report = (): void =>
      send({
        type: "sip:failed",
        cause,
        statusCode: statusOf(e),
        originator: originatorOf(e),
        ...(failure ? { detail: failure.detail } : {}),
      });
    // JsSIP émet `failed` **avant** l'événement qui porte l'erreur quand
    // c'est setRemoteDescription qui a échoué (il répond 488, échoue la
    // session, puis seulement émet `peerconnection:…failed`). Les deux
    // partent du même `catch`, donc du même tick : rapporter au microtask
    // suivant suffit à ce que le motif ait son détail, et l'ordre des
    // événements vus par la machine ne change pas — rien d'autre n'est
    // émis entre-temps.
    if (mediaCause(cause)) queueMicrotask(report);
    else report();
  });
}

/** Causes JsSIP derrière lesquelles se cache un message du navigateur. */
const MEDIA_CAUSES: ReadonlySet<string> = new Set<string>([
  JsSIP.C.causes.WEBRTC_ERROR,
  JsSIP.C.causes.USER_DENIED_MEDIA_ACCESS,
  JsSIP.C.causes.BAD_MEDIA_DESCRIPTION,
  JsSIP.C.causes.INTERNAL_ERROR,
]);

function mediaCause(cause: string): boolean {
  return MEDIA_CAUSES.has(cause);
}

/**
 * Branche les échecs WebRTC de la session. Ils sont tracés sans condition
 * par `sip/mediaerror.ts` ; ce qui remonte ici est ce qui servira à dire
 * *pourquoi* l'appel a échoué. Les noms d'événements ne sont pas dans les
 * types de JsSIP, qui n'y déclare que les siens.
 */
function bindMediaErrors(session: Session, onFailure: (failure: MediaFailure) => void): void {
  const emitter = session as unknown as {
    on(event: string, listener: (error: unknown) => void): void;
  };
  for (const [event, op] of Object.entries(MEDIA_ERROR_EVENTS)) {
    emitter.on(event, (error) => onFailure(reportMediaError(op, error)));
  }
}

/** Codes SIP de refus : le reste de l'application raisonne en motifs. */
const REJECT: Record<RejectReason, { status_code: number; reason_phrase: string }> = {
  declined: { status_code: 603, reason_phrase: "Decline" },
  busy: { status_code: 486, reason_phrase: "Busy Here" },
  timeout: { status_code: 480, reason_phrase: "Temporarily Unavailable" },
  incompatible: { status_code: 488, reason_phrase: "Not Acceptable Here" },
};

function wrapIncoming(
  session: Session,
  request: { body?: string | null; call_id?: string },
  pcConfig: RTCConfiguration,
  cfg: AccountConfig,
): IncomingCall {
  const from = session.remote_identity;
  const offer = request.body ?? null;
  // le transport du compte fait partie de la question : une offre texte
  // d'une forme que ce poste ne sait pas ouvrir n'offre pas de texte (§4.9)
  const offered = offeredMedia(offer, cfg.rtt, sharedVideoMid(offer));
  // constaté à l'arrivée, avant que quoi que ce soit ne parte : c'est ce
  // qui permet de répondre 488 sans qu'un 180 ait été envoyé. Le transport
  // texte du compte en fait partie : lui seul dit si une offre texte seul
  // est un appel ici (§4.9)
  const problem = unsupportedOffer(offer, cfg.rtt);
  // né avec l'écoute, consulté par la réponse : c'est lui qui saura refuser
  // la vidéo d'une offre à laquelle on répond en audio seul
  let control: MediaControl | null = null;
  return {
    from: from.uri.toString(),
    displayName: from.display_name || null,
    offered,
    offerProblem: problem,
    listen(send) {
      bindSession(session, send, cfg.rtt);
      let rtt: RttNegotiation | null = null;
      control = mediaControl(session, send, () => rtt?.negotiated() ?? false);
      // le texte se greffe avant `answer()` : c'est là que JsSIP présente
      // l'offre distante, dont il faut retirer la section texte avant que
      // le navigateur ne la voie — et c'est là que naît la connexion
      // pair-à-pair, sur laquelle le canal de données du distant arrivera
      rtt = openRttFor(cfg.rtt, session, "answer");
      // le carnet ne s'ouvre qu'ici, jamais à l'arrivée de l'INVITE : un
      // second appel refusé « occupé » n'est pas écouté, et n'a donc pas de
      // carnet à voler à la communication en cours. L'INVITE, lui, est déjà
      // passé — le Call-ID sert à le rattraper.
      return wrapSession(session, openCallTrace(request.call_id ?? null), control, rtt);
    },
    answer(media) {
      // répondre « audio seul » à une offre audio + vidéo — ou « texte
      // seul » à une offre audio + texte — se dit dans la réponse SDP :
      // sans cela le navigateur répondrait `recvonly`, et l'appelant
      // continuerait d'émettre un flux que personne n'a demandé (§4.4)
      const refused = MEDIA_KINDS.filter((k) => offered[k] && !media[k]);
      if (refused.length > 0) control?.refuseMedia(refused);
      session.answer({ mediaConstraints: { audio: media.audio, video: media.video }, pcConfig });
    },
    reject(reason) {
      // le carnet est ouvert depuis `listen()` : la ligne d'erreur et le
      // 488 qui la suit y tombent ensemble, dans cet ordre
      if (reason === "incompatible" && problem) reportOfferRefused(problem, offer);
      if (!session.isEnded()) session.terminate(REJECT[reason]);
    },
  };
}

function causeOf(e: unknown): string {
  const c = (e as { cause?: unknown }).cause;
  return typeof c === "string" && c !== "" ? c : "cause inconnue";
}

function originatorOf(e: unknown): SipOriginator | undefined {
  const o = (e as { originator?: unknown }).originator;
  return o === "local" || o === "remote" || o === "system" ? o : undefined;
}

/**
 * Ce que la réponse provisoire décrit comme actif — le **média précoce**
 * de RFC 3960, lu exactement comme une réponse finale : un 183 (ou un 180)
 * porteur d'un SDP décrit des flux qui commencent *avant* le décrochage.
 *
 * Les trois médias sont lus, et c'est le fond de l'affaire : le réseau peut
 * répondre en parole, mais aussi en **langue des signes** ou en **texte
 * temps réel** — un accueil de service d'urgence, une annonce d'opérateur
 * accessible. Ne regarder que l'audio reviendrait à dire « il ne se passe
 * rien » à celui-là même à qui l'on parle.
 *
 * Sans corps, il n'y a rien sur le fil : `NO_MEDIA`, et non le repli
 * « audio seul » que `answeredMedia` applique à un SDP illisible — un 180
 * n'est pas une description muette, c'est l'absence de description.
 */
function earlyMediaOf(e: unknown, carries: RttTransport): CallMedia {
  const body = (e as { response?: { body?: unknown } | null }).response?.body;
  if (typeof body !== "string" || body.trim() === "") return NO_MEDIA;
  return answeredMedia(body, carries);
}

/** Code SIP de la réponse finale (486, 603…) quand l'échec vient du distant. */
function statusOf(e: unknown): number | undefined {
  const m = (e as { message?: { status_code?: unknown } | null }).message;
  return typeof m?.status_code === "number" ? m.status_code : undefined;
}

// ---------------------------------------------------------------------------
// Négociation des médias en cours d'appel (docs/CONCEPTION.md §4.4)
// ---------------------------------------------------------------------------

/**
 * Ce que Trix pilote de la session au-delà des médias offerts au départ :
 * refuser un flux d'une offre, l'ajouter ou le retirer en cours d'appel, et
 * dire ce que l'appel transporte réellement après chaque négociation.
 *
 * **Les deux médias y sont strictement symétriques** (ADR 0003, D5) : F.703
 * §5.3.1 prévoit noir sur blanc que l'audio soit temporairement interrompu,
 * pourvu qu'un autre média reste. Il n'y a donc pas un chemin pour la
 * caméra et un autre pour le micro — il y en a un seul, paramétré par le
 * média.
 *
 * Tout l'état média d'une session vit ici, dans une seule fermeture : les
 * pistes que nous avons ouvertes (et que nous seuls pouvons éteindre), les
 * refus en vigueur, la renégociation en vol, le dernier résultat publié.
 */
interface MediaControl {
  /** Prochaine réponse SDP : ces médias déclarés `inactive`. */
  refuseMedia(kinds: readonly MediaKind[]): void;
  /** Re-INVITE ajoutant (ou retirant) un média de l'appel. */
  setMedia(kind: MediaKind, on: boolean): void;
  /** L'offre en vol n'aura pas de conclusion : on la retire. */
  abandonMedia(): void;
  /**
   * **La Pause** (ADR 0003, D6 et D7) : tout ce que j'émets s'arrête d'un
   * coup — micro et image ensemble, comme F.703 §6.2.4 les groupe.
   *
   * **Sur le fil : rien.** `replaceTrack(null)` sur les deux émetteurs.
   * Aucune négociation, aucun aller-retour, aucun 488, aucun 491 — donc
   * **aucun échec possible**, ce qui est toute la valeur du geste :
   * quelqu'un dont on sonne à la porte n'a pas le temps d'un aller-retour
   * SIP. La reprise rattache les mêmes pistes, sans rien rouvrir.
   *
   * **Le texte n'est jamais coupé**, dans aucun sens : c'est la même raison
   * qu'en D4 — une pause qui couperait le texte reviendrait, pour un usager
   * sourd, à raccrocher sans le dire, alors que c'est justement le média qui
   * permet d'écrire « deux minutes ».
   *
   * **Le correspondant continue de vivre** : il parle, il est vu, il écrit,
   * et il reçoit tout cela de son côté. Une mise en attente `sendonly`
   * l'aurait suspendu lui aussi, pour rien — le besoin est de me retirer,
   * moi.
   */
  setPaused(on: boolean): void;
  /** Pause : tout ce que j'émets s'arrête, sans que rien ne parte sur le fil. */
  setPaused(on: boolean): void;
  /** Mon écran rejoint l'appel : transceiver `sendonly` de plus, re-INVITE. */
  startShare(): void;
  /** Mon écran quitte l'appel : m-section rendue inerte, et recyclable. */
  stopShare(): void;
  /**
   * **Muet tant que personne n'a décroché.** Les pistes émises sont
   * désactivées (`track.enabled = false`) : ce qui part est alors du
   * **noir et du silence**, et non plus rien.
   *
   * La nuance est tout l'intérêt du geste. `replaceTrack(null)` — la Pause
   * — cesse d'émettre : plus un paquet RTP, donc plus rien qui entretienne
   * l'ouverture du NAT, et l'annonce que le réseau nous joue en média
   * précoce n'aurait aucun chemin pour revenir. Une piste désactivée, elle,
   * continue de produire des trames noires et du silence : le flux tient,
   * la conversation n'a pas commencé.
   *
   * Ce qu'on y gagne est de la vie privée, et elle n'est pas théorique : un
   * 183 avec SDP établit la connexion pair-à-pair comme le ferait un
   * 200 OK. Sans cela, un serveur qui joue une annonce entend la pièce et
   * voit son occupant avant que quiconque ait décroché.
   *
   * Le silence est levé au décrochage, et à ce seul moment (`sip:accepted`).
   */
  setSilent(on: boolean): void;
  /**
   * **L'image locale, pour l'auto-vue** : un clone de la piste émise, avec
   * son propre `enabled`.
   *
   * Il existe parce que le silence d'avant le décrochage rendrait l'auto-vue
   * noire — un `<video>` branché sur une piste désactivée n'affiche rien —
   * et que se cadrer juste avant de parler est exactement ce qu'on fait à ce
   * moment-là. Même caméra, même source : aucun second capteur n'est ouvert.
   *
   * Rendu tel quel pour l'audio : le vu-mètre local doit rester à zéro tant
   * que rien ne part, sans quoi il promettrait une voix qui n'arrive nulle
   * part.
   *
   * Le miroir tient la source pour son propre compte : il s'éteint avec la
   * piste qu'il copie, et avec l'appel. C'est le contrôle média qui le sait
   * — lui seul suit la vie des capteurs.
   */
  mirror(track: MediaStreamTrack): MediaStreamTrack;
  /**
   * **La piste d'un écran partagé** — le mien ou le sien —, ou `null` s'il
   * n'y en a pas (ADR 0005, D11).
   *
   * C'est ce qui permet à l'écran de router les flux **par identité** et
   * non par ordre d'arrivée : le sien se trouve par le **MID** de sa
   * m-section (RFC 5888), le mien par l'objet que nous avons capturé. Deux
   * `m=video` arrivent dans un ordre que rien ne garantit d'une
   * renégociation à la suivante, et se tromper de flux afficherait le
   * visage à la place de l'écran — ou l'inverse, ce qui est pire.
   */
  shareTrack(side: "own" | "peer"): MediaStreamTrack | null;
  /**
   * **Les m-sections qui portent un écran** — la mienne, la sienne, ou les
   * deux —, par leur `a=mid` (ADR 0005, SC-5).
   *
   * Les statistiques en ont besoin : un rapport WebRTC range ses compteurs
   * par média, et deux `m=video` s'y additionneraient — le débit « vidéo »
   * serait celui de la caméra **plus** celui de l'écran, et l'écart
   * audio / vidéo de F.703 §5.2.2 se mesurerait sur le premier flux venu.
   * Le port est le seul à savoir ce qu'un flux est.
   */
  shareMids(): string[];
  /** Fin d'appel : les capteurs que nous avons allumés s'éteignent avec lui. */
  release(): void;
}

/**
 * **Le rôle d'un flux dans l'appel** (ADR 0005, D2).
 *
 * Le port a raisonné en `kind` tant qu'il n'y avait qu'une seule image :
 * « la » piste vidéo, c'était la caméra. Avec le partage d'écran il y en a
 * deux, et « la première `m=video` venue » devient un générateur de bugs
 * silencieux — éteindre la mauvaise caméra, ne suspendre que la moitié de
 * ce que l'on émet, refuser la mauvaise m-section. Aucun de ces cas ne
 * lève d'exception : ils rendent l'appel faux.
 *
 * Le rôle est donc explicite partout, et **sans valeur par défaut** : un
 * appelant oublié doit se voir au compilateur, pas à l'usage.
 */
export type StreamRole = "audio" | "camera" | "share";

/** Les trois rôles émis, dans l'ordre où l'appel les ouvre. */
const STREAM_ROLES: readonly StreamRole[] = ["audio", "camera", "share"];

/** Le média que transporte un rôle — un écran partagé est de la vidéo. */
function mediaOf(role: StreamRole): MediaKind {
  return role === "audio" ? "audio" : "video";
}

/** Le rôle d'un média de l'appel : celui de la conversation, jamais l'écran. */
function roleOf(kind: MediaKind): StreamRole {
  return kind === "audio" ? "audio" : "camera";
}

/**
 * Le partage tel que le port le reconnaît sur la connexion : **le nôtre par
 * identité d'objet** — nous l'avons créé —, **celui du distant par son MID**
 * (RFC 5888), retenu à la lecture de son offre.
 *
 * Ni l'ordre des m-sections, ni le `msid`, ni le fait d'être « la deuxième
 * vidéo » ne sont des identités qui survivent à une renégociation
 * (RFC 8829 §5.2.2). Le MID l'est, et lui seul.
 */
interface ShareRef {
  /**
   * Le transceiver que nous avons créé pour émettre notre écran. Vide tant
   * que l'émission n'existe pas (phase SC-2).
   */
  ours: RTCRtpTransceiver | null;
  /** Le MID de la m-section par laquelle le distant partage le sien. */
  peerMid: string | null;
}

/** Le média d'un transceiver, qu'il émette, reçoive, ou les deux. */
function kindOf(tr: RTCRtpTransceiver): string | undefined {
  return tr.receiver.track?.kind ?? tr.sender.track?.kind;
}

/** Ce transceiver porte-t-il un écran partagé plutôt qu'une caméra ? */
function isShare(tr: RTCRtpTransceiver, share: ShareRef): boolean {
  return tr === share.ours || (share.peerMid !== null && tr.mid === share.peerMid);
}

/**
 * Le transceiver d'un **rôle** sur la connexion, s'il en existe un.
 *
 * `audio` et `camera` rendent le premier transceiver de leur média qui
 * n'est **pas** celui du partage ; `share` rend celui du partage. C'est
 * toute la différence avec l'ancien « premier transceiver du média », et
 * c'est elle qui empêche le partage de se faire passer pour la caméra.
 */
function transceiverFor(
  pc: RTCPeerConnection,
  role: StreamRole,
  share: ShareRef,
): RTCRtpTransceiver | null {
  const kind = mediaOf(role);
  const wantShare = role === "share";
  return (
    pc.getTransceivers().find((tr) => kindOf(tr) === kind && isShare(tr, share) === wantShare) ??
    null
  );
}

/**
 * Ce que la connexion transporte **effectivement**, lu sur la direction
 * négociée de chaque transceiver. C'est la seule source honnête : le SDP
 * dit ce qui a été demandé, `currentDirection` dit ce qui a été conclu.
 * Un transceiver jamais négocié (`currentDirection === null`) ne compte
 * pas encore.
 *
 * **Le partage n'en fait pas partie** (ADR 0005, D3) : un écran qui passe
 * n'est pas un média de l'appel. Sans cette exclusion, retirer sa caméra
 * pendant un partage laisserait `media.video` à vrai — l'appel se dirait
 * en vidéo alors que plus personne ne se voit.
 */
function negotiatedMedia(pc: RTCPeerConnection, text: boolean, share: ShareRef): CallMedia {
  const media: CallMedia = { ...NO_MEDIA, text };
  for (const tr of pc.getTransceivers()) {
    const kind = kindOf(tr);
    if (kind !== "audio" && kind !== "video") continue;
    if (isShare(tr, share)) continue;
    if (tr.currentDirection && tr.currentDirection !== "inactive") media[kind] = true;
  }
  return media;
}

/**
 * Ce que JsSIP ne montre pas dans ses types mais que la conversation
 * totale exige :
 *
 * - `_sendReinvite` plutôt que `renegotiate()`, dont le gestionnaire
 *   d'échec **raccroche l'appel** (500 Media Renegotiation Failed) : un
 *   488 n'est pas une fin d'appel, c'est un non ;
 * - `_receiveReinvite` intercepté, parce que l'événement public
 *   `reinvite` ne se décide que sur-le-champ — or accepter la vidéo
 *   demande d'allumer une caméra, donc l'accord de l'utilisateur, donc du
 *   temps. La transaction serveur a déjà répondu 100 Trying : l'appelant
 *   patiente sans que rien n'expire.
 */
interface Renegotiable {
  /**
   * Le rôle dans le dialogue — `"outgoing"` pour l'UAC. Il ne sert qu'à une
   * chose, et elle compte : choisir la borne du délai de reprise après un
   * 491 (RFC 3261 §14.1). Les deux bornes sont disjointes, et c'est cela
   * seul qui empêche les deux bouts de se recroiser.
   */
  direction: string;
  isReadyToReOffer(): boolean;
  /**
   * Le délai de la transaction INVITE (Timer B, RFC 3261 §17.1.1.2). JsSIP
   * le câble sur ce crochet, qui **raccroche l'appel** — 408, terminé.
   * C'est juste pour l'INVITE initial, qui n'a jamais établi de
   * communication ; ça ne l'est plus pour un re-INVITE, que le distant peut
   * laisser sans conclusion sans avoir mis fin à quoi que ce soit.
   */
  onRequestTimeout(): void;
  _sendReinvite(options: {
    eventHandlers: { succeeded(response: unknown): void; failed(response?: unknown): void };
  }): void;
  _receiveReinvite(request: InDialogRequest): void;
  /**
   * Le dialogue, pour le seul drapeau qui nous concerne : tant qu'un INVITE
   * que **nous** avons émis y attend sa réponse finale (RFC 3261 §14.2),
   * `isReadyToReOffer()` reste faux. JsSIP le lève à la fin de la
   * transaction ; une offre qu'aucune réponse ne conclura jamais le
   * laisserait levé jusqu'au raccrochage, et l'appel ne renégocierait plus
   * rien du tout.
   */
  _dialog?: {
    uac_pending_reply: boolean;
    /**
     * **Où partent nos requêtes dans le dialogue** (RFC 3261 §12.2.1.1) :
     * la Request-URI de tout ce que nous émettons ensuite — ACK, re-INVITE,
     * BYE. Voir `followRemoteTarget` pour la raison d'y toucher.
     */
    _remote_target?: unknown;
  } | null;
}

/** Le re-INVITE tel que nous avons besoin de le lire et d'y répondre. */
interface InDialogRequest {
  body?: string | null;
  reply(code: number, reason?: string | null): void;
}

/**
 * Exporté pour les tests seuls : la reprise après 491 et la symétrie des
 * deux médias sont exactement ce qui casse en silence, et la seule façon
 * de les éprouver sans navigateur est d'injecter une session factice —
 * comme `sip/rttsip.ts` le fait déjà pour ses deux transports.
 */
export function mediaControl(
  session: Session,
  send: (ev: CallSipEvent) => void,
  /**
   * Le texte est-il négocié ? Le port ne le lit pas sur la connexion
   * pair-à-pair : c'est `sip/rttsip.ts` qui le sait, chacun de ses deux
   * transports à sa façon. Une fonction, et non un booléen, parce que la
   * réponse change au fil de la négociation — et qu'elle est posée à
   * chaque retour à `stable`.
   */
  textNegotiated: () => boolean,
): MediaControl {
  const raw = session as unknown as Session & Renegotiable;
  /**
   * Le partage de cet appel — le nôtre et celui du distant (ADR 0005, D2).
   * Il est **lu partout** où le port désigne un flux, et **écrit** à deux
   * endroits seulement : à la lecture d'une offre distante, et par
   * l'émission de notre propre écran.
   */
  const share: ShareRef = { ours: null, peerMid: null };
  /** Les capteurs que nous avons ouverts : personne d'autre ne les éteindra. */
  const own: Partial<Record<StreamRole, MediaStreamTrack>> = {};
  /** Médias refusés dans la prochaine réponse SDP (réponse audio à une offre A/V). */
  const refusing = new Set<MediaKind>();
  /**
   * Rien de réel ne part encore : voir `setSilent`. Vrai jusqu'au
   * décrochage — c'est le port qui le lève, seul endroit d'où l'on voit
   * passer le 200 OK.
   */
  let silent = false;
  /**
   * Pose (ou lève) le silence sur les pistes émises. Réappliqué à chaque
   * fois que la connexion bouge : les pistes n'existent pas encore quand
   * l'appel est placé — `getUserMedia` puis l'offre viennent après —, et
   * une piste qui apparaîtrait après coup émettrait la pièce.
   */
  const applySilence = (): void => {
    if (!pc) return;
    for (const role of STREAM_ROLES) {
      const track = transceiverFor(pc, role, share)?.sender.track;
      if (track) track.enabled = !silent;
    }
  };
  /** Dernier résultat publié — on ne signale que les changements. */
  let published: CallMedia | null = null;
  /**
   * Ce que notre re-INVITE en vol demande. Lu à l'arrivée de la réponse :
   * c'est la demande, et non le capteur ouvert, qui dit s'il y a eu refus —
   * le capteur, lui, a pu être refermé entre-temps par l'observateur de
   * négociation.
   */
  let asking: { role: StreamRole; on: boolean } | null = null;
  /**
   * **Une transaction de re-INVITE, la nôtre, est ouverte.** Distinct
   * d'`asking`, qui dit ce que la demande *veut* : le délai côté
   * utilisateur (28 s) tombe **avant** le Timer B de la transaction (32 s,
   * RFC 3261 §17.1.1.2) et remet `asking` à null, mais la transaction, elle,
   * vit encore quatre secondes de plus. Sans ce drapeau, le 408 qui la
   * conclut retrouvait le crochet natif de JsSIP — c'est-à-dire un BYE
   * (`Reason: cause=408`) sur un appel que personne n'avait raccroché,
   * constaté en réel le 2026-09-08 à 19:39:19, quatre secondes après un
   * abandon local.
   */
  let inFlight = false;
  /**
   * **L'offre en vol s'est déjà annoncée.** JsSIP émet `sdp` **deux fois**
   * pour une même offre de re-INVITE — une fois à la fin de la collecte
   * ICE (`_createLocalDescription`, dont le SDP est celui qui part), une
   * seconde juste avant d'écrire le message. Un seul départ, donc un seul
   * `sip:offering` : sans cela le bloc rentrait deux fois dans son état
   * d'attente, à cinq millisecondes d'intervalle.
   */
  let offered = false;
  /**
   * **Notre partage a-t-il déjà été négocié ?** C'est ce qui décide, à
   * l'abandon, entre recycler la m-section (D6) et arrêter le transceiver
   * (D7) : une m-section qui n'a jamais existé sur le fil n'a rien à
   * recycler, et le rollback ne défait pas un `addTransceiver`.
   */
  let shareNegotiated = false;
  /**
   * **L'utilisateur a dit oui à l'écran du correspondant** (ADR 0005, D5).
   *
   * Tant que ce n'est pas le cas, la m-section de son partage est répondue
   * `inactive` : ni le poste qui ne saurait pas l'afficher, ni celui dont
   * l'utilisateur vient de refuser, ne doivent laisser le distant payer le
   * débit d'une image que personne ne regarde.
   *
   * Il retombe dès que le partage quitte l'offre distante : un partage
   * suivant est une nouvelle demande, et il se repose.
   */
  let peerShareAllowed = false;
  /** Le dernier état publié du partage distant — on ne signale que les changements. */
  let peerSharing = false;
  /**
   * Une reprise après 491 est en cours. Le retour arrière qui la précède
   * ramène la connexion à `stable`, et l'observateur y verrait un appel qui
   * vient de perdre le média demandé : il éteindrait le capteur qu'on
   * s'apprête à réoffrir, et annoncerait un changement qui n'a pas eu lieu.
   * Tant que ce drapeau est levé, il ne fait ni l'un ni l'autre.
   */
  let resuming = false;
  /** Une seule reprise par renégociation : deux clients face à face boucleraient. */
  let retried = false;
  /**
   * La reprise après 491 qui attend son tour, et ce qu'elle rejouera. Le
   * délai côté utilisateur peut tomber pendant cette attente : il faut
   * pouvoir la décommander, et savoir quel capteur elle laissait ouvert.
   */
  let resumeTimer: ReturnType<typeof setTimeout> | null = null;
  let deferred: { role: StreamRole; on: boolean } | null = null;
  /**
   * Les pistes mises de côté le temps d'une pause (D7). Elles ne sont **pas**
   * arrêtées : la reprise doit être instantanée, et rouvrir un capteur
   * prendrait du temps — voire échouerait, ce qu'un geste sans échec ne peut
   * pas se permettre. Le voyant de la caméra reste donc allumé pendant la
   * pause ; c'est le prix d'une reprise qui ne demande rien à personne, et
   * le bandeau plein écran dit assez clairement ce qui se passe.
   */
  const held: Partial<Record<StreamRole, MediaStreamTrack>> = {};
  /** Les clones de l'auto-vue, par piste copiée — voir `mirror`. */
  const mirrors = new Map<MediaStreamTrack, MediaStreamTrack>();
  let paused = false;
  let pc: RTCPeerConnection | null = null;

  /** Éteint le miroir d'une piste, s'il en avait un : il tient la source. */
  const stopMirror = (track: MediaStreamTrack | null | undefined): void => {
    if (!track) return;
    mirrors.get(track)?.stop();
    mirrors.delete(track);
  };

  /**
   * Éteint le capteur qui alimentait l'appel — le nôtre comme celui que
   * JsSIP a ouvert pour l'INVITE initial. Une piste laissée vivante
   * garderait le voyant de la machine allumé alors que plus personne ne
   * reçoit le flux : c'est le genre de détail sur lequel se juge un
   * logiciel de conversation totale.
   */
  const stopSending = (conn: RTCPeerConnection | null, role: StreamRole): void => {
    const tr = conn ? transceiverFor(conn, role, share) : null;
    const track = tr?.sender.track;
    if (tr && track) {
      // la piste s'arrête dans tous les cas — c'est elle qui tient le
      // voyant du capteur allumé. La détacher du sender, en revanche,
      // n'a de sens que sur une connexion encore ouverte : `release()` est
      // appelé sur `failed`, donc après que JsSIP a fermé la sienne, et
      // `replaceTrack` y lève un InvalidStateError qui n'apprend rien.
      track.stop();
      // le clone de l'auto-vue tient la même caméra pour son compte :
      // l'oublier laisserait le voyant allumé après le retrait de la vidéo
      stopMirror(track);
      if (conn && conn.signalingState !== "closed") {
        void tr.sender.replaceTrack(null).catch(() => {});
      }
    }
    stopMirror(own[role]);
    own[role]?.stop();
    delete own[role];
    // une pause en cours tient une piste hors du sender : elle ne doit pas
    // survivre au média qui vient de quitter l'appel
    stopMirror(held[role]);
    held[role]?.stop();
    delete held[role];
  };

  /**
   * Le MID par lequel **le distant** partage son écran dans ce SDP, ou
   * `null` s'il n'y en a pas.
   *
   * Notre propre partage revient décrit dans son offre : le repli « seconde
   * `m=video` » de `sharedVideoMid` le désignerait, et nous croirions que le
   * distant partage. D'où la comparaison avec le nôtre, qui a l'identité
   * d'objet pour lui.
   */
  const peerShareMid = (sdp: string | null | undefined): string | null =>
    sharedVideoMid(sdp, share.ours?.mid ?? null);

  /**
   * **J'émets un écran** — le capteur est ouvert, quoi qu'en dise la
   * négociation en cours. C'est ce qui interdit le second partage (D9) :
   * deux écrans dans un appel, ce sont deux surfaces à caser sur un
   * téléphone et une préséance que rien ne tranche.
   */
  const weShare = (): boolean => own.share !== undefined;

  /**
   * **Le distant émet-il un écran que nous montrons ?** Deux conditions, et
   * les deux comptent : l'utilisateur a dit oui, et la m-section a été
   * négociée dans un sens qui nous en fait recevoir quelque chose.
   *
   * La direction se lit sur `currentDirection` — ce qui a été **conclu** —
   * et non sur le SDP, qui ne dit que ce qui a été demandé.
   */
  const peerShareLive = (conn: RTCPeerConnection): boolean => {
    if (share.peerMid === null || !peerShareAllowed) return false;
    const dir = conn.getTransceivers().find((t) => t.mid === share.peerMid)?.currentDirection;
    return dir === "recvonly" || dir === "sendrecv";
  };

  /**
   * **L'écran que personne n'a accepté** (ADR 0005, D5) : sa m-section est
   * répondue `inactive`.
   *
   * Deux cas y mènent, et un seul mot pour les deux : l'utilisateur vient
   * de refuser, ou bien l'écran est arrivé là où aucune question ne se pose
   * — dans l'offre initiale d'un appel entrant, par exemple. Dans les deux
   * cas **l'appel continue** — dégrader, jamais refuser (F.703 §8.3.5).
   * Laissé à lui-même, le navigateur répondrait `recvonly` : il accepterait
   * un flux que personne ne regarde, et le distant paierait le débit d'une
   * image qui ne s'affiche nulle part.
   *
   * Le rendez-vous est `have-remote-offer` : l'offre est appliquée, les
   * transceivers existent et portent leur MID, la réponse n'est pas encore
   * écrite — le même que `blockInAnswer`.
   */
  const refusePeerShare = (conn: RTCPeerConnection): void => {
    // l'utilisateur a dit oui : la m-section reste `recvonly`, et l'écran
    // du correspondant entre dans l'appel (SC-3, D5)
    if (share.peerMid === null || peerShareAllowed) return;
    const tr = conn.getTransceivers().find((t) => t.mid === share.peerMid);
    if (tr) tr.direction = "inactive";
  };

  /**
   * Après chaque négociation (retour à `stable`), l'appel dit ce qu'il
   * transporte. Un seul observateur pour tous les cas : établissement,
   * re-INVITE reçu, re-INVITE émis — l'événement ne dépend pas de qui a
   * pris l'initiative.
   */
  const watch = (conn: RTCPeerConnection): void => {
    pc = conn;
    applySilence();
    conn.addEventListener("signalingstatechange", () => {
      // les pistes apparaissent avec la première offre, bien après l'appel :
      // le silence les rattrape ici, quel que soit l'état atteint
      applySilence();
      // l'offre du distant est appliquée, la réponse n'est pas encore
      // écrite : c'est le moment de refuser son partage (SC-1)
      if (conn.signalingState === "have-remote-offer") refusePeerShare(conn);
      if (conn.signalingState !== "stable" || resuming) return;
      const media = negotiatedMedia(conn, textNegotiated(), share);
      // un média est sorti de l'appel : son capteur n'a plus de raison de
      // rester allumé
      for (const kind of MEDIA_KINDS) if (!media[kind]) stopSending(conn, roleOf(kind));
      // **L'écran du correspondant**, publié à part : ce que l'appel
      // transporte n'a pas bougé, seule la scène change (D3, D11)
      const sharing = peerShareLive(conn);
      if (sharing !== peerSharing) {
        peerSharing = sharing;
        traceNote(`écran du correspondant ${sharing ? "affiché" : "retiré"}`);
        // son partage a pris fin : le suivant sera une nouvelle demande
        if (!sharing) peerShareAllowed = false;
        send({ type: "sip:peerSharing", on: sharing });
      }
      if (published && sameMedia(published, media)) return;
      published = media;
      send({ type: "sip:mediaChanged", media });
    });
  };
  /**
   * La pause **du correspondant**, lue là où elle se voit : ses pistes
   * cessent d'émettre, et les nôtres passent `muted` en réception. Rien
   * n'est passé par SIP — c'est bien le principe (D7).
   *
   * Une piste distante est `muted` **avant** d'avoir jamais rien reçu : au
   * décroché, toutes le sont. On ne conclut donc à une pause qu'après avoir
   * vu au moins un `unmute` sur cette connexion — sans quoi tout appel
   * s'ouvrirait sur « le correspondant est en pause ».
   */
  const watchPeer = (conn: RTCPeerConnection): void => {
    let seenLive = false;
    let reported = false;
    const report = (): void => {
      const tracks = conn
        .getReceivers()
        .map((r) => r.track)
        .filter((t): t is MediaStreamTrack => t !== null && (t.kind === "audio" || t.kind === "video"));
      if (tracks.length === 0) return;
      if (tracks.some((t) => !t.muted)) seenLive = true;
      // tout ce qu'il nous envoyait s'est tu d'un coup : c'est une pause.
      // Un seul flux muet sur deux serait un incident réseau, pas un geste
      const next = seenLive && tracks.every((t) => t.muted);
      if (next === reported) return;
      reported = next;
      send({ type: "sip:peerPaused", paused: next });
    };
    const follow = (track: MediaStreamTrack): void => {
      track.addEventListener("mute", report);
      track.addEventListener("unmute", report);
    };
    conn.addEventListener("track", (e) => {
      follow((e as RTCTrackEvent).track);
      report();
    });
    for (const r of conn.getReceivers()) if (r.track) follow(r.track);
  };

  if (session.connection) {
    watch(session.connection);
    watchPeer(session.connection);
  } else {
    session.on("peerconnection", (e) => {
      watch(e.peerconnection);
      watchPeer(e.peerconnection);
    });
  }

  /**
   * Filet de la réponse SDP : le transceiver est déjà passé `inactive`
   * (voir `blockInAnswer`), cette réécriture ne fait que garantir que la
   * réponse **partie sur le fil** le dit aussi, quelle que soit la façon
   * dont le navigateur a rédigé son answer.
   */
  session.on("sdp", (e: { originator: string; type: string; sdp: string }) => {
    if (e.originator === "remote" && e.type === "offer") {
      // **Qui partage ?** L'offre distante est le seul endroit d'où le MID
      // du partage du correspondant se lise (ADR 0005, D4). Notre propre
      // partage y revient décrit lui aussi : le repli « seconde m=video »
      // le désignerait, et nous croirions que le distant partage — d'où la
      // comparaison avec le nôtre, qui a l'identité pour lui.
      share.peerMid = peerShareMid(e.sdp);
      // l'écran a quitté son offre : ce qui avait été accepté ne vaut plus,
      // et un partage suivant se redemandera (D5)
      if (share.peerMid === null) peerShareAllowed = false;
      return;
    }
    if (e.originator === "local" && e.type === "offer") {
      // **Dire ce qu'est le flux** (ADR 0005, D4) : le navigateur n'écrit
      // pas `a=content`, et sans lui deux `m=video` ne disent pas laquelle
      // est le visage. C'est la seule chose que Trix écrive dans une offre.
      const mid = share.ours?.mid;
      if (mid) e.sdp = withSharedVideo(e.sdp, mid);
      // **L'offre est écrite, et elle part dans la foulée** : JsSIP
      // n'émet cet événement qu'une fois la description locale posée et la
      // collecte ICE close, juste avant d'écrire le message. C'est donc
      // d'ici, et de nulle part ailleurs, que se compte l'attente du
      // distant — le capteur et l'ICE sont de notre côté du fil.
      //
      // `asking` sépare nos renégociations de l'offre initiale, qui part
      // avec l'INVITE et n'attend aucun verrou ; `offered` garde le premier
      // des deux passages que JsSIP fait sur la même offre.
      if (asking !== null && !offered) {
        offered = true;
        send({ type: "sip:offering" });
      }
      return;
    }
    if (refusing.size === 0 || e.originator !== "local" || e.type !== "answer") return;
    e.sdp = withoutMedia(e.sdp, [...refusing]);
  });

  /**
   * Notre flux rejoint l'appel : le capteur s'ouvre, la piste prend la
   * place du transceiver existant s'il y en a un (celui d'une offre refusée
   * plus tôt), sinon elle en crée un.
   */
  const openTrack = async (conn: RTCPeerConnection, kind: MediaKind): Promise<boolean> => {
    const role = roleOf(kind);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ [kind]: true });
      const track = stream.getTracks().find((t) => t.kind === kind);
      if (!track) return false;
      own[role] = track;
      const tr = transceiverFor(conn, role, share);
      if (tr) {
        await tr.sender.replaceTrack(track);
        tr.direction = "sendrecv";
      } else {
        conn.addTrack(track, stream);
      }
      return true;
    } catch {
      // capteur refusé par le système ou déjà pris : l'appel continue
      stopSending(conn, role);
      return false;
    }
  };

  /**
   * Ce flux quitte l'appel : transceiver rendu inactif, capteur éteint.
   *
   * **Inactif, et non arrêté** — pour le partage, c'est D6 : une m-section
   * arrêtée laisserait un port 0 dans toutes les offres suivantes, et le
   * partage d'après en ajouterait une de plus, sur un SDP qui grandirait à
   * chaque fois. Rendue inerte, elle se recycle.
   */
  const closeRole = (conn: RTCPeerConnection, role: StreamRole): void => {
    stopSending(conn, role);
    const tr = transceiverFor(conn, role, share);
    if (tr) tr.direction = "inactive";
  };

  /** Le même geste, nommé par le média — c'est ainsi que l'appel en parle. */
  const closeTrack = (conn: RTCPeerConnection, kind: MediaKind): void => {
    closeRole(conn, roleOf(kind));
  };

  /**
   * **Le partage créé pour rien** (ADR 0005, D7) — le piège de la phase, et
   * il ne se voit pas en test manuel.
   *
   * Quand notre offre est refusée, `abandon()` ramène la connexion à
   * `stable` par un rollback. Le rollback retire les transceivers créés par
   * `setRemoteDescription` — **pas ceux que l'application a créés**. Le
   * transceiver du partage survivrait donc au refus, sans MID, et la
   * *prochaine* offre, fût-elle un simple ajout d'audio, réoffrirait le
   * partage que le distant vient de refuser.
   *
   * C'est le seul endroit où D6 ne s'applique pas : la m-section n'a jamais
   * été négociée, il n'y a rien à recycler.
   */
  const dropFreshShare = (): void => {
    if (!share.ours || shareNegotiated) return;
    share.ours.stop();
    share.ours = null;
  };

  /**
   * Notre écran ouvre l'œil : le sélecteur du système s'affiche, et la
   * piste rejoint la connexion — sur la m-section rendue inerte au partage
   * précédent s'il y en a une (D6), sur une neuve sinon.
   *
   * `sendonly` et non `sendrecv` : rien n'est attendu en retour sur cette
   * m-section, et un `sendrecv` promettrait une réciprocité que D9 refuse.
   */
  const openShare = async (conn: RTCPeerConnection): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = stream.getTracks().find((t) => t.kind === "video");
      if (!track) return false;
      own.share = track;
      // « Cesser de partager » arrête la piste sans rien dire à
      // l'application : c'est le seul avis que le navigateur nous en donne
      track.addEventListener("ended", () => {
        if (own.share === track) send({ type: "sip:shareEnded" });
      });
      const tr = share.ours;
      if (tr) {
        await tr.sender.replaceTrack(track);
        tr.direction = "sendonly";
      } else {
        share.ours = conn.addTransceiver(track, { direction: "sendonly" });
        shareNegotiated = false;
      }
      return true;
    } catch {
      // sélecteur d'écran fermé, ou capture refusée par le système :
      // l'appel continue, et rien n'a été offert
      stopSending(conn, "share");
      return false;
    }
  };

  /** Le retour arrière d'une offre restée sans conclusion. */
  const rollback = (conn: RTCPeerConnection): void => {
    if (conn.signalingState === "have-local-offer")
      void conn.setLocalDescription({ type: "rollback" }).catch(() => {});
  };

  /**
   * Le délai avant de rejouer une offre qui s'est croisée avec celle du
   * distant — RFC 3261 §14.1. Les deux bornes sont disjointes selon le
   * rôle **dans le dialogue**, et c'est tout ce qui empêche les deux bouts
   * de se recroiser indéfiniment : 0 à 2 s pour l'UAC, 2,1 à 4 s pour l'UAS.
   */
  const glareDelay = (): number =>
    session.direction === "outgoing" ? Math.random() * 2000 : 2100 + Math.random() * 1900;

  /**
   * Notre offre est abandonnée : retour arrière, capteur ouvert pour rien
   * refermé, écran prévenu. **L'appel, lui, continue** — une renégociation
   * qui n'aboutit pas ne coupe pas la communication, elle la laisse telle
   * qu'elle était. `by` sépare le non du distant du silence : ce n'est pas
   * la même phrase à l'écran.
   */
  const abandon = (by: "remote" | "local", statusCode?: number): void => {
    const conn = pc;
    const wanted = asking;
    asking = null;
    retried = false;
    if (conn) {
      rollback(conn);
      if (wanted) closeRole(conn, wanted.role);
    }
    // Le dialogue est rendu à la renégociation suivante. Sur un refus ou un
    // délai de transaction, JsSIP l'a déjà fait — c'est un geste pour rien.
    // Il ne compte que là où **rien** ne conclura la transaction : le
    // distant a accusé réception (100 Trying, que la transaction serveur
    // envoie toute seule) puis s'est tu, la transaction reste en
    // `Proceeding`, plus aucune minuterie n'y touchera — et sans cela
    // l'appel ne pourrait plus rien négocier jusqu'au raccrochage.
    const dialog = raw._dialog;
    if (dialog) dialog.uac_pending_reply = false;
    if (wanted?.role === "share") {
      dropFreshShare();
      traceNote(
        wanted.on
          ? `partage d'écran refusé (${by === "remote" ? (statusCode ?? "refus") : "abandon local"})`
          : "partage d'écran arrêté",
      );
      // **un arrêt refusé n'est pas un refus** : nous n'émettons plus, quoi
      // qu'en dise le distant, et la m-section restée inactive le dira à la
      // prochaine offre. Il n'y a que le début d'un partage qui puisse se
      // refuser — c'est lui qui demandait quelque chose
      send(
        wanted.on
          ? { type: "sip:mediaRefused", by, statusCode, share: true }
          : { type: "sip:sharing", on: false },
      );
      return;
    }
    send({ type: "sip:mediaRefused", by, statusCode });
  };

  /**
   * Notre re-INVITE. L'offre locale est déjà appliquée quand la réponse
   * arrive : un refus laisse la connexion en `have-local-offer`, d'où le
   * retour arrière — sans lui, plus aucune renégociation ne serait
   * possible de tout l'appel.
   */
  const reinvite = (): void => {
    inFlight = true;
    offered = false;
    raw._sendReinvite({
      eventHandlers: {
        succeeded: (response) => {
          inFlight = false;
          const body = (response as { body?: string | null }).body;
          const wanted = asking;
          asking = null;
          retried = false;
          if (wanted?.role === "share") {
            // la m-section existe désormais dans la session, quelle que
            // soit la réponse : elle se recycle, elle ne s'arrête plus (D6)
            shareNegotiated = true;
            const mid = share.ours?.mid ?? null;
            // le refus poli d'un partage : 200 OK, écran déclaré `inactive`
            // dans la réponse — le distant a accepté la renégociation, pas
            // ce qu'elle proposait
            if (wanted.on && !(mid !== null && midActive(body, mid))) {
              if (pc) closeRole(pc, "share");
              // le refus poli ne laisse **aucune trace SIP** : c'est un
              // 200 OK comme un autre, et seule la direction d'une m-section
              // le distingue d'un oui. Sans cette ligne, le carnet d'un
              // partage refusé se lit comme celui d'un partage accepté
              traceNote("partage d'écran refusé par le distant");
              send({ type: "sip:mediaRefused", by: "remote", share: true });
            } else {
              traceNote(`partage d'écran ${wanted.on ? "démarré" : "arrêté"}`);
              send({ type: "sip:sharing", on: wanted.on });
            }
            return;
          }
          // le résultat est publié par l'observateur de négociation ; ici
          // on ne rattrape que le refus poli, celui qui répond 200 OK en
          // ayant désactivé le flux
          if (wanted?.on === true && !answeredMedia(body)[mediaOf(wanted.role)])
            send({ type: "sip:mediaRefused", by: "remote" });
        },
        failed: (response) => {
          inFlight = false;
          const conn = pc;
          const statusCode = statusOf(response ?? {});
          const wanted = asking;

          // Glare (RFC 3261 §14.1) : les deux bouts ont renégocié en même
          // temps. On reprend **une** fois, après un délai aléatoire — et le
          // capteur qu'on vient d'ouvrir reste ouvert, puisqu'on va le
          // réoffrir. S'entêter au-delà ferait boucler deux clients face à
          // face, ce que le délai seul n'empêche pas.
          if (statusCode === 491 && wanted !== null && !retried && conn !== null) {
            asking = null;
            retried = true;
            resuming = true;
            deferred = wanted;
            rollback(conn);
            resumeTimer = setTimeout(() => {
              resumeTimer = null;
              deferred = null;
              resuming = false;
              if (session.isEnded()) return;
              // **Le distant a repris la main entre-temps** : sa négociation
              // à lui a abouti, et la nôtre n'a plus lieu d'être rejouée.
              //
              // Deux partages lancés en même temps n'ont pas besoin de plus
              // que cela (D9) : le capteur que nous gardons ouvert pour la
              // reprise fait refuser le sien sur-le-champ (`weShare`), et
              // c'est notre offre qui repart. S'il a été plus rapide, c'est
              // son poste à lui qui refusera la nôtre — poliment, et nous
              // le dirons comme n'importe quel refus.
              if (!raw.isReadyToReOffer()) {
                // `abandon` et non un simple avis : c'est lui qui referme le
                // capteur ouvert pour rien et qui **arrête** le transceiver
                // du partage jamais négocié (D7) — sans quoi la prochaine
                // offre, fût-elle un simple ajout d'audio, réoffrirait
                // l'écran que personne n'attend plus
                asking = wanted;
                abandon("local");
                return;
              }
              asking = wanted;
              reinvite();
            }, glareDelay());
            return;
          }

          // sans réponse du tout (transport, délai), ce n'est pas un refus
          // du distant : la phrase affichée n'est pas la même
          abandon(statusCode ? "remote" : "local", statusCode);
        },
      },
    });
  };

  /**
   * **Le re-INVITE resté sans réponse finale.** Le distant n'a rien conclu
   * — un client qui ne sait pas répondre à une offre en cours d'appel, un
   * correspondant parti sans trancher la question posée à son écran — et
   * JsSIP en tire un 408 qui **coupe la communication**. Or personne n'a
   * raccroché : l'appel continue, simplement sans le média demandé.
   *
   * Le crochet est dévié tant qu'une **transaction de renégociation à
   * nous** est ouverte — et non tant qu'une demande attend, ce qui n'est
   * pas la même durée. Le délai côté utilisateur (28 s) tombe avant le
   * Timer B (32 s) et remet `asking` à null : quatre secondes plus tard, le
   * 408 de la transaction retrouvait le crochet natif et raccrochait un
   * appel dont l'utilisateur avait simplement vu une demande échouer. Il
   * n'y a alors plus rien à abandonner — c'est déjà fait — mais toujours
   * rien à raccrocher non plus.
   *
   * Tout le reste garde le crochet natif, à commencer par le
   * rafraîchissement de session : si celui-là expire, c'est bien que le
   * distant a disparu.
   */
  const nativeTimeout = raw.onRequestTimeout.bind(raw);
  raw.onRequestTimeout = (): void => {
    if (asking === null && !inFlight) {
      nativeTimeout();
      return;
    }
    inFlight = false;
    // l'abandon a déjà eu lieu : la transaction ne fait que finir de mourir
    if (asking === null) {
      traceNote("re-INVITE expiré après abandon — l'appel continue");
      return;
    }
    abandon("local");
  };

  /**
   * Re-INVITE reçu. Ce qui ne fait qu'ôter un média, ou n'y touche pas
   * (rafraîchissement de session), suit le chemin normal de JsSIP. **Ajouter
   * un média, en revanche, allumerait un capteur** : la réponse attend que
   * l'utilisateur ait tranché. La question vaut pour le micro comme pour la
   * caméra — allumer l'un ou l'autre demande l'accord de son propriétaire
   * (ADR 0003, D5).
   *
   * **Un écran partagé la pose aussi** (ADR 0005, D5), pour une autre
   * raison et une plus forte : accepter n'allume aucun capteur ici, mais un
   * écran partagé **prend la place de la langue des signes**. Sur un
   * téléphone il n'y a pas deux grandes surfaces — accepter, c'est reléguer
   * le visage de son correspondant dans une vignette, et cela ne se décide
   * pas pour lui (F.703 §4.5 et §6.2.4).
   *
   * Une offre qui apporte les deux ne pose **qu'une** question, et
   * l'acceptation vaut pour tout ce qu'elle porte.
   */
  const passThrough = raw._receiveReinvite.bind(raw);
  /**
   * **Le re-INVITE reçu ne doit jamais rester sans réponse de notre fait.**
   *
   * Ce handler remplace celui de JsSIP : ce qu'il ne fait pas, personne ne
   * le fera. Une exception ici — un SDP d'une forme qu'on n'attendait pas,
   * un état qui manque — laisse l'appelant sur une offre en suspens
   * jusqu'à ce que sa transaction expire, et sa trace ne montre qu'un
   * silence dont rien ne dit d'où il vient. La question ne se pose pas de
   * savoir si cela peut arriver : un poste qui a répondu 200 OK à tous les
   * re-INVITE d'un ajout de vidéo et rien à celui d'un partage se
   * comporterait exactement comme ça.
   *
   * L'issue de secours est donc le chemin normal de JsSIP — il applique
   * l'offre et répond, quitte à accepter ce que nous aurions questionné —
   * sauf si la question est déjà posée, auquel cas c'est la popup qui
   * répondra et une seconde réponse serait de trop.
   */
  const receiveReinvite = (request: InDialogRequest, asked: { yes: boolean }): void => {
    const conn = pc;
    const body = request.body ?? null;
    // le partage ne compte pas dans la question posée : une offre qui
    // n'ajoute qu'un écran n'ajoute aucun média de l'appel, et ne doit donc
    // pas faire demander « accepter la vidéo ? » (ADR 0005, D3)
    // **les deux écrans sont écartés du compte** : le nôtre, que son offre
    // décrit aussi, et le sien. Sans cela un appel où chacun partage se
    // croirait en vidéo pour deux documents qui défilent (D3, D9)
    const wanted = offeredMedia(body, "none", [share.ours?.mid ?? null, peerShareMid(body)]);
    const here = conn ? negotiatedMedia(conn, false, share) : null;
    // le texte ne pèse pas dans cette question-là : il ne s'ajoute pas par
    // re-INVITE tant que CT-6 n'existe pas, et il ne se retire jamais (D4)
    const added = conn && here ? MEDIA_KINDS.filter((k) => wanted[k] && !here[k]) : [];
    // **un écran qui arrive** : l'offre en porte un que nous n'avons pas
    // déjà accepté. Un partage qui se poursuit d'une renégociation à la
    // suivante — le distant retire son micro pendant qu'il partage — n'est
    // pas une demande de plus, et ne repose pas la question
    // **un seul partage à la fois** (D9) : si j'émets déjà un écran, le sien
    // ne pose aucune question — il est répondu `inactive` comme tout ce que
    // personne n'a accepté, et son poste y lit le refus poli que SC-2 sait
    // déjà écrire. Deux écrans partagés, ce sont deux surfaces à caser sur
    // un téléphone, et une préséance que rien ne tranche
    const asksShare =
      conn !== null && !weShare() && peerShareMid(body) !== null && !peerShareAllowed;
    // D9, et il ne laisse aucune trace SIP non plus : sa m-section est
    // répondue `inactive` dans un 200 OK ordinaire
    if (conn !== null && weShare() && !peerShareAllowed && peerShareMid(body) !== null) {
      traceNote("écran du correspondant refusé — un seul partage à la fois");
    }
    if (!conn || (added.length === 0 && !asksShare)) {
      // le carnet du **récepteur** dit ce qu'il a fait de l'offre : sans
      // cette ligne, une renégociation qui n'aboutit pas ne se lit que
      // d'un seul côté, et le silence ne se distingue pas d'un message
      // qui ne serait jamais arrivé
      traceNote(conn ? "re-INVITE reçu — répondu sans question" : "re-INVITE reçu avant la connexion");
      passThrough(request);
      return;
    }
    traceNote(
      `re-INVITE reçu — question posée : ${[...added, ...(asksShare ? ["écran"] : [])].join(", ")}`,
    );
    asked.yes = true;
    let answered = false;
    const once = (fn: () => void): (() => void) => () => {
      if (answered || session.isEnded()) return;
      answered = true;
      fn();
    };
    send({
      type: "sip:mediaOffer",
      media: wanted,
      share: asksShare,
      offer: {
        accept: once(() => {
          for (const kind of added) refusing.delete(kind);
          // dit **avant** le laissez-passer : c'est ce que `refusePeerShare`
          // lira quand l'offre appliquée fera passer la connexion en
          // `have-remote-offer`, juste avant que la réponse ne s'écrive
          if (asksShare) peerShareAllowed = true;
          void Promise.all(added.map((kind) => openTrack(conn, kind))).then((oks) => {
            // capteur impossible à ouvrir : mieux vaut le dire au distant
            // que de lui répondre un flux qui n'arrivera jamais
            if (oks.every(Boolean)) passThrough(request);
            else request.reply(488, "Not Acceptable Here");
          });
        }),
        reject: once(() => {
          for (const kind of added) refusing.add(kind);
          // l'écran refusé n'a pas de `refusing` à lui : l'offre n'est pas
          // appliquée du tout, et la session revient à ce qu'elle était
          // (RFC 3261 §14.1). Il n'y a rien à désactiver dans une réponse
          // qui ne sera pas écrite
          if (asksShare) traceNote("écran du correspondant refusé");
          request.reply(488, "Not Acceptable Here");
        }),
      },
    });
  };

  raw._receiveReinvite = (request: InDialogRequest): void => {
    const asked = { yes: false };
    try {
      receiveReinvite(request, asked);
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      traceNote(`re-INVITE : erreur de traitement (${cause})`);
      // la question est posée : la popup répondra, et une réponse de plus
      // serait une réponse de trop
      if (asked.yes) return;
      passThrough(request);
    }
  };

  return {
    refuseMedia(kinds) {
      for (const kind of kinds) refusing.add(kind);
      const block = (conn: RTCPeerConnection): void =>
        blockInAnswer(conn, kinds, (k) => refusing.has(k), share);
      if (session.connection) block(session.connection);
      else session.on("peerconnection", (e) => block(e.peerconnection));
    },
    setMedia(kind, on) {
      const conn = pc;
      // **toute commande média rend un avis**, celle qui ne peut rien
      // faire comme les autres : la machine tient son verrou jusqu'à ce
      // que le port ait parlé, et un silence l'y laisserait pour de bon
      if (!conn || session.isEnded()) {
        send({ type: "sip:mediaRefused", by: "local" });
        return;
      }
      if (!raw.isReadyToReOffer()) {
        // une négociation est déjà en vol : réessayer plus tard vaut mieux
        // que deux offres qui se croisent (RFC 3261 §14.1, « glare »)
        send({ type: "sip:mediaRefused", by: "local" });
        return;
      }
      retried = false;
      if (!on) {
        refusing.add(kind);
        asking = { role: roleOf(kind), on: false };
        closeTrack(conn, kind);
        reinvite();
        return;
      }
      refusing.delete(kind);
      void openTrack(conn, kind).then((ok) => {
        if (!ok) {
          send({ type: "sip:mediaRefused", by: "local" });
          return;
        }
        asking = { role: roleOf(kind), on: true };
        reinvite();
      });
    },
    /**
     * Le délai côté utilisateur a tranché : l'offre en vol n'aura pas de
     * conclusion. C'est le **seul** endroit d'où cette décision vient — le
     * port n'a pas de minuterie à lui, et celles de JsSIP ne couvrent pas
     * tous les cas : le Timer B ne tranche que tant qu'aucune réponse
     * provisoire n'est arrivée (`Calling`), or un 100 Trying suffit à le
     * rendre inerte. Un distant qui accuse réception puis se tait laisserait
     * l'offre en vol pour toujours.
     */
    abandonMedia() {
      // la reprise après 491 attendait son tour : elle n'a plus d'objet, et
      // le capteur qu'elle gardait ouvert est à refermer avec le reste
      if (resumeTimer !== null) {
        clearTimeout(resumeTimer);
        resumeTimer = null;
        resuming = false;
        asking = deferred;
        deferred = null;
      }
      if (asking === null) return;
      abandon("local");
    },
    /**
     * **Rien ne part sur le fil.** Les deux émetteurs lâchent leur piste, et
     * c'est tout : pas de re-INVITE, pas de `sendonly`, pas de réponse à
     * attendre — donc pas d'échec possible. La reprise rattache les mêmes
     * pistes, qui n'ont jamais cessé de tourner.
     *
     * Le texte n'apparaît pas ici, et c'est délibéré : il vit hors de la
     * connexion pair-à-pair (§4.9), et rien de ce que fait cette fonction ne
     * peut l'atteindre. C'est la meilleure garantie qu'il continue de passer
     * dans les deux sens pendant toute la pause.
     */
    setPaused(on) {
      const conn = pc;
      if (!conn || paused === on || session.isEnded()) return;
      paused = on;
      // les trois rôles ensemble : un écran qui continuerait de s'afficher
      // pendant que je suis parti casserait la promesse de la Pause de la
      // façon la plus coûteuse qui soit (ADR 0005, D10)
      for (const role of STREAM_ROLES) {
        const tr = transceiverFor(conn, role, share);
        if (!tr) continue;
        if (on) {
          const track = tr.sender.track;
          if (!track) continue;
          held[role] = track;
          void tr.sender.replaceTrack(null).catch(() => {});
        } else {
          const track = held[role];
          delete held[role];
          // la piste a pu disparaître entre-temps — le média a quitté
          // l'appel pendant la pause : il n'y a plus rien à rattacher
          if (track) void tr.sender.replaceTrack(track).catch(() => {});
        }
      }
    },
    /**
     * **Mon écran rejoint l'appel** (ADR 0005, D1). Le chemin est celui de
     * `setMedia` — capteur d'abord, offre ensuite —, avec deux différences
     * qui tiennent à ce que le partage n'est pas un média de l'appel : la
     * capture se demande à `getDisplayMedia`, et le transceiver est
     * **ajouté**, jamais substitué à la caméra.
     */
    startShare() {
      const conn = pc;
      // le même devoir d'avis que `setMedia` : rien ne se prépare, et la
      // machine doit pouvoir rendre la main
      if (!conn || session.isEnded()) {
        send({ type: "sip:mediaRefused", by: "local", share: true });
        return;
      }
      if (peerSharing) {
        // **un seul partage à la fois** (D9). L'écran le dit déjà en grisant
        // le bouton ; l'événement qui arriverait malgré tout — un clic parti
        // juste avant que son écran n'entre — est refusé ici, et non offert
        // au distant qui n'en voudrait pas
        send({ type: "sip:mediaRefused", by: "local", share: true });
        return;
      }
      if (!raw.isReadyToReOffer()) {
        // une négociation est déjà en vol : deux offres qui se croisent,
        // c'est un 491 garanti (RFC 3261 §14.1)
        send({ type: "sip:mediaRefused", by: "local", share: true });
        return;
      }
      retried = false;
      void openShare(conn).then((ok) => {
        if (!ok) {
          send({ type: "sip:mediaRefused", by: "local", share: true });
          return;
        }
        asking = { role: "share", on: true };
        reinvite();
      });
    },
    stopShare() {
      const conn = pc;
      // rien à retirer, ou plus de connexion pour le dire : l'écran ne
      // part plus de toute façon, et c'est cela qu'on rapporte
      if (!conn || !share.ours || session.isEnded()) {
        send({ type: "sip:sharing", on: false });
        return;
      }
      if (!raw.isReadyToReOffer()) {
        // rien ne peut partir maintenant — mais rien ne part non plus : la
        // piste s'arrête, et la m-section rendue inerte le dira d'elle-même
        // dans la prochaine offre, quelle qu'elle soit
        closeRole(conn, "share");
        send({ type: "sip:sharing", on: false });
        return;
      }
      retried = false;
      asking = { role: "share", on: false };
      closeRole(conn, "share");
      reinvite();
    },
    setSilent(on) {
      silent = on;
      applySilence();
    },
    mirror(track) {
      // l'audio ne se clone pas : voir le contrat
      if (track.kind !== "video") return track;
      const known = mirrors.get(track);
      if (known && known.readyState === "live") return known;
      const copy = track.clone();
      // `clone()` recopie `enabled` : copier une piste rendue muette avant
      // le décrochage donnerait un miroir noir — et il le resterait, le
      // décrochage ne réactivant que la piste du sender
      copy.enabled = true;
      mirrors.set(track, copy);
      return copy;
    },
    shareMids() {
      return [share.ours?.mid ?? null, share.peerMid].filter((m): m is string => m !== null);
    },
    shareTrack(side) {
      if (side === "own") return own.share ?? null;
      // accepté, et pas seulement offert : une m-section répondue `inactive`
      // ne porte rien, et son `receiver.track` existe pourtant
      if (!pc || share.peerMid === null || !peerShareAllowed) return null;
      const tr = pc.getTransceivers().find((t) => t.mid === share.peerMid);
      return tr?.receiver.track ?? null;
    },
    release() {
      for (const role of STREAM_ROLES) stopSending(pc, role);
      // filet : un miroir dont la piste d'origine n'est plus dans aucun
      // transceiver n'aurait rien pour l'éteindre
      for (const copy of mirrors.values()) copy.stop();
      mirrors.clear();
    },
  };
}

/**
 * Répondre sans un média à une offre qui le propose : le transceiver que
 * l'offre distante vient de créer passe `inactive` **avant** que le
 * navigateur ne rédige sa réponse. Laissé à lui-même, il répondrait
 * `recvonly` — rien d'envoyé, mais le flux du distant accepté, c'est-à-dire
 * tout le contraire de ce que l'appelé a demandé.
 *
 * Le rendez-vous est `have-remote-offer` : l'offre est appliquée, les
 * transceivers existent, la réponse n'est pas encore écrite.
 */
function blockInAnswer(
  pc: RTCPeerConnection,
  kinds: readonly MediaKind[],
  active: (kind: MediaKind) => boolean,
  share: ShareRef,
): void {
  pc.addEventListener("signalingstatechange", () => {
    if (pc.signalingState !== "have-remote-offer") return;
    for (const kind of kinds) {
      if (!active(kind)) continue;
      // le rôle, et non le média : refuser la vidéo doit fermer la caméra,
      // pas la m-section du partage qui se trouverait passer en premier
      const tr = transceiverFor(pc, roleOf(kind), share);
      if (tr) tr.direction = "inactive";
    }
  });
}

interface RtcSessionLike {
  connection: RTCPeerConnection | undefined;
  isEnded(): boolean;
  terminate(): void;
  sendDTMF(tone: string, options?: { transportType?: string }): void;
  mute(opts: { audio?: boolean; video?: boolean }): void;
  unmute(opts: { audio?: boolean; video?: boolean }): void;
  on(event: string, listener: (...args: never[]) => void): void;
}

/**
 * Échantillonne les compteurs média de la session, une fois par seconde,
 * tant qu'elle dure. C'est ici et nulle part ailleurs : la fenêtre de 10 s
 * affichée pendant l'appel et le bilan gardé par l'historique sortent des
 * **mêmes** relevés, et la connexion pair-à-pair n'est plus interrogeable
 * une fois la session terminée.
 *
 * Le réglage est consulté à chaque relevé, comme pour les paquets (§5.2) :
 * cocher la case en pleine communication fait démarrer la mesure, sans que
 * l'appel s'en aperçoive. Décochée, aucun `getStats()` n'est demandé.
 */
function collectStats(
  session: RtcSessionLike,
  control: MediaControl,
  rtt: RttNegotiation | null,
) {
  const media = createCallStats();
  const timer = setInterval(() => {
    if (session.isEnded()) return clearInterval(timer);
    if (!sipTraceEnabled()) return;
    // le texte ne passe pas par RTP : son compteur ne sort pas de
    // `getStats()` mais du canal lui-même (T.140 §5.3.2.3), et il est lu au
    // même relevé pour que les deux mesures parlent de la même seconde
    const missing = rtt?.channel.missingText() ?? null;
    // getStats() sans sélecteur : le rapport entier, celui que sip/stats.ts
    // sait réduire aux quatre sens qui nous intéressent
    // les m-sections du partage sont relues à chaque relevé : un écran peut
    // entrer et sortir en cours d'appel, et le MID du sien n'existe qu'une
    // fois son offre appliquée (ADR 0005, SC-5)
    const shares = control.shareMids();
    void session.connection?.getStats().then(
      (report) => media.push(report, Date.now(), missing, shares),
      () => {
        // connexion fermée entre deux relevés : le suivant s'arrêtera sur
        // `isEnded()`, il n'y a rien à rattraper
      },
    );
  }, STATS_SAMPLE_MS);
  return media;
}

/** Les tonalités qu'un clavier téléphonique peut produire (RFC 4733 §3.10). */
const DTMF_TONE = /^[0-9A-D*#]$/i;

/**
 * L'émetteur de tonalités de la piste audio sortante, s'il y en a une :
 * c'est lui qui insère les événements `telephone-event` dans le flux RTP.
 * Absent, il n'y a pas de RFC 4733 possible — un appel sans audio émis, ou
 * une connexion déjà refermée.
 */
function dtmfSender(pc: RTCPeerConnection | undefined): RTCDTMFSender | null {
  const sender = pc?.getSenders().find((s) => s.track?.kind === "audio");
  return sender?.dtmf ?? null;
}

/**
 * La session vue par les machines et l'UI. Exportée pour être vérifiable :
 * c'est ici que se pose — et se lève — le silence d'avant le décrochage,
 * et rien d'autre dans le port n'a la même conséquence en cas d'oubli.
 */
export function wrapSession(
  session: RtcSessionLike,
  book: CallTraceHandle,
  control: MediaControl,
  rtt: RttNegotiation | null,
): CallSession {
  const media = collectStats(session, control, rtt);
  /**
   * **Rien de réel ne part avant le décrochage** — ni son, ni image, ni
   * texte tapé. Le média précoce (RFC 3960) établit la connexion
   * pair-à-pair aussi sûrement qu'un 200 OK : sans cette précaution, un
   * serveur qui joue une annonce entendrait la pièce et verrait son
   * occupant pendant qu'elle passe.
   *
   * Ce qui part quand même est ce qui **entretient le chemin** : des trames
   * noires, du silence, et la signature de session T.140 répétée
   * (`sip/rttdc.ts`). Sans ce filet de paquets sortants, aucune passerelle
   * ne saurait où renvoyer l'annonce — et un accueil sous-titré arriverait
   * dans le vide.
   *
   * `accepted` est émis des deux côtés : par le 200 OK reçu pour un appel
   * sortant, par `answer()` pour un entrant. C'est donc bien « quelqu'un a
   * décroché », et non « nous avons appelé ».
   */
  control.setSilent(true);
  rtt?.channel.setSending(false);
  // Le décrochage, et lui seul, rend la parole. Les deux restrictions se
  // lèvent **ensemble et ici** : posées sans être levées, elles font un
  // appel qui s'établit et où rien ne passe — la panne la plus silencieuse
  // qui soit, puisque la signalisation, elle, est parfaite.
  const speakUp = (): void => {
    control.setSilent(false);
    rtt?.channel.setSending(true);
  };
  // `accepted` suffit — il est émis des deux côtés, par le 200 OK reçu pour
  // un sortant et par son envoi pour un entrant. `confirmed` (l'ACK) est là
  // en ceinture : les deux gestes sont idempotents, et le prix d'un appel
  // muet de bout en bout est trop élevé pour dépendre d'un seul événement.
  session.on("accepted", speakUp);
  session.on("confirmed", speakUp);

  // la caméra que nous avons ouverte survivrait au dialogue : JsSIP ne
  // referme que le flux qu'il a demandé lui-même
  session.on("ended", control.release);
  session.on("failed", control.release);
  // le socket texte est hors de la connexion pair-à-pair : rien ne le
  // refermerait avec l'appel, et il se reconnecterait tout seul
  const closeRtt = (): void => rtt?.close();
  session.on("ended", closeRtt);
  session.on("failed", closeRtt);
  return {
    rtt: () => rtt?.channel ?? null,
    terminate() {
      if (!session.isEnded()) session.terminate();
    },
    trace: () => book.take(),
    mediaStats: () => media.live(),
    callStats: () => media.summary(),
    setMedia(kind, on) {
      control.setMedia(kind, on);
    },
    abandonMedia() {
      control.abandonMedia();
    },
    setPaused(on) {
      control.setPaused(on);
    },
    startShare() {
      control.startShare();
    },
    stopShare() {
      control.stopShare();
    },
    sendDtmf(tone) {
      if (session.isEnded() || !DTMF_TONE.test(tone)) return false;
      // JsSIP enverrait des INFO par défaut : le transport se demande
      // explicitement (docs/CONCEPTION.md §5.6). Sans piste audio émise, il
      // se contenterait d'un avertissement dans la console et la tonalité
      // serait perdue sans que personne ne le sache — on constate d'abord.
      if (!dtmfSender(session.connection)) return false;
      try {
        session.sendDTMF(tone, { transportType: "RFC2833" });
      } catch {
        // état de session refusé par JsSIP (dialogue en train de se fermer)
        return false;
      }
      traceNote(`DTMF « ${tone} » → RFC 4733`);
      return true;
    },
    attachMedia(remote, local, screen) {
      const pc = session.connection;
      if (!pc) return;
      /** La surface porte-t-elle déjà cette piste, et elle seule ? */
      const shows = (video: HTMLVideoElement, track: MediaStreamTrack | null): boolean => {
        const tracks = video.srcObject instanceof MediaStream ? video.srcObject.getTracks() : [];
        return track === null ? tracks.length === 0 : tracks.length === 1 && tracks[0] === track;
      };
      const sync = () => {
        // les deux écrans, repérés par identité : le sien par le MID de sa
        // m-section, le mien par l'objet capturé (D11). Sans cela, l'écran
        // reçu se glisserait dans la scène à la place du visage, et le mien
        // dans l'auto-vue à la place de ma caméra
        const peerShare = control.shareTrack("peer");
        const ownShare = control.shareTrack("own");
        const rTracks = pc
          .getReceivers()
          .map((r) => r.track)
          .filter((t): t is MediaStreamTrack => t !== null && t !== peerShare);
        if (rTracks.length) remote.srcObject = new MediaStream(rTracks);
        if (local) {
          const lTracks = pc
            .getSenders()
            .map((s) => s.track)
            .filter((t): t is MediaStreamTrack => t !== null && t !== ownShare)
            .map(control.mirror);
          if (lTracks.length) local.srcObject = new MediaStream(lTracks);
        }
        // la surface de l'écran partagé : rebranchée seulement quand elle
        // change de piste — la réattacher à chaque `track` relancerait la
        // lecture pour rien
        if (screen && !shows(screen, peerShare)) {
          screen.srcObject = peerShare ? new MediaStream([peerShare]) : null;
        }
      };
      pc.addEventListener("track", sync);
      sync();
    },
  };
}
