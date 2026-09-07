/**
 * **L'écran que le correspondant partage** (ADR 0005, D11).
 *
 * Recevoir un partage ne demande aucune capacité particulière — c'est tout
 * l'intérêt : le poste qui ne sait pas capturer un écran sait parfaitement
 * en afficher un. Ce qui se joue ici n'est donc pas une négociation, c'est
 * une **mise en scène**, et elle tient en quatre règles :
 *
 * - **`object-fit: contain`, jamais `cover`.** Recadrer un écran partagé
 *   coupe du texte — c'est-à-dire tout ce qu'il transportait ;
 * - **la permutation est offerte.** L'écran prend la grande surface et le
 *   visage passe en vignette ; remettre le visage en grand ne refuse pas
 *   le partage, cela le range. Pour le public de Trix, ce n'est pas un
 *   réglage d'affichage : la vidéo de l'appel est le canal de la langue des
 *   signes (F.703 §4.5 et §6.2.4), et tout ce qui l'en chasse est un acte
 *   de conversation ;
 * - **le zoom, parce que `contain` ne suffit pas.** Un écran de bureau
 *   ramené à 360 px reste illisible : rien n'y est coupé, tout y est trop
 *   petit. C'est la question ouverte 3 de l'ADR, et la réponse est un
 *   agrandissement **local** — rien ne part sur le fil, le correspondant
 *   continue d'envoyer la même image ;
 * - **deux chemins pour chaque geste.** Un appui sur la vignette et un
 *   bouton dans la barre ; un pincement et un pavé de zoom ; le clavier
 *   pour les deux. Le geste tactile seul n'existe pas au clavier
 *   (RGAA 7.3), et un pincement est même deux fois hors de portée — c'est
 *   un geste à plusieurs points, ce que WCAG 2.5.1 demande de doubler d'un
 *   équivalent à un seul point.
 *
 * Tout l'état vit ici, hors du DOM, comme celui du pavé DTMF
 * (`call/dtmf.ts`) : l'écran d'appel est reconstruit à chaque notification
 * de la machine, et un agrandissement qui repartirait à 100 % chaque fois
 * qu'un message fugace passe serait pire que pas de zoom du tout.
 */

import type { CallView } from "../../../machines/events.js";
import { formatNumber, t } from "../../../i18n/index.js";
import { esc } from "../../el.js";

/**
 * **Le visage a-t-il repris la grande surface ?** Faux au départ : c'est
 * l'écran qui la prend quand il arrive, sans quoi le partage n'aurait servi
 * à rien.
 */
let swapped = false;

export function shareSwapped(): boolean {
  return swapped;
}

// ---------------------------------------------------------------------------
// Le zoom — ce qui se calcule sans DOM, et se vérifie sans navigateur
// ---------------------------------------------------------------------------

/** Taille d'origine : l'image entière dans le cadre, rien de coupé. */
export const ZOOM_MIN = 1;
/**
 * Au-delà, on ne lit plus un écran : on regarde des pixels. Cinq fois
 * suffit à rendre lisible du texte de 12 px capturé sur un écran de bureau
 * et affiché sur 360, ce qui est le cas que l'ADR pose.
 */
export const ZOOM_MAX = 5;
/** Un cran de bouton ou de touche. Multiplicatif : c'est ainsi qu'on zoome. */
export const ZOOM_STEP = 1.4;

/** Le facteur ramené dans ses bornes. */
export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

/**
 * De combien l'image peut glisser sur un axe avant de découvrir du vide :
 * la moitié de ce que l'agrandissement lui a ajouté. À l'échelle 1, rien —
 * et c'est ce qui empêche de faire dériver une image qui tient déjà tout
 * entière dans le cadre.
 */
export function clampPan(offset: number, zoom: number, size: number): number {
  const max = Math.max(0, ((zoom - 1) * size) / 2);
  return Math.min(max, Math.max(-max, offset));
}

