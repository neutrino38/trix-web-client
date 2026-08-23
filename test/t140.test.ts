/**
 * Le codec T.140 : ce que le typage ne dit pas.
 *
 * Trois familles de pièges, toutes vues ailleurs en production (§4.9, « ce
 * que `tchat3` nous apprend ») : une séquence de commande coupée entre deux
 * fragments — les frontières de message ne veulent rien dire —, un
 * caractère compté en unités UTF-16 plutôt qu'en graphèmes, et une couleur
 * reçue appliquée telle quelle sur un fond qu'elle rend illisible.
 */

import { describe, expect, it } from "vitest";
import {
  T140,
  graphemes,
  sanitizeOutgoing,
  t140Decoder,
  t140Edit,
  type T140Event,
} from "../src/sip/t140.js";

/** Le flux décodé d'une traite, pour les cas qui n'ont pas de frontière. */
function decode(...chunks: string[]): T140Event[] {
  const d = t140Decoder();
  return chunks.flatMap((c) => d.feed(c));
}

/** Le texte qu'un flux produit, commandes retirées. */
function textOf(events: T140Event[]): string {
  return events.map((e) => (e.type === "text" ? e.text : "")).join("");
}

describe("le texte, et ce qui n'en est pas", () => {
  it("rend une salve de texte en un seul événement", () => {
    expect(decode("bonjour")).toEqual([{ type: "text", text: "bonjour" }]);
  });

  it("avale la signature de session sans jamais l'afficher", () => {
    expect(decode(`${T140.BOM}salut`)).toEqual([{ type: "text", text: "salut" }]);
  });

  it("filtre les caractères parasites plutôt que de les afficher", () => {
    expect(textOf(decode("a\u0000b\u001Fc"))).toBe("abc");
  });

  it("tout ce qui n'est pas une commande est du texte, émoji compris", () => {
    expect(textOf(decode("👍🏽 ça va"))).toBe("👍🏽 ça va");
  });
});

describe("les commandes", () => {
  it("un retour arrière est un effacement, pas un caractère", () => {
    expect(decode(`ab${T140.BS}`)).toEqual([{ type: "text", text: "ab" }, { type: "erase" }]);
  });

  it("le séparateur de ligne fige la bulle", () => {
    expect(decode(`a${T140.LS}b`)).toEqual([
      { type: "text", text: "a" },
      { type: "break" },
      { type: "text", text: "b" },
    ]);
  });

  it("accepte CR, LF et CRLF comme séparateurs — CRLF n'en fait qu'un", () => {
    expect(decode("a\r\nb").filter((e) => e.type === "break")).toHaveLength(1);
    expect(decode("a\rb").filter((e) => e.type === "break")).toHaveLength(1);
    expect(decode("a\nb").filter((e) => e.type === "break")).toHaveLength(1);
  });

  it("ne coupe pas un CRLF tombé entre deux fragments", () => {
    const d = t140Decoder();
    expect(d.feed("a\r")).toEqual([{ type: "text", text: "a" }]);
    expect(d.feed("\nb")).toEqual([{ type: "break" }, { type: "text", text: "b" }]);
  });

  it("l'alerte en séance est un événement, pas un caractère", () => {
    expect(decode(T140.BEL)).toEqual([{ type: "alert" }]);
  });

  it("le marqueur de texte perdu se voit", () => {
    expect(decode(T140.LOST)).toEqual([{ type: "lost" }]);
  });

  it("ignore l'interruption, qui n'a pas de mode à basculer ici", () => {
    expect(textOf(decode(`a${T140.ESC}ab`))).toBe("ab");
  });
});

