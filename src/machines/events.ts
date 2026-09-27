import type { SbbReturn, TaskResult } from "finite-state-language";
import type { CallDirection, CallLogEntry, Contact, Vault } from "../storage/store.js";

/** Ce qu'un compte emporte avec lui en prenant la main : son historique et son carnet. */
export interface AccountData {
  history: CallLogEntry[];
  contacts: Contact[];
}
import type {
  CallMedia,
  CallSession,
  CallSipEvent,
  MediaKind,
  SipEvent,
} from "../sip/port.js";
import type { Msg } from "../i18n/types.js";
import type { RttTransport } from "../sip/rtt.js";

/** Contenu du formulaire de configuration. `password: null` = inchangé (conserver le HA1 existant). */
export interface ConfigForm {
  proxy: string;
  /** URI SIP saisie telle quelle (`user@domaine`, préfixe `sip:` accepté). */
  uri: string;
  displayName: string;
  /** Identifiant d'authentification si différent du userpart de l'URI, sinon null. */
  authUsername: string | null;
  password: string | null;
  /** Flash visuel à l'appel entrant (accessibilité sourds), réglage du compte. */
  flashAlert: boolean;
  /** Serveur STUN (`hôte[:port]`) ; vide = aucun. */
  stun: string;
  /** Serveur TURN (`hôte[:port]`) ; vide = aucun, les trois champs suivants sont alors ignorés. */
  turn: string;
  turnUsername: string;
  /** null = inchangé (conserver le mot de passe TURN enregistré). */
  turnPassword: string | null;
  /** TURN sur TLS (`turns:`). */
  turnTls: boolean;
  /** Transport du texte en temps réel — WebSocket ou canal de données. */
  rtt: RttTransport;
}

/**
 * Champ du formulaire mis en cause par le dernier échec — surligné au
 * retour sur les paramètres, pour dire où chercher plutôt que d'annoncer
 * une erreur en l'air.
 */
export type SuspectField = "proxy" | "credentials" | "stun" | "turn";

/** Commandes UI valables pendant un appel — consommées par le bloc CallBlock. */
export type CallControlEvent =
  | { type: "ui:hangup" }
  /**
   * Les deux boutons média de la pastille, **strictement symétriques**
   * (ADR 0003, D5 et D6) : chacun ajoute son média à l'appel s'il n'y est
   * pas, l'en retire s'il y est. Il n'y a pas de « couper son micro » ni de
   * « couper sa caméra » — cesser d'émettre un flux, c'est le retirer de
   * l'appel, et le distant doit le savoir (docs/CONCEPTION.md §4.4).
   *
   * Se taire un instant sans rien changer à l'appel est un autre geste, sur
   * un autre axe : la Pause, qui ne passe par aucune signalisation.
   */
  | { type: "ui:toggleMedia"; kind: MediaKind }
  /** Décision sur le média que le distant propose d'ajouter en cours d'appel. */
  | { type: "ui:acceptMedia" }
  | { type: "ui:rejectMedia" }
  /**
   * **Axe 2** (ADR 0003, D6) : le bouton unique qui coupe d'un coup tout ce
   * que j'émets — micro et image ensemble, comme F.703 §6.2.4 les groupe.
   *
   * Ce n'est pas un contrôle média : il ne change rien à ce que l'appel
   * transporte, rien ne part sur le fil, et il ne peut donc pas échouer. Il
   * parle de moi, pas de l'appel.
   */
  | { type: "ui:togglePause" }
  /**
   * **Partager son écran**, ou cesser de le faire (ADR 0005). Ce n'est pas
   * un bouton média : le partage n'est pas un média de l'appel, il ne compte
   * pas dans « ne pas retirer le dernier », et l'historique ne le consigne
   * pas. C'est un épisode dans une conversation, pas une nature d'appel.
   *
   * Il partage en revanche le **verrou** des commandes média (ADR 0003, D5) :
   * une renégociation à la fois, quoi qu'elle porte.
   */
  | { type: "ui:toggleShare" }
  | { type: "ui:toggleSelfView" }
  /**
   * Une tonalité DTMF composée au clavier de l'appel (`0-9`, `*`, `#`) —
   * une par événement : c'est une touche pressée, pas une séquence.
   */
  | { type: "ui:dtmf"; tone: string }
  /** Appel entrant : répondre avec la combinaison choisie parmi les médias proposés. */
  | { type: "ui:answer"; media: CallMedia }
  | { type: "ui:reject" };

/**
 * Message fugace de l'appel — « Bob n'a pas accepté la vidéo ». Il ne
 * décrit pas un état mais un événement qui vient de passer : l'écran
 * l'affiche quelques secondes puis l'oublie, d'où le numéro d'ordre, seul
 * moyen pour lui de distinguer un nouveau message d'un rendu de plus.
 */
export interface CallNotice {
  seq: number;
  message: Msg;
}

