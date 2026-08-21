/**
 * Internationalisation — un fichier par langue, découvert par Vite.
 *
 * Ajouter une langue, c'est déposer `src/i18n/locales/xx.ts` — nommé d'après
 * sa balise BCP-47 — exportant son dictionnaire par défaut. Rien d'autre :
 * ni registre à tenir, ni `import` à ajouter, ni sélecteur à compléter ;
 * `import.meta.glob` fait l'inventaire à la construction, et le sélecteur se
 * peuple de ce qu'il trouve. Le compilateur, lui, exige que le nouveau
 * dictionnaire honore le type du français (voir `types.ts`).
 *
 * Le glob est **paresseux** : chaque langue devient un chunk séparé,
 * téléchargé seulement si on la choisit. Un utilisateur français ne paie
 * pas l'anglais, et la dixième langue ne coûtera rien aux neuf autres.
 *
 * Rien n'est donc chargé pour dresser la liste du sélecteur : le nom du
 * fichier *est* la balise BCP-47 (`fr`, `en`, `pt-BR`), et `Intl.DisplayNames`
 * en tire le nom de la langue **dans cette langue**. Un catalogue de
 * métadonnées à tenir à jour en parallèle des dictionnaires n'aurait été
 * qu'une deuxième chose à oublier.
 *
 * Une langue emporte plus que ses phrases : `<html lang>` et `<html dir>`
 * suivent le dictionnaire chargé, si bien que passer à l'arabe retourne la
 * mise en page sans qu'aucun écran ait à s'en occuper — le CSS n'emploie
 * que des propriétés logiques.
 *
 * Le chargement est donc asynchrone, mais `t()` reste synchrone — l'UI
 * rend en un seul passage. `initI18n()` est attendu avant le premier rendu
 * (`main.ts`), et `setLocaleChoice()` ne notifie qu'une fois le nouveau
 * dictionnaire en place : à aucun moment un écran ne peut se rendre à
 * moitié traduit.
 */

import type { Locale, LocaleChoice, Msg, MsgKey, Translation, Vars } from "./types.js";

export { msg, rawMsg } from "./types.js";
export type { Locale, LocaleChoice, Msg, MsgKey, Translation } from "./types.js";

const STORAGE_KEY = "trix-lang";

/** Langue servie quand ni le choix ni le navigateur ne désignent une langue connue. */
const FALLBACK: Locale = "fr";

const dictModules = import.meta.glob<Translation>("./locales/*.ts", { import: "default" });

/** `./locales/fr.ts` → `fr`. */
function codeOf(path: string): Locale {
  return path.slice(path.lastIndexOf("/") + 1, -3);
}

/**
 * Langues que `Intl.DisplayNames` nomme mal — et qui se nomment ici
 * elles-mêmes, dans leur propre langue comme toutes les autres.
 *
 * Une seule pour l'instant : « fr-CA ». La balise dit « français
 * canadien », et les moteurs ne s'accordent même pas là-dessus — Chrome
 * rend « Français (Canada) », Node « français canadien ». Or ce
 * dictionnaire n'est pas le français du Canada en général, c'est du
 * québécois : c'est le mot que ses lecteurs cherchent dans un menu, et il
 * a l'avantage de ne plus dépendre des données du navigateur.
 */
const NAME_OVERRIDE: Record<string, string> = { "fr-CA": "Québécois" };

/**
 * Nom d'une langue **écrit dans cette langue** — « Français », « English »,
 * « Deutsch ». C'est la seule forme qui serve à qui ne lit pas la langue
 * courante : un anglophone tombé sur une interface en français doit
 * reconnaître son choix sans la comprendre.
 *
 * Capitalisée : `Intl` rend « français » en minuscule, ce qui convient à
 * une phrase mais pas à une entrée de menu.
 */
export function localeName(code: Locale): string {
  const override = NAME_OVERRIDE[code];
  if (override !== undefined) return override;
  try {
    const name = new Intl.DisplayNames([code], { type: "language" }).of(code);
    if (name) return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
  } catch {
    // navigateur sans Intl.DisplayNames, ou balise refusée : le code fera foi
  }
  return code;
}

