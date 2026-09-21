/**
 * La joignabilité (ADR 0006, D1, D2 et D8).
 *
 * Quatre règles y sont des décisions, pas des détails d'implémentation, et
 * aucune ne se voit à la compilation :
 *
 * - le niveau se **dérive** de l'état de la machine, et rien ne produit
 *   `deferred` tant que le push n'existe pas (D1) ;
 * - la notification attend **10 s** d'injoignabilité continue, et ne part
 *   que sur un onglet caché — sans ce seuil, une reconnexion de trois
 *   secondes réveillerait tout le monde (D2) ;
 * - une absence qui a été annoncée **doit** être soldée, sur le même tag :
 *   c'est le seul moyen d'effacer une alerte `requireInteraction` devenue
 *   fausse, et la seule façon qu'une personne sourde sache que Trix est
 *   revenu (D8) ;
 * - rien ne s'annonce tant que personne n'a demandé à être joignable :
 *   l'accueil et un formulaire ouvert ne sont pas des pannes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocale } from "../src/i18n/index.js";

interface PostedNotification {
  title: string;
  tag?: string;
  requireInteraction?: boolean;
  closed: boolean;
}

let posted: PostedNotification[] = [];
let listeners: Map<string, ((e: unknown) => void)[]>;

/**
 * Le minimum de navigateur dont dépend `ui/reachability.ts` : de quoi
 * écrire un titre, une icône, une notification, et de quoi savoir si
 * l'onglet est visible.
 */
function stubBrowser(opts: {
  visible?: boolean;
  wasDiscarded?: boolean;
  stored?: Record<string, string>;
  permission?: string;
  online?: boolean;
}): Map<string, string> {
  posted = [];
  listeners = new Map();
  const data = new Map(Object.entries(opts.stored ?? {}));
  const icon = {
    rel: "",
    href: "/trix-favicon.svg",
    getAttribute: (k: string) => (k === "href" ? icon.href : null),
    remove: () => {},
  };
  const doc = {
    title: "",
    visibilityState: opts.visible === false ? "hidden" : "visible",
    wasDiscarded: opts.wasDiscarded === true,
    documentElement: { lang: "", dir: "", dataset: {} as Record<string, string> },
    head: { append: () => {} },
    body: { append: () => {} },
    createElement: () => icon,
    querySelector: (sel: string) => (sel === 'link[rel="icon"]' ? icon : null),
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    removeEventListener: () => {},
  };
  const define = (name: string, value: unknown): void => {
    Object.defineProperty(globalThis, name, { configurable: true, value });
  };
  define("document", doc);
  // les écouteurs de fenêtre (`pagehide`) partagent le même registre : ce
  // qui compte dans ces tests est qu'ils se posent, pas où
  define("addEventListener", doc.addEventListener);
  define("removeEventListener", doc.removeEventListener);
  define("window", { focus: () => {} });
  define("navigator", { onLine: opts.online !== false, languages: ["fr"], language: "fr" });
  define("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => data.set(k, v),
    removeItem: (k: string) => data.delete(k),
  });
  define(
    "Notification",
    class {
      static permission = opts.permission ?? "granted";
      onclick: (() => void) | null = null;
      private readonly mine: PostedNotification;
      constructor(title: string, options: NotificationOptions = {}) {
        this.mine = { title, tag: options.tag, requireInteraction: options.requireInteraction, closed: false };
        posted.push(this.mine);
      }
      close(): void {
        this.mine.closed = true;
      }
    },
  );
  return data;
}

/** Fait partir un événement de page sur les écouteurs posés par le module. */
function fire(type: string, event: unknown = {}): void {
  for (const fn of listeners.get(type) ?? []) fn(event);
}

/** La machine, réduite à ce que la joignabilité lui demande : un état, et un abonnement. */
function fakePhone(state: string) {
  const subs: (() => void)[] = [];
  return {
    get state() {
      return state;
    },
    subscribe(fn: () => void) {
      subs.push(fn);
      return () => {};
    },
    /** Change d'état et prévient, comme le ferait une transition. */
    goto(next: string) {
      state = next;
      for (const fn of subs) fn();
    },
  };
}

/** Le module, rechargé à neuf : il lit `document.wasDiscarded` à son import. */
async function loadModule() {
  vi.resetModules();
  return import("../src/ui/reachability.js");
}

/** L'onglet passe en arrière-plan, comme le ferait un changement d'onglet. */
function hide(): void {
  (document as unknown as { visibilityState: string }).visibilityState = "hidden";
  fire("visibilitychange");
}

