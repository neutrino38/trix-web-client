/**
 * Le fil tel que l'historique le garde (`sip/transcript.ts`).
 *
 * Ce qui se vérifie ici est ce que le typage ne dit pas : la bulle
 * vivante du raccrochage est close, ce qui est gardé est une **copie** —
 * le modèle du panneau continue d'écrire dans ses runs après coup —, un
 * fil trop long perd son début et le dit, et un appel où personne n'a
 * écrit ne laisse rien du tout.
 */

import { describe, expect, it } from "vitest";
import {
  bubbleText,
  sealTranscript,
  type ChatBubble,
  type ChatItem,
} from "../src/sip/transcript.js";

const AT = Date.UTC(2026, 0, 15, 12, 30, 5);
const END = AT + 60_000;

let seq = 0;

function bubble(side: "them" | "us", text: string, endedAt: number | null = AT + 1000): ChatBubble {
  return {
    kind: "bubble",
    id: ++seq,
    side,
    runs: text === "" ? [] : [{ text, attrs: {} }],
    startedAt: AT,
    endedAt,
  };
}

const note = (): ChatItem => ({
  kind: "note",
  id: ++seq,
  key: "chat.note.opened",
  at: AT,
});

describe("sealTranscript", () => {
  it("clôt la bulle vivante là où l'appel s'est arrêté", () => {
    const kept = sealTranscript([bubble("them", "bonjour", null)], END);
    expect(kept).toHaveLength(1);
    expect((kept[0] as ChatBubble).endedAt).toBe(END);
  });

  it("garde une copie : le panneau écrit encore dans ses runs après coup", () => {
    const live = bubble("us", "je vous li", null);
    const kept = sealTranscript([live], END);
    live.runs[0]!.text += "s";
    live.endedAt = END + 5;
    expect(bubbleText(kept[0] as ChatBubble)).toBe("je vous li");
    expect((kept[0] as ChatBubble).endedAt).toBe(END);
  });

  it("garde les remarques du fil, qui expliquent les trous", () => {
    const kept = sealTranscript([bubble("them", "allô"), note()], END);
    expect(kept.map((i) => i.kind)).toEqual(["bubble", "note"]);
  });

  it("rien à garder d'un appel où personne n'a écrit", () => {
    expect(sealTranscript([], END)).toEqual([]);
    expect(sealTranscript([note()], END)).toEqual([]);
    // une bulle vide n'est pas un message : le lien s'est ouvert, c'est tout
    expect(sealTranscript([bubble("us", ""), note()], END)).toEqual([]);
  });

  it("au plafond, c'est le début qui tombe — et une remarque le dit", () => {
    const long = "x".repeat(4_000);
    const items = Array.from({ length: 12 }, () => bubble("them", long));
    const kept = sealTranscript(items, END);
    expect(kept[0]).toMatchObject({ kind: "note", key: "chat.log.cut" });
    // 32 000 caractères de plafond : huit bulles de 4 000, pas neuf
    expect(kept.filter((i) => i.kind === "bubble")).toHaveLength(8);
    // et ce sont les dernières : une conversation se lit par la fin
    expect(kept.at(-1)).toMatchObject({ id: items.at(-1)!.id });
  });

  it("un fil qui tient sous le plafond ne porte pas la remarque de coupure", () => {
    const kept = sealTranscript([bubble("them", "bonjour"), bubble("us", "bonsoir")], END);
    expect(kept.some((i) => i.kind === "note" && i.key === "chat.log.cut")).toBe(false);
  });
});
