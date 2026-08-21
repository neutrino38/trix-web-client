/**
 * L'internationalisation : ce que le compilateur ne peut pas garantir.
 *
 * Le typage impose déjà qu'une langue porte **toutes** les clés du
 * français. Restent trois façons de casser une traduction sans qu'aucune
 * erreur de compilation ne le signale, et ce sont elles que l'on teste
 * ici : une valeur vide, une clé en trop, et surtout une variable perdue
 * en route — « Registration refused: » sans son `{cause}` compile
 * parfaitement et n'affiche plus rien d'utile.
 *
 * Une seule tolérance, et elle est nommée : les **formes de pluriel** qu'une
 * langue ajoute pour elle seule (l'arabe en compte six, le français deux).
 * Elles échappent aux deux premières règles — clé absente du français, et
 * chiffre parfois porté par le mot plutôt que par `{n}` : « depuis une
 * minute ». Partout ailleurs, l'égalité reste stricte.
 *
 * Le balayage passe par le même `import.meta.glob` que l'application :
 * une langue ajoutée demain est vérifiée sans que ce fichier bouge.
 */

import { describe, expect, it } from "vitest";
import {
  LOCALES,
  detectLocale,
  directionOf,
  localeName,
  t,
  tn,
  useLocale,
} from "../src/i18n/index.js";
import { msg, rawMsg, type Dictionary, type Translation } from "../src/i18n/types.js";
import fr from "../src/i18n/locales/fr.js";

const dicts = import.meta.glob<Translation>("../src/i18n/locales/*.ts", {
  eager: true,
  import: "default",
});

const byCode = Object.fromEntries(
  Object.entries(dicts).map(([path, dict]) => [path.slice(path.lastIndexOf("/") + 1, -3), dict]),
);

/** Les noms de variables attendus par un message, dans l'ordre de lecture. */
function placeholders(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
}

describe("catalogue des langues", () => {
  it("découvre au moins le français et l'anglais", () => {
    expect(LOCALES).toContain("fr");
    expect(LOCALES).toContain("en");
    expect(Object.keys(byCode).sort()).toEqual([...LOCALES].sort());
  });

  it("nomme chaque langue dans sa propre langue", () => {
    expect(localeName("fr")).toBe("Français");
    expect(localeName("en")).toBe("English");
    expect(localeName("ar")).toBe("العربية");
  });
});

describe("sens d'écriture", () => {
  it("reconnaît les langues de droite à gauche", () => {
    expect(directionOf("ar")).toBe("rtl");
    expect(directionOf("he")).toBe("rtl");
  });

  it("laisse les autres de gauche à droite", () => {
    expect(directionOf("fr")).toBe("ltr");
    expect(directionOf("en")).toBe("ltr");
  });

  it("tranche même sur une balise qu'Intl refuse", () => {
    expect(directionOf("ar-Arab-XX-nonsense")).toBe("rtl");
    expect(directionOf("!")).toBe("ltr");
  });
});

/** `announce.inCall.one` : une forme de pluriel, quelle que soit la langue. */
function isPluralForm(key: string): boolean {
  const dot = key.lastIndexOf(".");
  return dot > 0 && [...EXTRA_PLURALS, "one", "other"].includes(key.slice(dot + 1));
}

/** Les formes qu'une langue peut ajouter à un pluriel que le français a. */
const EXTRA_PLURALS = ["zero", "two", "few", "many"];

/** `announce.inCall.few` quand `announce.inCall.other` existe en français. */
function isExtraPluralForm(key: string): boolean {
  const dot = key.lastIndexOf(".");
  return (
    dot > 0 &&
    EXTRA_PLURALS.includes(key.slice(dot + 1)) &&
    `${key.slice(0, dot)}.other` in fr
  );
}

