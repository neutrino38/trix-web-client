/**
 * PresenceMachine — our own status and our contacts' presence (ADR 0007,
 * D12). A peer of PhoneMachine, not a state of it nor a child: presence
 * runs alongside the registration cycle, and NOTIFYs arrive at any time,
 * in a call included.
 *
 * The two machines never see each other. `main.ts` translates
 * PhoneMachine's transitions into `phone:*` events
 * (`machines/presencesignals.ts`); the SIP handle carried by `phone:up`
 * hands its presence events straight to this machine through the link it
 * opens (`SipHandle.presence`); PhoneMachine reads our do-not-disturb
 * status back through a getter.
 *
 * States:
 * - `off`: not registered yet since the page loaded; nothing known.
 * - `live`: registered; subscriptions and publication under way.
 * - `no_watch`: registered, but the server refused SUBSCRIBE (D8): no
 *   SUBSCRIBE leaves again until the next registration.
 * - `stale`: was registered; what we knew is kept, marked stale (D9).
 * - `disabled`: `presence: "no"` in `config.json` (D8).
 *
 * Our own address is watched too: what our other devices publish comes
 * back as `sip:ownPresence`, and a status chosen there becomes ours
 * (`ownPresence`).
 *
 * Neither a refused PUBLISH nor the published status is a state: the
 * first is a flag (`support.publish`) that only changes the menu, the
 * second is computed by `publishedPresence` whenever one of its inputs
 * changes, and published only when the result differs.
 */

import { defineMachine, goto, stay, type Fx } from "finite-state-language";
import type { Presence, PresenceInfo, PublishedPresence } from "../sip/pidf.js";
import type { SipHandle } from "../sip/port.js";
import type { PresenceLink, PresenceSipEvent, PublishedInfo } from "../sip/presence.js";
import {
  DEFAULT_STATUS,
  type ChosenStatus,
  type StatusPrefs,
} from "../storage/session.js";

/** What PresenceMachine is told about PhoneMachine (see `presencesignals.ts`). */
export type PhoneSignal =
  /** Registered, from outside the registered corridor. */
  | { type: "phone:up"; handle: SipHandle; accountId: string; uris: string[] }
  /** Left the registered corridor: the handle is about to stop. */
  | { type: "phone:down" }
  | { type: "phone:callStarted" }
  | { type: "phone:callEnded" }
  /** The contact book changed: these are the addresses to watch. */
  | { type: "phone:contacts"; uris: string[] };

export type PresenceEvent =
  | PhoneSignal
  | PresenceSipEvent
  | { type: "ui:setStatus"; status: ChosenStatus }
  | { type: "ui:setNote"; note: string | null }
  | { type: "ui:setRule"; rule: "onThePhone" | "awayWhenIdle"; on: boolean }
  /** Ten minutes without activity, and back (`ui/activity.ts`, D5 rule 2). */
  | { type: "sys:idle" }
  | { type: "sys:active" };

/** Where the status preferences of an account are kept (`storage/session.ts`). */
export interface StatusStore {
  load(accountId: string): StatusPrefs;
  save(accountId: string, prefs: StatusPrefs): void;
}

/** A contact's presence as far as we know it. */
export interface ContactPresence {
  info: PresenceInfo;
  /** The subscription waits for the contact's consent. */
  pending: boolean;
  /** False once we are no longer registered (D9): shown, but marked stale. */
  fresh: boolean;
  /** When we learnt it, epoch ms — the age a stale line shows. */
  receivedAt: number;
}

export interface PresenceCtx {
  /** Injected. */
  statusStore: StatusStore;
  /** Injected: false when the deployment turns presence off (D8). */
  enabled: boolean;

