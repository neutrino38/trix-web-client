/**
 * Le clavier DTMF : son gabarit et le bouton qui l'ouvre.
 *
 * Ce qui se vérifie ici est ce que le typage ne dit pas — que les douze
 * touches d'un clavier téléphonique y sont, dans l'ordre, que l'écho
 * montre ce que la machine a **réellement** envoyé (et rien de ce qu'un
 * distant pourrait y glisser), et que le bouton de la barre ne s'allume
 * pas au repos : une commande allumée en permanence ne dit plus rien.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { DTMF_PAD_ID, closeDtmf, dtmfOpen, dtmfPad, isDtmfTone } from "../src/ui/screens/call/dtmf.js";
import { overlayBar } from "../src/ui/screens/call/overlay.js";
import type { CallView } from "../src/machines/events.js";
import { useLocale } from "../src/i18n/index.js";

beforeAll(async () => {
  await useLocale("fr");
});

function view(over: Partial<CallView> = {}): CallView {
  return {
    state: "connected",
    direction: "outgoing",
    target: "sip:bob@example.fr",
    displayName: null,
    offered: { audio: true, video: false, text: false },
    media: { audio: true, video: false, text: false },
    selfViewHidden: false,
    mediaPending: false,
    mediaAsked: null,
    shareAsked: false,
    paused: false,
    sharing: "off" as const,
    peerSharing: false,
    peerPaused: false,
    dtmfSent: "",
    notice: null,
    earlyMedia: { audio: false, video: false, text: false },
    connectedAt: Date.now(),
    endedBy: null,
    session: null,
    ...over,
  };
}

const dtmfButton = (v: CallView): string => {
  const bar = overlayBar({ view: v, speakerMuted: false });
  const start = bar.indexOf('data-act="dtmf"');
  expect(start).toBeGreaterThan(-1);
  return bar.slice(bar.lastIndexOf("<button", start), bar.indexOf("</button>", start));
};

describe("gabarit du pavé", () => {
  it("porte les douze touches du clavier téléphonique, dans l'ordre", () => {
    const html = dtmfPad(view());
    const tones = [...html.matchAll(/data-tone="([^"]+)"/g)].map((m) => m[1]);
    expect(tones).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"]);
  });

  it("les touches restent en écriture latine, même en arabe", async () => {
    await useLocale("ar");
    try {
      expect(dtmfPad(view())).toContain('<div class="dtmf-keys" dir="ltr">');
    } finally {
      await useLocale("fr");
    }
  });

  it("sans tonalité composée, l'écho invite à composer", () => {
    const html = dtmfPad(view());
    expect(html).toContain("Composez sur les touches ou au clavier");
    expect(html).not.toContain('class="sent"');
  });

  it("les tonalités envoyées s'affichent telles que la machine les a retenues", () => {
    expect(dtmfPad(view({ dtmfSent: "*123#" }))).toContain(">*123#<");
  });

  it("hors communication, il n'y a pas de pavé du tout", () => {
    for (const state of ["dialing", "ringing", "ringing_in", "hangingup"] as const) {
      expect(dtmfPad(view({ state }))).toBe("");
    }
  });

  it("replié, le pavé est rendu mais caché — l'ouvrir n'est qu'un attribut", () => {
    closeDtmf();
    expect(dtmfOpen()).toBe(false);
    expect(dtmfPad(view())).toContain("hidden");
  });
});

describe("touches acceptées du clavier physique", () => {
  it("reconnaît exactement les douze touches du pavé", () => {
    for (const key of "0123456789*#") expect(isDtmfTone(key)).toBe(true);
    for (const key of ["a", "Enter", "ArrowUp", " ", "+", "A"]) {
      expect(isDtmfTone(key)).toBe(false);
    }
  });
});

describe("bouton DTMF de la barre", () => {
  it("en communication : actif, replié, et éteint", () => {
    closeDtmf();
    const html = dtmfButton(view());
    expect(html).not.toContain("disabled");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(`aria-controls="${DTMF_PAD_ID}"`);
    // ni rouge (rien n'est coupé) ni violet (rien n'est déployé)
    expect(html).not.toContain("toggled");
    expect(html).not.toContain('class="iconbtn off"');
  });

  it("hors communication : désactivé, il n'y a pas de flux où glisser un DTMF", () => {
    expect(dtmfButton(view({ state: "dialing" }))).toContain("disabled");
  });
});