describe("complétude des dictionnaires", () => {
  const reference = Object.keys(fr).sort();

  for (const [code, dict] of Object.entries(byCode)) {
    it(`${code} : toutes les clés du français, et rien d'autre qu'un pluriel de plus`, () => {
      const keys = Object.keys(dict);
      expect(keys.filter((k) => !isExtraPluralForm(k)).sort()).toEqual(reference);
    });

    it(`${code} : aucun libellé vide`, () => {
      const empty = Object.entries(dict)
        .filter(([, value]) => value.trim() === "")
        .map(([key]) => key);
      expect(empty).toEqual([]);
    });

    it(`${code} : les mêmes variables que le français, aux mêmes clés`, () => {
      const drift = Object.entries(dict)
        .filter(([key, value]) => {
          const source = fr[key as keyof Dictionary];
          if (source === undefined) return false;
          // Un pluriel peut se passer du nombre — « depuis une minute » —,
          // mais pas en inventer un que le français ne fournit pas.
          const expected = placeholders(source);
          const found = placeholders(value);
          return isPluralForm(key)
            ? found.some((name) => !expected.includes(name))
            : found.join(",") !== expected.join(",");
        })
        .map(([key]) => key);
      expect(drift).toEqual([]);
    });
  }
});

describe("détection de la langue du navigateur", () => {
  it("prend la première langue disponible, par ordre de préférence", () => {
    expect(detectLocale(["en-US", "fr-FR"])).toBe("en");
    expect(detectLocale(["fr-CH", "en"])).toBe("fr");
  });

  it("préfère la balise exacte à la sous-étiquette primaire", () => {
    // Deux français cohabitent : `fr-CA` doit gagner sur `fr` pour qui le
    // demande, et `fr-CH` — que Trix ne parle pas — retomber sur `fr`.
    expect(detectLocale(["fr-CA"])).toBe("fr-CA");
    expect(detectLocale(["fr-CH"])).toBe("fr");
    expect(detectLocale(["fr"])).toBe("fr");
  });

  it("ignore les langues qu'on ne parle pas", () => {
    expect(detectLocale(["de-DE", "it", "en-GB"])).toBe("en");
  });

  it("retombe sur le français quand rien ne correspond", () => {
    expect(detectLocale(["de-DE", "ko"])).toBe("fr");
    expect(detectLocale([])).toBe("fr");
  });
});

describe("traduction", () => {
  it("rend le libellé de la langue chargée", async () => {
    await useLocale("fr");
    expect(t("history.empty")).toBe("Aucun appel enregistré");
    await useLocale("en");
    expect(t("history.empty")).toBe("No calls yet. Blissfully quiet");
  });

  it("substitue les variables", async () => {
    await useLocale("fr");
    expect(t("error.regRefused", { cause: "403 Forbidden" })).toBe(
      "Enregistrement refusé : 403 Forbidden",
    );
  });

  it("traduit un message différé d'automate, variables comprises", async () => {
    await useLocale("en");
    expect(t(msg("reason.sip", { cause: "Busy", code: 486 }))).toBe("Busy (SIP 486)");
    expect(t(msg("error.proxyLost"))).toBe("Connection to the proxy lost");
  });

  it("rend tel quel un texte sans traduction", async () => {
    await useLocale("fr");
    expect(t(rawMsg("User Denied Media Access"))).toBe("User Denied Media Access");
  });

  it("laisse la variable en place quand rien ne la renseigne", async () => {
    await useLocale("fr");
    expect(t("error.regLost")).toBe("Enregistrement perdu : {cause}");
  });

  it("accorde le pluriel selon la langue", async () => {
    await useLocale("fr");
    expect(tn("announce.inCall", 1)).toBe("En communication depuis 1 minute");
    expect(tn("announce.inCall", 4)).toBe("En communication depuis 4 minutes");
    await useLocale("en");
    expect(tn("announce.inCall", 1)).toBe("In call for 1 minute");
    expect(tn("announce.inCall", 4)).toBe("In call for 4 minutes");
  });

  it("accorde les six formes de l'arabe, et retombe sur « other »", async () => {
    await useLocale("ar");
    // le duel et le singulier portent le nombre dans le mot, sans chiffre
    expect(tn("announce.inCall", 1)).toBe("في مكالمة منذ دقيقة واحدة");
    expect(tn("announce.inCall", 2)).toBe("في مكالمة منذ دقيقتين");
    expect(tn("announce.inCall", 3)).toBe("في مكالمة منذ 3 دقائق");
    expect(tn("announce.inCall", 11)).toBe("في مكالمة منذ 11 دقيقة");
    expect(tn("announce.inCall", 100)).toBe("في مكالمة منذ 100 دقيقة");
  });

  it("refuse une langue qui n'existe pas", async () => {
    await expect(useLocale("xx")).rejects.toThrow(/xx/);
  });
});
