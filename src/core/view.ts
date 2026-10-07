/**
 * What a UI sees of Trix (ADR 0011, D3): one immutable snapshot, computed
 * from the three machines and the conversation, and nothing of their
 * insides — no FSL state name, no port object.
 *
 * **Structural sharing**: a sub-view whose inputs did not change keeps its
 * reference from one snapshot to the next. Each one is memoized on the
 * references it is computed from — the machines never change a list in
 * place, they set a new one (`ctx.history = […]`) —, so a UI compares by
 * `===` and a reactive framework skips what did not move.
 *
 * Fields added here are not a break; fields removed or renamed are (D10).
 */

import { addressOf } from "../accounts.js";
import type { Deployment } from "../deployment.js";
import type { Msg } from "../i18n/types.js";
import type { CallView, SuspectField } from "../machines/events.js";
import {
  shownPrompt,
  unreadByKey,
  type MessagingCtx,
  type MessagingInstance,
  type Quarantined,
} from "../machines/messaging.js";
import { activeAccount, editedAccount, type PhoneInstance } from "../machines/phone.js";
import {
  publishedPresence,
  type ContactPresence,
  type PresenceInstance,
} from "../machines/presence.js";
import type { PublishedPresence } from "../sip/pidf.js";
import type { RttTransport, RttState } from "../sip/rtt.js";
import type { ChatItem } from "../sip/transcript.js";
import type { ResumeStore, StatusPrefs } from "../storage/session.js";
import type { CallLogEntry, Contact, MessageEntry, StoredAccount } from "../storage/store.js";
import type { Conversation } from "./conversation.js";
import { reachabilityOf, reachabilityWanted, type Reachability } from "./reachability.js";
import { buildThreads, type Thread } from "./thread.js";

/** Which screen the state calls for — not the machine's state, a stable projection of it. */
export type Phase = "loading" | "vaultError" | "accounts" | "settings" | "ready" | "inCall";

/**
 * Where the registration stands. More than registered or not: each of these
 * deserves its own words on screen, and an affiliate must not have to read
 * the machine to find them.
 */
export type Registration =
  | "off"
  | "connecting"
  | "registering"
  | "registered"
  | "switching"
  | "reconnecting"
  | "offline"
  | "sleeping"
  | "failed"
  | "unregistering";

/** An account as a UI may show it: no digest, no TURN password. */
export interface AccountView {
  id: string;
  /** `user@domain`, what identifies it (`accounts.ts`). */
  address: string;
  displayName: string;
  proxy: string;
  domain: string;
  username: string;
  authUsername: string | null;
  flashAlert: boolean;
  stun: string | null;
  turn: { host: string; username: string; tls: boolean } | null;
  rtt: RttTransport;
  /** The messaging file store, empty for none (ADR 0012, D1). */
  fileStore: string;
  /** A SHA-256 digest is kept: a server that challenges with it will be answered. */
  sha256: boolean;
}

/** The settings form's frame: the form itself is each UI's own. */
export interface SettingsView {
  /** The account being edited, `null` when one is being added. */
  editing: AccountView | null;
  /** The field the last failure blames, to highlight. */
  suspect: SuspectField | null;
  /** What is being written: the account, or its removal. */
  busy: "saving" | "deleting" | null;
}

/** The real-time text of the call in progress (ADR 0011, D5). */
export interface ConversationView {
  items: readonly ChatItem[];
  link: RttState;
  /** The link died without ever serving: the peer did not want text. */
  refused: boolean;
  /** What the input shows. */
  draft: string;
  /** When the deferred correction leaves, `0` when none waits. */
  holdUntil: number;
}

export type PresenceState = "off" | "live" | "noWatch" | "stale" | "disabled";

export interface PresenceView {
  state: PresenceState;
  /** My chosen status, its note, its two automatic rules (ADR 0007, D5). */
  prefs: StatusPrefs;
  /** What the others see of me, rules applied. */
  shown: { state: PublishedPresence; note: string | null };
  /** What the server takes; `null` until learnt. */
  support: { subscribe: boolean | null; publish: boolean | null };
  /** By contact URI. */
  contacts: Readonly<Record<string, ContactPresence>>;
}

/**
 * `disabled`: turned off by the deployment; `off`: no account yet;
 * `offline`: an account, not registered — what is written waits (D3).
 */
export type MessagingState = "disabled" | "off" | "offline" | "online";

