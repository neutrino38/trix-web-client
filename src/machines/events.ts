import type { TaskResult } from "finite-state-language";
import type { AccountConfig } from "../storage/store.js";
import type { SipEvent } from "../sip/port.js";

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

export type PhoneEvent =
  | { type: "ui:configure" }
  | { type: "ui:cancelConfig" }
  | { type: "ui:saveConfig"; form: ConfigForm }
  | { type: "ui:useAccount" }
  | { type: "ui:retry" }
  | { type: "ui:backToSettings" }
  | { type: "ui:logout" }
  | SipEvent
  | TaskResult<"loadConfig", AccountConfig | null>
  | TaskResult<"saveConfig", void>;
