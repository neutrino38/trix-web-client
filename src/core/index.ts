/**
 * The facade of the core (ADR 0011, D2) — **the only module an affiliated
 * project imports**. Everything else under `src/` is internal and may change
 * without notice; what this file exports is the contract (D10).
 *
 * ```ts
 * const trix = createTrix({ storagePrefix: "acme" });
 * await trix.ready;
 * trix.subscribe((view) => render(view));
 * trix.call.dial("bob@example.fr", { audio: true, video: false, text: true });
 * ```
 *
 * `createTrix` is the core's half of what `main.ts` used to wire by hand:
 * the three machines, in their order, on one vault, linked to each other;
 * the conversation following each call; the platform's signals. The UI's
 * half stays with the UI.
 */

import { loadDeployment, type Deployment } from "../deployment.js";
import type { Translate } from "../i18n/types.js";
import { CallBlock } from "../machines/call.js";
import type { ConfigForm } from "../machines/events.js";
import { MessagingMachine } from "../machines/messaging.js";
import { uploadFile, type UploadFile } from "../sip/ftupload.js";
import { linkMessaging } from "../machines/messagingsignals.js";
import { PhoneMachine, editedAccount, type PhoneInstance } from "../machines/phone.js";
import { PresenceMachine } from "../machines/presence.js";
import { linkPresence } from "../machines/presencesignals.js";
import { createJsSipPort, type CallMedia, type CallStreams, type MediaKind, type SipPort } from "../sip/port.js";
import type { MediaStats } from "../sip/stats.js";
import { createSipTrace, type SipTrace } from "../sip/trace.js";
import { shareUrl } from "../share/link.js";
import { createSessionStore, type ChosenStatus, type SessionStore } from "../storage/session.js";
import { createBrowserStore, type SecureStore } from "../storage/store.js";
import { browserPlatform } from "./browser/index.js";
import { createConversation, followCalls, type Conversation } from "./conversation.js";
import { coreTranslate, loadCoreMessages } from "./i18n/index.js";
import { consoleSink, formatLog, machineLogger, watchMachine, type Sink } from "./diagnostics.js";
import type { PageSleepReason, Platform } from "./platform.js";
import { createViewBuilder, type TrixView } from "./view.js";

export type {
  AccountView,
  ConversationView,
  MessagingState,
  MessagingView,
  Phase,
  PresenceState,
  PresenceView,
  ReachabilityView,
  Registration,
  SettingsView,
  TrixView,
} from "./view.js";
export type { ActivityEvents, LifecycleEvents, PageSleepReason, Platform } from "./platform.js";
export type { Deployment } from "../deployment.js";
export type { CallNotice, CallView, ConfigForm, SuspectField } from "../machines/events.js";
export type { ComposingPeer, HeldMessage, Quarantined } from "../machines/messaging.js";
export type { ContactPresence } from "../machines/presence.js";
export type { Reachability } from "./reachability.js";
export type { CallMedia, CallStreams, MediaKind } from "../sip/port.js";
export type { Direction, Flow, MediaStats, TextFlow } from "../sip/stats.js";
export type { ChatBubble, ChatItem, ChatNote, ChatRun, ChatSide } from "../sip/transcript.js";
export { bubbleText } from "../sip/transcript.js";
export type { T140Attrs } from "../sip/t140.js";
export type { RttState, RttTransport } from "../sip/rtt.js";
export type { Presence, PresenceInfo, PublishedPresence } from "../sip/pidf.js";
export type { IceConfig, TurnServer } from "../sip/ice.js";
export type { TraceLine } from "../sip/record.js";
export type { FileAttachment } from "../sip/fthttp.js";
export { isExpired, isVoiceMessage } from "../sip/fthttp.js";
export type { UploadFile } from "../sip/ftupload.js";
export type { ChosenStatus, StatusPrefs } from "../storage/session.js";
export type { CallDirection, CallLogEntry, CallOutcome, Contact, MessageEntry, MessageState } from "../storage/store.js";
export type { Thread, ThreadCall } from "./thread.js";
export type { ConversationEvent } from "./conversation.js";
export type { Sink } from "./diagnostics.js";
export type { CoreDictionary, CoreMsgKey, Locale, Msg, Translate, Vars } from "../i18n/types.js";
export { CORE_LOCALES, formatMsg, loadCoreMessages } from "./i18n/index.js";
export { browserPlatform } from "./browser/index.js";

