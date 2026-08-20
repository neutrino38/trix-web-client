/**
 * Le carnet d'un appel : ce qu'il garde, ce qu'il écarte, et surtout à quel
 * dialogue il rattache chaque paquet.
 *
 * Le point délicat n'est pas la collecte mais le **découpage** : le
 * REGISTER périodique passe sur le même socket que l'appel, l'INVITE
 * entrant arrive avant que le carnet n'existe, et un second INVITE refusé
 * « occupé » ne doit pas venir se mêler à la communication en cours.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  openCallTrace,
  recordFsm,
  recordPacket,
  resetCallTraces,
  type TraceLine,
} from "../src/sip/record.js";

/** Un paquet SIP en réduction : la ligne de départ, le Call-ID, et de quoi faire un corps. */
function packet(head: string, callId: string, extra = ""): string {
  return `${head}\r\nVia: SIP/2.0/WSS 1.2.3.4\r\nCall-ID: ${callId}\r\n${extra}\r\n`;
}

const INVITE_OUT = packet("INVITE sip:bob@example.fr SIP/2.0", "abc-123");
const RINGING = packet("SIP/2.0 180 Ringing", "abc-123", "CSeq: 1 INVITE\r\n");
const OK = packet("SIP/2.0 200 OK", "abc-123", "CSeq: 1 INVITE\r\n");
const REGISTER = packet("REGISTER sip:example.fr SIP/2.0", "reg-999");
const REGISTER_401 = packet("SIP/2.0 401 Unauthorized", "reg-999", "CSeq: 2 REGISTER\r\n");

/** Les entêtes gardés, dans l'ordre — ce qu'on lit d'un coup d'œil dans le popup. */
function heads(lines: TraceLine[]): string[] {
  return lines.map((l) => l.head);
}

beforeEach(() => {
  resetCallTraces();
});

describe("carnet d'un appel sortant", () => {
  it("adopte le dialogue du premier INVITE qui part, et le suit", () => {
    const book = openCallTrace(null);
    recordPacket("out", "INVITE sip:bob@example.fr SIP/2.0", INVITE_OUT);
    recordPacket("in", "SIP/2.0 180 Ringing", RINGING);
    recordPacket("in", "SIP/2.0 200 OK", OK);

    expect(heads(book.take())).toEqual([
      "INVITE sip:bob@example.fr SIP/2.0",
      "SIP/2.0 180 Ringing",
      "SIP/2.0 200 OK",
    ]);
  });

  it("écarte les REGISTER et leurs réponses : ils ne disent rien de l'appel", () => {
    const book = openCallTrace(null);
    recordPacket("out", "REGISTER sip:example.fr SIP/2.0", REGISTER);
    recordPacket("in", "SIP/2.0 401 Unauthorized", REGISTER_401);
    recordPacket("out", "INVITE sip:bob@example.fr SIP/2.0", INVITE_OUT);

    expect(heads(book.take())).toEqual(["INVITE sip:bob@example.fr SIP/2.0"]);
  });

  it("garde le paquet entier, dépliable, et son sens", () => {
    const book = openCallTrace(null);
    recordPacket("out", "INVITE sip:bob@example.fr SIP/2.0", INVITE_OUT);
    const [line] = book.take();

    expect(line).toMatchObject({ kind: "sip", way: "out", body: INVITE_OUT });
    expect(line!.at).toBeGreaterThan(0);
  });

  it("ne retient rien d'un dialogue étranger", () => {
    const book = openCallTrace(null);
    recordPacket("out", "INVITE sip:bob@example.fr SIP/2.0", INVITE_OUT);
    recordPacket("in", "OPTIONS sip:alice@example.fr SIP/2.0", packet("OPTIONS sip:alice@example.fr SIP/2.0", "autre-777"));

    expect(heads(book.take())).toEqual(["INVITE sip:bob@example.fr SIP/2.0"]);
  });
});

describe("case cochée en pleine communication", () => {
  it("le carnet se rattache au dialogue en cours, sans avoir vu l'INVITE", () => {
    // rien n'a été tracé jusqu'ici : la case vient d'être cochée
    const book = openCallTrace(null);
    recordPacket("in", "BYE sip:alice@example.fr SIP/2.0", packet("BYE sip:alice@example.fr SIP/2.0", "abc-123"));
    recordPacket("out", "SIP/2.0 200 OK", packet("SIP/2.0 200 OK", "abc-123", "CSeq: 2 BYE\r\n"));

    expect(heads(book.take())).toEqual(["BYE sip:alice@example.fr SIP/2.0", "SIP/2.0 200 OK"]);
  });

  it("n'adopte jamais un INVITE reçu : c'est l'appel de quelqu'un d'autre", () => {
    const book = openCallTrace(null);
    recordPacket("in", "INVITE sip:alice@example.fr SIP/2.0", packet("INVITE sip:alice@example.fr SIP/2.0", "in-42"));
    recordPacket("out", "SIP/2.0 180 Ringing", packet("SIP/2.0 180 Ringing", "in-42", "CSeq: 1 INVITE\r\n"));

    expect(book.take()).toEqual([]);
  });

  it("n'adopte pas non plus un dialogue hors appel (OPTIONS du proxy)", () => {
    const book = openCallTrace(null);
    recordPacket("in", "OPTIONS sip:alice@example.fr SIP/2.0", packet("OPTIONS sip:alice@example.fr SIP/2.0", "opt-9"));

    expect(book.take()).toEqual([]);
  });
});

