/**
 * Sélecteur de langue de l'interface.
 *
 * Trois raisons d'en faire un composant à part plutôt qu'un bloc dans
 * l'accueil : il apparaît à deux endroits (l'accueil, d'où l'on part, et
 * les paramètres, où l'on revient sans repasser par l'accueil), il se
 * peuple tout seul de ce que `i18n` a trouvé, et il n'a aucun re-rendu à
 * commander — `setLocaleChoice` prévient ses abonnés, et c'est `main.ts`
 * qui redessine. Le composant ne connaît donc ni l'écran ni la machine.
 *
 * « Automatique » est le premier choix, et il nomme la langue qu'il
 * détecte (« Automatique — Français ») : sans cela, l'utilisateur ne
 * saurait pas ce qu'il obtient avant de l'avoir choisi.
 */

import {
  LOCALES,
  detectLocale,
  localeChoice,
  localeName,
  setLocaleChoice,
  t,
} from "../i18n/index.js";
import { esc } from "./el.js";

/**
 * Gabarit. `withLabel` : un intitulé au-dessus (accueil, paramètres) ;
 * sans lui, seul le menu déroulant est rendu — le libellé viendrait alors
 * du contexte.
 */
export function langPicker(withLabel = true): string {
  const choice = localeChoice();
  const options = [
    `<option value="auto" ${choice === "auto" ? "selected" : ""}>${esc(
      t("lang.autoDetected", { name: localeName(detectLocale()) }),
    )}</option>`,
    // `lang` sur chaque entrée : un lecteur d'écran doit prononcer
    // « English » à l'anglaise au milieu d'une interface française (RGAA 8.7)
    ...LOCALES.map(
      (code) =>
        `<option value="${esc(code)}" ${choice === code ? "selected" : ""} lang="${esc(code)}">${esc(
          localeName(code),
        )}</option>`,
    ),
  ].join("");
  return `<div class="field lang-picker">
    ${withLabel ? `<label for="f-lang">${esc(t("lang.label"))}</label>` : ""}
    <select id="f-lang" data-ref="lang">${options}</select>
  </div>`;
}

/**
 * Câblage : enregistre le choix et charge la langue. Le rendu qui suit
 * n'est pas notre affaire — les abonnés de `onLocaleChange` s'en chargent,
 * une fois le dictionnaire réellement en place.
 */
export function wireLangPicker(node: HTMLElement): void {
  const select = node.querySelector<HTMLSelectElement>('[data-ref="lang"]');
  select?.addEventListener("change", () => {
    void setLocaleChoice(select.value);
  });
}
