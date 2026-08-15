/**
 * PhoneMachine pilotée par des événements scriptés contre un port SIP
 * et un store factices (même approche que le webphone de référence de
 * fsl-typescript). L'amorçage (task loadConfig) est asynchrone : les
 * tests attendent l'état `home` avec vi.waitFor.
 */
import { describe, expect, it, vi } from "vitest";
import { PhoneMachine, type PhoneInstance } from "../src/machines/phone.js";
import type { AccountConfig, SecureStore } from "../src/storage/store.js";
import type { SipEvent, SipPort } from "../src/sip/port.js";
import { computeHa1 } from "../src/storage/ha1.js";

const CFG: AccountConfig = {
  proxy: "wss://sip.example.fr:8443/ws",
  domain: "example.fr",
  displayName: "Alice Martin",
  username: "alice",
  authUsername: null,
  ha1: computeHa1("alice", "example.fr", "secret123"),
};

function fakeStore(initial: AccountConfig | null = null) {
  const box = { saved: initial as AccountConfig | null };
  const store: SecureStore = {
    load: async () => box.saved,
    save: async (cfg) => {
      box.saved = cfg;
    },
    clear: async () => {
      box.saved = null;
    },
  };
  return { store, box };
}

class FakeSip implements SipPort {
  started: AccountConfig[] = [];
  stopped = 0;
  send: (ev: SipEvent) => void = () => {};
  start(cfg: AccountConfig, send: (ev: SipEvent) => void) {
    this.started.push(cfg);
    this.send = send;
    return {
      stop: () => {
        this.stopped++;
      },
    };
  }
}

async function bootTo(
  state: string,
  initial: AccountConfig | null,
): Promise<{ phone: PhoneInstance; sip: FakeSip; box: { saved: AccountConfig | null } }> {
  const { store, box } = fakeStore(initial);
  const sip = new FakeSip();
  const phone = PhoneMachine.start({ args: { store, sip } });
  await vi.waitFor(() => expect(phone.state).toBe("home"));
  if (state === "home") return { phone, sip, box };
  phone.send({ type: "ui:useAccount" });
  if (state === "connecting") return { phone, sip, box };
  sip.send({ type: "sip:connected" });
  if (state === "registering") return { phone, sip, box };
  sip.send({ type: "sip:registered" });
  expect(phone.state).toBe("ready");
  return { phone, sip, box };
}

describe("PhoneMachine — amorçage", () => {
  it("charge la config au boot et arrive sur l'accueil", async () => {
    const { phone } = await bootTo("home", CFG);
    expect(phone.context.config).toEqual(CFG);
  });

  it("sans compte, ui:useAccount reste sur l'accueil", async () => {
    const { phone, sip } = await bootTo("home", null);
    phone.send({ type: "ui:useAccount" });
    expect(phone.state).toBe("home");
    expect(sip.started).toHaveLength(0);
  });
});