  accountId: string | null;
  prefs: StatusPrefs;
  link: PresenceLink | null;
  /** The addresses of the contact book, as normalized by PhoneMachine. */
  uris: string[];
  /** By contact URI. A contact we know nothing about has no entry. */
  contacts: Record<string, ContactPresence>;
  /** What the server takes, learnt anew on each registration; null: not yet. */
  support: { subscribe: boolean | null; publish: boolean | null };
  inCall: boolean;
  idle: boolean;
  /** What was last published, to publish only what changes. */
  published: PublishedInfo | null;
  /** What our other devices last chose, as `sip:ownPresence` said it; null: not yet. */
  others: Presence | null;
  /** When the chosen status last changed, epoch ms: an older choice elsewhere loses. */
  chosenAt: number;
}

/**
 * What the others see of us (D5): the chosen status, corrected by the two
 * automatic rules. Invisible publishes `offline`, without its note — a
 * closed presence that still says something would give it away.
 */
export function publishedPresence(
  prefs: StatusPrefs,
  inCall: boolean,
  idle: boolean,
): { state: PublishedPresence; note: string | null } {
  if (prefs.chosen === "invisible") return { state: "offline", note: null };
  if (inCall && prefs.onThePhone && prefs.chosen !== "dnd") {
    return { state: "on-the-phone", note: prefs.note };
  }
  if (idle && prefs.awayWhenIdle && prefs.chosen === "available") {
    return { state: "away", note: prefs.note };
  }
  return { state: prefs.chosen, note: prefs.note };
}

/** Publishes if the result changed and the server has not refused PUBLISH. */
function publish(ctx: PresenceCtx): void {
  if (!ctx.link || ctx.support.publish === false) return;
  const next = publishedPresence(ctx.prefs, ctx.inCall, ctx.idle);
  // our other devices must not take a rule for a choice (`ownPresence`)
  const automatic = ctx.prefs.chosen !== "invisible" && next.state !== ctx.prefs.chosen;
  const last = ctx.published;
  if (last && last.state === next.state && last.note === next.note && !!last.automatic === automatic) return;
  const info: PublishedInfo = {
    ...next,
    ...(automatic ? { automatic } : {}),
    // `since` dates the state, not the note
    since: last && last.state === next.state ? last.since : Date.now(),
  };
  ctx.published = info;
  ctx.link.publish(info);
}

function savePrefs(ctx: PresenceCtx): void {
  if (ctx.accountId) ctx.statusStore.save(ctx.accountId, ctx.prefs);
}

/**
 * Registered: open the link, watch every contact, publish. The discovery
 * starts over (D8); another account starts from nothing.
 */
function up(ev: Extract<PresenceEvent, { type: "phone:up" }>, ctx: PresenceCtx, fx: Fx<PresenceEvent, PresenceCtx>) {
  if (ctx.accountId !== ev.accountId) {
    ctx.accountId = ev.accountId;
    ctx.prefs = ctx.statusStore.load(ev.accountId);
    ctx.contacts = {};
  }
  ctx.support = { subscribe: null, publish: null };
  ctx.inCall = false;
  ctx.published = null;
  ctx.others = null;
  ctx.uris = ev.uris;
  ctx.link = ev.handle.presence((e) => fx.send(e));
  ctx.link.watchSelf();
  for (const uri of ctx.uris) ctx.link.watch(uri);
  publish(ctx);
  return goto("live", "registered");
}

/** The handle is going away with the registration: keep what we know, as stale. */
function down() {
  return goto("stale", "unregistered");
}

/** The contact book changed: watch the new, forget the gone. */
function contactsChanged(ev: Extract<PresenceEvent, { type: "phone:contacts" }>, ctx: PresenceCtx, watch: boolean) {
  const next = new Set(ev.uris);
  for (const uri of ctx.uris) {
    if (next.has(uri)) continue;
    ctx.link?.unwatch(uri);
    const { [uri]: _gone, ...rest } = ctx.contacts;
    ctx.contacts = rest;
  }
  if (watch) for (const uri of ev.uris) if (!ctx.uris.includes(uri)) ctx.link?.watch(uri);
  ctx.uris = ev.uris;
  return stay("contacts changed");
}

