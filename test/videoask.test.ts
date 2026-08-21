/**
 * La popup « X souhaite ajouter la vidéo » et le bouton de la caméra.
 *
 * Ce qui se vérifie ici est ce que le typage ne dit pas : la question
 * nomme le correspondant sans laisser passer ce qu'il a écrit dans son
 * nom affiché, et l'icône de la caméra dit à tout instant ce qu'un clic
 * ferait — ajouter la vidéo, ou la retirer.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { videoAskDialog } from "../src/ui/screens/call/videoask.js";
import { overlayBar } from "../src/ui/screens/call/overlay.js";
import type { CallView } from "../src/machines/events.js";
import { useLocale } from "../src/i18n/index.js";

beforeAll(async () => {
  // sans dictionnaire chargé, `t()` rend la clé : la question ne nommerait
  // personne, et c'est justement ce qui se vérifie ici
  await useLocale("fr");
});

function view(over: Partial<CallView> = {}): CallView {
  return {
    state: "connected",
    direction: "outgoing",
    target: "sip:bob@example.fr",
    displayName: null,
    offered: { audio: true, video: false },
    media: { audio: true, video: false },
    micMuted: false,
    selfViewHidden: false,
    videoPending: false,
    videoAsked: false,
    notice: null,
    connectedAt: Date.now(),
    endedBy: null,
    session: null,
    ...over,
  };
}

describe("videoAskDialog", () => {
  it("nomme le correspondant et propose les deux décisions", () => {
    const html = videoAskDialog(view({ videoAsked: true, displayName: "Alice Martin" }));
    expect(html).toContain("Alice Martin");
    expect(html).toContain('data-act="accept-video"');
    expect(html).toContain('data-act="reject-video"');
  });

  it("un nom affiché venu du réseau n'est pas injecté tel quel", () => {
    const html = videoAskDialog(view({ videoAsked: true, displayName: "<img src=x onerror=1>" }));
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });
});

describe("bouton de la caméra", () => {
  const camButton = (v: CallView): string => {
    const bar = overlayBar({ view: v, speakerMuted: false });
    const start = bar.indexOf('data-act="toggleVideo"');
    expect(start).toBeGreaterThan(-1);
    return bar.slice(bar.lastIndexOf("<button", start), bar.indexOf("</button>", start));
  };

  it("appel audio : icône barrée, un clic ajouterait la vidéo", () => {
    const html = camButton(view());
    expect(html).toContain("aria-pressed=\"true\"");
    expect(html).not.toContain("disabled");
  });

  it("appel vidéo : icône entière, un clic la retirerait", () => {
    const html = camButton(view({ media: { audio: true, video: true } }));
    expect(html).toContain("aria-pressed=\"false\"");
  });

  it("renégociation en vol : le bouton attend", () => {
    expect(camButton(view({ videoPending: true }))).toContain("disabled");
  });

  it("question posée : c'est la popup qui répond, pas l'icône", () => {
    expect(camButton(view({ videoAsked: true }))).toContain("disabled");
  });

  it("hors communication : rien à négocier", () => {
    expect(camButton(view({ state: "dialing" }))).toContain("disabled");
  });
});