describe("PhoneMachine — configuration", () => {
  it("calcule le HA1 depuis l'URI, persiste sans mot de passe, puis se connecte", async () => {
    const { phone, sip, box } = await bootTo("home", null);
    phone.send({ type: "ui:configure" });
    expect(phone.state).toBe("configuring");
    phone.send({
      type: "ui:saveConfig",
      form: {
        proxy: CFG.proxy,
        uri: "alice@example.fr",
        displayName: CFG.displayName,
        authUsername: null,
        password: "secret123",
      },
    });
    await vi.waitFor(() => expect(phone.state).toBe("connecting"));
    expect(box.saved).toEqual(CFG); // ha1 calculé, jamais de champ password
    expect(sip.started).toHaveLength(1);
    expect(sip.started[0]!.ha1).toBe(CFG.ha1);
  });

  it("le préfixe sip: de l'URI est accepté et ignoré", async () => {
    const { phone, box } = await bootTo("home", null);
    phone.send({ type: "ui:configure" });
    phone.send({
      type: "ui:saveConfig",
      form: {
        proxy: CFG.proxy,
        uri: "sip:alice@example.fr",
        displayName: CFG.displayName,
        authUsername: null,
        password: "secret123",
      },
    });
    await vi.waitFor(() => expect(phone.state).toBe("connecting"));
    expect(box.saved).toEqual(CFG);
  });

  it("URI SIP invalide : erreur, on reste sur le formulaire", async () => {
    const { phone } = await bootTo("home", null);
    phone.send({ type: "ui:configure" });
    phone.send({
      type: "ui:saveConfig",
      form: {
        proxy: "wss://x",
        uri: "alice.example.fr", // pas de @
        displayName: "",
        authUsername: null,
        password: "secret123",
      },
    });
    expect(phone.state).toBe("configuring");
    expect(phone.context.lastError).toBe("URI SIP invalide (attendu : utilisateur@domaine)");
  });

  it("identifiant d'authentification distinct : le HA1 est calculé avec lui", async () => {
    const { phone, box } = await bootTo("home", null);
    phone.send({ type: "ui:configure" });
    phone.send({
      type: "ui:saveConfig",
      form: {
        proxy: CFG.proxy,
        uri: "alice@example.fr",
        displayName: CFG.displayName,
        authUsername: "alice-auth",
        password: "secret123",
      },
    });
    await vi.waitFor(() => expect(phone.state).toBe("connecting"));
    expect(box.saved!.authUsername).toBe("alice-auth");
    expect(box.saved!.username).toBe("alice");
    expect(box.saved!.ha1).toBe(computeHa1("alice-auth", "example.fr", "secret123"));
  });

  it("mot de passe vide sans compte existant : erreur, on reste sur le formulaire", async () => {
    const { phone } = await bootTo("home", null);
    phone.send({ type: "ui:configure" });
    phone.send({
      type: "ui:saveConfig",
      form: { proxy: "wss://x", uri: "u@x.fr", displayName: "", authUsername: null, password: null },
    });
    expect(phone.state).toBe("configuring");
    expect(phone.context.lastError).toBe("Mot de passe requis");
  });

  it("mot de passe vide avec compte existant : conserve le HA1 (même identité/domaine)", async () => {
    const { phone, box } = await bootTo("home", CFG);
    phone.send({ type: "ui:configure" });
    phone.send({
      type: "ui:saveConfig",
      form: {
        proxy: "wss://autre.example.fr/ws",
        uri: `${CFG.username}@${CFG.domain}`,
        displayName: CFG.displayName,
        authUsername: null,
        password: null,
      },
    });
    await vi.waitFor(() => expect(phone.state).toBe("connecting"));
    expect(box.saved!.ha1).toBe(CFG.ha1);
    expect(box.saved!.proxy).toBe("wss://autre.example.fr/ws");
  });

  it("changement d'identité sans nouveau mot de passe : refusé (le HA1 en dépend)", async () => {
    const { phone } = await bootTo("home", CFG);
    phone.send({ type: "ui:configure" });
    phone.send({
      type: "ui:saveConfig",
      form: {
        proxy: CFG.proxy,
        uri: `bob@${CFG.domain}`,
        displayName: CFG.displayName,
        authUsername: null,
        password: null,
      },
    });
    expect(phone.state).toBe("configuring");
    expect(phone.context.lastError).toBe("Mot de passe requis");
  });

  it("ajout d'un identifiant d'authentification sans mot de passe : refusé", async () => {
    const { phone } = await bootTo("home", CFG);
    phone.send({ type: "ui:configure" });
    phone.send({
      type: "ui:saveConfig",
      form: {
        proxy: CFG.proxy,
        uri: `${CFG.username}@${CFG.domain}`,
        displayName: CFG.displayName,
        authUsername: "alice-auth",
        password: null,
      },
    });
    expect(phone.state).toBe("configuring");
    expect(phone.context.lastError).toBe("Mot de passe requis");
  });
});

