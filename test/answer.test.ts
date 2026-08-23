/**
 * Réponses proposées pour un appel entrant (docs/SPECS.md, phase 3) :
 * la règle est portée par une seule fonction, les deux gabarits (bureau,
 * mobile) ne font que la dérouler.
 */
import { describe, expect, it } from "vitest";
import { answerChoices, callModes } from "../src/ui/screens/call/parts.js";

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

describe("callModes", () => {
  const ids = (rtt?: "none" | "websocket" | "datachannel"): string[] =>
    callModes(rtt).map((m) => m.id);

  it("sans texte au compte, pas d'appel texte : ce serait un appel sans rien", () => {
    expect(ids()).toEqual(["audio", "video"]);
    expect(ids("none")).toEqual(["audio", "video"]);
  });

  it("le compte transporte le texte : l'appel texte seul est proposé", () => {
    expect(ids("datachannel")).toEqual(["audio", "video", "text"]);
    expect(ids("websocket")).toEqual(["audio", "video", "text"]);
  });

  it("l'appel texte ne demande ni micro ni caméra", () => {
    const text = callModes("datachannel").find((m) => m.id === "text")!;
    expect(text.media).toEqual({ audio: false, video: false });
  });
});
