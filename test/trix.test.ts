/**
 * The facade (ADR 0011, D2, D3): `createTrix` against a vault, a SIP port,
 * a session and a platform that are all fakes — what an affiliate's own
 * tests would do, and the proof that nothing here needs a page.
 */
import { describe, expect, it, vi } from "vitest";
import { createTrix, type Platform, type Trix, type TrixView } from "../src/core/index.js";
import type { PageSleepReason } from "../src/core/platform.js";
import { OPEN_DEPLOYMENT, type Deployment } from "../src/deployment.js";
import { NO_MESSAGING } from "../src/sip/message.js";
import type { SipEvent, SipPort } from "../src/sip/port.js";
import { NO_PRESENCE } from "../src/sip/presence.js";
import { DEFAULT_STATUS, type SessionStore, type StatusPrefs } from "../src/storage/session.js";
import type { SecureStore, StoredAccount, Vault } from "../src/storage/store.js";

const ACCOUNT: StoredAccount = {
  id: "acc-1",
  instanceId: "a11ce000-0000-4000-8000-000000000001",
  proxy: "wss://sip.example.fr:8443/ws",
  domain: "example.fr",
  displayName: "Alice Martin",
  username: "alice",
  authUsername: null,
  ha1: "0".repeat(32),
  ha1Sha256: "",
  flashAlert: true,
  ice: { stun: null, turn: { host: "turn.example.fr", username: "alice", password: "secret", tls: true } },
  rtt: "websocket",
};

function fakeStore(accounts: StoredAccount[] = [ACCOUNT]): SecureStore {
  let vault: Vault = { accounts, activeId: accounts[0]?.id ?? null };
  return {
    load: async () => vault,
    save: async (v) => {
      vault = v;
    },
    clear: async () => {
      vault = { accounts: [], activeId: null };
    },
    loadHistory: async () => [],
    saveHistory: async () => {},
    deleteHistory: async () => {},
    loadContacts: async () => [],
    saveContacts: async () => {},
    deleteContacts: async () => {},
    loadMessages: async () => [],
    saveMessages: async () => {},
    deleteMessages: async () => {},
  };
}

function fakeSession(): SessionStore & { prefs: Map<string, StatusPrefs> } {
  let resume: string | null = null;
  const prefs = new Map<string, StatusPrefs>();
  return {
    prefs,
    resumeAccount: () => resume,
    setResumeAccount: (id) => {
      resume = id;
    },
    lastReachableAt: () => null,
    markReachable: () => {},
    alertPosted: () => false,
    setAlertPosted: () => {},
    pinHintShown: () => true,
    setPinHintShown: () => {},
    statusPrefs: (id) => prefs.get(id) ?? DEFAULT_STATUS,
    setStatusPrefs: (id, p) => {
      prefs.set(id, p);
    },
  };
}

class FakeSip implements SipPort {
  send: (ev: SipEvent) => void = () => {};
  stopped = 0;
  start(_cfg: StoredAccount, send: (ev: SipEvent) => void) {
    this.send = send;
    return {
      stop: () => {
        this.stopped++;
      },
      presence: () => NO_PRESENCE,
      messaging: () => NO_MESSAGING,
      refresh: () => true,
      call: () => {
        throw new Error("no call in these tests");
      },
    };
  }
}

/** A platform the test drives by hand. */
function fakePlatform() {
  let lifecycle: Parameters<Platform["lifecycle"]>[0] | null = null;
  const platform: Platform = {
    lifecycle(events) {
      lifecycle = events;
      return () => {
        lifecycle = null;
      };
    },
    activity: () => () => {},
    visibility: () => () => {},
    visible: () => true,
    online: () => true,
  };
  return {
    platform,
    sleep: (reason: PageSleepReason) => lifecycle?.onSleep(reason),
    get listening() {
      return lifecycle !== null;
    },
  };
}