export interface MessagingView {
  state: MessagingState;
  enabled: boolean;
  /** The account's vault is read: what comes after is news (D10). */
  loaded: boolean;
  /** Every message of the account, both ways, oldest first. */
  messages: readonly MessageEntry[];
  /** Unread incoming messages, all correspondents together. */
  unread: number;
  /** By correspondent key. */
  unreadByKey: ReadonlyMap<string, number>;
  /** The unknown senders held, in turn (ADR 0008, D5). */
  quarantine: readonly Quarantined[];
  /** The one to ask about now, if any. */
  prompt: Quarantined | null;
  /** The server answered 405 or 501 to a MESSAGE. */
  unsupported: boolean;
  /** The account has a file store: files can be sent (ADR 0012, D1). */
  canSendFiles: boolean;
}

export interface ReachabilityView {
  /** Can a call reach us (ADR 0006, D1)? */
  level: Reachability;
  /** Did the person want to be reachable — is an absence worth saying? */
  wanted: boolean;
}

export interface TrixView {
  phase: Phase;
  registration: Registration;
  /** What the operator pins (`config.json`). */
  deployment: Deployment;
  /** The account in use, `null` until one is chosen. */
  account: AccountView | null;
  accounts: readonly AccountView[];
  /** Set in the `settings` phase only. */
  settings: SettingsView | null;
  call: CallView | null;
  /** The call's real-time text, while a call carries a text channel. */
  conversation: ConversationView | null;
  history: readonly CallLogEntry[];
  contacts: readonly Contact[];
  /** The Exchanges thread: one line per correspondent (`core/thread.ts`). */
  threads: readonly Thread[];
  presence: PresenceView;
  messaging: MessagingView;
  reachability: ReachabilityView;
  errors: {
    last: Msg | null;
    /** The technical code shown under it ("SIP 404", "WSS_CONNECT"). */
    code: string | null;
    call: Msg | null;
    contact: Msg | null;
  };
}

const PHASE: Record<string, Phase> = {
  initial_state: "loading",
  wiping_vault: "loading",
  vault_error: "vaultError",
  home: "accounts",
  configuring: "settings",
  reconfiguring: "settings",
  saving: "settings",
  deleting: "settings",
  in_call: "inCall",
};

const REGISTRATION: Record<string, Registration> = {
  connecting: "connecting",
  registering: "registering",
  ready: "registered",
  in_call: "registered",
  switching: "switching",
  reconnecting: "reconnecting",
  offline: "offline",
  sleeping: "sleeping",
  reg_failed: "failed",
  unregistering: "unregistering",
};

const MESSAGING_STATE: Record<string, MessagingState> = {
  disabled: "disabled",
  offline: "offline",
  online: "online",
};

const PRESENCE_STATE: Record<string, PresenceState> = {
  live: "live",
  no_watch: "noWatch",
  stale: "stale",
  disabled: "disabled",
};

export function phaseOf(state: string): Phase {
  return PHASE[state] ?? "ready";
}

export function registrationOf(state: string): Registration {
  return REGISTRATION[state] ?? "off";
}

function accountView(a: StoredAccount): AccountView {
  return {
    id: a.id,
    address: addressOf(a),
    displayName: a.displayName,
    proxy: a.proxy,
    domain: a.domain,
    username: a.username,
    authUsername: a.authUsername,
    flashAlert: a.flashAlert,
    stun: a.ice.stun,
    turn: a.ice.turn ? { host: a.ice.turn.host, username: a.ice.turn.username, tls: a.ice.turn.tls } : null,
    rtt: a.rtt,
    fileStore: a.fileStore,
    sha256: a.ha1Sha256 !== "",
  };
}

/**
 * The last result, kept as long as the inputs are the same references.
 * One per sub-view: that is all structural sharing takes.
 */
function memo<A extends readonly unknown[], R>(compute: (...args: A) => R): (...args: A) => R {
  let last: { args: A; value: R } | null = null;
  return (...args: A): R => {
    if (last && last.args.length === args.length && last.args.every((a, i) => a === args[i])) return last.value;
    const value = compute(...args);
    last = { args, value };
    return value;
  };
}

export interface ViewSources {
  phone: PhoneInstance;
  presence: PresenceInstance;
  messaging: MessagingInstance;
  conversation: Conversation;
  /** Bumped by every conversation event: its own getters are not references. */
  conversationRevision: () => number;
  session: ResumeStore;
}