/**
 * Le déplacement qui garde **le point visé sous le doigt** pendant que
 * l'image grandit. Sans lui, le pincement écarterait les doigts d'un
 * endroit et agrandirait un autre — le zoom se ferait toujours au centre,
 * et il faudrait repositionner l'image après chaque geste.
 *
 * `anchor` est la distance du point visé au centre du cadre, en pixels
 * d'écran ; le point de l'image qui s'y trouve est `(anchor - offset) /
 * zoom`, et on veut qu'il y reste après l'agrandissement.
 */
export function anchoredPan(offset: number, anchor: number, zoom: number, next: number): number {
  return anchor - (anchor - offset) * (next / zoom);
}

/** L'agrandissement en cours, et où l'image a glissé sous le cadre (en px). */
let zoom = ZOOM_MIN;
let panX = 0;
let panY = 0;

/** L'écran partagé est-il agrandi ? Lu par le pavé, et par les tests. */
export function shareZoom(): number {
  return zoom;
}

function resetZoom(): void {
  zoom = ZOOM_MIN;
  panX = 0;
  panY = 0;
}

// ---------------------------------------------------------------------------
// Gabarit
// ---------------------------------------------------------------------------

/**
 * La seconde surface, posée dans la zone vidéo à côté de la première. C'est
 * le **CSS** qui décide laquelle des deux occupe la scène — l'échange se
 * fait alors sans reconstruire l'écran, donc sans perdre une image.
 *
 * `muted` : l'audio de l'appel arrive par la surface principale, et un
 * second élément qui jouerait la même piste la doublerait. L'audio d'onglet
 * (`getDisplayMedia({ audio: true })`) est hors périmètre — il n'y a rien à
 * entendre ici.
 *
 * `tabindex="0"` : la surface se donne le focus, et c'est ce qui rend le
 * déplacement praticable aux flèches du clavier quand l'image est agrandie.
 * Le pavé de zoom la suit dans l'ordre de tabulation — les deux chemins
 * d'un même geste, l'un après l'autre.
 */
export function shareStage(view: CallView, peer: string): string {
  if (!view.peerSharing) return "";
  return `<video class="share" data-ref="share" autoplay playsinline muted tabindex="0"
                 aria-label="${esc(t("share.stageAria", { peer }))}"
                 title="${esc(t("share.zoomHint"))}"></video>
    <div class="sharezoom" data-ref="sharezoom" role="group"
         aria-label="${esc(t("share.zoomGroup"))}">
      <button type="button" class="zoombtn" data-act="zoom-out"
              title="${esc(t("share.zoomOut"))}" aria-label="${esc(t("share.zoomOut"))}">−</button>
      <button type="button" class="zoomlevel" data-act="zoom-reset" data-ref="zoomlevel"
              title="${esc(t("share.zoomReset"))}"
              aria-label="${esc(t("share.zoomReset"))}">${esc(zoomLabel())}</button>
      <button type="button" class="zoombtn" data-act="zoom-in"
              title="${esc(t("share.zoomIn"))}" aria-label="${esc(t("share.zoomIn"))}">+</button>
    </div>`;
}

/** Le niveau affiché au milieu du pavé — et le bouton qui le remet à 100 %. */
function zoomLabel(): string {
  return t("share.zoomLevel", { n: formatNumber(zoom * 100, 0) });
}

// ---------------------------------------------------------------------------
// Câblage
// ---------------------------------------------------------------------------

/**
 * Câble la permutation et le zoom. Aucun des deux ne re-rend l'écran : une
 * classe sur la zone vidéo pour l'un, une transformation CSS pour l'autre —
 * l'image ne cligne pas, et la vidéo ne repart pas de zéro.
 */
