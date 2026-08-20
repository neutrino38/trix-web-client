/**
 * Les traces d'erreur : ce qui doit partir sur la console, et — tout
 * aussi important — ce qui ne doit pas. Le puits est injecté, on lit donc
 * exactement les lignes qu'un développeur verrait.
 */
import { describe, expect, it } from "vitest";
import { defineMachine, goto, stay } from "finite-state-language";
import { machineLogger, watchMachine, type Diagnosable, type Sink } from "../src/ui/diagnostics.js";
import { useLocale } from "../src/i18n/index.js";
import { msg, type Msg } from "../src/i18n/types.js";

// les traces sortent traduites, comme l'écran : un rapport de bug reste
// lisible par celui qui l'a produit
await useLocale("fr");

function fakeSink() {
  const lines = { error: [] as string[], warn: [] as string[], debug: [] as string[] };
  const sink: Sink = {
    error: (m) => lines.error.push(m),
    warn: (m) => lines.warn.push(m),
    debug: (m) => lines.debug.push(m),
  };
  return { sink, lines };
}

interface Ctx {
  lastError: Msg | null;
  lastErrorCode: string | null;
  callError: Msg | null;
}

type Ev =
  | { type: "boom" }
  | { type: "fail" }
  | { type: "again" }
  | { type: "clear" }
  | { type: "ok" }
  | { type: "inconnu" };

const Machine = defineMachine<Ctx, Ev>()({
  name: "TestMachine",
  context: () => ({ lastError: null, lastErrorCode: null, callError: null }),
  states: {
    initial_state: {
      on: {
        fail: (_ev, ctx) => {
          ctx.lastError = msg("error.proxyLost");
          ctx.lastErrorCode = "WSS_LOST";
          return goto("down");
        },
        boom: () => {
          throw new Error("handler cassé");
        },
        ok: () => stay("rien à signaler"),
        clear: (_ev, ctx) => {
          ctx.callError = msg("reason.sip", { cause: "Busy Here", code: 486 });
          return stay("appel refusé");
        },
      },
    },
    down: {
      on: {
        again: () => stay("toujours en panne"),
      },
    },
  },
});

/** Laisse passer la microtask d'inspection. */
const tick = () => Promise.resolve();

describe("traces d'erreur des automates", () => {
  it("signale une erreur métier une seule fois, avec son code et son état", async () => {
    const { sink, lines } = fakeSink();
    const m = Machine.start();
    watchMachine(m as unknown as Diagnosable, sink);

    m.send({ type: "fail" });
    await tick();
    expect(lines.error).toHaveLength(1);
    expect(lines.error[0]).toContain("Connexion au proxy perdue");
    expect(lines.error[0]).toContain("WSS_LOST");
    expect(lines.error[0]).toContain("(sur fail)");

    // l'erreur reste dans le contexte : elle ne doit pas être répétée à
    // chaque transition suivante
    m.send({ type: "again" });
    await tick();
    expect(lines.error).toHaveLength(1);
  });

  it("signale un échec d'appel", async () => {
    const { sink, lines } = fakeSink();
    const m = Machine.start();
    watchMachine(m as unknown as Diagnosable, sink);

    m.send({ type: "clear" });
    await tick();
    expect(lines.error[0]).toContain("appel échoué : Busy Here (SIP 486)");
  });

  it("signale un événement resté en file d'attente", async () => {
    const { sink, lines } = fakeSink();
    const m = Machine.start();
    watchMachine(m as unknown as Diagnosable, sink);

    // `again` n'est pas écouté par initial_state : il est mis en attente
    m.send({ type: "again" });
    m.send({ type: "clear" });
    await tick();
    expect(lines.warn.join("\n")).toContain("événement non consommé en initial_state : again");
  });

  it("signale la mort de la machine avec le journal des transitions", async () => {
    const { sink, lines } = fakeSink();
    const m = Machine.start();
    watchMachine(m as unknown as Diagnosable, sink);

    m.send({ type: "boom" });
    await m.done;
    await tick();

    const death = lines.error.find((l) => l.includes("automate arrêté"));
    expect(death).toBeDefined();
    expect(death).toContain("failure");
    expect(death).toContain("handler cassé");
    // le journal accompagne la mort : on veut savoir d'où elle vient
    expect(death).toContain("(initial_state)");
  });

  it("ne dit rien quand tout va bien", async () => {
    const { sink, lines } = fakeSink();
    const m = Machine.start();
    watchMachine(m as unknown as Diagnosable, sink);

    m.send({ type: "ok" });
    await tick();
    expect(lines.error).toEqual([]);
    expect(lines.warn).toEqual([]);
  });

  it("le logger sépare les transitions (debug) des défauts du moteur (error)", () => {
    const { sink, lines } = fakeSink();
    const log = machineLogger(() => null, sink);

    log("fail: (initial_state) -> (down)");
    log("[TestMachine] exception in state 'initial_state': Error: handler cassé");

    expect(lines.debug).toHaveLength(1);
    expect(lines.error).toHaveLength(1);
    expect(lines.error[0]).toContain("exception in state");
  });
});
