import type { ChildExit, ChildMsg, ParentMsg, TaskResult } from "finite-state-language";
import type { AccountConfig, CallLogEntry } from "../storage/store.js";
import type { CallMedia, CallSession, CallSipEvent, SipEvent } from "../sip/port.js";

/** Contenu du formulaire de configuration. `password: null` = inchangé (conserver le HA1 existant). */
export interface ConfigForm {
  proxy: string;
  /** URI SIP saisie telle quelle (`user@domaine`, préfixe `sip:` accepté). */
  uri: string;
  displayName: string;
  /** Identifiant d'authentification si différent du userpart de l'URI, sinon null. */
  authUsername: string | null;
  password: string | null;
}

/** Commandes UI valables pendant un appel — relayées par PhoneMachine à la CallMachine. */
export type CallControlEvent =
  | { type: "ui:hangup" }
  | { type: "ui:muteMic" }
  | { type: "ui:muteCam" }
  | { type: "ui:toggleSelfView" };

/** Événements de la CallMachine (une instance par appel). */
export type CallEvent = CallControlEvent | CallSipEvent | ParentMsg;

/**
 * Vue de l'appel publiée au parent via notifyParent après chaque
 * changement significatif — c'est ce que l'UI lit dans le contexte
 * de PhoneMachine pour rendre l'écran d'appel.
 */
export interface CallView {
  state: "dialing" | "ringing" | "connected" | "hangingup";
  target: string;
  media: CallMedia;
  micMuted: boolean;
  camMuted: boolean;
  selfViewHidden: boolean;
  /** Timestamp du 200 OK ; l'UI en dérive le chrono. */
  connectedAt: number | null;
  /** Qui a mis fin à l'appel, connu à partir de hangingup/fin de session. */
  endedBy: "local" | "remote" | "network" | null;
  session: CallSession | null;
}

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
  | ChildMsg
  | ChildExit
  | SipEvent
  // boot : configuration + historique du compte, chargés d'un seul tenant
  | TaskResult<"loadConfig", { config: AccountConfig | null; history: CallLogEntry[] }>
  // sauvegarde : rend l'historique du compte (re)configuré
  | TaskResult<"saveConfig", CallLogEntry[]>;
