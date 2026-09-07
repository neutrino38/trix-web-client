/**
 * **La scène du partage reçu** (ADR 0005, D11).
 *
 * Recevoir un écran ne demande aucune capacité particulière — c'est tout
 * l'intérêt : le poste qui ne sait pas capturer un écran sait parfaitement
 * en afficher un. Ce qui se vérifie ici est donc la **mise en scène**, et
 * ce qu'un typage ne dit pas :
 *
 * - la seconde surface n'existe que pendant un partage : une balise vidéo
 *   vide posée en permanence prendrait la place et l'ordre de tabulation ;
 * - elle est **muette** : l'audio de l'appel arrive par la surface
 *   principale, et un second élément qui jouerait la même piste la
 *   doublerait ;
 * - elle se nomme, avec le correspondant dans son intitulé — deux
 *   rectangles noirs identiques ne se distinguent pas au lecteur d'écran.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { shareStage, shareSwapped } from "../src/ui/screens/call/share.js";
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
    offered: { audio: true, video: true, text: false },
    media: { audio: true, video: true, text: false },
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

describe("la seconde surface", () => {
  it("n'existe pas tant que rien n'est partagé", () => {
    expect(shareStage(view(), "Alice")).toBe("");
  });

  it("apparaît avec le partage, muette et nommée", () => {
    const html = shareStage(view({ peerSharing: true }), "Alice");
    expect(html).toContain('data-ref="share"');
    expect(html).toContain("muted");
    expect(html).toContain("Écran partagé par Alice");
  });

  /** Le nom du correspondant vient du réseau : il ne s'écrit pas en balisage. */
  it("échappe le nom du correspondant", () => {
    const html = shareStage(view({ peerSharing: true }), '<img src=x onerror="1">');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  /**
   * C'est l'écran qui prend la scène quand il arrive : sans cela le partage
   * n'aurait servi à rien, et le correspondant croirait partager pour rien.
   */
  it("l'écran prend la grande surface, et le visage la vignette", () => {
    expect(shareSwapped()).toBe(false);
  });
});