const UNREACHABLE = ["connecting", "registering", "reconnecting", "sleeping", "reg_failed", "home"];

beforeEach(async () => {
  vi.useFakeTimers();
  await useLocale("fr");
});

afterEach(() => {
  vi.useRealTimers();
  for (const name of [
    "document",
    "navigator",
    "localStorage",
    "Notification",
    "addEventListener",
    "removeEventListener",
    "window",
  ]) {
    Reflect.deleteProperty(globalThis, name);
  }
});

describe("niveaux de joignabilité (D1)", () => {
  it("seuls `ready` et `in_call` sont joignables", async () => {
    stubBrowser({});
    const { reachabilityOf } = await loadModule();
    expect(reachabilityOf("ready")).toBe("direct");
    expect(reachabilityOf("in_call")).toBe("direct");
    for (const state of UNREACHABLE) expect(reachabilityOf(state)).toBe("none");
  });

  it("rien ne produit `deferred` tant que le push n'existe pas", async () => {
    stubBrowser({});
    const { reachabilityOf } = await loadModule();
    const levels = ["ready", "in_call", ...UNREACHABLE].map(reachabilityOf);
    expect(levels).not.toContain("deferred");
  });

  it("la phrase ne se dit que si l'on avait demandé à être joignable", async () => {
    stubBrowser({ stored: {} });
    const { reachSentence } = await loadModule();
    // personne n'a demandé : l'accueil n'est pas une panne
    expect(reachSentence("reconnecting")).toBeNull();
    stubBrowser({ stored: { "trix-resume": "acc-1" } });
    const withMarker = await loadModule();
    expect(withMarker.reachSentence("reconnecting")).toBe("reach.none");
    expect(withMarker.reachSentence("ready")).toBeNull();
  });
});

describe("seuil de 10 s avant d'alerter (D2)", () => {
  it("n'alerte pas pour une reconnexion de trois secondes", async () => {
    stubBrowser({ visible: false, stored: { "trix-resume": "acc-1" } });
    const { watchReachability } = await loadModule();
    const phone = fakePhone("reconnecting");
    watchReachability(phone as never);
    vi.advanceTimersByTime(3000);
    phone.goto("ready");
    vi.advanceTimersByTime(60_000);
    expect(posted).toHaveLength(0);
  });

  it("alerte une seule fois, passé les 10 s, sur un onglet caché", async () => {
    stubBrowser({ visible: false, stored: { "trix-resume": "acc-1" } });
    const { watchReachability } = await loadModule();
    const phone = fakePhone("sleeping");
    watchReachability(phone as never);
    vi.advanceTimersByTime(9000);
    expect(posted).toHaveLength(0);
    vi.advanceTimersByTime(2000);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ tag: "trix-reachability", requireInteraction: true });
    // l'épisode continue : rien ne s'ajoute
    vi.advanceTimersByTime(120_000);
    expect(posted).toHaveLength(1);
  });

  it("n'alerte pas tant que l'onglet est visible, et alerte dès qu'il se cache", async () => {
    const store = stubBrowser({ visible: true, stored: { "trix-resume": "acc-1" } });
    const { watchReachability } = await loadModule();
    const phone = fakePhone("reg_failed");
    watchReachability(phone as never);
    vi.advanceTimersByTime(30_000);
    expect(posted).toHaveLength(0); // l'écran le dit déjà, une phrase entière
    hide();
    expect(posted).toHaveLength(1);
    expect(store.get("trix-reach-alert")).toBe("1");
  });

  it("n'alerte pas si personne n'a demandé à être joignable", async () => {
    stubBrowser({ visible: false, stored: {} });
    const { watchReachability } = await loadModule();
    watchReachability(fakePhone("home") as never);
    vi.advanceTimersByTime(60_000);
    expect(posted).toHaveLength(0);
  });

  it("n'alerte pas quand le réglage est coupé", async () => {
    stubBrowser({
      visible: false,
      stored: { "trix-resume": "acc-1", "trix-reach-notify": "off" },
    });
    const { watchReachability } = await loadModule();
    watchReachability(fakePhone("sleeping") as never);
    vi.advanceTimersByTime(60_000);
    expect(posted).toHaveLength(0);
  });
});

