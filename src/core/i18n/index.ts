/**
 * The core's catalogue (ADR 0011, D9): the texts of the only keys the core
 * produces (`CoreMsgKey`), in the languages Trix ships.
 *
 * French is bundled — it is the reference, and the fallback. The other
 * languages are loaded on demand, each its own chunk: an affiliate that
 * speaks English does not pay for Japanese. `loadCoreMessages()` brings one
 * in; `formatMsg()` then words a message in it, synchronously, as a render
 * needs.
 *
 * A language Trix does not ship is the affiliate's to write: `CoreDictionary`
 * says, at compile time, which keys it must cover.
 */

import type { CoreDictionary, CoreMsgKey, Locale, Msg, Translate, Vars } from "../../i18n/types.js";
import fr from "./fr.js";

/** Plain dynamic imports, not a bundler glob: any bundler splits them. */
const LOADERS: Record<Locale, () => Promise<{ default: CoreDictionary }>> = {
  ar: () => import("./ar.js"),
  en: () => import("./en.js"),
  "fr-CA": () => import("./fr-CA.js"),
  ja: () => import("./ja.js"),
  "zh-Hans": () => import("./zh-Hans.js"),
};

/** The languages of the core's catalogue, as BCP-47 tags. */
export const CORE_LOCALES: readonly Locale[] = ["fr", ...Object.keys(LOADERS)].sort();

/**
 * What is loaded. The page's, not an instance's: a dictionary is the same
 * text for every instance, and loading it twice would buy nothing.
 */
const loaded = new Map<Locale, CoreDictionary>([["fr", fr]]);

/** The shipped language for a tag: exact, then by primary subtag, then French. */
export function coreLocaleFor(tag: string): Locale {
  const wanted = tag.toLowerCase();
  const exact = CORE_LOCALES.find((code) => code.toLowerCase() === wanted);
  if (exact) return exact;
  const primary = wanted.split("-")[0];
  return CORE_LOCALES.find((code) => code.toLowerCase().split("-")[0] === primary) ?? "fr";
}

/**
 * Loads the catalogue that serves `tag`, and resolves to the language it
 * is. Never rejects: a chunk that does not come leaves French in place.
 */
export async function loadCoreMessages(tag: string): Promise<Locale> {
  const code = coreLocaleFor(tag);
  if (loaded.has(code)) return code;
  try {
    loaded.set(code, (await LOADERS[code]!()).default);
    return code;
  } catch {
    return "fr";
  }
}

const PLACEHOLDER = /\{(\w+)\}/g;

/** `{name}` replaced by its variable; one that is missing stays as written. */
export function interpolate(template: string, vars: Vars | undefined): string {
  if (!vars) return template;
  return template.replaceAll(PLACEHOLDER, (whole, name: string) => {
    const value = vars[name];
    return value === undefined ? whole : String(value);
  });
}

/**
 * A core message in words, in `tag`'s language if its catalogue is loaded,
 * in French otherwise — never an empty string: an unknown key comes back
 * as itself.
 */
export function formatMsg(message: Msg | CoreMsgKey, tag: string, vars?: Vars): string {
  const { key, vars: own } = typeof message === "string" ? { key: message, vars } : message;
  const dict = loaded.get(coreLocaleFor(tag)) ?? fr;
  const template = dict[key] ?? fr[key];
  return template === undefined ? key : interpolate(template, own);
}

/** The core's own `Translate`, in one language: what it words the console with. */
export function coreTranslate(tag: string): Translate {
  const code = coreLocaleFor(tag);
  return { t: (key, vars) => formatMsg(key, code, vars), locale: () => code };
}
