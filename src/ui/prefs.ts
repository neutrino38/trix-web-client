/**
 * Préférences d'affichage (thème clair/foncé, taille de texte) —
 * pied de la sidebar du mockup. UI pure : localStorage + attributs
 * sur <html>, aucune machine impliquée.
 */

const THEME_KEY = "stauri-theme";
const FONT_KEY = "stauri-font";
const CALLMODE_KEY = "stauri-callmode";
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

export function currentTheme(): "light" | "dark" {
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function toggleTheme(): void {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem(THEME_KEY, next);
}

/** Mode d'appel retenu (id du registre CALL_MODES de l'écran d'appel). */
export function getCallModeId(): string {
  return localStorage.getItem(CALLMODE_KEY) ?? "audio";
}

export function setCallModeId(id: string): void {
  localStorage.setItem(CALLMODE_KEY, id);
}

export function bumpFont(delta: 1 | -1): void {
  const cur = Number(localStorage.getItem(FONT_KEY)) || FONT_DEFAULT;
  const next = Math.min(FONT_MAX, Math.max(FONT_MIN, cur + delta));
  document.documentElement.style.fontSize = `${next}px`;
  localStorage.setItem(FONT_KEY, String(next));
}
