/**
 * La popup « X souhaite ajouter la vidéo » et le bouton de la caméra.
 *
 * Ce qui se vérifie ici est ce que le typage ne dit pas : la question
 * nomme le correspondant sans laisser passer ce qu'il a écrit dans son
 * nom affiché, et l'icône de la caméra dit à tout instant ce qu'un clic
 * ferait — ajouter la vidéo, ou la retirer.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { mediaAskDialog } from "../src/ui/screens/call/mediaask.js";
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
    offered: { audio: true, video: false, text: false },
    media: { audio: true, video: false, text: false },
    selfViewHidden: false,
    mediaPending: false,
    mediaAsked: null,
    paused: false,
    sharing: "off" as const,
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

describe("mediaAskDialog", () => {
  it("nomme le correspondant et propose les deux décisions", () => {
    const html = mediaAskDialog(view({ mediaAsked: ["video"], displayName: "Alice Martin" }));
    expect(html).toContain("Alice Martin");
    expect(html).toContain('data-act="accept-media"');
    expect(html).toContain('data-act="reject-media"');
  });

  it("un nom affiché venu du réseau n'est pas injecté tel quel", () => {
    const html = mediaAskDialog(view({ mediaAsked: ["video"], displayName: "<img src=x onerror=1>" }));
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });
});

/**
 * **Les deux boutons de l'axe 1, et leur symétrie** (ADR 0003, D5 et D6).
 * Ce qui se vérifie ici est qu'ils se comportent *exactement* pareil : même
 * état barré quand le média n'est pas dans l'appel, même verrou pendant une
 * renégociation, même retrait interdit quand il ne resterait rien. Une
 * asymétrie qui s'installerait ici serait invisible au compilateur — et
 * ramènerait le micro au rang de sourdine, ce que D6 écarte.
 */
describe("les boutons média", () => {
  const btn = (v: CallView, kind: "audio" | "video"): string => {
    const bar = overlayBar({ view: v, speakerMuted: false });
    const start = bar.indexOf(`data-act="toggle-${kind}"`);
    expect(start).toBeGreaterThan(-1);
    return bar.slice(bar.lastIndexOf("<button", start), bar.indexOf("</button>", start));
  };

  /** Un appel qui porte les trois : chaque média peut alors se retirer. */
  const full = (over: Partial<CallView> = {}): CallView =>
    view({ media: { audio: true, video: true, text: true }, ...over });

  it("média absent : icône barrée, un clic l'ajouterait", () => {
    // l'appel par défaut est audio seul : la vidéo n'y est pas
    expect(btn(view(), "video")).toContain('aria-pressed="true"');
    expect(btn(view(), "video")).not.toContain("disabled");
  });

  it("média présent : icône entière, un clic le retirerait", () => {
    for (const kind of ["audio", "video"] as const) {
      expect(btn(full(), kind)).toContain('aria-pressed="false"');
      expect(btn(full(), kind)).not.toContain("disabled");
    }
  });

  /**
   * D5 : un seul verrou de renégociation, quel que soit le média qu'elle
   * porte. Deux re-INVITE en vol sur la même boîte de dialogue, c'est un
   * 491 garanti — les deux icônes attendent donc ensemble.
   */
  it("renégociation en vol : les deux boutons attendent, pas seulement celui qui l'a lancée", () => {
    for (const kind of ["audio", "video"] as const) {
      expect(btn(full({ mediaPending: true }), kind)).toContain("disabled");
    }
  });

  it("question posée : c'est la popup qui répond, pas les icônes", () => {
    for (const kind of ["audio", "video"] as const) {
      expect(btn(full({ mediaAsked: ["video"] }), kind)).toContain("disabled");
    }
  });

  it("hors communication : rien à négocier", () => {
    for (const kind of ["audio", "video"] as const) {
      expect(btn(view({ state: "dialing" }), kind)).toContain("disabled");
    }
  });

  /**
   * L'invariant de D5 : « on ne retire pas le dernier média ». Il vit dans
   * le bloc (`isLastMedia`) ; l'interface ne fait qu'en griser le bouton, et
   * c'est cela qu'on vérifie ici — pas la règle elle-même.
   */
  it("dernier média de l'appel : le bouton est grisé, l'appel ne peut pas se vider", () => {
    // audio seul : le retirer ne laisserait rien
    expect(btn(view(), "audio")).toContain("disabled");
    // audio + texte : le texte reste, l'audio peut sortir (F.703 §5.3.1)
    const withText = view({ media: { audio: true, video: false, text: true } });
    expect(btn(withText, "audio")).not.toContain("disabled");
  });
});

/**
 * La question posée par le distant vaut pour les deux médias : allumer un
 * micro demande l'accord de son propriétaire, exactement comme une caméra.
 */
describe("la question porte le média qu'on lui demande", () => {
  it("audio, vidéo, ou les deux : trois questions, et non une phrase à trous", () => {
    expect(mediaAskDialog(view({ mediaAsked: ["video"], displayName: "Alice" }))).toContain(
      "Alice souhaite ajouter la vidéo",
    );
    expect(mediaAskDialog(view({ mediaAsked: ["audio"], displayName: "Alice" }))).toContain(
      "Alice souhaite ajouter l'audio",
    );
    expect(mediaAskDialog(view({ mediaAsked: ["audio", "video"], displayName: "Alice" }))).toContain(
      "Alice souhaite ajouter l'audio et la vidéo",
    );
  });

  it("dit quel capteur s'allumerait — c'est ce qui justifie la question", () => {
    expect(mediaAskDialog(view({ mediaAsked: ["audio"] }))).toContain("votre micro");
    expect(mediaAskDialog(view({ mediaAsked: ["video"] }))).toContain("votre caméra");
  });
});
