/**
 * Le sélecteur de langue de l'écran d'accueil.
 *
 * Ce qui se vérifie ici est ce que la maquette exige et que le typage ne
 * dit pas : « Automatique » vient **en premier**, il nomme la langue qu'il
 * détecte, la liste se peuple toute seule de ce que `i18n` a trouvé — une
 * langue ajoutée demain y figure sans qu'on touche à ce composant —, et
 * chaque entrée porte le bon emblème, y compris les deux cas où il ne se
 * déduit pas de la balise (le Québec, qui n'est pas le Canada ; l'arabe,
 * qui n'est aucun pays).
 */

import { beforeEach, describe, expect, it } from "vitest";
import { langPicker } from "../src/ui/langpicker.js";
import { flagImage } from "../src/ui/flags.js";
import { localeFlag, useLocale } from "../src/i18n/index.js";

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

interface Item {
  value: string;
  checked: boolean;
  name: string;
  /** L'image du drapeau, l'emoji, ou `null` quand l'entrée n'en porte pas. */
  flag: string | null;
  /** Le balisage de l'entrée, pour ce qui ne se résume pas à un champ. */
  html: string;
}

const NAME = /<span class="lang-name"[^>]*>([^<]*)<\/span>/;
const IMG = /<img class="flag" src="([^"]+)"/;
const EMOJI = /<span class="flag emoji"[^>]*>([^<]*)<\/span>/;

function flagOf(html: string): string | null {
  return IMG.exec(html)?.[1] ?? EMOJI.exec(html)?.[1] ?? null;
}

/** Les entrées du menu, dans l'ordre où elles sont rendues. */
function items(html: string): Item[] {
  const menu = html.slice(html.indexOf('data-ref="langmenu"'));
  return [...menu.matchAll(/<button[^>]*aria-checked="(true|false)"[\s\S]*?<\/button>/g)].map(
    (m) => {
      const block = m[0];
      return {
        value: /data-value="([^"]+)"/.exec(block)![1]!,
        checked: m[1] === "true",
        name: NAME.exec(block)![1]!.trim(),
        flag: flagOf(block),
        html: block,
      };
    },
  );
}

/** Ce que montre le bouton qui ouvre le menu. */
function trigger(html: string): { name: string; flag: string | null } {
  const block = html.slice(html.indexOf('data-ref="lang"'), html.indexOf('data-ref="langmenu"'));
  return { name: NAME.exec(block)![1]!.trim(), flag: flagOf(block) };
}

describe("sélecteur de langue", () => {
  beforeEach(async () => {
    stubStorage();
    stubNavigator(["en-US", "fr"]);
    await useLocale("fr");
  });

  it("propose « auto » en premier, puis chaque langue disponible", () => {
    const list = items(langPicker());
    expect(list[0]!.value).toBe("auto");
    expect(list.map((o) => o.value)).toContain("fr");
    expect(list.map((o) => o.value)).toContain("en");
  });

  it("« auto » nomme la langue détectée", () => {
    stubNavigator(["en-GB"]);
    expect(items(langPicker())[0]!.name).toBe("Automatique — English");
    stubNavigator(["fr-BE"]);
    expect(items(langPicker())[0]!.name).toBe("Automatique — Français");
    stubNavigator(["fr-CA"]);
    expect(items(langPicker())[0]!.name).toBe("Automatique — Québécois");
  });

  it("chaque langue est nommée dans sa propre langue", () => {
    const by = new Map(items(langPicker()).map((o) => [o.value, o]));
    expect(by.get("fr")!.name).toBe("Français");
    expect(by.get("en")!.name).toBe("English");
    // Ni « Français canadien » (Node) ni « Français (Canada) » (Chrome) :
    // le dictionnaire est québécois, et le libellé cesse du même coup de
    // dépendre des données du moteur.
    expect(by.get("fr-CA")!.name).toBe("Québécois");
    expect(by.get("ja")!.name).toBe("日本語");
    expect(by.get("zh-Hans")!.name).toBe("简体中文");
  });

  it("porte un drapeau dessiné, et le bon", () => {
    const by = new Map(items(langPicker()).map((o) => [o.value, o]));
    for (const code of ["fr", "en", "ja", "zh-Hans", "fr-CA", "ar"]) {
      expect(by.get(code)!.flag).toMatch(/^data:image\/svg\+xml,/);
    }
    // Tout l'objet de l'exercice : le fleurdelisé n'est ni le tricolore
    // dont `fr-CA` hériterait par sa langue, ni l'unifolié que sa région
    // lui vaudrait.
    expect(by.get("fr-CA")!.flag).not.toBe(by.get("fr")!.flag);
    expect(decodeURIComponent(by.get("fr-CA")!.flag!)).toContain("#002495");
  });

  it("donne à l'arabe le drapeau choisi, et le globe à « auto »", () => {
    const by = new Map(items(langPicker()).map((o) => [o.value, o]));
    // L'arabe standard moderne n'est celui d'aucun pays : le drapeau est un
    // choix, pas une déduction — la Tunisie, et non l'Égypte que CLDR tient
    // pour la région la plus probable de la balise.
    expect(by.get("ar")!.name).toBe("العربية");
    expect(decodeURIComponent(by.get("ar")!.flag!)).toContain("#e70013");
    expect(by.get("auto")!.flag).toBe("🌐");
  });

  it("donne une case de drapeau à chaque entrée, colonne oblige", () => {
    // Vide au besoin : une entrée sans case verrait son nom se décaler
    // d'une vignette vers la gauche, et la colonne se briserait sur elle.
    for (const o of items(langPicker())) expect(o.html).toMatch(/class="flag/);
  });

  it("retombe sur l'emoji pour une langue qu'on n'a pas dessinée", () => {
    // Déposer `de.ts` doit suffire : rien à dessiner, rien à inscrire.
    expect(flagImage("de")).toBeUndefined();
    expect(localeFlag("de")).toBe("🇩🇪");
  });

  it("sans choix enregistré, « auto » est coché et montré", () => {
    const html = langPicker();
    expect(items(html).find((o) => o.checked)!.value).toBe("auto");
    expect(trigger(html).name).toBe("Automatique — English");
  });

  it("avec un choix enregistré, c'est lui qui est coché et montré", () => {
    stubStorage({ "trix-lang": "fr-CA" });
    const html = langPicker();
    expect(items(html).find((o) => o.checked)!.value).toBe("fr-CA");
    expect(trigger(html).name).toBe("Québécois");
    expect(trigger(html).flag).toBe(flagImage("fr-CA"));
  });

  it("un choix devenu introuvable retombe sur « auto »", () => {
    stubStorage({ "trix-lang": "xx" });
    expect(items(langPicker()).find((o) => o.checked)!.value).toBe("auto");
  });
});
