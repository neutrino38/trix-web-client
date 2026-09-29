/**
 * The prompt for a message from an unknown address (ADR 0008, D5): the
 * address comes first, the display name is never alone, and nothing that
 * came from the network enters the page as markup.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { useLocale } from "../src/i18n/index.js";
import type { Quarantined } from "../src/machines/messaging.js";
import { strangerPromptHtml } from "../src/ui/strangerprompt.js";

const held = (over: Partial<Quarantined> = {}): Quarantined => ({
  key: "carla@example.org",
  uri: "sip:carla@example.org",
  name: null,
  messages: [{ text: "Bonjour", at: 1 }],
  shownAt: 1,
  ...over,
});

beforeEach(async () => {
  await useLocale("fr");
});

describe("strangerPromptHtml", () => {
  it("names the address, without its scheme", () => {
    expect(strangerPromptHtml(held())).toContain("carla@example.org vous écrit");
  });

  it("never shows the display name alone", () => {
    const html = strangerPromptHtml(held({ name: "Votre banque" }));
    expect(html).toContain("carla@example.org (se présente comme « Votre banque »)");
  });

  it("lists every held message, escaped, in its own direction", () => {
    const html = strangerPromptHtml(held({ messages: [{ text: "<img src=x onerror=alert(1)>", at: 1 }, { text: "Deux", at: 2 }] }));
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html.match(/<p dir="auto">/g)).toHaveLength(2);
  });

  it("offers the three answers, and says what Escape does", () => {
    const html = strangerPromptHtml(held());
    for (const act of ["accept", "refuse", "block"]) expect(html).toContain(`data-act="${act}"`);
    expect(html).toContain("Échap refuse");
  });
});
