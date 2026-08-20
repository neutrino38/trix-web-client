/**
 * Types de l'internationalisation — **sans dépendance à l'exécution**.
 *
 * Ce module n'importe le français qu'en `import type` : la déclaration est
 * effacée à la compilation, donc les automates et le port SIP peuvent
 * parler de messages traduisibles sans faire entrer le moindre
 * dictionnaire dans leur bundle.
 *
 * Le français est la langue de référence : `Dictionary` est *son* type, et
 * toute autre langue doit le satisfaire — une clé oubliée est une erreur
 * de compilation, pas une chaîne manquante découverte en production.
 */

import type fr from "./locales/fr.js";

export type Dictionary = typeof fr;
export type MsgKey = keyof Dictionary;

/** Les bases de pluriel du français — `announce.inCall`, depuis `.other`. */
type BaseOf<K> = K extends `${infer Base}.other` ? Base : never;

/**
 * Ce qu'une langue a le droit d'écrire : **toutes** les clés du français,
 * plus — pour elle seule — les formes de pluriel que le français n'a pas.
 *
 * Le français en compte deux (`.one`, `.other`) ; l'arabe en demande six et
 * le russe quatre. Les faire porter à la langue de référence obligerait à
 * inventer un « duel » français qui n'existe pas, et à le traduire partout.
 * Chaque langue déclare donc les siennes, et `tn()` retombe sur `.other`
 * pour celles qu'elle ne déclare pas.
 *
 * L'ouverture reste close sur le reste : seules ces quatre formes, et
 * seulement sur une base que le français plurialise déjà, échappent au
 * contrôle des clés. Une faute de frappe dans un nom de clé ordinaire est
 * toujours refusée à la compilation.
 */
export type Translation = Dictionary &
  Partial<Record<`${BaseOf<MsgKey>}.${"zero" | "two" | "few" | "many"}`, string>>;

/**
 * Code d'une langue disponible — **le nom de son fichier** (`fr`, `en`,
 * `pt-BR`…), qui est du même coup une balise BCP-47 valide : elle sert
 * telle quelle à `<html lang>` et aux formateurs `Intl`.
 */
export type Locale = string;

/** Ce que l'utilisateur choisit : une langue, ou la détection automatique. */
export type LocaleChoice = "auto" | Locale;

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
  key: MsgKey;
  vars?: Vars;
}

/** Fabrique — `msg("error.proxyLost")`, `msg("error.regLost", { cause })`. */
export function msg(key: MsgKey, vars?: Vars): Msg {
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
