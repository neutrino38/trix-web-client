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
 * Le chargement est donc asynchrone, mais `t()` reste synchrone — l'UI
 * rend en un seul passage. `initI18n()` est attendu avant le premier rendu
 * (`main.ts`), et `setLocaleChoice()` ne notifie qu'une fois le nouveau
 * dictionnaire en place : à aucun moment un écran ne peut se rendre à
 * moitié traduit.
 */

import type { Dictionary, Locale, LocaleChoice, Msg, MsgKey, Vars } from "./types.js";

export { msg, rawMsg } from "./types.js";
export type { Locale, LocaleChoice, Msg, MsgKey } from "./types.js";

const STORAGE_KEY = "trix-lang";

/** Langue servie quand ni le choix ni le navigateur ne désignent une langue connue. */
const FALLBACK: Locale = "fr";

const dictModules = import.meta.glob<Dictionary>("./locales/*.ts", { import: "default" });

/** `./locales/fr.ts` → `fr`. */
function codeOf(path: string): Locale {
  return path.slice(path.lastIndexOf("/") + 1, -3);
}

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
  try {
    const name = new Intl.DisplayNames([code], { type: "language" }).of(code);
    if (name) return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
  } catch {
    // navigateur sans Intl.DisplayNames, ou balise refusée : le code fera foi
  }
  return code;
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

// ---------------------------------------------------------------------------
// Dictionnaire actif
// ---------------------------------------------------------------------------

let current: Locale = FALLBACK;
let dict: Dictionary | null = null;

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
  if (typeof document !== "undefined") document.documentElement.lang = localeTag();
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