/**
 * Ce qu'une langue porte quand la région la plus probable de sa balise ne
 * la représente pas. **La chaîne vide veut dire : rien du tout** — le nom
 * seul, dans une liste qui porte des drapeaux par ailleurs.
 *
 * La clé est une balise complète, sinon la langue seule :
 *
 * - « en » → 🇬🇧 là où `maximize()` aurait dit 🇺🇸. Statistiquement juste,
 *   visuellement faux ici : l'anglais de Trix est écrit en orthographe
 *   britannique (« minimised », « Cancelled »).
 * - « ar » → 🇹🇳 là où `maximize()` aurait dit 🇪🇬. Le dictionnaire est en
 *   arabe standard moderne, que nul pays ne possède en propre ; il fallait
 *   pourtant choisir, et ce choix-là ne se déduit d'aucune donnée.
 *
 * Ces emoji restent le repli : `ui/flags.ts` dessine les mêmes drapeaux, et
 * c'est lui que le sélecteur sert en premier. Ils comptent là où l'image ne
 * va pas — un titre, un texte brut, un jour peut-être une notification.
 */
const FLAG_OVERRIDE: Record<string, string> = { en: "🇬🇧", ar: "🇹🇳" };

/**
 * Drapeau d'une langue, **déduit de sa balise** — 🇫🇷, 🇯🇵, 🇨🇳.
 *
 * Un drapeau par langue est un raccourci discutable — une langue n'est pas
 * un pays —, mais c'est le repère que l'œil trouve avant de lire, dans un
 * menu où l'entrée qu'on cherche est justement celle qu'on ne sait pas
 * lire. Là où le raccourci deviendrait un contresens, `FLAG_OVERRIDE`
 * tranche : un autre emblème, ou aucun.
 *
 * Le reste se demande à `Intl` plutôt qu'à une liste tenue à la main,
 * comme le nom et le sens d'écriture : `maximize()` complète la balise de
 * la région la plus probable (« ja » → « ja-Jpan-JP »), dont les deux
 * lettres se transposent en indicateurs régionaux — le mécanisme même des
 * drapeaux d'Unicode. Déposer `de.ts` suffit donc à faire apparaître 🇩🇪.
 *
 * Rendu vide si la balise ne donne aucune région ou si le moteur ignore
 * `maximize()` : le nom seul reste lisible, et le sélecteur ne perd que
 * son ornement. Sous Windows, qui n'embarque pas les glyphes de drapeaux,
 * c'est le sort de toutes les langues — les deux lettres du pays
 * s'affichent à leur place. La fleur de lis, elle, y survit : ce n'est pas
 * un drapeau.
 */
