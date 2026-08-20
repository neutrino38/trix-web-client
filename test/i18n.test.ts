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
 * Le balayage passe par le même `import.meta.glob` que l'application :
 * une langue ajoutée demain est vérifiée sans que ce fichier bouge.
 */

import { describe, expect, it } from "vitest";
import { LOCALES, detectLocale, localeName, t, tn, useLocale } from "../src/i18n/index.js";
import { msg, rawMsg, type Dictionary } from "../src/i18n/types.js";
import fr from "../src/i18n/locales/fr.js";

const dicts = import.meta.glob<Dictionary>("../src/i18n/locales/*.ts", {
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
  });
});

describe("complétude des dictionnaires", () => {
  const reference = Object.keys(fr).sort();

  for (const [code, dict] of Object.entries(byCode)) {
    it(`${code} : mêmes clés que le français, aucune de plus`, () => {
      expect(Object.keys(dict).sort()).toEqual(reference);
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
          return (
            source !== undefined &&
            placeholders(value).join(",") !== placeholders(source).join(",")
          );
        })
        .map(([key]) => key);
      expect(drift).toEqual([]);
    });
  }
});

describe("détection de la langue du navigateur", () => {
  it("prend la première langue disponible, par ordre de préférence", () => {
    expect(detectLocale(["en-US", "fr-FR"])).toBe("en");
    expect(detectLocale(["fr-CA", "en"])).toBe("fr");
  });

  it("ignore les langues qu'on ne parle pas", () => {
    expect(detectLocale(["de-DE", "it", "en-GB"])).toBe("en");
  });

  it("retombe sur le français quand rien ne correspond", () => {
    expect(detectLocale(["de-DE", "ja"])).toBe("fr");
    expect(detectLocale([])).toBe("fr");
  });
});

describe("traduction", () => {
  it("rend le libellé de la langue chargée", async () => {
    await useLocale("fr");
    expect(t("history.empty")).toBe("Aucun appel enregistré");
    await useLocale("en");
    expect(t("history.empty")).toBe("No calls yet");
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

  it("refuse une langue qui n'existe pas", async () => {
    await expect(useLocale("xx")).rejects.toThrow(/xx/);
  });
});