export interface TrixOptions {
  /**
   * The deployment configuration: where to fetch it (`config.json` by
   * default, relative to the page), or the object itself. Absent or
   * unreadable, Trix behaves as without one.
   */
  config?: string | Deployment;
  /**
   * Prefixes the IndexedDB base and every `localStorage` key of the
   * instance (D8). `trix` by default — the existing installations' own.
   */
  storagePrefix?: string;
  /** What the core hears from the page (D7); `browserPlatform()` by default. */
  platform?: Platform;
  /**
   * The language of the core's messages (D9), as a BCP-47 tag: its
   * catalogue is loaded before `ready` resolves, so that `formatMsg(msg,
   * locale)` words them at once. French by default; a language Trix does
   * not ship falls back to it.
   */
  locale?: string;
  /**
   * How the core words what it writes to the console: its own catalogue in
   * `locale` by default, or a UI's, which covers the same keys.
   */
  translate?: Translate;
  /** Where the diagnostics go; the console by default. */
  sink?: Sink;
  // For tests and other platforms — not needed in a browser:
  store?: SecureStore;
  session?: SessionStore;
  sip?: (deps: { deployment: Deployment; trace: SipTrace }) => SipPort;
}

export interface Trix {
  /**
   * The deployment read and the machines started. The vault is read after:
   * see `view.phase`. Until it resolves, every command throws, and so do
   * `call.onStreams` and `conversation.subscribe`; only `view()`,
   * `subscribe` and `system.onSleep` may be called before.
   */
  readonly ready: Promise<void>;
  /**
   * The snapshot as things stand, `null` before `ready`. Read right after a
   * command, it already shows its result; it is the very object the next
   * notification will carry, so `===` keeps its meaning.
   */
  view(): TrixView | null;
  /**
   * Called with each new snapshot, a microtask after the chain of
   * transitions that produced it — never in the middle of one. Returns what
   * unsubscribes.
   */
  subscribe(listener: (view: TrixView) => void): () => void;

  accounts: {
    /** Open the settings on an account, or empty (`null`) to add one. */
    configure(id: string | null): void;
    cancel(): void;
    save(form: ConfigForm): void;
    /** Remove the account being edited, with its history. */
    remove(): void;
    /**
     * The link that hands the account being edited to another browser
     * (`share/link.ts`, ADR 0004). It carries the digest: show it to its
     * owner only. `null` while no saved account is being edited.
     */
    shareUrl(base: string | URL): string | null;
    /** Register on this account, from the accounts screen. */
    use(id: string): void;
    /** Move to the other account while registered — refused once a call rings. */
    switchTo(id: string): void;
    retry(): void;
    backToSettings(): void;
    logout(): void;
    retryVault(): void;
    /** Wipe an unreadable vault. Ask twice before calling it: nothing is implied. */
    resetVault(): void;
    setFlashAlert(on: boolean): void;
  };
  call: {
    dial(target: string, media: CallMedia): void;
    answer(media: CallMedia): void;
    reject(): void;
    hangup(): void;
    /** Add a medium to the call, or remove it (ADR 0003, D5). */
    toggleMedia(kind: MediaKind): void;
    acceptMedia(): void;
    rejectMedia(): void;
    togglePause(): void;
    toggleShare(): void;
    toggleSelfView(): void;
    dtmf(tone: string): void;
    /** The call's media, for the UI to set as `srcObject` (D4); all `null` out of a call. */
    streams(): CallStreams;
    /** Tracks added, a share started or stopped. Returns what unsubscribes. */
    onStreams(listener: () => void): () => void;
    /** The last ten seconds of media, `null` when nothing is measured or the trace is off. */
    stats(): MediaStats | null;
    /** The whole history, or the calls of one correspondent (address key). */
    clearHistory(key?: string): void;
  };
  conversation: {
    /** The input changed: what to send is worked out from what went out. */
    type(value: string): void;
    /** Enter: the bubble is frozen on both ends. */
    enter(): void;
    /**
     * What a view does not carry: a bubble frozen, a bell, the link
     * changing — for a UI that announces or flashes.
     */
    subscribe: Conversation["subscribe"];
  };
  contacts: {
    add(name: string, uri: string): void;
    rename(id: string, name: string): void;
    remove(id: string): void;
    block(uri: string, name: string): void;
    unblock(id: string): void;
  };
  presence: {
    setStatus(status: ChosenStatus): void;
    setNote(note: string | null): void;
    setRule(rule: "onThePhone" | "awayWhenIdle", on: boolean): void;
  };
  messaging: {
    send(uri: string, text: string): void;
    /** Send a file, with an optional caption (ADR 0012, D7, D8). */
    sendFile(uri: string, file: UploadFile, caption?: string): void;
    /** A key pressed in the writing field for `uri` (ADR 0012, D9). */
    typing(uri: string): void;
    /** A voice message for `uri` started or stopped being recorded. */
    recording(uri: string, on: boolean): void;
    retry(id: string): void;
    /** This correspondent's line is open in a visible tab. */
    read(key: string): void;
    acceptSender(key: string): void;
    refuseSender(key: string): void;
    clear(key?: string): void;
  };
  system: {
    /** The SIP trace's setting (offered unless the deployment forbids it). */
    trace: { enabled(): boolean; set(on: boolean): void };
    /**
     * The page goes to sleep: called **before** the core unregisters, while
     * the registration still stands — the last instant a UI may stamp as
     * reachable. Returns what unsubscribes.
     */
    onSleep(listener: (reason: PageSleepReason) => void): () => void;
  };

