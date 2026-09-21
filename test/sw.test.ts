/**
 * Le service worker des notifications (`public/sw.js`, ADR 0006, D2 bis).
 *
 * Il n'existe que parce qu'une page gelée ne peut pas afficher d'alerte —
 * et il échappe à tout le reste : il n'est pas compilé avec le bundle, il
 * ne s'exécute dans aucun écran, et rien de ce qu'il fait ne se voit
 * depuis l'application. Autant dire qu'une faute y vit longtemps. Deux y
 * ont déjà vécu, dont celle qui ouvrait un second onglet Trix à chaque
 * clic sur l'alerte.
 *
 * Il est donc chargé ici tel quel, avec un `self` de fabrication, et l'on
 * vérifie ce qui compte : ce qu'il affiche, ce qu'il efface, et surtout ce
 * qu'il n'ouvre **pas**.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

interface Shown {
  title: string;
  body?: string;
  tag?: string;
  requireInteraction?: boolean;
  closed: boolean;
}

/** Un onglet, tel que `clients.matchAll` le rend. */
function fakeClient(over: { focus?: () => Promise<void> } = {}) {
  const box = { focused: 0 };
  return {
    box,
    client: {
      focus:
        over.focus ??
        (async () => {
          box.focused++;
        }),
    },
  };
}

function loadWorker(windows: { focus: () => Promise<void> }[] = []) {
  const handlers = new Map<string, (event: unknown) => void>();
  const shown: Shown[] = [];
  const opened: string[] = [];
  const warned: string[] = [];
  const self = {
    addEventListener: (type: string, fn: (event: unknown) => void) => handlers.set(type, fn),
    skipWaiting: () => {},
    clients: {
      claim: async () => {},
      matchAll: async () => windows,
      openWindow: async (url: string) => {
        opened.push(url);
      },
    },
    registration: {
      showNotification: async (title: string, opts: Record<string, unknown>) => {
        shown.push({ title, ...opts, closed: false } as Shown);
      },
      getNotifications: async ({ tag }: { tag: string }) =>
        shown.filter((n) => n.tag === tag && !n.closed).map((n) => ({ close: () => (n.closed = true) })),
    },
  };
  const code = readFileSync(fileURLToPath(new URL("../public/sw.js", import.meta.url)), "utf8");
  const console = { warn: (msg: string) => warned.push(msg), log: () => {}, error: () => {} };
  new Function("self", "console", code)(self, console);

  /** Fait partir un événement et attend ce que le worker a mis en `waitUntil`. */
  const fire = async (type: string, event: Record<string, unknown> = {}): Promise<void> => {
    const waits: Promise<unknown>[] = [];
    handlers.get(type)?.({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  };
  return { fire, shown, opened, warned };
}

const NOTIFY = { kind: "trix:notify", title: "Injoignable", body: "…", tag: "trix-reachability" };

describe("service worker — afficher et effacer", () => {
  it("affiche ce que la page lui demande, et rien d'autre", async () => {
    const sw = loadWorker();
    await sw.fire("message", { data: { ...NOTIFY, keep: true } });
    expect(sw.shown).toHaveLength(1);
    expect(sw.shown[0]).toMatchObject({
      title: "Injoignable",
      tag: "trix-reachability",
      requireInteraction: true,
      silent: true,
    });
  });

  it("ignore un message qui ne vient pas de Trix", async () => {
    const sw = loadWorker();
    await sw.fire("message", { data: { kind: "autre-chose", title: "Coucou" } });
    await sw.fire("message", { data: null });
    expect(sw.shown).toHaveLength(0);
  });

  it("efface l'alerte précédente du même tag — y compris posée par une page morte", async () => {
    // c'est tout l'intérêt du worker pour D8 : sans lui, une alerte
    // `requireInteraction` survit à la page et plus personne ne la ferme
    const sw = loadWorker();
    await sw.fire("message", { data: { ...NOTIFY, keep: true } });
    await sw.fire("message", { data: { kind: "trix:notify", tag: NOTIFY.tag, close: true, title: "" } });
    expect(sw.shown[0]!.closed).toBe(true);
    expect(sw.shown).toHaveLength(1); // `title` vide : on efface sans rien reposer
  });
});

describe("service worker — le clic ramène sur l'onglet existant", () => {
  it("reprend l'onglet Trix au lieu d'en ouvrir un second", async () => {
    const tab = fakeClient();
    const sw = loadWorker([tab.client]);
    const closed = vi.fn();
    await sw.fire("notificationclick", { notification: { close: closed } });
    expect(tab.box.focused).toBe(1);
    expect(sw.opened).toEqual([]);
    expect(closed).toHaveBeenCalled();
  });

  it("passe au suivant quand un onglet refuse de revenir", async () => {
    const dying = fakeClient({ focus: async () => Promise.reject(new Error("parti")) });
    const alive = fakeClient();
    const sw = loadWorker([dying.client, alive.client]);
    await sw.fire("notificationclick", { notification: { close: () => {} } });
    expect(alive.box.focused).toBe(1);
    expect(sw.opened).toEqual([]);
  });

  it("n'ouvre jamais de second Trix, même quand il n'y a plus rien à reprendre", async () => {
    // un onglet déchargé n'est plus un client, mais il est toujours dans la
    // barre : en ouvrir un autre donnerait deux Trix enregistrés, l'un à
    // côté de l'autre, pour un clic qui voulait revenir sur le sien
    const sw = loadWorker([]);
    await sw.fire("notificationclick", { notification: { close: () => {} } });
    expect(sw.opened).toEqual([]);
    expect(sw.warned.join(" ")).toContain("aucun onglet Trix");
  });
});