describe("les attributs d'affichage", () => {
  it("remappe la couleur sur la palette du thème, jamais du RGB brut", () => {
    const events = decode(`${T140.CSI}31mrouge`);
    expect(events[0]).toEqual({ type: "attrs", attrs: { color: "var(--red)" } });
    expect(events[1]).toEqual({ type: "text", text: "rouge" });
  });

  it("accumule les paramètres et les remet à zéro sur SGR 0", () => {
    const events = decode(`${T140.CSI}1;4;32m`, `${T140.CSI}0m`);
    expect(events[0]).toEqual({
      type: "attrs",
      attrs: { bold: true, underline: true, color: "var(--green)" },
    });
    expect(events[1]).toEqual({ type: "attrs", attrs: {} });
  });

  it("dilue un fond reçu : le texte reste lisible sur les deux thèmes", () => {
    const [ev] = decode(`${T140.CSI}41m`);
    expect(ev).toEqual({
      type: "attrs",
      attrs: { background: "color-mix(in srgb, var(--red) 22%, transparent)" },
    });
  });

  it("avale une séquence de contrôle qui n'est pas un SGR", () => {
    expect(decode(`a${T140.CSI}2Jb`)).toEqual([
      { type: "text", text: "a" },
      { type: "text", text: "b" },
    ]);
  });

  it("recolle une séquence coupée entre deux fragments", () => {
    const d = t140Decoder();
    expect(d.feed(`a${T140.CSI}3`)).toEqual([{ type: "text", text: "a" }]);
    expect(d.pending()).not.toBe("");
    expect(d.feed("1mb")).toEqual([
      { type: "attrs", attrs: { color: "var(--red)" } },
      { type: "text", text: "b" },
    ]);
  });

  it("avale une extension de protocole en entier, forme 7 bits comprise", () => {
    expect(textOf(decode(`a${T140.SOS}profil=x${T140.ST}b`))).toBe("ab");
    expect(textOf(decode(`a${T140.ESC}Xprofil${T140.ESC}\\b`))).toBe("ab");
  });
});

describe("le différentiel d'émission", () => {
  it("ne dit rien quand rien n'a changé", () => {
    expect(t140Edit("bonjour", "bonjour")).toEqual({ kind: "same", back: 0, add: "" });
  });

  it("écrire à la fin ne coûte aucun retour arrière", () => {
    expect(t140Edit("bon", "bonjour")).toEqual({ kind: "append", back: 0, add: "jour" });
  });

  it("effacer par la fin ne coûte que des retours arrière", () => {
    expect(t140Edit("bonjour", "bon")).toEqual({ kind: "erase", back: 4, add: "" });
  });

  it("compte un émoji pour un seul retour arrière", () => {
    expect(t140Edit("bravo 👍🏽", "bravo ")).toEqual({ kind: "erase", back: 1, add: "" });
  });

  it("remonte jusqu'au point de divergence pour une correction au milieu", () => {
    expect(t140Edit("12 rue des Lilas", "12 rue des Tilleuls")).toEqual({
      kind: "rewrite",
      back: 5,
      add: "Tilleuls",
    });
  });

  it("un accent combinant ajouté après sa lettre reste une écriture à la fin", () => {
    // « cafe » puis l'accent : mesuré en graphèmes ce serait une correction
    // au milieu — donc deux secondes d'attente pour une frappe ordinaire
    expect(t140Edit("cafe", "cafe\u0301")).toEqual({
      kind: "append",
      back: 0,
      add: "\u0301",
    });
  });
});

describe("ce qui part vers le champ", () => {
  it("neutralise les fins de ligne d'un collage — une seule espace par ligne", () => {
    expect(sanitizeOutgoing("deux\r\nlignes")).toBe("deux lignes");
    expect(sanitizeOutgoing(`a${T140.LS}b`)).toBe("a b");
  });

  it("ne laisse partir aucune commande : nous n'en émettons pas", () => {
    expect(sanitizeOutgoing(`a${T140.BS}${T140.BEL}${T140.BOM}b`)).toBe("ab");
  });
});

describe("les graphèmes", () => {
  it("compte un émoji composé pour une unité", () => {
    expect(graphemes("👍🏽")).toHaveLength(1);
    expect(graphemes("é")).toHaveLength(1);
  });
});
