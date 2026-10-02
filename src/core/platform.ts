/**
 * What the core needs to hear from the platform it runs on (ADR 0011, D7):
 * the page going to sleep and coming back, the person at the keyboard, the
 * tab being looked at, the network. Only the platform knows these, and the
 * core touches no page: they come through this interface.
 *
 * `browserPlatform()` (`core/browser/`) is the default. An affiliate that
 * embeds Trix in Tauri, Capacitor or a test provides its own.
 *
 * Every `watch` returns what stops it.
 */

/**
 * Why the page goes to sleep, **among what the platform announces**.
 *
 * `leave` is not a disguised `freeze`, and mixing them up would cost a lot:
 * a frozen tab stays in the bar and will come back, whereas `leave` says the
 * page is going away — the person closed it, went elsewhere, or the browser
 * is shutting down. SIP draws the same conclusion from both (ADR 0006, D3:
 * unregister), but nobody is alerted about what they just decided (D2).
 *
 * The two other reasons for being unreachable — network down, tab discarded
 * — are not observed here: the first is `Platform.online()`, the second is
 * seen at the next load (`ui/reachability.ts`).
 */
export type PageSleepReason = "freeze" | "leave" | "system";

export interface LifecycleEvents {
  onSleep: (reason: PageSleepReason) => void;
  /**
   * Any return: thaw, out of the bfcache, back to the foreground, back
   * online, machine waking up. It carries no reason — what needs explaining
   * is the period that went by, not how it ended (ADR 0006, D5).
   */
  onWake: () => void;
  /**
   * The network is lost. Not a sleep: the page is awake, it just cannot
   * reach anyone — the machine says so instead of blaming the settings, and
   * the return comes through `onWake`.
   */
  onOffline: () => void;
}

export interface ActivityEvents {
  /** Nobody at the keyboard for ten minutes (ADR 0007, D5, rule 2). */
  onIdle: () => void;
  /** The first gesture after that. */
  onActive: () => void;
}

export interface Platform {
  /** Sleeps and returns of the page and of the machine (ADR 0006). */
  lifecycle(events: LifecycleEvents): () => void;
  /** Idle and back (ADR 0007, D5). */
  activity(events: ActivityEvents): () => void;
  /** The tab shown or hidden (ADR 0008, D5: a stranger's two minutes only count while seen). */
  visibility(listener: (visible: boolean) => void): () => void;
  /** Is the tab seen right now? Read at start-up, before any change. */
  visible(): boolean;
  /** Does the platform believe it has a network? Read when the registration fails. */
  online(): boolean;
}