/**
 * A view builder for one instance: call it after each change, it returns
 * the same `TrixView` when nothing it shows moved.
 */
export function createViewBuilder(src: ViewSources): () => TrixView {
  const accounts = memo((list: readonly StoredAccount[]) => list.map(accountView));
  const account = memo(
    (list: readonly AccountView[], id: string | null) => list.find((a) => a.id === id) ?? null,
  );
  const settings = memo(
    (
      phase: Phase,
      list: readonly AccountView[],
      editing: string | null,
      suspect: SuspectField | null,
      busy: SettingsView["busy"],
    ) =>
      phase === "settings"
        ? { editing: list.find((a) => a.id === editing) ?? null, suspect, busy }
        : null,
  );
  const conversation = memo(
    (_revision: number, on: boolean): ConversationView | null => {
      if (!on) return null;
      const c = src.conversation;
      return { items: c.items(), link: c.link(), refused: c.refused(), draft: c.draft(), holdUntil: c.holdUntil() };
    },
  );
  const threads = memo(buildThreads);
  const presence = memo(
    (
      state: string,
      prefs: StatusPrefs,
      inCall: boolean,
      idle: boolean,
      support: PresenceView["support"],
      contacts: PresenceView["contacts"],
    ): PresenceView => ({
      state: PRESENCE_STATE[state] ?? "off",
      prefs,
      shown: publishedPresence(prefs, inCall, idle),
      support,
      contacts,
    }),
  );
  const messaging = memo(
    (
      state: string,
      loaded: boolean,
      messages: MessagingCtx["messages"],
      quarantine: MessagingCtx["quarantine"],
      prompt: Quarantined | null,
      unsupported: boolean,
      canSendFiles: boolean,
    ): MessagingView => {
      const byKey = unreadByKey(messages);
      let unread = 0;
      for (const n of byKey.values()) unread += n;
      return {
        state: MESSAGING_STATE[state] ?? "off",
        enabled: state !== "disabled",
        loaded,
        messages,
        unread,
        unreadByKey: byKey,
        quarantine,
        prompt,
        unsupported,
        canSendFiles,
      };
    },
  );
  const reachability = memo(
    (level: Reachability, wanted: boolean): ReachabilityView => ({ level, wanted }),
  );
  const errors = memo(
    (last: Msg | null, code: string | null, call: Msg | null, contact: Msg | null): TrixView["errors"] => ({
      last,
      code,
      call,
      contact,
    }),
  );

  let last: TrixView | null = null;

  return () => {
    const { phone, presence: pres, messaging: msgs } = src;
    const ctx = phone.context;
    const phase = phaseOf(phone.state);
    const list = accounts(ctx.accounts);
    const call = phone.state === "in_call" ? ctx.call : null;
    const next: TrixView = {
      phase,
      registration: registrationOf(phone.state),
      deployment: ctx.deployment,
      account: account(list, activeAccount(ctx)?.id ?? null),
      accounts: list,
      settings: settings(
        phase,
        list,
        editedAccount(ctx)?.id ?? null,
        ctx.suspectFields,
        phone.state === "saving" || phone.state === "deleting" ? phone.state : null,
      ),
      call,
      conversation: conversation(src.conversationRevision(), call?.textChannel ?? false),
      history: ctx.history,
      contacts: ctx.contacts,
      threads: threads(ctx.contacts, ctx.history, pres.context.contacts, msgs.context.messages),
      presence: presence(
        pres.state,
        pres.context.prefs,
        pres.context.inCall,
        pres.context.idle,
        pres.context.support,
        pres.context.contacts,
      ),
      messaging: messaging(
        msgs.state,
        msgs.context.loaded,
        msgs.context.messages,
        msgs.context.quarantine,
        shownPrompt(msgs.context),
        msgs.context.unsupported,
        msgs.context.fileStore !== null,
      ),
      reachability: reachability(reachabilityOf(phone.state), reachabilityWanted(src.session)),
      errors: errors(ctx.lastError, ctx.lastErrorCode, ctx.callError, ctx.contactError),
    };
    // the snapshot itself is shared too, when none of its fields moved
    if (last && (Object.keys(next) as (keyof TrixView)[]).every((k) => next[k] === last![k])) return last;
    last = next;
    return next;
  };
}
