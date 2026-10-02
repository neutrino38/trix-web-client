/**
 * The conversation of a call, in the core (`core/conversation.ts`, ADR
 * 0011, D5) — the model, without a page and without a screen.
 *
 * What breaks without a type flinching: one live bubble per side, a
 * separator that freezes, a backspace that crosses that separator, the
 * two-second rule — writing at the end leaves at once, correcting in the
 * middle waits — and, since D5, a conversation that keeps the text of a
 * call nobody looked at.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_HOLD_MS,
  createConversation,
  followCalls,
  type Conversation,
  type ConversationEvent,
} from "../src/core/conversation.js";
import { bubbleText, type ChatBubble } from "../src/sip/transcript.js";
import { T140 } from "../src/sip/t140.js";
import { fakeChannel, type FakeChannel } from "./fakes/rtt.js";

let conv: Conversation;
let channel: FakeChannel;

beforeEach(() => {
  conv = createConversation();
  channel = fakeChannel();
  conv.attach(channel);
});

const bubbles = (): ChatBubble[] => conv.items().filter((i): i is ChatBubble => i.kind === "bubble");
const texts = (): string[] => bubbles().map(bubbleText);

describe("the received thread", () => {
  it("opens a live bubble on the first character", () => {
    channel.receive("bon");
    channel.receive("jour");
    expect(texts()).toEqual(["bonjour"]);
    expect(bubbles()[0]?.endedAt).toBeNull();
  });

  it("freezes the bubble on the separator and opens a new one", () => {
    channel.receive(`bonjour${T140.LS}salut`);
    expect(texts()).toEqual(["bonjour", "salut"]);
    expect(bubbles()[0]?.endedAt).not.toBeNull();
    expect(bubbles()[1]?.endedAt).toBeNull();
  });

  it("a separator received on an empty bubble creates nothing", () => {
    channel.receive(`${T140.LS}${T140.LS}a`);
    expect(texts()).toEqual(["a"]);
  });

  it("erases a whole grapheme, emoji included", () => {
    channel.receive(`bravo 👍🏽${T140.BS}`);
    expect(texts()).toEqual(["bravo "]);
  });

  it("a backspace on an empty bubble merges the frozen one back", () => {
    channel.receive(`bonjour${T140.LS}`);
    channel.receive(T140.BS);
    expect(texts()).toEqual(["bonjour"]);
    expect(bubbles()[0]?.endedAt).toBeNull();
    channel.receive(" Bob");
    expect(texts()).toEqual(["bonjour Bob"]);
  });

  it("keeps received attributes as separate runs", () => {
    channel.receive(`au ${T140.CSI}31m12 rue des Lilas${T140.CSI}0m, bâtiment C`);
    const runs = bubbles()[0]?.runs ?? [];
    expect(runs.map((r) => r.text)).toEqual(["au ", "12 rue des Lilas", ", bâtiment C"]);
    expect(runs[1]?.attrs.color).toBe("var(--red)");
    expect(runs[2]?.attrs.color).toBeUndefined();
  });

  it("sets a single marker for consecutive losses", () => {
    channel.receive(`${T140.LOST}${T140.LOST}${T140.LOST}suite`);
    expect(texts()).toEqual([`${T140.LOST}suite`]);
  });
});

describe("sending, and the two-second rule", () => {
  afterEach(() => vi.useRealTimers());

  it("writing at the end leaves at once, and shows in the local bubble", () => {
    conv.type("bon");
    conv.type("bonjour");
    expect(conv.sent()).toBe("bonjour");
    expect(texts()).toEqual(["bonjour"]);
    expect(channel.wire).toEqual(["bon", "jour"]);
  });

  it("erasing from the end leaves at once too", () => {
    conv.type("bonjour");
    conv.type("bon");
    expect(conv.sent()).toBe("bon");
    expect(texts()).toEqual(["bon"]);
    expect(channel.wire).toEqual(["bonjour", "⌫4"]);
  });

  it("correcting in the middle waits, then goes back in one stroke", () => {
    vi.useFakeTimers();
    conv.type("12 rue des Lilas");
    conv.type("12 rue des Tilleuls");
    // nothing has left yet: the bubble differs from the input
    expect(conv.sent()).toBe("12 rue des Lilas");
    expect(texts()).toEqual(["12 rue des Lilas"]);
    expect(conv.holdUntil()).toBeGreaterThan(0);
    vi.advanceTimersByTime(CHAT_HOLD_MS);
    expect(conv.sent()).toBe("12 rue des Tilleuls");
    expect(conv.holdUntil()).toBe(0);
    expect(channel.wire).toEqual(["12 rue des Lilas", "⌫5", "Tilleuls"]);
  });

  it("Enter freezes the local bubble, sends the separator and flushes", () => {
    conv.type("j'arrive");
    conv.enter();
    expect(conv.sent()).toBe("");
    expect(conv.draft()).toBe("");
    expect(texts()).toEqual(["j'arrive"]);
    expect(bubbles()[0]?.endedAt).not.toBeNull();
    expect(channel.wire).toEqual(["j'arrive", T140.LS, "⏎"]);
  });

  it("Enter on an empty input freezes nothing and sends nothing", () => {
    conv.enter();
    expect(conv.items()).toHaveLength(0);
    expect(channel.wire).toEqual([]);
  });

  it("a paste does not bring its line breaks into the bubble", () => {
    conv.type("deux\r\nlignes");
    expect(conv.sent()).toBe("deux lignes");
  });
});

describe("the link", () => {
  it("notes the opening once", () => {
    channel.link("open");
    channel.link("open");
    expect(conv.items().filter((i) => i.kind === "note")).toHaveLength(1);
    expect(conv.link()).toBe("open");
  });

  it("tells a refused channel from one closed after use", () => {
    channel.link("closed");
    expect(conv.refused()).toBe(true);
    conv.attach(fakeChannel());
    const next = conv.channel() as FakeChannel;
    next.link("open");
    next.link("closed");
    expect(conv.refused()).toBe(false);
  });

  it("a break shows in the thread", () => {
    channel.link("open");
    channel.link("lost");
    expect(conv.items().at(-1)).toMatchObject({ kind: "note", key: "chat.note.broken" });
  });
});

describe("both sides of the thread", () => {
  it("keeps one live bubble on each side at once", () => {
    channel.receive("je vous entends mal");
    conv.type("oui, je vous lis");
    expect(bubbles().map((b) => [b.side, bubbleText(b)])).toEqual([
      ["them", "je vous entends mal"],
      ["us", "oui, je vous lis"],
    ]);
    // and the peer's separator freezes only theirs
    channel.receive(T140.LS);
    expect(bubbles()[0]?.endedAt).not.toBeNull();
    expect(bubbles()[1]?.endedAt).toBeNull();
  });
});

describe("what the history keeps", () => {
  it("the call's thread, live bubbles closed at hang-up", () => {
    channel.receive("je vous entends mal");
    conv.type("oui, je vous lis");
    const kept = conv.transcript();
    expect(kept.filter((i) => i.kind === "bubble").map((b) => bubbleText(b))).toEqual([
      "je vous entends mal",
      "oui, je vous lis",
    ]);
    // what goes to the vault is a closed copy, not the model
    expect(kept.every((i) => i.kind === "note" || i.endedAt !== null)).toBe(true);
    expect(bubbles().every((b) => b.endedAt === null)).toBe(true);
  });

  it("nothing of a call where nobody wrote", () => {
    channel.link("open");
    channel.link("closed");
    expect(conv.items().length).toBeGreaterThan(0); // remarks, not messages
    expect(conv.transcript()).toEqual([]);
  });
});

describe("what listeners hear", () => {
  it("a frozen bubble of the peer, the bell, the link, a reset", () => {
    const heard: ConversationEvent["type"][] = [];
    conv.subscribe((e) => {
      if (e.type !== "changed") heard.push(e.type);
    });
    channel.receive(`bonjour${T140.LS}`);
    channel.receive(T140.BEL);
    channel.link("open");
    // a fresh channel says "connecting", which a fresh thread already is
    conv.attach(fakeChannel());
    expect(heard).toEqual(["frozen", "alert", "link", "reset"]);
  });

  it("our own bubble frozen is not announced", () => {
    const frozen: ChatBubble[] = [];
    conv.subscribe((e) => {
      if (e.type === "frozen") frozen.push(e.bubble);
    });
    conv.type("j'arrive");
    conv.enter();
    expect(frozen).toEqual([]);
  });
});

/** A phone as far as `followCalls` reads it: its call's session, and its notifications. */
type FakeSession = { rtt: () => FakeChannel | null } | null;

