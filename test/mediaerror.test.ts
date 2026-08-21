/**
 * Les échecs WebRTC : ce que le port en dit, et où il le dit.
 *
 * Le point à tenir n'est pas le formatage mais la **garantie** : quoi que
 * JsSIP transmette — une `DOMException`, une chaîne, un objet quelconque,
 * rien du tout —, il en sort une ligne de console et une ligne de carnet,
 * sans que la trace SIP ait eu besoin d'être cochée.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { describeMediaError, reportMediaError, type ErrorSink } from "../src/sip/mediaerror.js";
import { openCallTrace, resetCallTraces, type TraceLine } from "../src/sip/record.js";

/** Le puits d'erreurs, en réduction : ce qu'un développeur lit dans la console. */
function sink(): ErrorSink & { lines: { text: string; detail: unknown }[] } {
  const lines: { text: string; detail: unknown }[] = [];
  return { lines, error: (text, detail) => void lines.push({ text, detail }) };
}

beforeEach(() => {
  resetCallTraces();
});

describe("describeMediaError", () => {
  it("garde le nom de l'exception devant son message : il nomme la famille d'échec", () => {
    const error = new DOMException("Failed to set remote offer sdp", "OperationError");
    const f = describeMediaError("setRemoteDescription", error);

    expect(f.message).toBe("OperationError: Failed to set remote offer sdp");
    expect(f.detail).toBe("setRemoteDescription : OperationError: Failed to set remote offer sdp");
  });

  it("abrège le détail, jamais le message : le motif tient dans une ligne d'historique", () => {
    const f = describeMediaError("createAnswer", new Error("x".repeat(400)));

    expect(f.message.length).toBeGreaterThan(400);
    expect(f.detail.length).toBeLessThan(240);
    expect(f.detail.endsWith("…")).toBe(true);
  });

  it("accepte ce qui n'est pas une erreur — chaîne, objet, rien", () => {
    expect(describeMediaError("getUserMedia", "NotAllowedError").message).toBe("NotAllowedError");
    expect(describeMediaError("getUserMedia", { message: "device in use" }).message).toBe(
      "device in use",
    );
    expect(describeMediaError("getUserMedia", undefined).message).toBe("erreur sans détail");
  });
});

describe("reportMediaError", () => {
  it("écrit sur la console, avec l'objet d'origine pour la pile", () => {
    const s = sink();
    const error = new DOMException("Called with SDP without ice-ufrag", "OperationError");
    reportMediaError("setRemoteDescription", error, s);

    expect(s.lines).toHaveLength(1);
    expect(s.lines[0]!.text).toContain("setRemoteDescription");
    expect(s.lines[0]!.text).toContain("Called with SDP without ice-ufrag");
    expect(s.lines[0]!.detail).toBe(error);
  });

  it("entre au carnet de l'appel sans que la trace soit cochée", () => {
    const book = openCallTrace("call-42");
    reportMediaError("setRemoteDescription", new Error("SDP refusé"), sink());

    const lines: TraceLine[] = book.take();
    expect(lines).toHaveLength(1);
    expect(lines[0]!.kind).toBe("err");
    expect(lines[0]!.head).toContain("setRemoteDescription");
    // le carnet garde le message entier, lui : c'est ce qui part au support
    expect(lines[0]!.body).toContain("SDP refusé");
  });
});
