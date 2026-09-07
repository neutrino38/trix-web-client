/**
 * Les échecs WebRTC : ce que le port en dit, et où il le dit.
 *
 * Le point à tenir n'est pas le formatage mais la **garantie** : quoi que
 * JsSIP transmette — une `DOMException`, une chaîne, un objet quelconque,
 * rien du tout —, il en sort une ligne de console et une ligne de carnet,
 * sans que la trace SIP ait eu besoin d'être cochée.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  certificateFault,
  describeMediaError,
  reportMediaError,
  reportTextChannelError,
  type ErrorSink,
} from "../src/sip/mediaerror.js";
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

/**
 * Le canal texte T.140 : la même garantie, pour une panne qui n'a
 * absolument rien d'autre pour se dire — pas de paquet SIP, pas de
 * renégociation, rien qu'un panneau de tchat devenu muet.
 */
describe("reportTextChannelError", () => {
  it("dit la panne même quand le navigateur n'a donné aucune erreur", () => {
    const s = sink();
    const book = openCallTrace("call-t140");
    reportTextChannelError({ problem: "aucun canal t140 ouvert", notes: { "rôle": "answer" } }, s);

    expect(s.lines).toHaveLength(1);
    expect(s.lines[0]!.text).toContain("aucun canal t140 ouvert");
    expect(s.lines[0]!.text).toContain("rôle : answer");
    // rien à déplier : pas d'objet d'erreur, donc pas de second argument
    expect(s.lines[0]!.detail).toBeUndefined();

    const lines: TraceLine[] = book.take();
    expect(lines).toHaveLength(1);
    expect(lines[0]!.kind).toBe("err");
    expect(lines[0]!.head).toBe("Canal texte T.140 : aucun canal t140 ouvert");
  });

  it("garde l'erreur technique entière au carnet, entête sur une ligne", () => {
    const book = openCallTrace("call-t140");
    const error = Object.assign(new DOMException("Data channel failure", "OperationError"), {
      errorDetail: "sctp-failure",
      sctpCauseCode: 12,
    });
    reportTextChannelError({ problem: "erreur sur le canal", error }, sink());

    const lines: TraceLine[] = book.take();
    expect(lines[0]!.head).toBe(
      "Canal texte T.140 : erreur sur le canal : OperationError: Data channel failure",
    );
    expect(lines[0]!.body).toContain("errorDetail : sctp-failure");
    expect(lines[0]!.body).toContain("sctpCauseCode : 12");
  });
});

/**
 * **Le certificat du serveur, quand le navigateur veut bien le dire.**
 *
 * Une poignée de main DTLS ratée se solde par une alerte TLS numérotée, et
 * WebRTC est le seul endroit où le navigateur nous la rend (`RTCError`).
 * Ce qui se vérifie ici est la lecture de cette alerte — et surtout le
 * **sens** : celle qu'on envoie rejette le certificat d'en face, celle
 * qu'on reçoit rejette le nôtre. Les confondre enverrait le support
 * réparer le mauvais serveur.
 */
describe("certificateFault", () => {
  it("nomme un certificat expiré, et dit que c'est nous qui l'avons refusé", () => {
    expect(certificateFault({ errorDetail: "dtls-failure", sentAlert: 45 })).toBe(
      "certificat du serveur expiré, refusé par ce poste (alerte 45 certificate_expired)",
    );
  });

  it("distingue un certificat invalide d'un certificat expiré", () => {
    expect(certificateFault({ sentAlert: 48 })).toContain("certificat du serveur invalide");
    expect(certificateFault({ sentAlert: 48 })).toContain("alerte 48 unknown_ca");
  });

  it("une alerte reçue met en cause le nôtre", () => {
    expect(certificateFault({ receivedAlert: 42 })).toBe(
      "notre certificat refusé par le serveur (alerte 42 bad_certificate)",
    );
  });

  it("ne met pas le certificat en cause pour une alerte qui n'en parle pas", () => {
    // 51 accompagne le plus souvent une empreinte SDP qui ne correspond pas
    expect(certificateFault({ sentAlert: 51 })).toBeNull();
    expect(certificateFault({ sentAlert: 40 })).toBeNull();
    expect(certificateFault(new Error("échec DTLS"))).toBeNull();
    expect(certificateFault(undefined)).toBeNull();
  });

  it("le verdict rejoint l'entête du carnet, pas seulement la console", () => {
    const book = openCallTrace("call-t140");
    reportTextChannelError(
      { problem: "échec de la poignée de main DTLS", error: { sentAlert: 45 } },
      sink(),
    );

    const lines: TraceLine[] = book.take();
    expect(lines[0]!.head).toContain("échec de la poignée de main DTLS");
    expect(lines[0]!.head).toContain("certificat du serveur expiré");
  });
});