describe("PhoneMachine — enregistrement", () => {
  it("connexion → REGISTER OK → ready", async () => {
    const { phone } = await bootTo("ready", CFG);
    expect(phone.state).toBe("ready");
  });

  it("échec d'enregistrement : reg_failed, UA arrêté, retry relance", async () => {
    const { phone, sip } = await bootTo("registering", CFG);
    sip.send({ type: "sip:registrationFailed", cause: "403 Forbidden" });
    expect(phone.state).toBe("reg_failed");
    expect(phone.context.lastError).toContain("403 Forbidden");
    expect(sip.stopped).toBe(1);

    phone.send({ type: "ui:retry" });
    expect(phone.state).toBe("connecting");
    expect(sip.started).toHaveLength(2);
  });

  it("URL de proxy invalide : reg_failed avec message dédié et détail en code", async () => {
    const { phone } = await bootTo("connecting", CFG);
    const sip2 = phone.context.sip as FakeSip;
    sip2.send({ type: "sip:invalidProxy", detail: "Invalid JsSIP.UA configuration: sockets" });
    expect(phone.state).toBe("reg_failed");
    expect(phone.context.lastError).toBe("Nom du proxy invalide — vérifiez l'adresse WSS");
    expect(phone.context.lastErrorCode).toContain("Invalid JsSIP.UA configuration");
  });

  it("connexion WSS refusée : reg_failed avec code WSS_CONNECT", async () => {
    const { phone, sip } = await bootTo("connecting", CFG);
    sip.send({ type: "sip:disconnected" });
    expect(phone.state).toBe("reg_failed");
    expect(phone.context.lastError).toContain("Impossible de se connecter au proxy");
    expect(phone.context.lastErrorCode).toBe("WSS_CONNECT");
  });

  it("SIP 404 (login/mot de passe/domaine incorrects) : message identifiants + code SIP 404", async () => {
    const { phone, sip } = await bootTo("registering", CFG);
    sip.send({ type: "sip:registrationFailed", cause: "Not Found", statusCode: 404 });
    expect(phone.state).toBe("reg_failed");
    expect(phone.context.lastError).toBe("URI SIP, mot de passe ou identifiant d'authentification incorrect");
    expect(phone.context.lastErrorCode).toBe("SIP 404");
  });

  it("reg_failed : ui:backToSettings garde l'erreur et les champs suspects sur le formulaire", async () => {
    const { phone, sip } = await bootTo("registering", CFG);
    sip.send({ type: "sip:registrationFailed", cause: "Not Found", statusCode: 404 });
    expect(phone.state).toBe("reg_failed");
    expect(phone.context.suspectFields).toBe("credentials");
    phone.send({ type: "ui:backToSettings" });
    expect(phone.state).toBe("configuring");
    expect(phone.context.lastError).toBe("URI SIP, mot de passe ou identifiant d'authentification incorrect");
    expect(phone.context.lastErrorCode).toBe("SIP 404");
    expect(phone.context.suspectFields).toBe("credentials");
    expect(phone.context.config).toEqual(CFG); // formulaire pré-rempli
  });

  it("échec WSS : champ proxy suspect, effacé au relancement de la connexion", async () => {
    const { phone, sip } = await bootTo("connecting", CFG);
    sip.send({ type: "sip:disconnected" });
    expect(phone.context.suspectFields).toBe("proxy");
    phone.send({ type: "ui:retry" });
    expect(phone.context.suspectFields).toBeNull();
    expect(phone.context.lastError).toBeNull();
  });

  it("ui:configure depuis l'accueil : formulaire vierge de toute erreur passée", async () => {
    const { phone, sip } = await bootTo("registering", CFG);
    sip.send({ type: "sip:registrationFailed", cause: "Not Found", statusCode: 404 });
    phone.send({ type: "ui:logout" }); // reg_failed → home
    expect(phone.state).toBe("home");
    phone.send({ type: "ui:configure" });
    expect(phone.state).toBe("configuring");
    expect(phone.context.lastError).toBeNull();
    expect(phone.context.suspectFields).toBeNull();
  });

  it("perte de connexion en ready : reg_failed", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    sip.send({ type: "sip:disconnected" });
    expect(phone.state).toBe("reg_failed");
  });

  it("re-REGISTER périodique : ready reste ready", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    sip.send({ type: "sip:registered" });
    expect(phone.state).toBe("ready");
  });

  it("timeout WebSocket (10 s) : reg_failed", async () => {
    vi.useFakeTimers();
    try {
      const { store } = fakeStore(CFG);
      const sip = new FakeSip();
      const phone = PhoneMachine.start({ args: { store, sip } });
      await vi.advanceTimersByTimeAsync(0); // règle la task loadConfig
      expect(phone.state).toBe("home");
      phone.send({ type: "ui:useAccount" });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(phone.state).toBe("reg_failed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("registrar muet (30 s) : reg_failed", async () => {
    vi.useFakeTimers();
    try {
      const { store } = fakeStore(CFG);
      const sip = new FakeSip();
      const phone = PhoneMachine.start({ args: { store, sip } });
      await vi.advanceTimersByTimeAsync(0);
      phone.send({ type: "ui:useAccount" });
      sip.send({ type: "sip:connected" });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(phone.state).toBe("reg_failed");
      expect(phone.context.lastError).toBe("Le registrar ne répond pas");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("PhoneMachine — sorties", () => {
  it("déconnexion : unregistering → home quand le transport se ferme", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    phone.send({ type: "ui:logout" });
    expect(phone.state).toBe("unregistering");
    expect(sip.stopped).toBe(1);
    sip.send({ type: "sip:unregistered" });
    sip.send({ type: "sip:disconnected" });
    expect(phone.state).toBe("home");
  });

  it("déconnexion forcée après 5 s sans réponse du transport", async () => {
    vi.useFakeTimers();
    try {
      const { store } = fakeStore(CFG);
      const sip = new FakeSip();
      const phone = PhoneMachine.start({ args: { store, sip } });
      await vi.advanceTimersByTimeAsync(0);
      phone.send({ type: "ui:useAccount" });
      sip.send({ type: "sip:connected" });
      sip.send({ type: "sip:registered" });
      phone.send({ type: "ui:logout" });
      await vi.advanceTimersByTimeAsync(5000);
      expect(phone.state).toBe("home");
    } finally {
      vi.useRealTimers();
    }
  });

  it("retour paramètres depuis ready : UA arrêté, formulaire pré-rempli", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    phone.send({ type: "ui:backToSettings" });
    expect(phone.state).toBe("reconfiguring");
    expect(sip.stopped).toBe(1);
    expect(phone.context.config).toEqual(CFG);
  });

  it("paramètres ouverts depuis ready puis Annuler : reconnexion vers l'écran d'appel", async () => {
    const { phone, sip } = await bootTo("ready", CFG);
    phone.send({ type: "ui:backToSettings" });
    expect(phone.state).toBe("reconfiguring");
    phone.send({ type: "ui:cancelConfig" });
    expect(phone.state).toBe("connecting");
    expect(sip.started).toHaveLength(2); // l'UA est relancé avec la config inchangée
    sip.send({ type: "sip:connected" });
    sip.send({ type: "sip:registered" });
    expect(phone.state).toBe("ready");
  });

  it("paramètres ouverts depuis ready puis Enregistrer : sauvegarde et reconnexion", async () => {
    const { phone, sip, box } = await bootTo("ready", CFG);
    phone.send({ type: "ui:backToSettings" });
    phone.send({
      type: "ui:saveConfig",
      form: {
        proxy: "wss://autre.example.fr/ws",
        uri: `${CFG.username}@${CFG.domain}`,
        displayName: CFG.displayName,
        authUsername: null,
        password: null,
      },
    });
    await vi.waitFor(() => expect(phone.state).toBe("connecting"));
    expect(box.saved!.proxy).toBe("wss://autre.example.fr/ws");
    expect(sip.started).toHaveLength(2);
  });

  it("Annuler depuis la config ouverte à l'accueil : retour à l'accueil", async () => {
    const { phone, sip } = await bootTo("home", CFG);
    phone.send({ type: "ui:configure" });
    phone.send({ type: "ui:cancelConfig" });
    expect(phone.state).toBe("home");
    expect(sip.started).toHaveLength(0);
  });
});
