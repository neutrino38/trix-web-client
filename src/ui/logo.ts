/**
 * Logo placeholder (arcs du logo FSL) — à remplacer par l'icône LSF
 * définitive quand elle sera fournie (cf. SPECS.md, questions ouvertes).
 */
export function logoSvg(size: number, withText: boolean): string {
  const text = withText
    ? `<text x="60" y="70" text-anchor="middle" font-family="Poppins, system-ui, sans-serif"
             font-size="26" font-weight="600" fill="currentColor">LSF</text>`
    : "";
  return `
  <svg width="${size}" height="${size}" viewBox="0 0 120 120" role="img" aria-label="Logo LSF">
    <path d="M 92 30 A 42 42 0 1 0 92 90" fill="none" stroke="#7B54A0"
          stroke-width="${withText ? 4 : 8}" stroke-linecap="round"/>
    <path d="M 92 30 A 42 42 0 0 1 92 90" fill="none" stroke="#7B54A0"
          stroke-width="${withText ? 4 : 8}" stroke-linecap="round"
          stroke-dasharray="${withText ? "8 8" : "14 14"}"/>
    ${text}
  </svg>`;
}
