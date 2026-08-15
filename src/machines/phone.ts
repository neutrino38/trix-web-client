/**
 * PhoneMachine — cycle de vie de l'application et de l'enregistrement SIP
 * (docs/CONCEPTION.md §4.1). Le diagramme de référence se régénère avec
 * `PhoneMachine.toMermaid()` (npm run diagrams).
 *
 * Invariant : l'UA SIP ne vit que dans connecting → registering → ready
 * (→ in_call en phase 2) → unregistering. Toute sortie de ce couloir
 * passe par stopSip().
 */

import { defineMachine, goto, stay } from "finite-state-language";
import type { AccountConfig, SecureStore } from "../storage/store.js";
import type { SipHandle, SipPort } from "../sip/port.js";
import { computeHa1 } from "../storage/ha1.js";
import { parseSipUri } from "../sip/uri.js";
import type { PhoneEvent } from "./events.js";

export interface PhoneCtx {
  /** Injectés via start({ args }) — jamais recréés par la machine. */
  store: SecureStore;
  sip: SipPort;
  config: AccountConfig | null;
  handle: SipHandle | null;
  lastError: string | null;
  /** Code technique affiché discrètement sous l'erreur (ex. "SIP 404", "WSS_CONNECT"). */
  lastErrorCode: string | null;
  /** Champs du formulaire à surligner après un échec : le proxy (connexion) ou les identifiants SIP. */
  suspectFields: "proxy" | "credentials" | null;
}

function stopSip(ctx: PhoneCtx): void {
  ctx.handle?.stop();
  ctx.handle = null;
}

function fail(ctx: PhoneCtx, message: string, code: string, fields: "proxy" | "credentials") {
  ctx.lastError = message;
  ctx.lastErrorCode = code;
  ctx.suspectFields = fields;
  return goto("reg_failed");
}

function clearError(ctx: PhoneCtx): void {
  ctx.lastError = null;
  ctx.lastErrorCode = null;
  ctx.suspectFields = null;
}

/** 401/403/407 : credentials refusés ; 404 : user ou domaine inconnu du registrar. */
function isCredentialsError(statusCode: number | undefined): boolean {
  return statusCode === 401 || statusCode === 403 || statusCode === 404 || statusCode === 407;
}

/** Validation + HA1 du formulaire, partagé par configuring et reconfiguring. */
function saveConfig(ev: Extract<PhoneEvent, { type: "ui:saveConfig" }>, ctx: PhoneCtx) {
  const f = ev.form;
  const parsed = parseSipUri(f.uri);
  if (!parsed) {
    ctx.lastError = "URI SIP invalide (attendu : utilisateur@domaine)";
    return stay("URI invalide");
  }
  const { username, domain } = parsed;
  const authUsername = f.authUsername?.trim() || null;
  // le HA1 dépend de l'identité d'authentification effective et du realm (= domaine)
  const authId = authUsername ?? username;
  const prevAuthId = ctx.config ? (ctx.config.authUsername ?? ctx.config.username) : null;
  const ha1 =
    f.password !== null && f.password !== ""
      ? computeHa1(authId, domain, f.password)
      : ctx.config && prevAuthId === authId && ctx.config.domain === domain
        ? ctx.config.ha1
        : null;
  if (!ha1) {
    ctx.lastError = "Mot de passe requis";
    return stay("mot de passe manquant");
  }
  ctx.config = {
    proxy: f.proxy,
    domain,
    displayName: f.displayName,
    username,
    authUsername,
    ha1,
  };
  return goto("saving");
}

