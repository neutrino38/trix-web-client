/**
 * The badge of the call screen (ADR 0008, D10): who wrote, how many, and
 * a held unknown sender when nothing else is unread.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { useLocale } from "../src/i18n/index.js";
import type { MessageEntry } from "../src/storage/store.js";
import { badgeText } from "../src/ui/messagealerts.js";

const message = (key: string, read = false): MessageEntry => ({
  id: `${key}-${Math.random()}`, key, uri: `sip:${key}`, direction: "incoming", text: "x",
  at: 1, state: "received", reason: null, read,
});
const names: Record<string, string> = { "bob@example.org": "Bob Martin" };
const nameOf = (key: string) => names[key] ?? key;

beforeEach(async () => {
  await useLocale("fr");
});

describe("badgeText", () => {
  it("one sender: how many, and who", () => {
    expect(badgeText([message("bob@example.org")], 0, nameOf)).toBe("1 message — Bob Martin");
    expect(badgeText([message("bob@example.org"), message("bob@example.org")], 0, nameOf)).toBe(
      "2 messages — Bob Martin",
    );
  });

  it("several senders: how many only", () => {
    expect(badgeText([message("bob@example.org"), message("zoe@example.org")], 0, nameOf)).toBe("2 messages");
  });

  it("read messages do not count", () => {
    expect(badgeText([message("bob@example.org", true)], 0, nameOf)).toBeNull();
  });

  it("a held unknown sender when nothing else is unread", () => {
    expect(badgeText([], 1, nameOf)).toBe("Message d'une adresse inconnue en attente");
  });
});