export function wireShareStage(screen: HTMLElement): void {
  const zone = screen.querySelector<HTMLElement>('[data-ref="videozone"]');
  const share = screen.querySelector<HTMLVideoElement>('[data-ref="share"]');
  if (!zone || !share) {
    // Pas de partage dans ce rendu : ni permutation ni zoom n'ont d'objet, et
    // leur état ne doit pas lui survivre — sans quoi le partage suivant
    // s'ouvrirait en vignette, ou agrandi trois fois, pour avoir été réglé
    // ainsi dix minutes plus tôt. C'est la fin du partage **et** la fin de
    // l'appel, en une seule ligne.
    swapped = false;
    resetZoom();
    return;
  }
  const remote = screen.querySelector<HTMLVideoElement>('[data-ref="remote"]');
  const buttons = [...screen.querySelectorAll<HTMLElement>('[data-act="swap-stage"]')];
  const level = screen.querySelector<HTMLElement>('[data-ref="zoomlevel"]');
  const zoomOut = screen.querySelector<HTMLButtonElement>('[data-act="zoom-out"]');
  const zoomIn = screen.querySelector<HTMLButtonElement>('[data-act="zoom-in"]');

  /** L'image agrandie, telle qu'elle se pose sur la surface. */
  const draw = (): void => {
    // Le câblage précède le montage : un nœud détaché mesure 0, et borner
    // le déplacement à cette taille-là le ramènerait à zéro — l'écran
    // reviendrait au centre à chaque re-rendu, c'est-à-dire à chaque
    // message fugace. On ne borne que ce qui a une taille.
    if (share.clientWidth > 0) panX = clampPan(panX, zoom, share.clientWidth);
    if (share.clientHeight > 0) panY = clampPan(panY, zoom, share.clientHeight);
    share.style.transform =
      zoom === ZOOM_MIN ? "" : `translate(${panX}px, ${panY}px) scale(${zoom})`;
    share.classList.toggle("zoomed", zoom > ZOOM_MIN);
    if (level) level.textContent = zoomLabel();
    if (zoomOut) zoomOut.disabled = zoom <= ZOOM_MIN;
    if (zoomIn) zoomIn.disabled = zoom >= ZOOM_MAX;
  };

  /**
   * Change l'agrandissement autour d'un point visé — le milieu des deux
   * doigts, ou le centre du cadre quand la demande vient d'un bouton ou
   * d'une touche.
   */
  const setZoom = (next: number, anchorX = 0, anchorY = 0): void => {
    const to = clampZoom(next);
    if (to === zoom) return;
    panX = anchoredPan(panX, anchorX, zoom, to);
    panY = anchoredPan(panY, anchorY, zoom, to);
    zoom = to;
    draw();
  };

  /** Le zoom n'a de sens que sur la scène : en vignette, l'appui permute. */
  const zoomable = (): boolean => !swapped;

  const apply = (next: boolean): void => {
    swapped = next;
    zone.classList.toggle("swapped", next);
    // l'écran qui quitte la scène rend sa taille d'origine : une vignette
    // agrandie ne montrerait qu'un coin de l'écran, et le geste pour en
    // sortir n'y serait plus
    if (next) {
      resetZoom();
      draw();
    }
    for (const b of buttons) {
      b.setAttribute("aria-pressed", String(next));
      const label = t(next ? "ctrl.swap.screen" : "ctrl.swap.face");
      b.title = label;
      const slot = b.querySelector(".cmd-label");
      if (slot) slot.textContent = label;
      b.classList.toggle("toggled", next);
    }
  };

  for (const b of buttons) b.addEventListener("click", () => apply(!swapped));
  // un appui sur la **vignette** la met en grand : c'est celle des deux
  // surfaces qui n'a pas la scène, et elle change avec la permutation
  share.addEventListener("click", () => {
    if (swapped) apply(false);
  });
  remote?.addEventListener("click", () => {
    if (!swapped) apply(true);
  });

  // --- le pavé de zoom : l'équivalent à un seul point du pincement --------
  zoomOut?.addEventListener("click", () => setZoom(zoom / ZOOM_STEP));
  zoomIn?.addEventListener("click", () => setZoom(zoom * ZOOM_STEP));
  screen.querySelector('[data-act="zoom-reset"]')?.addEventListener("click", () => {
    resetZoom();
    draw();
  });

  // --- le pincement, et le glissement quand l'image dépasse ---------------
  /** Les doigts posés sur la surface, par identifiant de pointeur. */
  const points = new Map<number, { x: number; y: number }>();
  /** L'écartement des deux doigts au relevé précédent. */
  let spread = 0;

  /** Le centre des deux doigts, rapporté au centre du cadre. */
  const focus = (): { x: number; y: number } => {
    const [a, b] = [...points.values()];
    const box = share.getBoundingClientRect();
    const x = b ? (a!.x + b.x) / 2 : a!.x;
    const y = b ? (a!.y + b.y) / 2 : a!.y;
    return { x: x - (box.left + box.width / 2), y: y - (box.top + box.height / 2) };
  };

  const gap = (): number => {
    const [a, b] = [...points.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  share.addEventListener("pointerdown", (e) => {
    if (!zoomable()) return;
    points.set(e.pointerId, { x: e.clientX, y: e.clientY });
    spread = gap();
    // sans capture, un doigt qui sort du cadre en cours de geste ne rendrait
    // plus rien — et le zoom resterait figé au milieu du mouvement
    share.setPointerCapture(e.pointerId);
  });

  share.addEventListener("pointermove", (e) => {
    const held = points.get(e.pointerId);
    if (!held || !zoomable()) return;
    const dx = e.clientX - held.x;
    const dy = e.clientY - held.y;
    held.x = e.clientX;
    held.y = e.clientY;
    if (points.size >= 2) {
      const next = gap();
      if (spread > 0 && next > 0) {
        const at = focus();
        setZoom(zoom * (next / spread), at.x, at.y);
      }
      spread = next;
      return;
    }
    // un seul doigt : on déplace, et seulement s'il y a de quoi. À
    // l'échelle 1 le glissement ne fait rien — l'image tient déjà entière
    if (zoom === ZOOM_MIN) return;
    panX += dx;
    panY += dy;
    draw();
  });

  const release = (e: PointerEvent): void => {
    points.delete(e.pointerId);
    spread = gap();
  };
  share.addEventListener("pointerup", release);
  share.addEventListener("pointercancel", release);

  // le pincement d'un pavé tactile de portable arrive en molette + Ctrl :
  // c'est le même geste, et il mérite la même réponse
  share.addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey || !zoomable()) return;
      e.preventDefault();
      const box = share.getBoundingClientRect();
      setZoom(
        zoom * (e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP),
        e.clientX - (box.left + box.width / 2),
        e.clientY - (box.top + box.height / 2),
      );
    },
    { passive: false },
  );

  // --- le clavier : le même geste, sans doigts ----------------------------
  share.addEventListener("keydown", (e) => {
    if (!zoomable()) return;
    const step = e.shiftKey ? 120 : 40;
    switch (e.key) {
      case "+":
      case "=":
        setZoom(zoom * ZOOM_STEP);
        break;
      case "-":
        setZoom(zoom / ZOOM_STEP);
        break;
      case "0":
      case "Escape":
        if (zoom === ZOOM_MIN) return; // Échap appartient alors à ce qui est derrière
        resetZoom();
        draw();
        break;
      case "ArrowLeft":
      case "ArrowRight":
      case "ArrowUp":
      case "ArrowDown": {
        if (zoom === ZOOM_MIN) return; // rien à déplacer : la page garde sa touche
        if (e.key === "ArrowLeft") panX += step;
        if (e.key === "ArrowRight") panX -= step;
        if (e.key === "ArrowUp") panY += step;
        if (e.key === "ArrowDown") panY -= step;
        draw();
        break;
      }
      default:
        return;
    }
    e.preventDefault();
  });

  // le rendu vient de reconstruire l'écran : la scène reprend l'ordre et
  // l'agrandissement qu'elle avait, sans que personne n'ait rien demandé
  apply(swapped);
  draw();
}
