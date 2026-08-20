/**
 * Le sélecteur de langue de l'écran d'accueil.
 *
 * Ce qui se vérifie ici est ce que la maquette exige et que le typage ne
 * dit pas : « Automatique » vient **en premier**, il nomme la langue qu'il
 * détecte, et la liste se peuple toute seule de ce que `i18n` a trouvé —
 * une langue ajoutée demain y figure sans qu'on touche à ce composant.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { langPicker } from "../src/ui/langpicker.js";
import { useLocale } from "../src/i18n/index.js";

/** localStorage minimal : le composant y lit le choix enregistré. */
function stubStorage(initial: Record<string, string> = {}): void {
  const data = new Map(Object.entries(initial));
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => data.set(k, v),
      removeItem: (k: string) => data.delete(k),
    },
  });
}

/** Le navigateur de référence des tests : anglophone. */
function stubNavigator(languages: string[]): void {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { languages, language: languages[0] },
  });
}

const options = (html: string): { value: string; text: string }[] =>
  [...html.matchAll(/<option value="([^"]+)"[^>]*>([^<]*)<\/option>/g)].map((m) => ({
    value: m[1]!,
    text: m[2]!.trim(),
  }));

describe("sélecteur de langue", () => {
  beforeEach(async () => {
    stubStorage();
    stubNavigator(["en-US", "fr"]);
    await useLocale("fr");
  });

  it("propose « auto » en premier, puis chaque langue disponible", () => {
    const list = options(langPicker());
    expect(list[0]!.value).toBe("auto");
    expect(list.map((o) => o.value)).toContain("fr");
    expect(list.map((o) => o.value)).toContain("en");
  });

  it("« auto » nomme la langue détectée", () => {
    stubNavigator(["en-GB"]);
    expect(options(langPicker())[0]!.text).toBe("Automatique — English");
    stubNavigator(["fr-CA"]);
    expect(options(langPicker())[0]!.text).toBe("Automatique — Français");
  });

  it("chaque langue est nommée dans sa propre langue", () => {
    const list = options(langPicker());
    expect(list.find((o) => o.value === "fr")!.text).toBe("Français");
    expect(list.find((o) => o.value === "en")!.text).toBe("English");
  });

  it("sans choix enregistré, « auto » est sélectionné", () => {
    expect(langPicker()).toMatch(/<option value="auto" selected/);
  });

  it("avec un choix enregistré, c'est lui qui est sélectionné", () => {
    stubStorage({ "trix-lang": "en" });
    const html = langPicker();
    expect(html).not.toMatch(/<option value="auto" selected/);
    expect(html).toMatch(/<option value="en" selected/);
  });

  it("un choix devenu introuvable retombe sur « auto »", () => {
    stubStorage({ "trix-lang": "xx" });
    expect(langPicker()).toMatch(/<option value="auto" selected/);
  });
});
