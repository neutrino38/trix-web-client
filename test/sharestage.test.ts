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
import {
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  anchoredPan,
  clampPan,
  clampZoom,
  shareStage,
  shareSwapped,
  shareZoom,
} from "../src/ui/screens/call/share.js";
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

/**
 * **Le zoom sur un écran reçu** (ADR 0005, question ouverte 3).
 *
 * Un écran de bureau ramené à 360 px reste illisible même en `contain` :
 * rien n'y est coupé, tout y est trop petit. Le calcul est ici — le geste,
 * lui, demande un navigateur, et ce qui se vérifie sans navigateur est
 * justement ce qui casserait en silence : une image qu'on peut faire
 * dériver hors de son cadre, ou un pincement qui zoome ailleurs que sous
 * les doigts.
 */
describe("l'agrandissement de l'écran reçu", () => {
  it("le pavé de zoom accompagne la surface, et disparaît avec elle", () => {
    expect(shareStage(view(), "Alice")).toBe("");
    const html = shareStage(view({ peerSharing: true }), "Alice");
    expect(html).toContain('data-act="zoom-in"');
    expect(html).toContain('data-act="zoom-out"');
    expect(html).toContain('data-act="zoom-reset"');
    // le pincement est un geste à plusieurs points : WCAG 2.5.1 demande un
    // équivalent à un seul point, et le clavier demande un élément focusable
    expect(html).toContain('tabindex="0"');
  });

  it("l'écran s'ouvre à sa taille d'origine, jamais agrandi", () => {
    expect(shareZoom()).toBe(ZOOM_MIN);
    expect(shareStage(view({ peerSharing: true }), "Alice")).toContain("100 %");
  });

  it("l'agrandissement reste entre ses bornes", () => {
    expect(clampZoom(0.2)).toBe(ZOOM_MIN);
    expect(clampZoom(1000)).toBe(ZOOM_MAX);
    expect(clampZoom(2)).toBe(2);
    // multiplicatif : c'est ainsi qu'on zoome, et c'est ce qui rend les
    // crans réguliers à l'œil
    expect(ZOOM_STEP).toBeGreaterThan(1);
  });

  /**
   * À l'échelle 1, l'image tient tout entière dans le cadre : la faire
   * glisser ne montrerait que du noir. Agrandie, elle peut glisser de la
   * moitié de ce que l'agrandissement lui a ajouté, et pas d'un pixel de
   * plus.
   */
  it("on ne peut pas faire dériver l'image hors de son cadre", () => {
    expect(clampPan(500, ZOOM_MIN, 360)).toBe(0);
    expect(clampPan(-500, ZOOM_MIN, 360)).toBeCloseTo(0, 10);
    // à 2 ×, une surface de 360 px en gagne 360 : 180 de chaque côté
    expect(clampPan(500, 2, 360)).toBe(180);
    expect(clampPan(-500, 2, 360)).toBe(-180);
    expect(clampPan(42, 2, 360)).toBe(42);
  });

  /**
   * Le pincement doit agrandir **sous les doigts** : sans cela, écarter les
   * doigts sur un coin de l'écran agrandirait le centre, et il faudrait
   * repositionner l'image après chaque geste.
   */
  it("le point visé reste sous les doigts pendant l'agrandissement", () => {
    // le point de l'image sous l'ancre, avant et après, doit être le même
    const before = { offset: 0, anchor: 100, zoom: 1 };
    const next = 2;
    const after = anchoredPan(before.offset, before.anchor, before.zoom, next);
    const pointBefore = (before.anchor - before.offset) / before.zoom;
    const pointAfter = (before.anchor - after) / next;
    expect(pointAfter).toBeCloseTo(pointBefore, 6);
  });

  it("zoomer au centre ne déplace rien", () => {
    expect(anchoredPan(0, 0, 1, 3)).toBe(0);
  });
});