/**
 * Vue de l'appel, écrite par CallBlock **directement dans le contexte de
 * PhoneMachine** — le bloc partage ce contexte, il n'a pas de miroir à
 * tenir à jour. C'est ce que l'UI lit pour rendre l'écran d'appel.
 */
export interface CallView {
  /**
   * `early_media` est l'attente d'une réponse, comme `ringing`, mais le
   * réseau y envoie déjà du son (RFC 3960) : c'est ce qui décide du
   * silence du retour d'appel local (`ui/ring.ts`, F.703 §6.1.2).
   */
  state:
    | "dialing"
    | "ringing"
    | "early_media"
    | "ringing_in"
    | "answering"
    | "connected"
    | "hangingup";
  direction: CallDirection;
  target: string;
  /** Nom affiché de l'appelant (entrant), s'il en porte un. */
  displayName: string | null;
  /** Entrant : médias proposés par l'INVITE — décide des réponses possibles. */
  offered: CallMedia;
  /** Médias effectivement négociés — ce que l'appel transporte à cet instant. */
  media: CallMedia;
  selfViewHidden: boolean;
  /**
   * Une renégociation est en vol — **une seule à la fois, quel que soit le
   * média qu'elle porte** (ADR 0003, D5). Deux re-INVITE en vol sur la même
   * boîte de dialogue, c'est un 491 garanti : le verrou est donc un état de
   * l'appel, pas du média, et les deux icônes attendent ensemble.
   */
  mediaPending: boolean;
  /**
   * Le distant demande à ajouter un média : l'écran pose la question. `null`
   * quand il n'y en a pas — sinon, ce qu'il propose d'ajouter, pour que la
   * question le nomme.
   */
  mediaAsked: MediaKind[] | null;
  /**
   * La question posée porte sur un **écran partagé** (ADR 0005, D5). Elle
   * ne se pose pas pour la même raison que les autres : accepter n'allume
   * aucun capteur ici, mais un écran partagé prend la place de la langue
   * des signes, et sur un téléphone il n'y a pas deux grandes surfaces.
   *
   * Avec `mediaAsked` vide, c'est une offre qui n'apporte qu'un écran ;
   * avec des médias dedans, c'est une offre qui apporte les deux — et la
   * question reste unique.
   */
  shareAsked: boolean;
  /**
   * **Je suis en pause** : rien de ce que j'émets ne part. L'appel n'a pas
   * changé de nature — `media` dit toujours la même chose — et le texte
   * continue de passer dans les deux sens (D7).
   */
  paused: boolean;
  /**
   * **Le correspondant est en pause.** Lu sur ses pistes devenues muettes,
   * jamais sur SIP : c'est l'avis explicite que F.703 §6.2.4 réclame pour
   * une vidéo suspendue, et il remplace l'image figée que l'on verrait
   * sinon.
   */
  peerPaused: boolean;
  /**
   * **Ce que j'émets d'écran** (ADR 0005, D3). Trois états et non deux :
   * `starting` est le temps de la renégociation, distinct de `mediaPending`
   * par ce qu'il affiche, confondu avec lui par ce qu'il verrouille — le
   * bouton de partage est grisé pendant toute renégociation, quelle qu'elle
   * soit.
   *
   * L'arrêt, lui, n'a pas d'état d'attente : la piste est morte dès qu'on
   * le demande, plus rien ne part, et le re-INVITE qui suit ne fait que le
   * dire. Annoncer « arrêt en cours » promettrait un écran encore visible.
   */
  sharing: "off" | "starting" | "on";
  /**
   * **Le correspondant partage son écran.** L'appel n'a pas changé de
   * nature — `media` dit toujours la même chose —, c'est la **scène** qui
   * change : l'écran prend la grande surface, sa caméra passe en vignette,
   * et l'auto-vue se replie (D11).
   *
   * Un booléen et non trois états : recevoir ne se demande pas, cela
   * arrive. Ce qui s'attend, c'est la réponse à la question posée avant —
   * et elle vit dans `shareAsked`.
   */
  peerSharing: boolean;
  /**
   * Les tonalités DTMF composées depuis le début de l'appel, dans l'ordre,
   * et seulement celles qui sont **parties**. Rien d'autre ne les rejoue :
   * un DTMF ne s'entend pas ici, il n'apparaît dans aucun paquet SIP, et
   * l'application s'adresse d'abord à des sourds — les lire à l'écran est
   * la seule confirmation qu'ils existent (docs/CONCEPTION.md §4.8).
   */
  dtmfSent: string;
  /** Dernier message fugace à afficher, s'il y en a eu un. */
  notice: CallNotice | null;
  /**
   * En `early_media` : **ce que le réseau émet déjà**, avant le décrochage
   * (RFC 3960). Les trois médias, parce qu'un accueil peut être parlé,
   * signé ou écrit — et c'est ce détail qui décide du retour d'appel local
   * (`ui/ring.ts`) : une annonce en langue des signes ou en texte
   * n'apporte aucun son, la tonalité doit donc continuer.
   *
   * `NO_MEDIA` dans tous les autres états.
   */
  earlyMedia: CallMedia;
  /** Timestamp du 200 OK ; l'UI en dérive le chrono. */
  connectedAt: number | null;
  /** Qui a mis fin à l'appel, connu à partir de hangingup/fin de session. */
  endedBy: "local" | "remote" | "network" | null;
  session: CallSession | null;
}