describe("carnet d'un appel entrant", () => {
  it("rattrape l'INVITE passé avant son ouverture", () => {
    // l'INVITE entrant est ce qui déclenche l'appel : il précède le carnet
    recordPacket("in", "INVITE sip:alice@example.fr SIP/2.0", packet("INVITE sip:alice@example.fr SIP/2.0", "in-42"));
    const book = openCallTrace("in-42");
    recordPacket("out", "SIP/2.0 200 OK", packet("SIP/2.0 200 OK", "in-42", "CSeq: 1 INVITE\r\n"));

    expect(heads(book.take())).toEqual([
      "INVITE sip:alice@example.fr SIP/2.0",
      "SIP/2.0 200 OK",
    ]);
  });

  it("un second INVITE refusé « occupé » n'entre pas dans le carnet en cours", () => {
    const book = openCallTrace(null);
    recordPacket("out", "INVITE sip:bob@example.fr SIP/2.0", INVITE_OUT);
    // arrive pendant la communication : le port ne l'écoute pas, aucun carnet
    // ne s'ouvre pour lui (port.ts n'ouvre que dans listen())
    recordPacket("in", "INVITE sip:alice@example.fr SIP/2.0", packet("INVITE sip:alice@example.fr SIP/2.0", "busy-2"));
    recordPacket("out", "SIP/2.0 486 Busy Here", packet("SIP/2.0 486 Busy Here", "busy-2", "CSeq: 1 INVITE\r\n"));

    expect(heads(book.take())).toEqual(["INVITE sip:bob@example.fr SIP/2.0"]);
  });
});

describe("états de la machine", () => {
  it("s'intercalent entre les paquets, dans l'ordre où ils sont passés", () => {
    const book = openCallTrace(null);
    recordPacket("out", "INVITE sip:bob@example.fr SIP/2.0", INVITE_OUT);
    recordFsm("(CallBlock/initial_state) → (CallBlock/dialing) \"INVITE sortant\"");
    recordPacket("in", "SIP/2.0 180 Ringing", RINGING);

    const lines = book.take();
    expect(lines.map((l) => l.kind)).toEqual(["sip", "fsm", "sip"]);
    expect(lines[1]!.body).toBeUndefined();
  });

  it("vont au carnet ouvert le plus récent — un seul appel est suivi à la fois", () => {
    const first = openCallTrace("a");
    const second = openCallTrace("b");
    recordFsm("transition");

    expect(second.take()).toHaveLength(1);
    expect(first.take()).toHaveLength(0);
  });
});

describe("plafonds", () => {
  it("coupe un corps trop long et le signale", () => {
    const huge = packet("INVITE sip:bob@example.fr SIP/2.0", "abc-123", "x".repeat(8000));
    const book = openCallTrace(null);
    recordPacket("out", "INVITE sip:bob@example.fr SIP/2.0", huge);

    const [line] = book.take();
    expect(line!.clipped).toBe(true);
    expect(line!.body!.length).toBeLessThan(huge.length);
  });

  it("s'arrête au plafond de l'appel et marque la coupure", () => {
    const book = openCallTrace(null);
    recordPacket("out", "INVITE sip:bob@example.fr SIP/2.0", INVITE_OUT);
    // 4 Ko par paquet, 64 Ko de plafond : le carnet cède avant le 20ᵉ
    const big = packet("SIP/2.0 200 OK", "abc-123", `CSeq: 1 INVITE\r\n${"y".repeat(4000)}`);
    for (let i = 0; i < 30; i++) recordPacket("in", "SIP/2.0 200 OK", big);

    const lines = book.take();
    expect(lines.length).toBeLessThan(31);
    expect(lines[lines.length - 1]!.kind).toBe("cut");
  });

  it("ne collecte plus rien une fois le carnet repris", () => {
    const book = openCallTrace(null);
    recordPacket("out", "INVITE sip:bob@example.fr SIP/2.0", INVITE_OUT);
    const lines = book.take();
    recordPacket("in", "SIP/2.0 200 OK", OK);

    expect(lines).toHaveLength(1);
    expect(book.take()).toHaveLength(1);
  });
});