  /**
   * The machines themselves, for the console and for bug reports. **Not
   * part of the contract** (D9): nothing here is promised from one version
   * to the next.
   */
  readonly debug: TrixDebug;

  /** Unregisters, stops the machines, lets go of every listener. */
  dispose(): Promise<void>;
}

export interface TrixDebug {
  readonly phone: PhoneInstance;
  readonly presence: ReturnType<typeof PresenceMachine.start>;
  readonly messaging: ReturnType<typeof MessagingMachine.start>;
  readonly conversation: Conversation;
  readonly session: SessionStore;
  mermaid(): string;
  dump(): string;
}

export function createTrix(options: TrixOptions = {}): Trix {
  const prefix = options.storagePrefix ?? "trix";
  const platform = options.platform ?? browserPlatform();
  const sink = options.sink ?? consoleSink;
  const session = options.session ?? createSessionStore(prefix);

  let core: ReturnType<typeof start> | null = null;
  let disposed = false;
  const listeners = new Set<(view: TrixView) => void>();
  const sleepers = new Set<(reason: PageSleepReason) => void>();

  const locale = options.locale ?? "fr";

  const ready = (async () => {
    // the catalogue comes alongside: nothing waits for it but `ready`, and
    // until it is there, French words the messages
    const catalogue = loadCoreMessages(locale);
    const deployment =
      typeof options.config === "object" ? options.config : await loadDeployment(options.config);
    if (disposed) return;
    core = start(deployment);
    await catalogue;
  })();

  function start(deployment: Deployment) {
    const trace = createSipTrace({ prefix, allowed: deployment.debug });
    const stops: (() => void)[] = [];

    // the engine may log before `phone` is assigned (initial transition)
    let started: PhoneInstance | null = null;

    // Presence before the phone: the phone reads its status at each INVITE
    // (ADR 0007, D12). The two never see each other: `linkPresence` below
    // translates the phone's transitions for it.
    const presence = PresenceMachine.start({
      debug: true,
      logger: machineLogger(() => null, sink),
      args: {
        statusStore: { load: session.statusPrefs, save: session.setStatusPrefs },
        enabled: deployment.presence,
      },
    });

    // one vault for the two machines that write into it
    const store = options.store ?? createBrowserStore(prefix);

    const messaging = MessagingMachine.start({
      debug: true,
      logger: machineLogger(() => null, sink),
      args: {
        store,
        enabled: deployment.messaging,
        visible: platform.visible(),
        // the XML the store answers is read like any other (ADR 0012, D7)
        upload: (account, file) => uploadFile(account, file, new DOMParser()),
      },
    });

    // created before the phone, which reads its transcript when filing the call
    const conversation = createConversation();

    const phone = PhoneMachine.start({
      debug: true,
      logger: machineLogger(() => started, sink),
      args: {
        store,
        sip: options.sip
          ? options.sip({ deployment, trace })
          : createJsSipPort({ messaging: deployment.messaging, trace }),
        transcript: () => conversation.transcript(),
        // Do not disturb refuses calls (ADR 0007, D6)
        doNotDisturb: () => presence.state !== "disabled" && presence.context.prefs.chosen === "dnd",
        online: platform.online,
        resume: session,
        deployment,
        trace,
      },
    });
    started = phone;

    stops.push(
      watchMachine(phone, options.translate ?? coreTranslate(locale), sink),
      followCalls(phone, conversation),
      linkPresence(phone, presence),
      linkMessaging(phone, messaging),
      trace.callStates(phone),
    );

    // One notification per chain of transitions: a transition notifies
    // **before** the arrival state's `enter()` writes what it publishes
    // (`ctx.call`). Read in the callback, the view would show the previous
    // state; a microtask later, it shows the result.
    let revision = 0;
    const build = createViewBuilder({
      phone,
      presence,
      messaging,
      conversation,
      conversationRevision: () => revision,
      session,
    });
    // what was last handed to the listeners: `build()` read in between by
    // `view()` returns the same object, which is then published as new
    let published = build();
    let queued = false;
    const notify = (): void => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (disposed) return;
        const next = build();
        if (next === published) return;
        published = next;
        for (const l of [...listeners]) l(next);
      });
    };
    stops.push(
      phone.subscribe(notify),
      presence.subscribe(notify),
      messaging.subscribe(notify),
      conversation.subscribe(() => {
        revision++;
        notify();
      }),
    );

    // Sleeps and returns of the page (ADR 0006, D3 and D5): all unregister,
    // every return registers again. The UI hears the sleep first.
    stops.push(
      platform.lifecycle({
        onSleep: (reason) => {
          for (const l of [...sleepers]) l(reason);
          phone.send({ type: "sys:sleep" });
        },
        onWake: () => phone.send({ type: "sys:wake" }),
        onOffline: () => phone.send({ type: "sys:offline" }),
      }),
      // a stranger's two minutes only count in a visible tab (ADR 0008, D5)
      platform.visibility((visible) => messaging.send({ type: "sys:visible", visible })),
      // Available becomes Away after ten idle minutes (ADR 0007, D5, rule 2)
      platform.activity({
        onIdle: () => presence.send({ type: "sys:idle" }),
        onActive: () => presence.send({ type: "sys:active" }),
      }),
    );

    return {
      phone,
      presence,
      messaging,
      conversation,
      trace,
      view: build,
      stops,
    };
  }

  function live() {
    if (!core) throw new Error("Trix is not ready yet: await trix.ready");
    return core;
  }
  const phone = (ev: Parameters<PhoneInstance["send"]>[0]): void => live().phone.send(ev);
  const presence = (ev: Parameters<TrixDebug["presence"]["send"]>[0]): void => live().presence.send(ev);
  const messaging = (ev: Parameters<TrixDebug["messaging"]["send"]>[0]): void => live().messaging.send(ev);
  const noStreams: CallStreams = { remote: null, local: null, share: null };

  return {
    ready,
    view: () => core?.view() ?? null,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    accounts: {
      configure: (id) => phone({ type: "ui:configure", id }),
      cancel: () => phone({ type: "ui:cancelConfig" }),
      save: (form) => phone({ type: "ui:saveConfig", form }),
      remove: () => phone({ type: "ui:deleteAccount" }),
      shareUrl(base) {
        const account = core ? editedAccount(core.phone.context) : null;
        return account ? shareUrl(account, base) : null;
      },
      use: (id) => phone({ type: "ui:useAccount", id }),
      switchTo: (id) => phone({ type: "ui:switchAccount", id }),
      retry: () => phone({ type: "ui:retry" }),
      backToSettings: () => phone({ type: "ui:backToSettings" }),
      logout: () => phone({ type: "ui:logout" }),
      retryVault: () => phone({ type: "ui:retryVault" }),
      resetVault: () => phone({ type: "ui:resetVault" }),
      setFlashAlert: (on) => phone({ type: "ui:setFlashAlert", on }),
    },
    call: {
      dial: (target, media) => phone({ type: "ui:call", target, media }),
      answer: (media) => phone({ type: "ui:answer", media }),
      reject: () => phone({ type: "ui:reject" }),
      hangup: () => phone({ type: "ui:hangup" }),
      toggleMedia: (kind) => phone({ type: "ui:toggleMedia", kind }),
      acceptMedia: () => phone({ type: "ui:acceptMedia" }),
      rejectMedia: () => phone({ type: "ui:rejectMedia" }),
      togglePause: () => phone({ type: "ui:togglePause" }),
      toggleShare: () => phone({ type: "ui:toggleShare" }),
      toggleSelfView: () => phone({ type: "ui:toggleSelfView" }),
      dtmf: (tone) => phone({ type: "ui:dtmf", tone }),
      streams: () => core?.phone.context.session?.streams() ?? noStreams,
      onStreams: (listener) => live().phone.context.session?.onStreams(listener) ?? (() => {}),
      stats: () => core?.phone.context.session?.mediaStats() ?? null,
      clearHistory: (key) => phone(key === undefined ? { type: "ui:clearHistory" } : { type: "ui:clearHistory", key }),
    },
    conversation: {
      type: (value) => live().conversation.type(value),
      enter: () => live().conversation.enter(),
      subscribe: (listener) => live().conversation.subscribe(listener),
    },
    contacts: {
      add: (name, uri) => phone({ type: "ui:addContact", name, uri }),
      rename: (id, name) => phone({ type: "ui:renameContact", id, name }),
      remove: (id) => phone({ type: "ui:removeContact", id }),
      block: (uri, name) => phone({ type: "ui:blockContact", uri, name }),
      unblock: (id) => phone({ type: "ui:unblockContact", id }),
    },
    presence: {
      setStatus: (status) => presence({ type: "ui:setStatus", status }),
      setNote: (note) => presence({ type: "ui:setNote", note }),
      setRule: (rule, on) => presence({ type: "ui:setRule", rule, on }),
    },
    messaging: {
      send: (uri, text) => messaging({ type: "ui:send", uri, text }),
      typing: (uri) => messaging({ type: "ui:typing", uri }),
      recording: (uri, on) => messaging({ type: "ui:recording", uri, on }),
      sendFile: (uri, file, caption) =>
        messaging({ type: "ui:sendFile", uri, file, ...(caption !== undefined ? { caption } : {}) }),
      retry: (id) => messaging({ type: "ui:retry", id }),
      read: (key) => messaging({ type: "ui:read", key }),
      acceptSender: (key) => messaging({ type: "ui:acceptSender", key }),
      refuseSender: (key) => messaging({ type: "ui:refuseSender", key }),
      clear: (key) => messaging(key === undefined ? { type: "ui:clearMessages" } : { type: "ui:clearMessages", key }),
    },
    system: {
      trace: {
        enabled: () => core?.trace.enabled() ?? false,
        set: (on) => live().trace.set(on),
      },
      onSleep(listener) {
        sleepers.add(listener);
        return () => sleepers.delete(listener);
      },
    },

    get debug(): TrixDebug {
      const c = live();
      return {
        phone: c.phone,
        presence: c.presence,
        messaging: c.messaging,
        conversation: c.conversation,
        session,
        mermaid: () =>
          [PhoneMachine, CallBlock, PresenceMachine, MessagingMachine].map((m) => m.toMermaid()).join("\n"),
        // to paste into a bug report: the last transitions, in clear
        dump: () => formatLog(c.phone.log),
      };
    },

    async dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      sleepers.clear();
      await ready;
      const c = core;
      if (!c) return;
      for (const stop of c.stops) stop();
      // the way out every sleep takes: hang up, unregister, close the port
      c.phone.send({ type: "sys:sleep" });
      await Promise.all([c.phone.shutdown("disposed"), c.presence.shutdown("disposed"), c.messaging.shutdown("disposed")]);
    },
  };
}
