/**
 * Réponses proposées pour un appel entrant (docs/SPECS.md, phase 3) :
 * la règle est portée par une seule fonction, les deux gabarits (bureau,
 * mobile) ne font que la dérouler.
 */
import { describe, expect, it } from "vitest";
import { answerChoices } from "../src/ui/screens/call/parts.js";

const acts = (audio: boolean, video: boolean): string[] =>
  answerChoices({ audio, video }).map((c) => c.act);

describe("answerChoices", () => {
  it("vidéo proposée : réponse A/V et réponse audio seul", () => {
    expect(acts(true, true)).toEqual(["answer-av", "answer-audio"]);
  });

  it("audio seul proposé : pas de réponse vidéo", () => {
    expect(acts(true, false)).toEqual(["answer-audio"]);
  });

  it("vidéo seule proposée : pas de réponse audio seul", () => {
    expect(acts(false, true)).toEqual(["answer-av"]);
  });
});
