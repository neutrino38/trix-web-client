/**
 * Format d'affichage — signal purement UI.
 *
 * Choix d'architecture (voir docs/CONCEPTION.md §4.6) : le format ne
 * change **rien** au protocole SIP, donc pas de machine à états dédiée.
 * PhoneMachine reste unique et le basculement mobile/bureau ne coupe ni
 * l'appel ni l'enregistrement — seul le module de rendu change.
 */

const MOBILE_QUERY = "(max-width: 720px)";

export type LayoutMode = "mobile" | "desktop";

/**
 * Forçage par l'URL (`?layout=mobile` / `?layout=desktop`) : prévisualiser
 * la vue mobile depuis un poste de bureau, sans redimensionner la fenêtre.
 */
function forced(): LayoutMode | null {
  const q = new URLSearchParams(location.search).get("layout");
  return q === "mobile" || q === "desktop" ? q : null;
}

export function layoutMode(): LayoutMode {
  return forced() ?? (matchMedia(MOBILE_QUERY).matches ? "mobile" : "desktop");
}

/** Prévient à chaque franchissement du seuil (rotation, redimensionnement). */
export function watchLayout(onChange: (mode: LayoutMode) => void): () => void {
  const mq = matchMedia(MOBILE_QUERY);
  const handler = (): void => onChange(layoutMode());
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}