function contactPresence(ev: Extract<PresenceEvent, { type: "sip:presence" }>, ctx: PresenceCtx) {
  if (!ctx.uris.includes(ev.uri)) return stay("presence of a former contact");
  ctx.contacts = {
    ...ctx.contacts,
    [ev.uri]: { info: ev.info, pending: ev.pending, fresh: true, receivedAt: Date.now() },
  };
  return stay("contact presence");
}

/** What another device may hand us: a choice — not a rule, not an absence. */
const ADOPTABLE: ReadonlySet<Presence> = new Set<ChosenStatus & Presence>(["available", "busy", "away", "dnd"]);

/**
 * Our other devices changed what they say: a status chosen there becomes
 * ours. Only a change counts — the first word after registering is what
 * they said before we came, and a NOTIFY our own PUBLISH triggers repeats
 * what they already said. A choice older than ours loses, so two devices
 * choosing at once settle on the later one instead of swapping forever.
 * Neither a rule (`automatic`, on the phone) nor an absence (offline:
 * gone, or invisible) is a choice, and none moves the reference.
 */
function ownPresence(ev: Extract<PresenceEvent, { type: "sip:ownPresence" }>, ctx: PresenceCtx) {
  const { state, since } = ev.info;
  if (ev.automatic || !ADOPTABLE.has(state)) return stay("own presence: not a choice");
  const before = ctx.others;
  ctx.others = state;
  if (before === null) return stay("own presence: first word");
  if (before === state) return stay("own presence: unchanged");
  if (since !== null && since <= ctx.chosenAt) return stay("own presence: older than our choice");
  if (ctx.prefs.chosen === state) return stay("own presence: already ours");
  ctx.prefs = { ...ctx.prefs, chosen: state as ChosenStatus };
  ctx.chosenAt = since ?? Date.now();
  savePrefs(ctx);
  publish(ctx);
  return stay("status chosen elsewhere");
}

// Status, note, rules, calls and activity: kept whatever the state,
// published when we can. The diagram extractor follows any identifier that
// names a function, `ctx.idle` included: hence no function called `idle`.

function setStatus(ev: Extract<PresenceEvent, { type: "ui:setStatus" }>, ctx: PresenceCtx) {
  ctx.prefs = { ...ctx.prefs, chosen: ev.status };
  ctx.chosenAt = Date.now();
  savePrefs(ctx);
  publish(ctx);
  return stay("status chosen");
}

function setNote(ev: Extract<PresenceEvent, { type: "ui:setNote" }>, ctx: PresenceCtx) {
  ctx.prefs = { ...ctx.prefs, note: ev.note?.trim() || null };
  savePrefs(ctx);
  publish(ctx);
  return stay("note set");
}

function setRule(ev: Extract<PresenceEvent, { type: "ui:setRule" }>, ctx: PresenceCtx) {
  ctx.prefs = { ...ctx.prefs, [ev.rule]: ev.on };
  savePrefs(ctx);
  publish(ctx);
  return stay("rule set");
}

function callStarted(_ev: PresenceEvent, ctx: PresenceCtx) {
  ctx.inCall = true;
  publish(ctx);
  return stay("in a call");
}

function callEnded(_ev: PresenceEvent, ctx: PresenceCtx) {
  ctx.inCall = false;
  publish(ctx);
  return stay("call ended");
}

function wentIdle(_ev: PresenceEvent, ctx: PresenceCtx) {
  ctx.idle = true;
  publish(ctx);
  return stay("idle");
}

function cameBack(_ev: PresenceEvent, ctx: PresenceCtx) {
  ctx.idle = false;
  publish(ctx);
  return stay("active");
}

