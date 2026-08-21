import type { SbbReturn, TaskResult } from "finite-state-language";
import type { AccountConfig, CallDirection, CallLogEntry } from "../storage/store.js";
import type { CallMedia, CallSession, CallSipEvent, SipEvent } from "../sip/port.js";
import type { Msg } from "../i18n/types.js";

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
  | { type: "ui:muteMic" }
  /**
   * L'icône de la caméra, en conversation totale : elle ajoute la vidéo à
   * l'appel si elle n'y est pas, l'en retire si elle y est. Il n'y a pas
   * de « couper sa caméra » — cesser d'émettre son image, c'est retirer la
   * vidéo de l'appel, et le distant doit le savoir (docs/CONCEPTION.md §4.4).
   */
  | { type: "ui:toggleVideo" }
  /** Décision sur la vidéo que le distant propose d'ajouter en cours d'appel. */
  | { type: "ui:acceptVideo" }
  | { type: "ui:rejectVideo" }
  | { type: "ui:toggleSelfView" }
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
  state: "dialing" | "ringing" | "ringing_in" | "answering" | "connected" | "hangingup";
  direction: CallDirection;
  target: string;
  /** Nom affiché de l'appelant (entrant), s'il en porte un. */
  displayName: string | null;
  /** Entrant : médias proposés par l'INVITE — décide des réponses possibles. */
  offered: CallMedia;
  /** Médias effectivement négociés — ce que l'appel transporte à cet instant. */
  media: CallMedia;
  micMuted: boolean;
  selfViewHidden: boolean;
  /** Notre demande d'ajout ou de retrait de la vidéo est en vol : l'icône attend. */
  videoPending: boolean;
  /** Le distant demande à ajouter la vidéo : l'écran pose la question. */
  videoAsked: boolean;
  /** Dernier message fugace à afficher, s'il y en a eu un. */
  notice: CallNotice | null;
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
  | { type: "ui:configure" }
  | { type: "ui:cancelConfig" }
  | { type: "ui:saveConfig"; form: ConfigForm }
  | { type: "ui:useAccount" }
  | { type: "ui:retry" }
  | { type: "ui:backToSettings" }
  | { type: "ui:logout" }
  | { type: "ui:call"; target: string; media: CallMedia }
  | { type: "ui:clearHistory" }
  /** Veille / réveil de la machine (détectés par src/ui/lifecycle.ts). */
  | { type: "sys:sleep" }
  | { type: "sys:wake" }
  | CallControlEvent
  | CallSipEvent
  | CallReturn
  | SipEvent
  // boot : configuration + historique du compte, chargés d'un seul tenant
  | TaskResult<"loadConfig", { config: AccountConfig | null; history: CallLogEntry[] }>
  // sauvegarde : rend l'historique du compte (re)configuré
  | TaskResult<"saveConfig", CallLogEntry[]>;