export function localeFlag(code: Locale): string {
  const override = FLAG_OVERRIDE[code] ?? FLAG_OVERRIDE[code.split("-")[0]!];
  if (override !== undefined) return override;
  let region: string | undefined;
  try {
    const tag = new Intl.Locale(code);
    region = tag.region ?? tag.maximize().region;
  } catch {
    // balise refusée par Intl.Locale, ou moteur sans maximize() : pas de drapeau
  }
  if (region?.length !== 2) return "";
  return String.fromCodePoint(
    ...[...region.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

/** Les langues disponibles, triées par leur nom d'affichage. */
export const LOCALES: readonly Locale[] = Object.keys(dictModules)
  .map(codeOf)
  .sort((a, b) => localeName(a).localeCompare(localeName(b)));

const AVAILABLE = new Set(LOCALES);

// ---------------------------------------------------------------------------
// Choix de l'utilisateur et détection
// ---------------------------------------------------------------------------

/**
 * Le choix enregistré — « auto » tant que l'utilisateur n'a rien imposé.
 *
 * « auto » n'est pas l'absence de choix : c'est celui de suivre le
 * navigateur, qui peut changer sans que Trix soit rouvert. Le même
 * raisonnement que pour le thème « système » (voir `ui/prefs.ts`).
 */
export function localeChoice(): LocaleChoice {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved !== null && AVAILABLE.has(saved) ? saved : "auto";
}

/**
 * Langue du navigateur ramenée à une langue disponible. `navigator.languages`
 * est ordonné par préférence : on prend la première qui correspond, d'abord
 * exactement (`fr-CA` → `fr-CA` si elle existe), puis par sous-étiquette
 * primaire (`fr-CA` → `fr`).
 *
 * `preferred` n'existe que pour les tests : la règle de correspondance vaut
 * la peine d'être vérifiée sur des listes choisies, sans un navigateur.
 */
export function detectLocale(preferred?: readonly string[]): Locale {
  const wanted =
    preferred ?? (navigator.languages?.length ? navigator.languages : [navigator.language]);
  for (const raw of wanted) {
    const tag = raw.toLowerCase();
    const exact = LOCALES.find((code) => code.toLowerCase() === tag);
    if (exact) return exact;
    const primary = tag.split("-")[0]!;
    const partial = LOCALES.find((code) => code.toLowerCase().split("-")[0] === primary);
    if (partial) return partial;
  }
  return AVAILABLE.has(FALLBACK) ? FALLBACK : (LOCALES[0] ?? FALLBACK);
}

/** La langue effectivement servie, une fois « auto » résolu. */
export function locale(): Locale {
  return current;
}

/**
 * Balise BCP-47 de la langue courante (`Intl`, `<html lang>`) — le code
 * lui-même : nommer les fichiers d'après la balise évite de les faire
 * correspondre à autre chose.
 */
export function localeTag(): string {
  return current;
}

/** Langues RTL connues, pour les moteurs sans `Intl.Locale#getTextInfo`. */
const RTL_FALLBACK = new Set(["ar", "he", "fa", "ur", "ps", "ckb", "dv", "yi"]);

/**
 * Sens d'écriture d'une langue. Demandé à `Intl` plutôt qu'à une liste
 * tenue à la main : le navigateur porte déjà les données CLDR, et une
 * liste de langues RTL est exactement le genre d'inventaire qu'on oublie
 * de compléter en même temps qu'on dépose un dictionnaire.
 *
 * `getTextInfo()` est récent ; la propriété `textInfo` l'a précédé, et
 * quelques moteurs n'ont ni l'un ni l'autre. D'où le repli sur les langues
 * qui s'écrivent de droite à gauche parmi celles que Trix pourrait servir
 * — l'arabe, l'hébreu, le persan, l'ourdou. Se tromper de sens rend une
 * interface pénible, pas inutilisable : le repli n'a pas à être exhaustif.
 */
export function directionOf(code: Locale): "ltr" | "rtl" {
  try {
    const info = new Intl.Locale(code) as Intl.Locale & {
      getTextInfo?: () => { direction: string };
      textInfo?: { direction: string };
    };
    const dir = info.getTextInfo?.().direction ?? info.textInfo?.direction;
    if (dir === "rtl" || dir === "ltr") return dir;
  } catch {
    // balise refusée par Intl.Locale : le repli tranchera
  }
  return RTL_FALLBACK.has(code.toLowerCase().split("-")[0]!) ? "rtl" : "ltr";
}

/**
 * Sens d'écriture de la langue courante — posé sur `<html dir>`, donc
 * suffisant pour la mise en page : le CSS n'emploie que des propriétés
 * logiques (`inset-inline-start` plutôt que `left`), qui basculent seules.
 * Ne reste au JavaScript que ce qu'aucune propriété ne couvre : le sens du
 * glisser qui élargit le panneau latéral (voir `ui/screens/call/panel.ts`).
 */
export function direction(): "ltr" | "rtl" {
  return directionOf(current);
}

/** Raccourci de lecture pour les gestes qui dépendent du sens. */
export function isRtl(): boolean {
  return direction() === "rtl";
}

// ---------------------------------------------------------------------------
// Dictionnaire actif
// ---------------------------------------------------------------------------

let current: Locale = FALLBACK;
let dict: Translation | null = null;

/**
 * Charge un dictionnaire et le rend courant, sans toucher au réglage
 * enregistré. Exporté pour les tests, qui traduisent des messages
 * d'automate sans passer par le navigateur — d'où la garde sur `document`,
 * absent quand seules les machines sont sous test.
 */
export async function useLocale(code: Locale): Promise<void> {
  const loader = dictModules[`./locales/${code}.ts`];
  if (!loader) throw new Error(`unknown locale: ${code}`);
  dict = await loader();
  current = code;
  if (typeof document !== "undefined") {
    document.documentElement.lang = localeTag();
    document.documentElement.dir = direction();
  }
}

/**
 * Charge la langue à servir et l'applique au document. À attendre **avant**
 * le premier rendu : `t()` n'a rien à dire tant qu'aucun dictionnaire n'est
 * en place.
 *
 * Ne rejette jamais. Le chunk d'une langue se télécharge, et un téléphone
 * qu'un réseau capricieux laisserait sur un écran blanc serait pire qu'un
 * téléphone dans la mauvaise langue : on retombe sur la langue de repli,
 * puis, si elle manque aussi, sur les clés elles-mêmes — l'application
 * reste utilisable, et la console dit pourquoi elle est illisible.
 */
export async function initI18n(): Promise<void> {
  const choice = localeChoice();
  const wanted = choice === "auto" ? detectLocale() : choice;
  try {
    await useLocale(wanted);
  } catch (e) {
    console.error(`[trix] langue « ${wanted} » indisponible`, e);
    if (wanted === FALLBACK) return;
    try {
      await useLocale(FALLBACK);
    } catch {
      // plus rien à tenter : `t()` rendra les clés
    }
  }
}

/**
 * Enregistre un choix, charge la langue correspondante et prévient les
 * abonnés — dans cet ordre, pour qu'aucun rendu ne parte avant que le
 * dictionnaire ne soit là. « auto » efface le réglage plutôt que de figer
 * la langue détectée du jour.
 */
export async function setLocaleChoice(choice: LocaleChoice): Promise<void> {
  const next = choice === "auto" ? detectLocale() : choice;
  if (next !== current || !dict) {
    try {
      await useLocale(next);
    } catch (e) {
      // le chunk n'a pas pu être téléchargé : on garde la langue en place
      // plutôt que de vider l'écran, et le choix n'est pas enregistré —
      // le prochain démarrage ne rejouera pas un échec.
      console.error(`[trix] langue « ${next} » indisponible`, e);
      return;
    }
  }
  if (choice === "auto") localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, choice);
  for (const fn of listeners) fn();
}

const listeners = new Set<() => void>();

/** Prévient à chaque changement de langue effectif. Rend le désabonnement. */
export function onLocaleChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------------------------------------------------------------------------
// Traduction
// ---------------------------------------------------------------------------

const PLACEHOLDER = /\{(\w+)\}/g;

function interpolate(template: string, vars: Vars | undefined): string {
  if (!vars) return template;
  return template.replaceAll(PLACEHOLDER, (whole, name: string) => {
    const value = vars[name];
    return value === undefined ? whole : String(value);
  });
}

/**
 * Traduit une clé, ou un message différé produit par un automate.
 *
 * Une clé introuvable rend la clé elle-même : un écran défiguré se répare,
 * un écran vide ne se diagnostique pas. Le cas ne devrait jamais survenir —
 * le typage l'interdit à la compilation.
 */
export function t(key: MsgKey | Msg, vars?: Vars): string {
  if (typeof key !== "string") return t(key.key, key.vars);
  const template = dict?.[key];
  return template === undefined ? key : interpolate(template, vars);
}

/**
 * Traduit un pluriel : `tn("announce.inCall", n)` choisit entre
 * `announce.inCall.one` et `.other` selon les règles de la langue courante.
 * `{n}` est fourni d'office — c'est toujours le nombre dont on parle.
 *
 * Les langues à formes multiples (`few`, `many`…) n'ont qu'à déclarer les
 * clés correspondantes : le repli sur `.other` couvre celles qui manquent.
 */
export function tn(base: string, n: number, vars?: Vars): string {
  const rule = new Intl.PluralRules(localeTag()).select(n);
  const key = `${base}.${rule}` as MsgKey;
  const chosen = dict?.[key] !== undefined ? key : (`${base}.other` as MsgKey);
  return t(chosen, { n, ...vars });
}

// ---------------------------------------------------------------------------
// Formats dépendants de la langue
// ---------------------------------------------------------------------------

/** Heure courte (« 14:32 », « 2:32 PM »), dans la langue courante. */
export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(localeTag(), { hour: "2-digit", minute: "2-digit" });
}

/** Jour et mois, sans l'année : l'historique ne remonte pas si loin. */
export function formatDayMonth(ts: number): string {
  return new Date(ts).toLocaleDateString(localeTag(), { day: "2-digit", month: "2-digit" });
}

/**
 * Un nombre dans la langue courante : séparateur décimal, groupement des
 * milliers, et chiffres arabes orientaux là où ils ont cours. `digits` est
 * un **plafond** de décimales — « 0,2 % » reste « 0 % » quand la perte
 * s'annule, sans zéro de garniture.
 */
export function formatNumber(n: number, digits = 0): string {
  return new Intl.NumberFormat(localeTag(), { maximumFractionDigits: digits }).format(n);
}
