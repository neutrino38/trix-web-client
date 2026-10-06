/**
 * Types de l'internationalisation **du noyau** — sans dépendance à
 * l'exécution (ADR 0011, D9).
 *
 * Ce module n'importe le catalogue du noyau qu'en `import type` : la
 * déclaration est effacée à la compilation, donc les automates et le port
 * SIP peuvent parler de messages traduisibles sans faire entrer le moindre
 * dictionnaire dans leur bundle.
 *
 * Il ne connaît que les clés que le noyau produit (`CoreMsgKey`). Celles des
 * écrans sont à l'UI (`dictionary.ts`), dont les dictionnaires étendent
 * celui du noyau : un affilié qui écrit sa propre interface n'hérite que
 * des premières.
 *
 * Le français est la langue de référence : `CoreDictionary` est *son* type,
 * et toute autre langue du noyau doit le satisfaire — une clé oubliée est
 * une erreur de compilation, pas une chaîne manquante découverte en
 * production.
 */

import type core from "../core/i18n/fr.js";

export type CoreDictionary = { readonly [K in keyof typeof core]: string };
/** Les seules clés que le noyau peut produire — celles qu'un affilié doit couvrir. */
export type CoreMsgKey = keyof CoreDictionary;

/**
 * Code d'une langue disponible — **le nom de son fichier** (`fr`, `en`,
 * `pt-BR`…), qui est du même coup une balise BCP-47 valide : elle sert
 * telle quelle à `<html lang>` et aux formateurs `Intl`.
 */
export type Locale = string;

export type Vars = Record<string, string | number>;

/**
 * Un message **différé** : la clé et ses variables, pas le texte.
 *
 * C'est ce que les automates écrivent dans leur contexte et ce que
 * l'historique persiste. La traduction n'a lieu qu'au rendu — d'où le seul
 * comportement acceptable au changement de langue : l'erreur affichée et
 * les motifs de l'historique basculent avec le reste, au lieu de rester
 * figés dans la langue qui avait cours au moment de l'appel.
 */
export interface Msg {
  key: CoreMsgKey;
  vars?: Vars;
}

/**
 * La traduction telle que le noyau s'en sert pour écrire — un fichier de
 * sous-titres, une ligne de console : la sienne (`coreTranslate`,
 * `core/i18n/`), ou celle de l'UI, qui couvre les mêmes clés et d'autres.
 */
export interface Translate {
  t(key: CoreMsgKey | Msg, vars?: Vars): string;
  /** Balise BCP-47 de la langue courante, pour les formateurs `Intl`. */
  locale(): Locale;
}

/** Fabrique — `msg("error.proxyLost")`, `msg("error.regLost", { cause })`. */
export function msg(key: CoreMsgKey, vars?: Vars): Msg {
  return vars ? { key, vars } : { key };
}

/**
 * Enveloppe un texte sans traduction (cause JsSIP, ligne d'historique
 * enregistrée avant l'i18n) pour qu'il traverse la même chaîne que les
 * autres messages.
 */
export function rawMsg(text: string): Msg {
  return { key: "misc.raw", vars: { text } };
}
