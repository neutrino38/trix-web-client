/**
 * Préférences d'affichage (thème clair/foncé, taille de texte) —
 * pied de la sidebar du mockup. UI pure : localStorage + attributs
 * sur <html>, aucune machine impliquée.
 */

const THEME_KEY = "trix-theme";
const FONT_KEY = "trix-font";
const CALLMODE_KEY = "trix-callmode";
const PANEL_KEY = "trix-panel";
const PANEL_WIDTH_KEY = "trix-panel-width";
const FONT_MIN = 13;
const FONT_MAX = 20;
const FONT_DEFAULT = 16;

export function applyPrefs(): void {
  const theme = localStorage.getItem(THEME_KEY);
  if (theme === "light" || theme === "dark") {
    document.documentElement.dataset.theme = theme;
  }
  const font = Number(localStorage.getItem(FONT_KEY));
  if (font >= FONT_MIN && font <= FONT_MAX) {
    document.documentElement.style.fontSize = `${font}px`;
  }
}

/**
 * Trois choix, et non deux : « système » n'est pas l'absence de préférence,
 * c'est une préférence à part entière — celle de suivre le réglage de l'OS,
 * qui bascule seul au coucher du soleil. L'ancien interrupteur clair/sombre
 * ne permettait pas d'y **revenir** une fois qu'on y avait touché : le
 * réglage forcé était définitif.
 */
export type ThemeChoice = "light" | "dark" | "system";

/** Le choix enregistré — « système » quand rien n'est forcé. */
export function themeChoice(): ThemeChoice {
  const set = localStorage.getItem(THEME_KEY);
  return set === "light" || set === "dark" ? set : "system";
}

/** Le thème réellement appliqué, une fois « système » résolu. */
export function currentTheme(): "light" | "dark" {
  const choice = themeChoice();
  if (choice !== "system") return choice;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Applique et retient — effet immédiat, sans passer par le formulaire. */
export function setTheme(choice: ThemeChoice): void {
  if (choice === "system") {
    localStorage.removeItem(THEME_KEY);
    delete document.documentElement.dataset.theme;
  } else {
    localStorage.setItem(THEME_KEY, choice);
    document.documentElement.dataset.theme = choice;
  }
}

/** Mode d'appel retenu (id du registre CALL_MODES de l'écran d'appel). */
export function getCallModeId(): string {
  return localStorage.getItem(CALLMODE_KEY) ?? "audio";
}

export function setCallModeId(id: string): void {
  localStorage.setItem(CALLMODE_KEY, id);
}

// ---------------------------------------------------------------------------
// Panneau latéral de l'écran d'appel (repli et largeur)
// ---------------------------------------------------------------------------
//
// Réglages d'affichage, donc localStorage et rien d'autre : replier le
// panneau ou l'élargir ne change rien au protocole SIP, exactement comme le
// choix mobile/bureau (docs/CONCEPTION.md §4.5). Aucune machine à prévenir.

/**
 * Bornes de largeur. En dessous de 300 px, l'historique et le tchat se
 * tronquent au point de ne plus se lire ; au-delà du tiers de la fenêtre, la
 * vidéo cesse d'être la scène principale. Le plancher l'emporte sur le
 * plafond quand la fenêtre est trop étroite pour que le tiers atteigne
 * 300 px — un panneau illisible ne rendrait service à personne.
 */
export const PANEL_MIN = 300;

export function panelMax(): number {
  return Math.max(PANEL_MIN, Math.round(window.innerWidth / 3));
}

export function clampPanelWidth(px: number): number {
  return Math.min(panelMax(), Math.max(PANEL_MIN, Math.round(px)));
}

/** Largeur retenue, toujours ramenée aux bornes de la fenêtre **courante**. */
export function panelWidth(): number {
  return clampPanelWidth(Number(localStorage.getItem(PANEL_WIDTH_KEY)) || PANEL_MIN);
}

/** Retient la largeur bornée et la retourne — l'appelant affiche ce qu'il a écrit. */
export function setPanelWidth(px: number): number {
  const width = clampPanelWidth(px);
  localStorage.setItem(PANEL_WIDTH_KEY, String(width));
  return width;
}

export function panelCollapsed(): boolean {
  return localStorage.getItem(PANEL_KEY) === "collapsed";
}

export function setPanelCollapsed(collapsed: boolean): void {
  localStorage.setItem(PANEL_KEY, collapsed ? "collapsed" : "expanded");
}

export function bumpFont(delta: 1 | -1): void {
  const cur = Number(localStorage.getItem(FONT_KEY)) || FONT_DEFAULT;
  const next = Math.min(FONT_MAX, Math.max(FONT_MIN, cur + delta));
  document.documentElement.style.fontSize = `${next}px`;
  localStorage.setItem(FONT_KEY, String(next));
}
