/**
 * Types des dictionnaires **de l'UI** — sans dépendance à l'exécution.
 *
 * Les dictionnaires de `locales/` étendent le catalogue du noyau
 * (`core/i18n/`, ADR 0011, D9) : ils en reprennent toutes les clés, puis
 * ajoutent celles des écrans. `MsgKey` couvre donc les deux, et un message
 * du noyau (`Msg`) se traduit ici comme un libellé d'écran.
 *
 * Le français est la langue de référence : `Dictionary` est *son* type, et
 * toute autre langue doit le satisfaire — une clé oubliée est une erreur
 * de compilation, pas une chaîne manquante découverte en production.
 */

import type fr from "./locales/fr.js";
import type { Locale } from "./types.js";

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

/** Ce que l'utilisateur choisit : une langue, ou la détection automatique. */
export type LocaleChoice = "auto" | Locale;
