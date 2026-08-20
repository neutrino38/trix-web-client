/**
 * Saisie des serveurs ICE : normalisation de l'hôte, dérivation du
 * schéma (`stun:`, `turn:`, `turns:`) et validation du formulaire.
 */
import { describe, expect, it } from "vitest";
import {
  iceServers,
  parseIceForm,
  parseIceHost,
  turnUrl,
  NO_ICE,
  type IceConfig,
  type IceForm,
} from "../src/sip/ice.js";

const FORM: IceForm = {
  stun: "",
  turn: "",
  turnUsername: "",
  turnPassword: null,
  turnTls: false,
};

describe("parseIceHost", () => {
  it("accepte hôte seul et hôte:port", () => {
    expect(parseIceHost("stun.example.fr")).toBe("stun.example.fr");
    expect(parseIceHost(" turn.example.fr:3478 ")).toBe("turn.example.fr:3478");
    expect(parseIceHost("192.168.1.10:3478")).toBe("192.168.1.10:3478");
    expect(parseIceHost("[2001:db8::1]:3478")).toBe("[2001:db8::1]:3478");
  });

  it("retire un schéma collé depuis une documentation, et le transport", () => {
    expect(parseIceHost("stun:stun.example.fr:3478")).toBe("stun.example.fr:3478");
    expect(parseIceHost("turns:turn.example.fr:5349?transport=tcp")).toBe("turn.example.fr:5349");
  });

  it("refuse ce qui n'est pas un hôte", () => {
    expect(parseIceHost("")).toBeNull();
    expect(parseIceHost("   ")).toBeNull();
    expect(parseIceHost("turn.example.fr/chemin")).toBeNull();
    expect(parseIceHost("deux hôtes")).toBeNull();
    expect(parseIceHost("turn.example.fr:port")).toBeNull();
  });
});

describe("iceServers", () => {
  it("rien de configuré : aucune entrée", () => {
    expect(iceServers(NO_ICE)).toEqual([]);
  });

  it("STUN seul", () => {
    expect(iceServers({ stun: "stun.example.fr:3478", turn: null })).toEqual([
      { urls: "stun:stun.example.fr:3478" },
    ]);
  });

  it("TURN en clair : schéma turn:, identifiants portés", () => {
    const ice: IceConfig = {
      stun: null,
      turn: { host: "turn.example.fr:3478", username: "alice", password: "s3cr3t", tls: false },
    };
    expect(iceServers(ice)).toEqual([
      { urls: "turn:turn.example.fr:3478", username: "alice", credential: "s3cr3t" },
    ]);
  });

  it("TURN sur TLS : schéma turns: et transport TCP", () => {
    const turn = { host: "turn.example.fr:5349", username: "alice", password: "s3cr3t", tls: true };
    expect(turnUrl(turn)).toBe("turns:turn.example.fr:5349?transport=tcp");
    expect(iceServers({ stun: "stun.example.fr", turn })).toHaveLength(2);
  });
});

describe("parseIceForm", () => {
  it("champs vides : aucun serveur (réglage facultatif)", () => {
    expect(parseIceForm(FORM, null)).toEqual({ ok: true, ice: { stun: null, turn: null } });
  });

  it("STUN invalide : erreur qui désigne le champ", () => {
    const r = parseIceForm({ ...FORM, stun: "stun.example.fr/ws" }, null);
    expect(r).toMatchObject({ ok: false, field: "stun" });
  });

  it("TURN complet, TLS coché", () => {
    const r = parseIceForm(
      { stun: "stun.example.fr", turn: "turn.example.fr:5349", turnUsername: "alice", turnPassword: "s3cr3t", turnTls: true },
      null,
    );
    expect(r).toEqual({
      ok: true,
      ice: {
        stun: "stun.example.fr",
        turn: { host: "turn.example.fr:5349", username: "alice", password: "s3cr3t", tls: true },
      },
    });
  });

  it("TURN sans identifiant ou sans mot de passe : refusé", () => {
    expect(
      parseIceForm({ ...FORM, turn: "turn.example.fr", turnPassword: "x" }, null),
    ).toMatchObject({ ok: false, field: "turn" });
    expect(
      parseIceForm({ ...FORM, turn: "turn.example.fr", turnUsername: "alice" }, null),
    ).toMatchObject({ ok: false, field: "turn" });
  });

  it("mot de passe laissé vide : repris du compte pour le même serveur", () => {
    const previous: IceConfig = {
      stun: null,
      turn: { host: "turn.example.fr", username: "alice", password: "s3cr3t", tls: false },
    };
    const r = parseIceForm(
      { ...FORM, turn: "turn.example.fr", turnUsername: "alice", turnTls: true },
      previous,
    );
    expect(r).toEqual({
      ok: true,
      ice: {
        stun: null,
        turn: { host: "turn.example.fr", username: "alice", password: "s3cr3t", tls: true },
      },
    });
  });

  it("mot de passe vide mais serveur ou identifiant changé : il faut le ressaisir", () => {
    const previous: IceConfig = {
      stun: null,
      turn: { host: "turn.example.fr", username: "alice", password: "s3cr3t", tls: false },
    };
    expect(
      parseIceForm({ ...FORM, turn: "autre.example.fr", turnUsername: "alice" }, previous),
    ).toMatchObject({ ok: false, field: "turn" });
    expect(
      parseIceForm({ ...FORM, turn: "turn.example.fr", turnUsername: "bob" }, previous),
    ).toMatchObject({ ok: false, field: "turn" });
  });

  it("serveur TURN effacé : les identifiants restants sont ignorés", () => {
    const r = parseIceForm({ ...FORM, turnUsername: "alice", turnPassword: "s3cr3t" }, null);
    expect(r).toEqual({ ok: true, ice: { stun: null, turn: null } });
  });
});
