/**
 * Drapeaux dessinés — les quelques langues dont l'emblème ne tient pas
 * dans un caractère, ou dont le caractère ne s'affiche pas partout.
 *
 * `i18n/localeFlag()` déduit un emoji de la balise et n'a besoin d'aucun
 * inventaire : c'est lui la règle, et ce fichier l'exception. Deux raisons
 * de dessiner :
 *
 * - **Le fleurdelisé n'existe pas en emoji.** Unicode ne code que trois
 *   drapeaux de subdivision — Angleterre, Écosse, pays de Galles — et le
 *   Québec n'en est pas. Aucun caractère ne le porte, il faut l'image.
 * - **Windows n'embarque aucun glyphe de drapeau.** Les navigateurs y
 *   affichent « FR », « GB » à la place des couleurs. Une image passe
 *   partout, et tant qu'à en avoir une pour le Québec, autant que ses
 *   voisines de menu ne dépendent pas de la police du système.
 *
 * Chaque drapeau est un SVG minuscule, servi en `data:` — donc inclus dans
 * le bundle, sans requête ni fichier à déployer, et autorisé par la CSP
 * (`img-src 'self' data:`, voir `config/nginx`). Rendus par `<img>` et non
 * en ligne : chaque image est un document à part, ce qui isole les `id`
 * internes (`<use xlink:href="#a">` du fleurdelisé) alors qu'une insertion
 * en ligne les ferait entrer en collision dès que le même drapeau paraît
 * deux fois — dans le bouton et dans la liste, ce qui est le cas courant.
 *
 * Ne rien trouver ici n'est pas une erreur : `flagImage()` rend
 * `undefined`, le sélecteur retombe sur l'emoji, et déposer `de.ts`
 * continue de suffire à faire apparaître 🇩🇪. On ne dessine que ce qui le
 * mérite.
 *
 * Les tracés viennent de Wikimedia Commons, où ces drapeaux sont dans le
 * domaine public (emblèmes officiels) : le fleurdelisé est le fichier
 * « Flag of Quebec (CMYK).svg » tel quel ; les autres sont les
 * constructions géométriques usuelles, réduites à l'essentiel.
 */

import type { Locale } from "../i18n/index.js";

