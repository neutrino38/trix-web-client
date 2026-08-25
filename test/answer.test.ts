/**
 * Réponses proposées pour un appel entrant, et modes d'appel sortant :
 * la règle est portée par une seule fonction, les deux gabarits (bureau,
 * mobile) ne font que la dérouler.
 *
 * Depuis l'ADR 0003, le texte y est un média comme les deux autres (D1) :
 * ce qui se teste ici est le **tableau de D3**, ligne par ligne — la
 * réponse est toujours un sous-ensemble de l'offre, jamais un sur-ensemble
 * (F.703 §8.1), et le texte n'y apparaît jamais comme un choix : il est
 * dans toutes les réponses d'une ligne, ou dans aucune.
 */
import { describe, expect, it } from "vitest";
import { answerChoices, callModes, callProfile } from "../src/ui/screens/call/parts.js";
import type { CallMedia } from "../src/sip/port.js";

const offer = (audio: boolean, video: boolean, text: boolean): CallMedia => ({
  audio,
  video,
  text,
});

const acts = (audio: boolean, video: boolean, text = false): string[] =>
  answerChoices(offer(audio, video, text)).map((c) => c.act);

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

  /**
   * Ni parole ni image : c'est un appel texte seul (§4.9) — le port a déjà
   * refusé les offres qui n'étaient rien du tout. Sans ce cas, la popup
   * n'offrirait que Refuser.
   */
  it("texte seul : c'est un appel, et il se répond", () => {
    expect(acts(false, false, true)).toEqual(["answer-text"]);
  });

  /**
   * Le tableau de D3, dans l'ordre où il est écrit. C'est la seule règle
   * de l'écran d'appel entrant, et elle vit ici — un gabarit ne fait que
   * dérouler cette liste.
   */
  it("suit le tableau des réponses possibles, offre par offre", () => {
    expect(acts(true, true, true)).toEqual(["answer-av", "answer-audio", "answer-text"]);
    expect(acts(true, true, false)).toEqual(["answer-av", "answer-audio"]);
    expect(acts(true, false, true)).toEqual(["answer-audio", "answer-text"]);
    expect(acts(false, true, true)).toEqual(["answer-av", "answer-text"]);
    expect(acts(true, false, false)).toEqual(["answer-audio"]);
    expect(acts(false, true, false)).toEqual(["answer-av"]);
    expect(acts(false, false, true)).toEqual(["answer-text"]);
  });
});

/**
 * Le profil, au sens du tableau F.703 §7.2 : ce que l'écran d'appel
 * entrant annonce. Un appel audio + texte n'est pas « un appel audio »,
 * et le dire ainsi cacherait à un usager sourd son seul recours.
 */
describe("callProfile", () => {
  it("nomme les cinq profils que Trix propose", () => {
    expect(callProfile(offer(false, false, true))).toBe("text");
    expect(callProfile(offer(true, false, false))).toBe("audio");
    expect(callProfile(offer(true, false, true))).toBe("audioText");
    expect(callProfile(offer(true, true, false))).toBe("video");
    // le seul qui soit une conversation totale au sens de la norme
    expect(callProfile(offer(true, true, true))).toBe("videoText");
  });

  it("une vidéo sans audio reste de la visiophonie : c'est l'image qui domine", () => {
    expect(callProfile(offer(false, true, false))).toBe("video");
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
    expect(text.media).toEqual({ audio: false, video: false, text: true });
  });

  /**
   * D2 : le texte n'est jamais un choix de l'appelant — il est là si le
   * compte le porte. C'est ce qui fait passer l'appel audio du profil 3c
   * et l'appel vidéo de la visiophonie à la conversation totale, sans
   * ajouter une seule entrée au menu.
   */
  it("le texte s'ajoute à tous les modes dès que le compte le porte", () => {
    const media = (rtt: "none" | "datachannel", id: string): CallMedia =>
      callModes(rtt).find((m) => m.id === id)!.media;
    expect(media("none", "audio")).toEqual({ audio: true, video: false, text: false });
    expect(media("none", "video")).toEqual({ audio: true, video: true, text: false });
    expect(media("datachannel", "audio")).toEqual({ audio: true, video: false, text: true });
    expect(media("datachannel", "video")).toEqual({ audio: true, video: true, text: true });
  });
});
