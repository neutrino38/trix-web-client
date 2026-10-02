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
import { afterEach, describe, expect, it, vi } from "vitest";
import { inject, type Manifest } from "../build/precache.js";

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

const SCOPE = "https://trix.example.com/";

/** A request as the browser hands it over; `mode: "navigate"` cannot be built with `new Request`. */
const incoming = (url: string, mode: RequestMode = "no-cors") =>
  Object.defineProperty(new Request(url), "mode", { value: mode });

/** `CacheStorage`, kept in memory: cache name → URL → response. */
function fakeCaches() {
  const store = new Map<string, Map<string, Response>>();
  const url = (r: Request | string) => (typeof r === "string" ? r : r.url);
  const open = async (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    const c = store.get(name)!;
    return {
      // `Vary` as the browser applies it: a cached answer that varies on a
      // header only matches a request carrying the same value, unless told
      // to ignore it
      match: async (r: Request | string, opts?: { ignoreVary?: boolean }) => {
        const hit = c.get(url(r));
        if (!hit) return undefined;
        const vary = hit.headers.get("Vary");
        if (vary && !opts?.ignoreVary && typeof r !== "string") {
          const differs = vary.split(",").some((h) => r.headers.get(h.trim()) !== null);
          if (differs) return undefined;
        }
        return hit.clone();
      },
      put: async (r: Request | string, res: Response) => void c.set(url(r), res),
    };
  };
  return {
    store,
    api: {
      open,
      keys: async () => [...store.keys()],
      delete: async (name: string) => store.delete(name),
    },
  };
}

interface WorkerOptions {
  /** The build's manifest; without it, the worker is the one `vite dev` serves. */
  manifest?: Manifest;
  /** The network, as `fetch` sees it. */
  fetch?: (req: Request | string) => Promise<Response>;
}

function loadWorker(windows: { focus: () => Promise<void> }[] = [], opts: WorkerOptions = {}) {
  const handlers = new Map<string, (event: unknown) => void>();
  const shown: Shown[] = [];
  const opened: string[] = [];
  const warned: string[] = [];
  const caches = fakeCaches();
  const fetched: string[] = [];
  const network = opts.fetch ?? (async () => new Response("", { status: 404 }));
  const fetch = (req: Request | string) => {
    fetched.push(typeof req === "string" ? req : req.url);
    return network(req);
  };
  const self = {
    location: new URL(SCOPE),
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
      scope: SCOPE,
      showNotification: async (title: string, opts: Record<string, unknown>) => {
        shown.push({ title, ...opts, closed: false } as Shown);
      },
      getNotifications: async ({ tag }: { tag: string }) =>
        shown.filter((n) => n.tag === tag && !n.closed).map((n) => ({ close: () => (n.closed = true) })),
    },
  };
  const source = readFileSync(fileURLToPath(new URL("../public/sw.js", import.meta.url)), "utf8");
  const code = opts.manifest ? inject(source, opts.manifest) : source;
  const console = { warn: (msg: string) => warned.push(msg), log: () => {}, error: () => {} };
  new Function("self", "console", "caches", "fetch", code)(self, console, caches.api, fetch);

  /** Fait partir un événement et attend ce que le worker a mis en `waitUntil`. */
  const fire = async (type: string, event: Record<string, unknown> = {}): Promise<void> => {
    const waits: Promise<unknown>[] = [];
    handlers.get(type)?.({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  };
  /** Sends a request through the worker; `null` when it leaves it to the browser. */
  const request = async (url: string, mode: RequestMode = "no-cors"): Promise<Response | null> => {
    let answer: Promise<Response> | null = null;
    await fire("fetch", { request: incoming(url, mode), respondWith: (p: Promise<Response>) => (answer = p) });
    return answer;
  };
  return { fire, request, shown, opened, warned, fetched, caches: caches.store };
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
    expect(sw.warned.join(" ")).toContain("no Trix tab");
  });
});

const MANIFEST: Manifest = { version: "v2", files: ["assets/main-1.js", "index.html", "share_account.html"] };

/** A server that knows a fixed set of files, or none when `online` is false. */
function server(files: Record<string, string>, state = { online: true }) {
  return async (req: Request | string) => {
    if (!state.online) throw new TypeError("Failed to fetch");
    // `DirectoryIndex index.html`, as the provided configurations do
    const path = new URL(typeof req === "string" ? req : req.url).pathname.slice(1) || "index.html";
    const body = files[path];
    return body === undefined ? new Response("", { status: 404 }) : new Response(body);
  };
}

const BUILD = {
  "assets/main-1.js": "main",
  "index.html": "today",
  "share_account.html": "share",
  "config.json": "{}",
};

const text = async (res: Response | null) => (res ? await res.text() : null);

