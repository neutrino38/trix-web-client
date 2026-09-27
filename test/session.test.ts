/**
 * L'état de session hors coffre (ADR 0006, SC-1).
 *
 * Ce qui se vérifie ici n'est pas le round-trip — trois lignes de
 * `localStorage` — mais la **tolérance** : ce module est lu au moment
 * précis où le reste peut avoir échoué (coffre illisible, stockage refusé
 * en navigation privée), et il n'a le droit de faire échouer personne.
 * Une valeur absente, illisible ou absurde doit se comporter comme si
 * rien n'avait jamais été écrit, et une écriture impossible doit passer
 * en silence.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  alertPosted,
  lastReachableAt,
  markReachable,
  pinHintShown,
  resumeAccount,
  setAlertPosted,
  setPinHintShown,
  setResumeAccount,
  setStatusPrefs,
  statusPrefs,
  DEFAULT_STATUS,
} from "../src/storage/session.js";

/** localStorage minimal, en mémoire. */
function stubStorage(initial: Record<string, string> = {}): Map<string, string> {
  const data = new Map(Object.entries(initial));
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => data.set(k, v),
      removeItem: (k: string) => data.delete(k),
    },
  });
  return data;
}

/** Le stockage d'une fenêtre privée : il existe, et il refuse tout. */
function stubBrokenStorage(): void {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem() {
        throw new DOMException("refusé");
      },
      setItem() {
        throw new DOMException("quota");
      },
      removeItem() {
        throw new DOMException("refusé");
      },
    },
  });
}

/** Aucun stockage du tout : `localStorage` n'est même pas défini. */
function stubNoStorage(): void {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: undefined,
  });
}

describe("état de session — le compte à reprendre", () => {
  beforeEach(() => stubStorage());

  it("n'a rien à reprendre tant que rien n'a été posé", () => {
    expect(resumeAccount()).toBeNull();
  });

  it("retient l'identifiant posé, et l'oublie sur demande", () => {
    setResumeAccount("acc-42");
    expect(resumeAccount()).toBe("acc-42");
    setResumeAccount(null);
    expect(resumeAccount()).toBeNull();
  });
});

describe("état de session — le dernier instant joignable", () => {
  beforeEach(() => stubStorage());

  it("relit l'horodatage écrit", () => {
    markReachable(1_700_000_000_000);
    expect(lastReachableAt()).toBe(1_700_000_000_000);
  });

  it("horodate l'instant présent par défaut", () => {
    const before = Date.now();
    markReachable();
    expect(lastReachableAt()).toBeGreaterThanOrEqual(before);
  });

  it.each(["", "hier", "NaN", "0", "-1"])(
    "traite une valeur illisible (%s) comme une valeur absente",
    (raw) => {
      stubStorage({ "trix-reachable": raw });
      // sans quoi le message d'après-déchargement annoncerait une absence
      // commencée le 1er janvier 1970
      expect(lastReachableAt()).toBeNull();
    },
  );
});

describe("état de session — les deux marqueurs booléens", () => {
  beforeEach(() => stubStorage());

  it("l'alerte d'absence se pose et se solde", () => {
    expect(alertPosted()).toBe(false);
    setAlertPosted(true);
    expect(alertPosted()).toBe(true);
    setAlertPosted(false);
    expect(alertPosted()).toBe(false);
  });

  it("le rappel sur l'épinglage ne se montre qu'une fois", () => {
    expect(pinHintShown()).toBe(false);
    setPinHintShown();
    expect(pinHintShown()).toBe(true);
  });
});

describe("état de session — le statut de présence (ADR 0007, D5)", () => {
  it("par défaut : disponible, sans note, les deux règles cochées", () => {
    stubStorage();
    expect(statusPrefs("acc")).toEqual(DEFAULT_STATUS);
  });

  it("round-trip, compte par compte", () => {
    stubStorage();
    const prefs = { chosen: "dnd", note: "Réunion", onThePhone: false, awayWhenIdle: true } as const;
    setStatusPrefs("acc", prefs);
    expect(statusPrefs("acc")).toEqual(prefs);
    expect(statusPrefs("autre")).toEqual(DEFAULT_STATUS);
  });

  it("un champ illisible retombe sur son défaut sans emporter les autres", () => {
    stubStorage({
      "trix-status:acc": JSON.stringify({ chosen: "sieste", note: "  ", onThePhone: false, awayWhenIdle: "oui" }),
    });
    expect(statusPrefs("acc")).toEqual({ ...DEFAULT_STATUS, onThePhone: false });
  });

  it("une valeur qui n'est pas du JSON vaut une valeur absente", () => {
    stubStorage({ "trix-status:acc": "{pas du json" });
    expect(statusPrefs("acc")).toEqual(DEFAULT_STATUS);
  });

  it.each([
    ["refusé", stubBrokenStorage],
    ["absent", stubNoStorage],
  ])("stockage %s : les défauts, et l'écriture passe en silence", (_, stub) => {
    stub();
    expect(() => setStatusPrefs("acc", { ...DEFAULT_STATUS, chosen: "busy" })).not.toThrow();
    expect(statusPrefs("acc")).toEqual(DEFAULT_STATUS);
  });
});

describe("état de session — stockage indisponible", () => {
  for (const [name, stub] of [
    ["un stockage qui refuse tout", stubBrokenStorage],
    ["pas de stockage du tout", stubNoStorage],
  ] as const) {
    describe(name, () => {
      beforeEach(() => stub());

      it("se lit comme si rien n'avait été écrit", () => {
        expect(resumeAccount()).toBeNull();
        expect(lastReachableAt()).toBeNull();
        expect(alertPosted()).toBe(false);
        expect(pinHintShown()).toBe(false);
      });

      it("s'écrit sans rien faire échouer", () => {
        expect(() => {
          setResumeAccount("acc-42");
          setResumeAccount(null);
          markReachable();
          setAlertPosted(true);
          setPinHintShown();
        }).not.toThrow();
      });
    });
  }
});
