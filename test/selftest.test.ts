/**
 * L'autotest micro / caméra hors appel (ADR 0003 §4 — F.703 §4.4 note).
 *
 * Ce qui se vérifie ici est ce que le typage ne dit pas, et qui décide de
 * l'utilité du test : **une caméra manquante ne doit pas emporter le
 * micro**. C'est le principe du §5.1.2.2 — dégrader, jamais refuser —
 * appliqué à un écran de réglages ; et un refus de permission, lui, vaut
 * pour les deux périphériques, donc ne se redemande pas.
 *
 * Le reste (l'aperçu, la barre de niveau) est du DOM et se regarde à
 * l'écran ; les phrases, elles, sont ce que l'utilisateur aura pour agir.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";
import { openSelfTestMedia, selfTestReason } from "../src/ui/selftest.js";
import { useLocale } from "../src/i18n/index.js";

beforeAll(async () => {
  await useLocale("fr");
});

/** Un `navigator.mediaDevices` de laboratoire : il note ce qu'on lui demande. */
function stubMedia(answer: (c: MediaStreamConstraints) => unknown): {
  asked: MediaStreamConstraints[];
} {
  const asked: MediaStreamConstraints[] = [];
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: (c: MediaStreamConstraints) => {
        asked.push(c);
        const out = answer(c);
        return out instanceof Error ? Promise.reject(out) : Promise.resolve(out);
      },
    },
  });
  return { asked };
}

const fakeStream = (): MediaStream => ({ getTracks: () => [] }) as unknown as MediaStream;

describe("autotest micro et caméra", () => {
  it("demande les deux, et n'insiste pas quand les deux sont là", async () => {
    const { asked } = stubMedia(() => fakeStream());
    const { videoOnly } = await openSelfTestMedia();
    expect(asked).toEqual([{ audio: true, video: true }]);
    expect(videoOnly).toBe(false);
    vi.unstubAllGlobals();
  });

  it("sans caméra, teste le micro seul plutôt que de ne rien tester", async () => {
    const { asked } = stubMedia((c) =>
      c.video ? new DOMException("no camera", "NotFoundError") : fakeStream(),
    );
    const { videoOnly } = await openSelfTestMedia();
    expect(asked).toEqual([{ audio: true, video: true }, { audio: true }]);
    expect(videoOnly).toBe(true);
    vi.unstubAllGlobals();
  });

  it("une permission refusée ne se redemande pas : le second refus effacerait le premier", async () => {
    const { asked } = stubMedia(() => new DOMException("denied", "NotAllowedError"));
    await expect(openSelfTestMedia()).rejects.toBeInstanceOf(DOMException);
    expect(asked).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it("dit quoi faire, et non ce qui a échoué", () => {
    expect(selfTestReason(new DOMException("x", "NotAllowedError"))).toContain("Autorisez");
    expect(selfTestReason(new DOMException("x", "NotFoundError"))).toContain("Aucun micro");
    expect(selfTestReason(new DOMException("x", "NotReadableError"))).toContain(
      "déjà utilisé par une autre application",
    );
    // cause inconnue : le texte du navigateur est ce qui nommera la vraie
    // raison dans un rapport de support, il est rendu tel quel
    expect(selfTestReason(new Error("boom"))).toContain("boom");
  });
});