describe("service worker — the client kept in cache", () => {
  afterEach(() => vi.useRealTimers());

  it("caches every file of the build at install, and config.json with them", async () => {
    const sw = loadWorker([], { manifest: MANIFEST, fetch: server(BUILD) });
    await sw.fire("install");
    expect([...sw.caches.get("trix-v2")!.keys()].sort()).toEqual(
      [...MANIFEST.files, "config.json"].map((p) => SCOPE + p).sort(),
    );
  });

  it("installs even when a file cannot be cached — the notifications do not depend on it", async () => {
    const sw = loadWorker([], { manifest: MANIFEST, fetch: server({ "index.html": "today" }) });
    await sw.fire("install");
    expect(sw.caches.get("trix-v2")!.has(SCOPE + "index.html")).toBe(true);
    expect(sw.warned.join(" ")).toContain("assets/main-1.js");
    // a deployment without config.json is a normal one: no warning for it
    expect(sw.warned.join(" ")).not.toContain("config.json");
  });

  it("loads offline once installed", async () => {
    const state = { online: true };
    const sw = loadWorker([], { manifest: MANIFEST, fetch: server(BUILD, state) });
    await sw.fire("install");
    state.online = false;
    expect(await text(await sw.request(SCOPE, "navigate"))).toBe("today");
    expect(await text(await sw.request(SCOPE + "share_account.html?x=1", "navigate"))).toBe("share");
    expect(await text(await sw.request(SCOPE + "assets/main-1.js"))).toBe("main");
    expect(await text(await sw.request(SCOPE + "config.json"))).toBe("{}");
  });

  it("serves the server's page when it answers, never yesterday's copy", async () => {
    const files: Record<string, string> = { ...BUILD };
    const sw = loadWorker([], { manifest: MANIFEST, fetch: server(files) });
    await sw.fire("install");
    files["index.html"] = "tomorrow";
    expect(await text(await sw.request(SCOPE, "navigate"))).toBe("tomorrow");
    // and the offline copy follows
    expect(await sw.caches.get("trix-v2")!.get(SCOPE + "index.html")!.clone().text()).toBe("tomorrow");
  });

  it("finds what it cached at install when the server answers Vary", async () => {
    // seen in the browser: precached without `Origin`, requested by a module
    // script with it — every asset missed, and the offline page stayed blank
    const state = { online: true };
    const net = server(BUILD, state);
    const sw = loadWorker([], {
      manifest: MANIFEST,
      fetch: async (req) => {
        const res = await net(req);
        return new Response(res.body, { status: res.status, headers: { Vary: "Origin" } });
      },
    });
    await sw.fire("install");
    state.online = false;
    const script = new Request(SCOPE + "assets/main-1.js", { headers: { Origin: SCOPE.slice(0, -1) } });
    let answer: Promise<Response> | null = null;
    await sw.fire("fetch", { request: script, respondWith: (p: Promise<Response>) => (answer = p) });
    expect(await text(await answer!)).toBe("main");
  });

  it("takes hashed assets from the cache without asking the network", async () => {
    const sw = loadWorker([], { manifest: MANIFEST, fetch: server(BUILD) });
    await sw.fire("install");
    sw.fetched.length = 0;
    expect(await text(await sw.request(SCOPE + "assets/main-1.js"))).toBe("main");
    expect(sw.fetched).toEqual([]);
  });

  it("keeps the working config.json when the server answers an error", async () => {
    const files: Record<string, string> = { ...BUILD };
    const sw = loadWorker([], { manifest: MANIFEST, fetch: server(files) });
    await sw.fire("install");
    delete files["config.json"];
    expect((await sw.request(SCOPE + "config.json"))!.status).toBe(404);
    expect(await sw.caches.get("trix-v2")!.get(SCOPE + "config.json")!.clone().text()).toBe("{}");
  });

  it("answers from the cache when the network hangs", async () => {
    let hang = false;
    const net = server(BUILD);
    const sw = loadWorker([], {
      manifest: MANIFEST,
      fetch: (req) => (hang ? new Promise<Response>(() => {}) : net(req)),
    });
    await sw.fire("install");
    hang = true;
    vi.useFakeTimers();
    let answer: Promise<Response> | null = null;
    sw.fire("fetch", {
      request: incoming(SCOPE, "navigate"),
      respondWith: (p: Promise<Response>) => (answer = p),
    });
    await vi.advanceTimersByTimeAsync(4000);
    expect(await text(await answer!)).toBe("today");
  });

  it("drops the previous version's cache, and only Trix's", async () => {
    const sw = loadWorker([], { manifest: MANIFEST, fetch: server(BUILD) });
    sw.caches.set("trix-v1", new Map());
    sw.caches.set("someone-else", new Map());
    await sw.fire("install");
    await sw.fire("activate");
    expect([...sw.caches.keys()].sort()).toEqual(["someone-else", "trix-v2"]);
  });

  it("leaves the browser alone for others' requests and for the worker itself", async () => {
    const sw = loadWorker([], { manifest: MANIFEST, fetch: server(BUILD) });
    expect(await sw.request("https://elsewhere.example/x.js")).toBeNull();
    expect(await sw.request(SCOPE + "sw.js")).toBeNull();
  });

  it("caches nothing under vite dev, where the manifest is not written", async () => {
    const sw = loadWorker([], { fetch: server(BUILD) });
    await sw.fire("install");
    expect(sw.caches.size).toBe(0);
    expect(await sw.request(SCOPE, "navigate")).toBeNull();
  });
});