describe("le retour à la normale se notifie aussi (D8)", () => {
  it("solde l'alerte sur le même tag, sans exiger d'interaction", async () => {
    const store = stubBrowser({ visible: false, stored: { "trix-resume": "acc-1" } });
    const { watchReachability } = await loadModule();
    const phone = fakePhone("sleeping");
    watchReachability(phone as never);
    vi.advanceTimersByTime(11_000);
    expect(posted).toHaveLength(1);
    phone.goto("ready");
    expect(posted).toHaveLength(2);
    expect(posted[1]).toMatchObject({ tag: "trix-reachability", requireInteraction: false });
    // l'objet de la première est encore là : on la ferme aussi
    expect(posted[0]!.closed).toBe(true);
    expect(store.get("trix-reach-alert")).toBeUndefined();
  });

  it("solde une alerte posée avant un rechargement complet de la page", async () => {
    // la page a été déchargée, l'objet `Notification` est mort avec elle :
    // seul le marqueur persistant sait qu'une alerte est restée à l'écran
    const store = stubBrowser({
      stored: { "trix-resume": "acc-1", "trix-reach-alert": "1" },
    });
    const { watchReachability } = await loadModule();
    watchReachability(fakePhone("ready") as never);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ tag: "trix-reachability", requireInteraction: false });
    expect(store.get("trix-reach-alert")).toBeUndefined();
  });

  it("ne dit rien quand rien n'avait été annoncé", async () => {
    stubBrowser({ stored: { "trix-resume": "acc-1" } });
    const { watchReachability } = await loadModule();
    watchReachability(fakePhone("ready") as never);
    expect(posted).toHaveLength(0);
  });
});

describe("la période d'injoignabilité après un déchargement (D4)", () => {
  it("borne l'absence par le dernier instant joignable et l'instant du retour", async () => {
    const from = Date.now() - 47 * 60_000;
    stubBrowser({ wasDiscarded: true, stored: { "trix-reachable": String(from) } });
    const { discardedEpisode } = await loadModule();
    const gone = discardedEpisode();
    expect(gone?.from).toBe(from);
    expect(gone?.to).toBeGreaterThanOrEqual(from);
  });

  it("ne raconte rien d'un chargement ordinaire", async () => {
    stubBrowser({ stored: { "trix-reachable": String(Date.now()) } });
    const { discardedEpisode } = await loadModule();
    expect(discardedEpisode()).toBeNull();
  });

  it("ne raconte rien sans borne basse connue", async () => {
    // rien n'a jamais été écrit : « injoignable depuis le 1er janvier 1970 »
    // n'informerait personne
    stubBrowser({ wasDiscarded: true });
    const { discardedEpisode } = await loadModule();
    expect(discardedEpisode()).toBeNull();
  });

  it("le message se masque, et ne revient pas", async () => {
    stubBrowser({ wasDiscarded: true, stored: { "trix-reachable": String(Date.now() - 1000) } });
    const { discardedEpisode, dismissDiscardNotice } = await loadModule();
    expect(discardedEpisode()).not.toBeNull();
    dismissDiscardNotice();
    expect(discardedEpisode()).toBeNull();
  });

  it("le rappel sur l'épinglage ne se montre qu'une fois (D6)", async () => {
    const store = stubBrowser({
      wasDiscarded: true,
      stored: { "trix-reachable": String(Date.now() - 1000) },
    });
    const first = await loadModule();
    expect(first.pinHintDue()).toBe(true);
    expect(store.get("trix-pin-hint")).toBe("1");
    // un second déchargement, plus tard : le conseil a déjà été donné
    const second = await loadModule();
    expect(second.pinHintDue()).toBe(false);
  });
});

describe("l'horodatage du dernier instant joignable", () => {
  it("s'écrit dès que l'on est joignable, et au passage en arrière-plan", async () => {
    const store = stubBrowser({ visible: true, stored: { "trix-resume": "acc-1" } });
    const { watchReachability } = await loadModule();
    watchReachability(fakePhone("ready") as never);
    const first = Number(store.get("trix-reachable"));
    expect(first).toBeGreaterThan(0);
    vi.advanceTimersByTime(20_000);
    expect(Number(store.get("trix-reachable"))).toBeGreaterThan(first);
    const beforeHide = Number(store.get("trix-reachable"));
    vi.advanceTimersByTime(5000);
    hide();
    expect(Number(store.get("trix-reachable"))).toBeGreaterThan(beforeHide);
  });

  it("ne s'écrit pas quand on n'est pas joignable", async () => {
    const store = stubBrowser({ visible: true, stored: { "trix-resume": "acc-1" } });
    const { watchReachability } = await loadModule();
    watchReachability(fakePhone("reconnecting") as never);
    vi.advanceTimersByTime(60_000);
    expect(store.get("trix-reachable")).toBeUndefined();
  });
});
