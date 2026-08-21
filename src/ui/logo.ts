/**
 * Marque Trix. Les images vivent dans `public/` et sont servies en `<img>` :
 * l'écran d'appel est reconstruit à chaque notification de la machine, et
 * réinjecter 260 ko de SVG dans le DOM à chaque rendu serait absurde — le
 * navigateur, lui, ne charge et ne décode l'image qu'une fois.
 */

/**
 * Icône carrée. `alt` vide par défaut : dans la barre d'en-tête, le mot
 * « Trix » est déjà écrit à côté, et le répéter ne ferait que doubler
 * l'annonce des lecteurs d'écran (RGAA 1.2 — image décorative).
 */
export function trixIcon(size: number, alt = ""): string {
  return `<img class="brand" src="/trix-icon.svg" width="${size}" height="${size}" alt="${alt}"${
    alt === "" ? ' aria-hidden="true"' : ""
  }>`;
}

/*
 * `trix-logo.svg` (icône + mot-marque) n'est volontairement pas utilisé dans
 * l'application : le mot « Trix » y est peint en violet foncé, illisible sur
 * le fond du thème sombre — et le texte d'une image ne suit pas le thème.
 * L'accueil compose donc l'icône et un titre en vrai texte, qui prend la
 * couleur courante (et se sélectionne, se traduit, se zoome). Le fichier
 * reste dans `public/` pour les supports à fond clair — README, partage.
 */

import { t } from "../i18n/index.js";
import { esc } from "./el.js";

/** Dépôt du framework d'orchestration — la cible du crédit ci-dessous. */
const FSL_URL = "https://github.com/neutrino38/finite-state-language/";

/**
 * Crédit du framework qui orchestre l'UI (`finite-state-language`), en pied
 * d'accueil. Ouvert dans un onglet séparé : Trix est un téléphone, quitter la
 * page couperait l'enregistrement SIP. L'intitulé accessible dit la
 * destination **et** l'ouverture d'une nouvelle fenêtre (RGAA 6.1, 13.2) ;
 * l'icône, elle, est décorative — le texte la double déjà.
 */
export function fslBadge(): string {
  return `
    <a class="fsl-badge" href="${FSL_URL}" target="_blank" rel="noopener noreferrer"
       aria-label="${esc(t("fsl.aria"))}">
      <img src="/fsl-icon.svg" width="36" height="36" alt="" aria-hidden="true">
      <span>Powered by FSL</span>
    </a>`;
}
