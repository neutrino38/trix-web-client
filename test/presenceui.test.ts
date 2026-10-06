/**
 * Presence on screen (ADR 0007, D5, D8, D11): each glyph has its own
 * shape, the word is always written, the status button shows only where
 * D8 says, and the menu says what each choice does.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { useLocale } from "../src/i18n/index.js";
import type { PresenceState, PresenceView, Registration, TrixView } from "../src/core/index.js";
import { PresenceMachine, publishedPresence, type PresenceInstance } from "../src/machines/presence.js";
import type { SipHandle } from "../src/sip/port.js";
import { NO_PRESENCE } from "../src/sip/presence.js";
import { NO_MESSAGING } from "../src/sip/message.js";
import {
  GLYPH_LABEL,
  glyph,
  headerKey,
  myGlyph,
  statusButton,
  statusMenuHtml,
  type Glyph,
} from "../src/ui/presence.js";
import { DEFAULT_STATUS } from "../src/storage/session.js";

beforeAll(async () => {
  await useLocale("fr");
});

const STATE: Record<string, PresenceState> = { live: "live", no_watch: "noWatch", stale: "stale", disabled: "disabled" };

/** The machine as the view shows it (`core/view.ts`): the screens read nothing else. */
function viewOf(p: PresenceInstance): PresenceView {
  const c = p.context;
  return {
    state: STATE[p.state] ?? "off",
    prefs: c.prefs,
    shown: publishedPresence(c.prefs, c.inCall, c.idle),
    support: c.support,
    contacts: c.contacts,
  };
}

/** What the header reads of the view: the registration, and our presence. */
const appIn = (registration: Registration, p: PresenceInstance) =>
  ({ registration, presence: viewOf(p) }) as TrixView;

function presenceLive(): PresenceInstance {
  const presence = PresenceMachine.start();
  const handle = { presence: () => NO_PRESENCE, messaging: () => NO_MESSAGING } as unknown as SipHandle;
  presence.send({ type: "phone:up", handle, accountId: "acc", uris: [] });
  return presence;
}

describe("glyphs (D11)", () => {
  const ALL: Glyph[] = ["available", "busy", "on-the-phone", "away", "dnd", "offline", "unknown", "invisible"];

  it("eight states, eight shapes", () => {
    expect(new Set(ALL.map((g) => glyph(g))).size).toBe(8);
  });

  it("every glyph is decorative: the word goes beside it", () => {
    for (const g of ALL) expect(glyph(g)).toContain('aria-hidden="true"');
    expect(new Set(Object.values(GLYPH_LABEL)).size).toBe(8);
  });

  it("a stale state is drawn with the dashed ring of the unknown (D9)", () => {
    expect(glyph("available", 15, true)).toBe(glyph("unknown"));
  });

  it("the tints come from the presence tokens, not the theme's", () => {
    expect(glyph("available")).toContain("var(--presence-available)");
    expect(glyph("away")).toContain("var(--presence-away)");
    expect(glyph("dnd")).toContain("var(--presence-busy)");
  });
});

describe("myGlyph", () => {
  const ctx = (over: Partial<PresenceInstance["context"]>) =>
    viewOf({ state: "live", context: { prefs: DEFAULT_STATUS, inCall: false, idle: false, ...over } } as PresenceInstance);

  it("what others see, rules applied", () => {
    expect(myGlyph(ctx({ inCall: true }))).toBe("on-the-phone");
    expect(myGlyph(ctx({ idle: true }))).toBe("away");
  });

  it("Invisible is shown as such to us alone", () => {
    expect(myGlyph(ctx({ prefs: { ...DEFAULT_STATUS, chosen: "invisible" } }))).toBe("invisible");
  });
});

describe("the status button (D8)", () => {
  it("replaces the pill when registered and presence is live", () => {
    const html = statusButton(appIn("registered", presenceLive()), "alice@example.fr")!;
    expect(html).toContain("Disponible");
    expect(html).toContain("alice@example.fr");
    expect(html).toContain('aria-haspopup="dialog"');
  });

  it.each<Registration>(["connecting", "reconnecting", "sleeping", "failed"])("not while %s", (registration) => {
    expect(statusButton(appIn(registration, presenceLive()), "")).toBeNull();
  });

  it("not when the server refused SUBSCRIBE: the pill of before", () => {
    const presence = presenceLive();
    presence.send({ type: "sip:presenceSupport", method: "subscribe", supported: false });
    expect(statusButton(appIn("registered", presence), "")).toBeNull();
  });

  it("the header key follows our status, not our contacts", () => {
    const presence = presenceLive();
    const before = headerKey(appIn("registered", presence));
    presence.send({
      type: "sip:presence",
      uri: "sip:bob@example.fr",
      info: { state: "busy", note: null, since: null },
      pending: false,
    });
    expect(headerKey(appIn("registered", presence))).toBe(before);
    presence.send({ type: "ui:setStatus", status: "busy" });
    expect(headerKey(appIn("registered", presence))).not.toBe(before);
  });
});

describe("the menu (D5)", () => {
  it("five statuses, the chosen one checked and alone in the tab order", () => {
    const presence = presenceLive();
    presence.send({ type: "ui:setStatus", status: "away" });
    const html = statusMenuHtml(viewOf(presence));
    expect(html.match(/role="menuitemradio"/g)).toHaveLength(5);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-checked="true" tabindex="0"[^>]*data-status="away"/);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
  });

  it("says what Do not disturb does to calls", () => {
    const html = statusMenuHtml(viewOf(presenceLive()));
    expect(html).toContain("Les appels entrants sont refusés et notés dans l'historique");
  });

  it("the note and both rules reflect the preferences", () => {
    const presence = presenceLive();
    presence.send({ type: "ui:setNote", note: `<b>"Lyon"</b>` });
    presence.send({ type: "ui:setRule", rule: "awayWhenIdle", on: false });
    const html = statusMenuHtml(viewOf(presence));
    expect(html).toContain('value="&lt;b&gt;&quot;Lyon&quot;&lt;/b&gt;"');
    expect(html).toMatch(/data-rule="onThePhone" checked/);
    expect(html).toMatch(/data-rule="awayWhenIdle" >/);
  });

  it("says so when the server does not take PUBLISH", () => {
    const presence = presenceLive();
    expect(statusMenuHtml(viewOf(presence))).not.toContain("ne diffuse pas");
    presence.send({ type: "sip:presenceSupport", method: "publish", supported: false });
    expect(statusMenuHtml(viewOf(presence))).toContain("Ce serveur ne diffuse pas votre statut");
  });
});
