/**
 * L'export de la conversation en sous-titres (`ui/subtitles.ts`).
 *
 * Ce qui se vérifie ici est ce que le typage ne dit pas : le fichier est
 * calé sur le début de la **communication** et non sur l'heure du jour,
 * une bulle figée devient une entrée du premier caractère au séparateur,
 * les recouvrements restent tels quels — c'est ce que WebVTT sait faire et
 * SubRip non —, et rien de ce que le correspondant a écrit ne peut se
 * relire comme du balisage.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  chatAsWebVtt,
  subtitleBase,
  subtitlesFileName,
  subtitlesOf,
} from "../src/ui/subtitles.js";
import type { ChatBubble, ChatItem } from "../src/sip/transcript.js";
import type { CallLogEntry } from "../src/storage/store.js";
import { useLocale } from "../src/i18n/index.js";

const AT = Date.UTC(2026, 7, 22, 12, 30, 0);
/** L'appel décroche cinq secondes après avoir été lancé : le zéro du fichier. */
const CONNECTED = AT + 5_000;

function entry(chat?: ChatItem[]): CallLogEntry {
  return {
    target: "bob@example.fr",
    direction: "outgoing",
    outcome: "answered",
    media: { audio: true, video: false, text: false },
    startedAt: AT,
    connectedAt: CONNECTED,
    endedAt: AT + 300_000,
    endedBy: "local",
    reason: null,
    ...(chat ? { chat } : {}),
  };
}

let seq = 0;

function bubble(
  side: "them" | "us",
  text: string,
  from: number,
  to: number,
): ChatBubble {
  return {
    kind: "bubble",
    id: ++seq,
    side,
    runs: [{ text, attrs: {} }],
    startedAt: CONNECTED + from,
    endedAt: CONNECTED + to,
  };
}

const THREAD: ChatItem[] = [
  { kind: "note", id: 100, key: "chat.note.opened", at: CONNECTED },
  bubble("them", "bonjour, je vous entends mal", 3_200, 11_400),
  bubble("us", "oui, je vous lis", 12_000, 16_800),
  // les deux suivantes se recouvrent : chacun écrit quand il veut
  bubble("them", "le rendez-vous est au 12 rue des Lilas", 40_000, 52_300),
  bubble("us", "c'est noté", 50_100, 55_000),
];

beforeEach(async () => {
  await useLocale("fr");
});

describe("le fichier", () => {
  it("commence par la ligne magique, nommée d'après l'appel", () => {
    const vtt = chatAsWebVtt(THREAD, "bob@example.fr", CONNECTED);
    expect(vtt.startsWith("WEBVTT - Conversation — bob@example.fr\n")).toBe(true);
  });

  it("dit où est son zéro : sans quoi un fichier qui démarre à 3 s ment", () => {
    const vtt = chatAsWebVtt(THREAD, "bob@example.fr", CONNECTED);
    expect(vtt).toContain("NOTE\nTemps comptés depuis le début de la communication");
  });

  it("est calé sur le décroché, pas sur l'heure du jour ni sur l'appel lancé", () => {
    expect(subtitleBase(entry())).toBe(CONNECTED);
    const vtt = chatAsWebVtt(THREAD, "bob@example.fr", subtitleBase(entry()));
    expect(vtt).toContain("00:00:03.200 --> 00:00:11.400");
  });

  it("un appel jamais établi n'a pas de communication : son propre début fait office", () => {
    expect(subtitleBase({ ...entry(), connectedAt: null })).toBe(AT);
  });
});