function make(prefix = "test", config: string | Deployment = OPEN_DEPLOYMENT) {
  const sip = new FakeSip();
  const page = fakePlatform();
  const session = fakeSession();
  const trix = createTrix({
    config,
    storagePrefix: prefix,
    store: fakeStore(),
    session,
    platform: page.platform,
    sip: () => sip,
    sink: { error: () => {}, warn: () => {}, debug: () => {} },
  });
  return { trix, sip, page, session };
}

async function registered(trix: Trix, sip: FakeSip): Promise<void> {
  await trix.ready;
  await vi.waitFor(() => expect(trix.view()?.phase).toBe("accounts"));
  trix.accounts.use(ACCOUNT.id);
  await vi.waitFor(() => expect(trix.view()?.registration).toBe("connecting"));
  sip.send({ type: "sip:connected" });
  sip.send({ type: "sip:registered" });
  await vi.waitFor(() => expect(trix.view()?.registration).toBe("registered"));
}

describe("createTrix", () => {
  it("has no view while the deployment is fetched, and refuses commands", async () => {
    // nothing answers at this address: Trix goes on as without the file
    const { trix } = make("test", "http://127.0.0.1:9/config.json");
    expect(trix.view()).toBeNull();
    expect(() => trix.accounts.use(ACCOUNT.id)).toThrow(/not ready/);
    await trix.ready;
    expect(trix.view()?.deployment).toEqual(OPEN_DEPLOYMENT);
  });

  it("starts at once when handed the deployment itself", () => {
    const { trix } = make();
    expect(trix.view()?.phase).toBe("loading");
  });

  it("reads the vault and shows the accounts, without a secret in sight", async () => {
    const { trix } = make();
    await trix.ready;
    await vi.waitFor(() => expect(trix.view()?.phase).toBe("accounts"));
    const view = trix.view()!;
    expect(view.registration).toBe("off");
    expect(view.accounts).toHaveLength(1);
    expect(view.accounts[0]).toMatchObject({ id: "acc-1", address: "alice@example.fr", sha256: false });
    expect(view.accounts[0]!.turn).toEqual({ host: "turn.example.fr", username: "alice", tls: true });
    expect(JSON.stringify(view.accounts)).not.toMatch(/secret|0{32}/);
  });

  it("registers through its commands, and says so with a projection, not a state name", async () => {
    const { trix, sip } = make();
    await registered(trix, sip);
    const view = trix.view()!;
    expect(view.phase).toBe("ready");
    expect(view.account?.id).toBe("acc-1");
    expect(view.reachability).toEqual({ level: "direct", wanted: true });
    expect(view.presence.state).toBe("live");
  });

  it("notifies once per chain of transitions, a microtask later", async () => {
    const { trix, sip } = make();
    await registered(trix, sip);
    const seen: TrixView[] = [];
    trix.subscribe((v) => seen.push(v));
    // two transitions in a row: offline, then back to connecting
    trix.debug.phone.send({ type: "sys:offline" });
    trix.debug.phone.send({ type: "ui:retry" });
    expect(seen).toHaveLength(0);
    await Promise.resolve();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.registration).not.toBe("offline");
  });

  it("keeps what did not move: a status change leaves the accounts and the history alone", async () => {
    const { trix, sip } = make();
    await registered(trix, sip);
    const before = trix.view()!;
    trix.presence.setStatus("busy");
    await vi.waitFor(() => expect(trix.view()).not.toBe(before));
    const after = trix.view()!;
    expect(after.presence.prefs.chosen).toBe("busy");
    expect(after.presence).not.toBe(before.presence);
    expect(after.accounts).toBe(before.accounts);
    expect(after.account).toBe(before.account);
    expect(after.history).toBe(before.history);
    expect(after.messaging).toBe(before.messaging);
    expect(after.errors).toBe(before.errors);
  });

  it("shows a command's result at once, in the very object the next notification carries", async () => {
    const { trix, sip } = make();
    await registered(trix, sip);
    const seen: TrixView[] = [];
    trix.subscribe((v) => seen.push(v));
    trix.presence.setStatus("busy");
    const now = trix.view()!;
    expect(now.presence.prefs.chosen).toBe("busy");
    expect(trix.view()).toBe(now);
    await Promise.resolve();
    expect(seen).toEqual([now]);
    expect(seen[0]).toBe(now);
  });

  it("says where messaging stands, and what it holds", async () => {
    const { trix, sip } = make();
    await trix.ready;
    await vi.waitFor(() => expect(trix.view()?.phase).toBe("accounts"));
    // the vault names an account: messages wait for the registration (ADR 0008, D3)
    expect(trix.view()!.messaging).toMatchObject({ state: "offline", enabled: true });
    await registered(trix, sip);
    await vi.waitFor(() => expect(trix.view()!.messaging.loaded).toBe(true));
    expect(trix.view()!.messaging).toMatchObject({
      state: "online",
      messages: [],
      quarantine: [],
      prompt: null,
      unread: 0,
    });
  });

  it("says what the settings are writing, and hands the edited account's link", async () => {
    const { trix } = make();
    await trix.ready;
    await vi.waitFor(() => expect(trix.view()?.phase).toBe("accounts"));
    expect(trix.accounts.shareUrl("https://trix.example.fr/")).toBeNull();
    trix.accounts.configure(null);
    expect(trix.view()!.settings).toEqual({ editing: null, suspect: null, busy: null });
    expect(trix.accounts.shareUrl("https://trix.example.fr/")).toBeNull();
    trix.accounts.cancel();
    trix.accounts.configure(ACCOUNT.id);
    expect(trix.view()!.settings?.editing?.id).toBe(ACCOUNT.id);
    expect(trix.accounts.shareUrl("https://trix.example.fr/")).toMatch(/^https:\/\/trix\.example\.fr\/.*#/);
    trix.accounts.save({
      proxy: ACCOUNT.proxy,
      uri: "alice@example.fr",
      displayName: "Alice",
      authUsername: null,
      password: null,
      stun: "",
      turn: "",
      turnUsername: "",
      turnPassword: null,
      turnTls: false,
      rtt: "websocket",
    });
    expect(trix.view()!.settings?.busy).toBe("saving");
  });

  it("lets the UI hear a sleep while the registration still stands", async () => {
    const { trix, sip, page } = make();
    await registered(trix, sip);
    const heard: { reason: PageSleepReason; state: string }[] = [];
    trix.system.onSleep((reason) => heard.push({ reason, state: trix.debug.phone.state }));
    page.sleep("freeze");
    expect(heard).toEqual([{ reason: "freeze", state: "ready" }]);
    expect(trix.debug.phone.state).toBe("sleeping");
  });

  it("keeps two instances apart", async () => {
    const a = make("a");
    const b = make("b");
    await registered(a.trix, a.sip);
    await b.trix.ready;
    await vi.waitFor(() => expect(b.trix.view()?.phase).toBe("accounts"));
    a.trix.presence.setStatus("dnd");
    await vi.waitFor(() => expect(a.trix.view()!.presence.prefs.chosen).toBe("dnd"));
    expect(b.trix.view()!.presence.prefs.chosen).toBe("available");
    expect(b.trix.view()!.registration).toBe("off");
    expect(b.sip.stopped).toBe(0);
  });

  it("disposes: unregisters, lets go of the platform, and notifies no more", async () => {
    const { trix, sip, page } = make();
    await registered(trix, sip);
    const seen: TrixView[] = [];
    trix.subscribe((v) => seen.push(v));
    await trix.dispose();
    expect(sip.stopped).toBeGreaterThan(0);
    expect(page.listening).toBe(false);
    await Promise.resolve();
    expect(seen).toHaveLength(0);
  });
});