function fakePhone() {
  const subs = new Set<() => void>();
  const phone = {
    context: { session: null as FakeSession },
    subscribe: (fn: () => void) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    /** The call changes, and the machine says so. */
    set(session: FakeSession) {
      phone.context.session = session;
      for (const fn of subs) fn();
    },
  };
  return phone;
}

/**
 * D5: the conversation follows the call's channel **without any screen**.
 * Before, the subscription was made by the chat pane: a UI that did not
 * mount it lost the text received, and the history lost the transcript.
 */
describe("following the calls (D5)", () => {
  it("attaches to the call's channel, keeps what arrived before, detaches when it ends", async () => {
    const phone = fakePhone();
    const mine = createConversation();
    followCalls(phone as never, mine);
    const rtt = fakeChannel();
    // the peer writes before anyone follows: the channel keeps it
    rtt.receive("allô ?");
    phone.set({ rtt: () => rtt });
    await Promise.resolve();
    expect(mine.channel()).toBe(rtt);
    expect(mine.items().filter((i) => i.kind === "bubble").map((b) => bubbleText(b as ChatBubble))).toEqual([
      "allô ?",
    ]);
    // the history reads the transcript inside the transition that files the
    // call, before the conversation lets go
    expect(mine.transcript()).toHaveLength(1);
    phone.set(null);
    await Promise.resolve();
    expect(mine.channel()).toBeNull();
    expect(mine.items()).toEqual([]);
    expect(rtt.listeners()).toBe(0);
  });

  it("a new call starts from an empty thread", async () => {
    const phone = fakePhone();
    const mine = createConversation();
    followCalls(phone as never, mine);
    const first = fakeChannel();
    phone.set({ rtt: () => first });
    await Promise.resolve();
    first.receive("premier appel");
    const second = fakeChannel();
    phone.set({ rtt: () => second });
    await Promise.resolve();
    expect(mine.channel()).toBe(second);
    expect(mine.items()).toEqual([]);
    expect(first.listeners()).toBe(0);
  });

  it("a call without text leaves nothing to follow", async () => {
    const phone = fakePhone();
    const mine = createConversation();
    followCalls(phone as never, mine);
    phone.set({ rtt: () => null });
    await Promise.resolve();
    expect(mine.channel()).toBeNull();
  });
});