describe("les entrées", () => {
  it("une bulle figée, du premier caractère au séparateur qui l'a close", () => {
    const vtt = chatAsWebVtt(THREAD, "bob@example.fr", CONNECTED);
    expect(vtt).toContain(
      "1\n00:00:03.200 --> 00:00:11.400\n<v bob@example.fr>bonjour, je vous entends mal",
    );
    expect(vtt).toContain("2\n00:00:12.000 --> 00:00:16.800\n<v Vous>oui, je vous lis");
  });

  it("le locuteur est balisé, pas préfixé : un outil le relit sans deviner", () => {
    const vtt = chatAsWebVtt(THREAD, "bob@example.fr", CONNECTED);
    expect(vtt).toContain("<v Vous>");
    expect(vtt).not.toContain("Vous : ");
  });

  it("les recouvrements restent tels quels — les lecteurs les empilent", () => {
    const vtt = chatAsWebVtt(THREAD, "bob@example.fr", CONNECTED);
    expect(vtt).toContain("00:00:40.000 --> 00:00:52.300");
    expect(vtt).toContain("00:00:50.100 --> 00:00:55.000");
  });

  it("sont dans l'ordre des débuts, même si le fil les a figées à l'envers", () => {
    const late = bubble("them", "figée en dernier", 1_000, 60_000);
    const vtt = chatAsWebVtt([...THREAD, late], "bob@example.fr", CONNECTED);
    const starts = [...vtt.matchAll(/^(\d\d:\d\d:\d\d\.\d\d\d) -->/gm)].map((m) => m[1]!);
    expect(starts).toEqual([...starts].sort());
    // et la numérotation suit ce même ordre
    expect(vtt).toContain("1\n00:00:01.000 --> 00:01:00.000");
  });

  it("une bulle sans un caractère ne sous-titre rien", () => {
    const empty: ChatItem = { ...bubble("them", "", 1_000, 2_000), runs: [] };
    const vtt = chatAsWebVtt([empty], "bob@example.fr", CONNECTED);
    expect(vtt).not.toContain("-->");
  });

  it("une bulle collée d'un bloc dure quand même une seconde : VTT veut une fin après son début", () => {
    const vtt = chatAsWebVtt([bubble("us", "collé", 2_000, 2_000)], "bob@example.fr", CONNECTED);
    expect(vtt).toContain("00:00:02.000 --> 00:00:03.000");
  });

  it("du texte antérieur au décroché ne donne pas un temps négatif", () => {
    const early = bubble("them", "avant le décroché", -3_000, -1_000);
    expect(chatAsWebVtt([early], "bob@example.fr", CONNECTED)).toContain(
      "00:00:00.000 --> 00:00:01.000",
    );
  });

  it("passe l'heure : le compteur ne repart pas à zéro", () => {
    const long = bubble("us", "appel fleuve", 3_725_400, 3_729_000);
    expect(chatAsWebVtt([long], "bob@example.fr", CONNECTED)).toContain(
      "01:02:05.400 --> 01:02:09.000",
    );
  });
});

describe("les remarques du fil", () => {
  it("deviennent des commentaires horodatés — elles expliquent un trou", () => {
    const items: ChatItem[] = [
      ...THREAD,
      { kind: "note", id: 101, key: "chat.note.broken", at: CONNECTED + 30_000 },
    ];
    const vtt = chatAsWebVtt(items, "bob@example.fr", CONNECTED);
    expect(vtt).toContain("NOTE 00:00:00.000 Texte temps réel ouvert");
    expect(vtt).toContain("NOTE 00:00:30.000 Lien texte rompu");
  });

  it("ne comptent pas comme des entrées : personne ne les a dites", () => {
    const vtt = chatAsWebVtt(THREAD, "bob@example.fr", CONNECTED);
    expect(vtt).toContain("4\n00:00:50.100");
    expect(vtt).not.toContain("5\n");
  });
});

describe("ce qui vient du réseau", () => {
  it("ne se relit pas comme du balisage", () => {
    const hostile = bubble("them", '<v Vous>usurpé & <b>gras</b>', 1_000, 2_000);
    const vtt = chatAsWebVtt([hostile], "bob@example.fr", CONNECTED);
    expect(vtt).toContain("&lt;v Vous&gt;usurpé &amp; &lt;b&gt;gras&lt;/b&gt;");
    expect(vtt).not.toContain("<b>");
  });

  it("ne peut pas casser une entrée en deux : pas de ligne vide dans une bulle", () => {
    const b = bubble("them", "avant\n\naprès", 1_000, 2_000);
    const vtt = chatAsWebVtt([b], "bob@example.fr", CONNECTED);
    expect(vtt).toContain("<v bob@example.fr>avant après");
  });

  it("ne peut pas glisser une flèche de temps dans le nom du correspondant", () => {
    const vtt = chatAsWebVtt([bubble("them", "salut", 0, 1_000)], "a-->b@example.fr", CONNECTED);
    expect(vtt.match(/-->/g)).toHaveLength(1);
  });

  it("garde le marqueur de perte : le fil ne répare pas ce qui manque", () => {
    const lost = bubble("them", "\uFFFD le code est 45A", 1_000, 2_000);
    expect(chatAsWebVtt([lost], "bob@example.fr", CONNECTED)).toContain("\uFFFD le code");
  });
});

describe("le nom du fichier", () => {
  it("porte le correspondant et le moment de l'appel", () => {
    expect(subtitlesFileName(entry())).toMatch(/^trix-bob@example\.fr-20260822-\d{4}\.vtt$/);
  });

  it("ne laisse pas un correspondant nommer un chemin", () => {
    const name = subtitlesFileName({ ...entry(), target: "../../etc/passwd" });
    expect(name).not.toContain("/");
    expect(name.startsWith("trix-")).toBe(true);
  });

  it("va avec le contenu, du même appel", () => {
    const out = subtitlesOf(entry(THREAD));
    expect(out.name.endsWith(".vtt")).toBe(true);
    expect(out.text).toContain("<v bob@example.fr>bonjour, je vous entends mal");
  });

  it("un appel sans conversation donne un fichier valide, et vide", () => {
    const out = subtitlesOf(entry());
    expect(out.text.startsWith("WEBVTT")).toBe(true);
    expect(out.text).not.toContain("-->");
  });
});