/**
 * Ce que CallBlock rapporte à son hôte (`finite-state-language` §8.4).
 * Un outcome par ligne d'historique possible : le bloc a suivi l'appel,
 * c'est lui qui sait comment il s'est terminé — PhoneMachine n'a plus à
 * le redériver de `endedBy`, d'un timestamp et d'un code de sortie.
 *
 * `data` porte de quoi écrire la ligne, et rien d'autre : ce que l'UI
 * doit voir pendant l'appel passe par le contexte partagé (`ctx.call`).
 */
export type CallReturn =
  /** Établi puis raccroché normalement, d'un côté ou de l'autre. */
  | SbbReturn<"call", "answered", { connectedAt: number; media: CallMedia; endedBy: "local" | "remote" }>
  /** Établi puis coupé : perte du transport, ou fin de session imputée au réseau. */
  | SbbReturn<"call", "dropped", { connectedAt: number | null; media: CallMedia; reason: Msg }>
  /** Sortant refusé par le distant, ou impossible à placer. */
  | SbbReturn<"call", "rejected", { reason: Msg }>
  /** Sortant abandonné par l'utilisateur avant toute réponse. */
  | SbbReturn<"call", "canceled", { reason: Msg }>
  /**
   * Entrant jamais décroché. `failed` sépare les deux cas que l'historique
   * consigne pareil mais que l'écran ne doit pas montrer pareil : refusé ou
   * manqué (rien à signaler), contre échoué techniquement — média refusé par
   * l'OS, réponse finale d'erreur après le décrochage — où la cause s'affiche.
   */
  | SbbReturn<"call", "missed", { reason: Msg; failed: boolean }>;

export type PhoneEvent =
  /** Ouvrir le formulaire sur un compte du coffre, ou vide (`id: null`) pour en ajouter un. */
  | { type: "ui:configure"; id: string | null }
  | { type: "ui:cancelConfig" }
  | { type: "ui:saveConfig"; form: ConfigForm }
  /** Supprimer le compte que le formulaire modifie — avec son historique. */
  | { type: "ui:deleteAccount" }
  /** S'enregistrer sur ce compte, depuis l'accueil. */
  | { type: "ui:useAccount"; id: string }
  /**
   * Passer à l'autre compte, depuis l'en-tête de l'écran d'appel. Interdit
   * dès la première sonnerie : `CallBlock` consomme l'événement sans effet
   * s'il lui parvient malgré un bouton grisé.
   */
  | { type: "ui:switchAccount"; id: string }
  | { type: "ui:retry" }
  | { type: "ui:backToSettings" }
  | { type: "ui:logout" }
  | { type: "ui:call"; target: string; media: CallMedia }
  | { type: "ui:clearHistory" }
  /**
   * Carnet de contacts du compte actif (ADR 0007, D7). `uri` est la saisie
   * telle quelle : la machine la normalise, et refuse ce qui n'est pas une
   * adresse.
   */
  | { type: "ui:addContact"; name: string; uri: string }
  | { type: "ui:renameContact"; id: string; name: string }
  | { type: "ui:removeContact"; id: string }
  /**
   * Endormissement / réveil, machine **ou** page (ADR 0006, `ui/lifecycle.ts`) :
   * veille de l'ordinateur constatée au saut d'horloge, gel de l'onglet par
   * l'Économiseur d'énergie, départ en bfcache ou fermeture de la page.
   * Tous mènent au même endroit — `sleeping` désenregistre, le réveil
   * réenregistre — parce qu'un contact laissé vivant chez un registrar qui
   * n'a plus personne au bout du fil est le pire des deux mondes (D3).
   */
  | { type: "sys:sleep" }
  | { type: "sys:wake" }
  | CallControlEvent
  | CallSipEvent
  | CallReturn
  | SipEvent
  /**
   * boot : coffre, historique et carnet du compte actif, chargés d'un seul tenant.
   * `activeId` n'est pas forcément celui du coffre — le marqueur de reprise
   * (ADR 0006, D4) peut en désigner un autre, et c'est alors *son*
   * historique qui a été lu. `resume` dit que ce marqueur a parlé : sans
   * lui, l'amorçage s'arrête sur l'accueil.
   */
  | TaskResult<
      "loadVault",
      {
        vault: Vault;
        activeId: string | null;
        resume: boolean;
        history: CallLogEntry[];
        contacts: Contact[];
      }
    >
  // écriture du coffre : rend l'historique et le carnet du compte qui prend la main
  | TaskResult<"saveVault", AccountData>
  // suppression : coffre amputé écrit, puis historique et carnet effacés
  | TaskResult<"deleteAccount", void>;