export const PresenceMachine = defineMachine<PresenceCtx, PresenceEvent>()({
  name: "PresenceMachine",

  context: () => ({
    statusStore: { load: () => DEFAULT_STATUS, save: () => {} },
    enabled: true,
    accountId: null,
    prefs: DEFAULT_STATUS,
    link: null,
    uris: [],
    contacts: {},
    support: { subscribe: null, publish: null },
    inCall: false,
    idle: false,
    published: null,
    others: null,
    chosenAt: 0,
  }),

  states: {
    initial_state: {
      enter(ctx) {
        return ctx.enabled ? goto("off") : goto("disabled", "presence turned off");
      },
    },

    off: {
      on: {
        "phone:up": up,
        "phone:down": () => stay("never up"),
        "phone:contacts": (ev, ctx) => contactsChanged(ev, ctx, false),
        "ui:setStatus": setStatus,
        "ui:setNote": setNote,
        "ui:setRule": setRule,
        "phone:callStarted": callStarted,
        "phone:callEnded": callEnded,
        "sys:idle": wentIdle,
        "sys:active": cameBack,
      },
    },

    live: {
      on: {
        "phone:up": up,
        "phone:down": down,
        "phone:contacts": (ev, ctx) => contactsChanged(ev, ctx, true),
        "sip:presence": contactPresence,
        "sip:ownPresence": ownPresence,
        "sip:presenceSupport": (ev, ctx) => {
          ctx.support = { ...ctx.support, [ev.method]: ev.supported };
          if (ev.method === "subscribe" && !ev.supported) {
            ctx.contacts = {};
            return goto("no_watch", "SUBSCRIBE refused");
          }
          return stay(`${ev.method} ${ev.supported ? "accepted" : "refused"}`);
        },
        "ui:setStatus": setStatus,
        "ui:setNote": setNote,
        "ui:setRule": setRule,
        "phone:callStarted": callStarted,
        "phone:callEnded": callEnded,
        "sys:idle": wentIdle,
        "sys:active": cameBack,
      },
    },

    no_watch: {
      on: {
        "phone:up": up,
        "phone:down": down,
        "phone:contacts": (ev, ctx) => contactsChanged(ev, ctx, false),
        // the link dropped every subscription: whatever still arrives is late
        "sip:presence": () => stay("late presence"),
        "sip:ownPresence": () => stay("late presence"),
        "sip:presenceSupport": (ev, ctx) => {
          ctx.support = { ...ctx.support, [ev.method]: ev.supported };
          return stay(`${ev.method} ${ev.supported ? "accepted" : "refused"}`);
        },
        "ui:setStatus": setStatus,
        "ui:setNote": setNote,
        "ui:setRule": setRule,
        "phone:callStarted": callStarted,
        "phone:callEnded": callEnded,
        "sys:idle": wentIdle,
        "sys:active": cameBack,
      },
    },

    stale: {
      enter(ctx) {
        ctx.link = null;
        ctx.published = null;
        ctx.inCall = false;
        const contacts: Record<string, ContactPresence> = {};
        for (const [uri, p] of Object.entries(ctx.contacts)) contacts[uri] = { ...p, fresh: false };
        ctx.contacts = contacts;
      },
      on: {
        "phone:up": up,
        "phone:down": () => stay("already down"),
        "phone:contacts": (ev, ctx) => contactsChanged(ev, ctx, false),
        // events of the link that just closed
        "sip:presence": () => stay("late presence"),
        "sip:ownPresence": () => stay("late presence"),
        "sip:presenceSupport": () => stay("late support"),
        "ui:setStatus": setStatus,
        "ui:setNote": setNote,
        "ui:setRule": setRule,
        "phone:callStarted": callStarted,
        "phone:callEnded": callEnded,
        "sys:idle": wentIdle,
        "sys:active": cameBack,
      },
    },

    disabled: {
      on: {
        "phone:up": () => stay("presence off"),
        "phone:down": () => stay("presence off"),
        "phone:contacts": () => stay("presence off"),
        "phone:callStarted": () => stay("presence off"),
        "phone:callEnded": () => stay("presence off"),
        "sip:presence": () => stay("presence off"),
        "sip:ownPresence": () => stay("presence off"),
        "sip:presenceSupport": () => stay("presence off"),
        "ui:setStatus": () => stay("presence off"),
        "ui:setNote": () => stay("presence off"),
        "ui:setRule": () => stay("presence off"),
        "sys:idle": () => stay("presence off"),
        "sys:active": () => stay("presence off"),
      },
    },
  },
});

export type PresenceInstance = ReturnType<typeof PresenceMachine.start>;