export const PhoneMachine = defineMachine<PhoneCtx, PhoneEvent>()({
  name: "PhoneMachine",

  context: () => ({
    store: null as unknown as SecureStore,
    sip: null as unknown as SipPort,
    config: null,
    handle: null,
    lastError: null,
    lastErrorCode: null,
    suspectFields: null,
  }),

  states: {
    initial_state: {
      enter(ctx, fx) {
        fx.task(ctx.store.load(), "loadConfig", { timeout: 3000 });
      },
      on: {
        "task:loadConfig": (ev, ctx) => {
          ctx.config = ev.ok ? ev.value : null;
          return goto("home", ctx.config ? "compte trouvé" : "aucun compte");
        },
      },
      meta: { screen: "boot" },
    },

    home: {
      on: {
        "ui:configure": (_ev, ctx) => {
          clearError(ctx);
          return goto("configuring");
        },
        "ui:useAccount": (_ev, ctx) =>
          ctx.config ? goto("connecting") : stay("aucun compte configuré"),
        // événements SIP tardifs d'un UA arrêté : consommés sans effet
        "sip:disconnected": () => undefined,
        "sip:unregistered": () => undefined,
      },
      meta: { screen: "home" },
    },

    configuring: {
      // pas de reset ici : en venant de reg_failed, l'erreur et les champs
      // suspects restent affichés sur le formulaire pour guider la correction
      on: {
        "ui:saveConfig": saveConfig,
        "ui:cancelConfig": () => goto("home"),
        "sip:disconnected": () => undefined,
        "sip:unregistered": () => undefined,
      },
      meta: { screen: "config" },
    },

    /** Paramètres ouverts depuis l'écran d'appel enregistré : Annuler relance la connexion. */
    reconfiguring: {
      on: {
        "ui:saveConfig": saveConfig,
        "ui:cancelConfig": () => goto("connecting", "retour à l'appel"),
        // suites de l'arrêt de l'UA : consommées sans effet
        "sip:disconnected": () => undefined,
        "sip:unregistered": () => undefined,
        "sip:registrationFailed": () => undefined,
      },
      meta: { screen: "config" },
    },

    saving: {
      enter(ctx, fx) {
        fx.task(ctx.store.save(ctx.config!), "saveConfig", { timeout: 3000 });
      },
      on: {
        "task:saveConfig": (ev, ctx) => {
          // même si la persistance échoue, la session en mémoire reste utilisable
          if (!ev.ok) ctx.lastError = `Sauvegarde impossible : ${ev.error}`;
          return goto("connecting");
        },
      },
      meta: { screen: "config" },
    },

    connecting: {
      enter(ctx, fx) {
        clearError(ctx);
        ctx.handle = ctx.sip.start(ctx.config!, (ev) => fx.send(ev));
      },
      on: {
        "sip:connected": () => goto("registering", "WebSocket ouverte"),
        "sip:invalidProxy": (ev, ctx) =>
          fail(ctx, "Nom du proxy invalide — vérifiez l'adresse WSS", `URL: ${ev.detail}`, "proxy"),
        "sip:disconnected": (_ev, ctx) =>
          fail(
            ctx,
            "Impossible de se connecter au proxy (connexion WSS refusée)",
            "WSS_CONNECT",
            "proxy",
          ),
      },
      after: {
        delay: 10_000,
        then: (ctx) =>
          fail(ctx, "Le proxy ne répond pas (timeout WebSocket)", "WSS_TIMEOUT", "proxy"),
      },
      meta: { screen: "call" },
    },

    registering: {
      on: {
        "sip:registered": () => goto("ready", "REGISTER OK"),
        "sip:registrationFailed": (ev, ctx) =>
          isCredentialsError(ev.statusCode)
            ? fail(
                ctx,
                "URI SIP, mot de passe ou identifiant d'authentification incorrect",
                `SIP ${ev.statusCode}`,
                "credentials",
              )
            : fail(
                ctx,
                `Enregistrement refusé : ${ev.cause}`,
                ev.statusCode ? `SIP ${ev.statusCode}` : ev.cause,
                "credentials",
              ),
        "sip:disconnected": (_ev, ctx) =>
          fail(ctx, "Connexion perdue pendant l'enregistrement", "WSS_LOST", "proxy"),
      },
      after: {
        delay: 30_000,
        then: (ctx) => fail(ctx, "Le registrar ne répond pas", "SIP_TIMEOUT", "credentials"),
      },
      meta: { screen: "call" },
    },

    ready: {
      on: {
        // rafraîchissements périodiques du REGISTER
        "sip:registered": () => stay("re-REGISTER OK"),
        "sip:connected": () => undefined,
        "sip:registrationFailed": (ev, ctx) =>
          fail(
            ctx,
            `Enregistrement perdu : ${ev.cause}`,
            ev.statusCode ? `SIP ${ev.statusCode}` : ev.cause,
            "credentials",
          ),
        "sip:disconnected": (_ev, ctx) =>
          fail(ctx, "Connexion au proxy perdue", "WSS_LOST", "proxy"),
        "ui:backToSettings": (_ev, ctx) => {
          stopSip(ctx);
          clearError(ctx);
          return goto("reconfiguring", "retour paramètres");
        },
        "ui:logout": () => goto("unregistering"),
      },
      meta: { screen: "call" },
    },

    reg_failed: {
      enter(ctx) {
        stopSip(ctx);
      },
      on: {
        "ui:retry": () => goto("connecting"),
        "ui:backToSettings": () => goto("configuring"),
        "ui:logout": () => goto("home"),
        // suites de l'arrêt de l'UA : consommées sans effet
        "sip:disconnected": () => undefined,
        "sip:unregistered": () => undefined,
        "sip:registrationFailed": () => undefined,
        "sip:invalidProxy": () => undefined,
      },
      meta: { screen: "call" },
    },

    unregistering: {
      enter(ctx) {
        ctx.handle?.stop();
      },
      on: {
        "sip:unregistered": () => undefined, // on attend la fermeture du transport
        "sip:registrationFailed": () => undefined,
        "sip:disconnected": (_ev, ctx) => {
          ctx.handle = null;
          return goto("home", "déconnecté");
        },
      },
      after: {
        delay: 5000,
        then: (ctx) => {
          ctx.handle = null;
          return goto("home", "déconnexion forcée");
        },
      },
      meta: { screen: "call" },
    },
  },

  cleanup(ctx) {
    stopSip(ctx);
  },
});

export type PhoneInstance = ReturnType<typeof PhoneMachine.start>;