/* eslint-disable @typescript-eslint/naming-convention */
const SVG: Record<string, string> = {
  // Québec — « Flag of Quebec (CMYK).svg », domaine public. Les `<use>`
  // internes économisent trois fleurs de lis sur quatre.
  "fr-CA":
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="900" height="600" viewBox="0 0 9600 6400">` +
    `<path fill="#fff" d="M0 0h9600v6400H0z"/><g id="b">` +
    `<path fill="#002495" id="a" d="M4000 0v2400H0V0zM2309 1622v-129h-115c0-66 32-130 66-150 20-17 65-25 104-5 ` +
    `51 29 54 113 28 151 243-45 219-280 136-365-67-69-140-79-196-58-128 46-214 199-218 427h-67c0-207 36-273 130-534 ` +
    `48-123 19-275-65-415-31-50-69-95-112-144-43 49-81 94-112 144-84 140-113 292-65 415 94 261 130 327 130 534h-67c-4-228-90-381-218-427-56-21-129-11-196 58-83 85-107 320 136 365-26-38-23-122 28-151 39-20 84-12 104 5 34 20 66 84 66 150h-115v129h239c-3 67-39 119-106 148 8 28 49 85 105 81 11 60 21 94 71 149 50-55 60-89 71-149 56 4 97-53 105-81-67-29-103-81-106-148z"/>` +
    `<use xlink:href="#a" x="5600"/></g><use xlink:href="#b" y="4000"/></svg>`,

  // Tunisie — pour l'arabe. Ce n'est pas la région que CLDR déduit de la
  // balise (l'Égypte, la plus peuplée) mais un choix explicite : le
  // dictionnaire est en arabe standard moderne, qu'aucun pays ne possède,
  // et il fallait trancher. Croissant obtenu par soustraction — un disque
  // rouge, puis un disque blanc décalé vers le battant.
  ar:
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 600">` +
    `<path fill="#e70013" d="M0 0h900v600H0z"/>` +
    `<circle cx="450" cy="300" r="180" fill="#fff"/>` +
    `<circle cx="450" cy="300" r="140" fill="#e70013"/>` +
    `<circle cx="487" cy="300" r="112" fill="#fff"/>` +
    `<path fill="#e70013" d="M508,228L524.2,277.8L576.5,277.8L534.2,308.5L550.3,358.2L508,327.5L465.7,358.2L481.8,308.5L439.5,277.8L491.8,277.8z"/>` +
    `</svg>`,

  // France — trois bandes égales.
  fr:
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 600">` +
    `<path fill="#fff" d="M0 0h900v600H0z"/>` +
    `<path fill="#002395" d="M0 0h300v600H0z"/>` +
    `<path fill="#ed2939" d="M600 0h300v600H600z"/></svg>`,

  // Royaume-Uni — l'Union Jack, en remplissages seuls : le sautoir rouge
  // de saint Patrick est contre-échangé, c'est-à-dire décalé d'un quartier
  // à l'autre, ce qu'on obtient d'ordinaire par un `clipPath` sur un trait.
  // Les polygones sont ici découpés une fois pour toutes (les coordonnées
  // sont calculées, non écrites à la main) : ni trait ni détourage, donc
  // rien qui puisse se perdre d'un moteur de rendu à l'autre.
  en:
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 30">` +
    `<path fill="#012169" d="M0 0h60v30H0z"/>` +
    `<path fill="#fff" d="M0,3.35L53.29,30L60,30L60,26.65L6.71,0L0,0zM53.29,0L0,26.65L0,30L6.71,30L60,3.35L60,0z"/>` +
    `<path fill="#c8102e" d="M60,30L60,27.76L34.47,15L30,15zM27.76,16.12L30,17.24L30,15zM0,2.24L25.53,15L30,15L0,0zM32.24,13.88L30,12.76L30,15zM32.24,16.12L34.47,15L30,15zM0,30L4.47,30L30,17.24L30,15zM27.76,13.88L25.53,15L30,15zM55.53,0L30,12.76L30,15L60,0z"/>` +
    `<path fill="#fff" d="M25 0h10v30H25zM0 10h60v10H0z"/>` +
    `<path fill="#c8102e" d="M27 0h6v30h-6zM0 12h60v6H0z"/>` +
    `</svg>`,

  // Japon — le disque fait trois cinquièmes de la hauteur, centré.
  ja:
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 600">` +
    `<path fill="#fff" d="M0 0h900v600H0z"/>` +
    `<circle fill="#bc002d" cx="450" cy="300" r="180"/></svg>`,

  // Chine — une étoile dessinée une fois, posée cinq fois : la grande, puis
  // quatre petites inclinées vers elle.
  "zh-Hans":
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 30 20">` +
    `<path fill="#ee1c25" d="M0 0h30v20H0z"/>` +
    `<defs><path id="s" d="M0-1 .588.809-.951-.309H.951L-.588.809z"/></defs>` +
    `<g fill="#ffde00">` +
    `<use xlink:href="#s" transform="translate(5 5) scale(3)"/>` +
    `<use xlink:href="#s" transform="translate(10 2) rotate(23.036)"/>` +
    `<use xlink:href="#s" transform="translate(12 4) rotate(45.87)"/>` +
    `<use xlink:href="#s" transform="translate(12 7) rotate(69.945)"/>` +
    `<use xlink:href="#s" transform="translate(10 9) rotate(20.66)"/></g></svg>`,
};
/* eslint-enable @typescript-eslint/naming-convention */

/** `data:` calculées une fois — le sélecteur se redessine à chaque écran. */
const encoded = new Map<string, string>();

/**
 * Le drapeau d'une langue en `data:` URI, ou `undefined` s'il n'est pas
 * dessiné ici. La balise complète l'emporte sur sa langue seule — c'est
 * tout l'objet de l'exercice : `fr-CA` doit trouver le fleurdelisé, et non
 * le tricolore que `fr` lui prêterait.
 */
export function flagImage(code: Locale): string | undefined {
  const key = SVG[code] !== undefined ? code : code.split("-")[0]!;
  const svg = SVG[key];
  if (svg === undefined) return undefined;
  let uri = encoded.get(key);
  if (uri === undefined) {
    uri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    encoded.set(key, uri);
  }
  return uri;
}
