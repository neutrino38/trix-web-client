/**
 * Panneau latéral repliable et redimensionnable (maquette 1b/1c).
 *
 * Deux gestes, une seule règle qui les gouverne : **Raccrocher doit rester
 * atteignable dans tous les états**. C'est elle qui justifie le rond rouge de
 * la barre de surimpression — sans lui, replier le panneau enlèverait le seul
 * bouton permettant de mettre fin à l'appel.
 *
 * L'état vit dans `prefs.ts`, jamais dans la machine : le format d'affichage
 * ne change rien au protocole SIP (docs/CONCEPTION.md §4.6).
 *
 * Le repli est un simple basculement de classe sur la racine de l'écran, et
 * non un re-rendu : l'écran est reconstruit à chaque notification de la
 * machine, mais un clic sur ce bouton n'en est pas une. Le CSS fait tout —
 * cacher la sidebar, révéler le rond rouge — et le prochain rendu relit
 * `prefs` pour retrouver le même état.
 */

import {
  PANEL_MIN,
  clampPanelWidth,
  panelMax,
  panelWidth,
  setPanelCollapsed,
  setPanelWidth,
} from "../../prefs.js";
import { esc } from "../../el.js";
import { isRtl, t } from "../../../i18n/index.js";

/** Rectangle avec une colonne sur le bord : le panneau lui-même (maquette
 * 1b/1c). Le dessin est celui de la lecture latine ; le CSS le retourne en
 * écriture droite-à-gauche, où le panneau borde l'autre côté. */
const PANEL_GLYPH = `<path d="M3 4h18v16H3V4zm11 2v12h5V6h-5z"/>`;
/** Chevron vers l'extérieur : le panneau va ressortir (état replié). */
const PANEL_CHEVRON = `<path d="M12.6 8.6 9.2 12l3.4 3.4" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;

export function panelIcon(collapsed: boolean): string {
  return `<svg class="icon" viewBox="0 0 24 24">${PANEL_GLYPH}${
    collapsed ? PANEL_CHEVRON : ""
  }</svg>`;
}

/**
 * Ce que fait le bouton **maintenant**. Replié, il montre le tchat : c'est le
 * contenu du panneau pendant un appel (D3 — l'historique, lui, reste réservé
 * au hors-appel, faute de place à 300 px).
 */
export function panelToggleLabel(collapsed: boolean): string {
  return t(collapsed ? "panel.showChat" : "panel.hide");
}

/**
 * Poignée de redimensionnement : `role="separator"` focusable — le patron ARIA
 * du séparateur de fenêtres. `tabindex="0"` et les flèches ne sont pas un
 * supplément d'âme : sans eux le redimensionnement serait réservé à la souris
 * (RGAA 7.3 / WCAG 2.1.1).
 */
export function panelHandle(width: number): string {
  return `<div class="panel-handle" data-ref="panel-handle" tabindex="0"
       role="separator" aria-orientation="vertical" aria-label="${esc(t("panel.handleAria"))}"
       aria-valuenow="${width}" aria-valuemin="${PANEL_MIN}" aria-valuemax="${panelMax()}"
       title="${esc(t("panel.handleTitle"))}"><span></span></div>`;
}

/** Pas du pilotage clavier : fin par défaut, large avec Maj. */
const STEP = 16;
const STEP_FAST = 64;

/**
 * Sens dans lequel il faut pousser pour élargir le panneau : vers la gauche
 * (`-1`) quand il borde le côté droit de l'écran, vers la droite (`+1`)
 * quand la page est en droite-à-gauche et qu'il est passé à gauche.
 */
function widenSign(): 1 | -1 {
  return isRtl() ? 1 : -1;
}

export function wirePanel(screen: HTMLElement): void {
  const sidebar = screen.querySelector(".sidebar") as HTMLElement | null;
  const toggle = screen.querySelector('[data-act="panel"]') as HTMLElement | null;
  const handle = screen.querySelector('[data-ref="panel-handle"]') as HTMLElement | null;

  toggle?.addEventListener("click", () => {
    const collapsed = !screen.classList.contains("panel-collapsed");
    screen.classList.toggle("panel-collapsed", collapsed);
    setPanelCollapsed(collapsed);
    toggle.classList.toggle("toggled", collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.title = panelToggleLabel(collapsed);
    toggle.innerHTML = panelIcon(collapsed);
    // Pas d'annonce dans la région `polite` : `aria-expanded` sur le bouton
    // qu'on vient d'activer dit déjà l'état, et cette région appartient au
    // chrono pendant la communication — y écrire ferait ré-annoncer « en
    // communication depuis N minutes » à la seconde suivante (announce() ne
    // filtre que la répétition immédiate).
  });

  if (!sidebar || !handle) return;

  // pendant le glisser : le DOM suit la souris, mais on n'écrit dans
  // localStorage qu'au relâchement — inutile d'y graver soixante largeurs
  // par seconde pour n'en garder qu'une
  const show = (px: number): number => {
    const width = clampPanelWidth(px);
    sidebar.style.width = `${width}px`;
    handle.setAttribute("aria-valuenow", String(width));
    handle.setAttribute("aria-valuemax", String(panelMax()));
    return width;
  };
  const keep = (px: number): void => {
    show(setPanelWidth(px));
  };

  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault(); // sinon le glisser sélectionne le texte de la sidebar
    handle.setPointerCapture(e.pointerId);
    screen.classList.add("resizing");
    const startX = e.clientX;
    const startWidth = sidebar.getBoundingClientRect().width;
    let width = startWidth;
    // Le geste suit le bord, pas la gauche : le panneau est du côté « fin de
    // ligne », donc à gauche en écriture droite-à-gauche. `clientX` reste
    // physique — c'est le seul endroit où le sens de la page doit être lu.
    const towardsWide = widenSign();
    const move = (m: PointerEvent): void => {
      width = show(startWidth + towardsWide * (m.clientX - startX));
    };
    const stop = (): void => {
      handle.removeEventListener("pointermove", move);
      screen.classList.remove("resizing");
      keep(width);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop, { once: true });
    handle.addEventListener("pointercancel", stop, { once: true });
  });

  handle.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? STEP_FAST : STEP;
    const width = sidebar.getBoundingClientRect().width;
    let next: number | null = null;
    // la flèche qui pointe vers le panneau l'élargit, comme le glisser :
    // gauche en écriture latine, droite une fois la page retournée
    const wide = widenSign();
    if (e.key === "ArrowLeft") next = width - wide * step;
    else if (e.key === "ArrowRight") next = width + wide * step;
    else if (e.key === "Home") next = PANEL_MIN;
    else if (e.key === "End") next = panelMax();
    if (next === null) return;
    e.preventDefault(); // les flèches ne doivent pas faire défiler la page
    keep(next);
  });

  // La borne haute dépend de la fenêtre : la redimensionner peut rendre la
  // largeur retenue hors bornes. On repart de la valeur **retenue**, et non
  // de la largeur mesurée : panneau replié, celle-ci vaut zéro et écraserait
  // le réglage. L'écran étant reconstruit à chaque notification de la
  // machine, l'écouteur se retire dès que son nœud a quitté le document —
  // sinon ils s'empileraient à chaque rendu.
  const onResize = (): void => {
    if (!screen.isConnected) {
      window.removeEventListener("resize", onResize);
      return;
    }
    show(panelWidth());
  };
  window.addEventListener("resize", onResize);
}
