/**
 * PhoneMachine — cycle de vie de l'application et de l'enregistrement SIP
 * (docs/CONCEPTION.md §4.1). Le diagramme de référence se régénère avec
 * `npm run diagrams`, qui extrait les transitions de ce fichier.
 *
 * Invariant : l'UA SIP ne vit que dans connecting → registering → ready
 * → in_call → unregistering. Toute sortie de ce couloir (reconnecting,
 * sleeping, reg_failed, retours paramètres) passe par stopSip().
 *
 * Perte du proxy : hors appel, `reconnecting` retente toutes les 10 s en
 * boucle (autoReconnect) ; en appel, l'appel est raccroché avec une
 * erreur spécifique puis on rejoint la boucle. Veille machine :
 * `sleeping` raccroche et désenregistre, le réveil réenregistre.
 */

import { defineMachine, goto, stay } from "finite-state-language";
import type {
  AccountConfig,
  CallDirection,
  CallLogEntry,
  SecureStore,
} from "../storage/store.js";
import type { CallMedia, IncomingCall, RejectReason, SipHandle, SipPort } from "../sip/port.js";
import type { TraceLine } from "../sip/record.js";
import type { MediaStats } from "../sip/stats.js";
import { computeHa1 } from "../storage/ha1.js";
import { parseSipUri } from "../sip/uri.js";
import { CallBlock } from "./call.js";
import type { CallReturn, CallView, PhoneEvent, SuspectField } from "./events.js";
import { parseIceForm } from "../sip/ice.js";
import { msg, type Msg } from "../i18n/types.js";

export interface PhoneCtx {
  /** Injectés via start({ args }) — jamais recréés par la machine. */
  store: SecureStore;
  sip: SipPort;
  config: AccountConfig | null;
  handle: SipHandle | null;
  /**
   * Erreur métier en cours, gardée sous forme de message différé : la
   * machine dit **quoi**, l'écran dit dans quelle langue (`i18n/types.ts`).
   */
  lastError: Msg | null;
  /** Code technique affiché discrètement sous l'erreur (ex. "SIP 404", "WSS_CONNECT"). */
  lastErrorCode: string | null;
  /** Champ du formulaire à surligner après un échec (proxy, identifiants, serveur ICE…). */
  suspectFields: SuspectField | null;
  /** Appel en cours de lancement/déroulement, gardé jusqu'au retour du bloc pour l'historique. */
  pendingCall: {
    target: string;
    media: CallMedia;
    direction: CallDirection;
    startedAt: number;
  } | null;
  /** INVITE entrant accepté par `ready`, passé au CallBlock dans ses `args`. */
  incoming: IncomingCall | null;
  /**
   * Vue de l'appel, **écrite par CallBlock dans ce contexte** — il le
   * partage, il n'a pas de miroir à tenir. C'est ce que l'UI rend
   * pendant `in_call`.
   */
  call: CallView | null;
  /** Issue du dernier appel raté (486, pas de réponse…), affichée près du champ d'adresse. */
  callError: Msg | null;
  /** Historique d'appels du compte courant, persisté chiffré. */
  history: CallLogEntry[];
  /** Boucle de reconnexion active : les échecs de connexion repartent en reconnecting. */
  autoReconnect: boolean;
  /** Mise en veille demandée pendant un appel : posée par le bloc, lue à son retour. */
  sleepRequested: boolean;
}

/**
 * Longueur de l'historique : les 50 derniers appels, du plus récent au plus
 * ancien. La liste est relue en entier à chaque rendu et réécrite chiffrée à
 * chaque appel — la borne est là pour cela, pas pour la place occupée.
 * Un historique plus long déjà persisté (borne précédente) est ramené à
 * cette taille dès sa relecture, par `recent()`.
 */
const HISTORY_MAX = 50;

/** Les entrées à garder d'un historique relu — les plus récentes sont en tête. */
function recent(entries: CallLogEntry[]): CallLogEntry[] {
  return entries.slice(0, HISTORY_MAX);
}

function accountKey(cfg: AccountConfig): string {
  return `${cfg.username}@${cfg.domain}`;
}

function stopSip(ctx: PhoneCtx): void {
  ctx.handle?.stop();
  ctx.handle = null;
}

/**
 * Échec de connexion/enregistrement : mémorise l'erreur, puis reg_failed —
 * ou retour dans la boucle de reconnexion si elle est active et que le
 * problème est côté transport (un refus de credentials ne se réglera pas
 * en réessayant).
 */
function fail(ctx: PhoneCtx, message: Msg, code: string, fields: SuspectField) {
  ctx.lastError = message;
  ctx.lastErrorCode = code;
  ctx.suspectFields = fields;
  if (ctx.autoReconnect && fields === "proxy") return goto("reconnecting", "reconnexion auto");
  ctx.autoReconnect = false;
  return goto("reg_failed");
}

function clearError(ctx: PhoneCtx): void {
  ctx.lastError = null;
  ctx.lastErrorCode = null;
  ctx.suspectFields = null;
}

/** Vidage de l'historique du compte courant (mémoire + persistance). */
function clearHistory(_ev: PhoneEvent, ctx: PhoneCtx) {
  ctx.history = [];
  if (ctx.config) void ctx.store.saveHistory(accountKey(ctx.config), []).catch(() => {});
  return stay("historique vidé");
}

/**
 * Consigne l'appel terminé dans l'historique et le persiste (fire-and-forget :
 * un échec d'écriture ne doit pas perturber la machine — l'historique en
 * mémoire reste juste).
 *
 * Il n'y a plus rien à redériver : le bloc a suivi l'appel du début à la
 * fin, et son outcome *est* la colonne de l'historique. Ce qui reste ici
 * est ce que le bloc ne pouvait pas savoir — l'instant où l'utilisateur a
 * demandé l'appel, et quel compte le consigne.
 */
const LOG_OUTCOME: Record<CallReturn["type"], CallLogEntry["outcome"]> = {
  "call:answered": "answered",
  "call:dropped": "dropped",
  "call:rejected": "failed",
  "call:canceled": "canceled",
  "call:missed": "missed",
};

/**
 * Le carnet de l'appel qui se termine, pris à la session avant que la vue
 * ne soit rangée. Rien à consigner quand la trace était éteinte : c'est ce
 * qui décide de l'icône dans l'historique, et une ligne vide n'en porte pas.
 */
function traceOf(ctx: PhoneCtx): { trace?: TraceLine[] } {
  const lines = ctx.call?.session?.trace() ?? [];
  return lines.length > 0 ? { trace: lines } : {};
}

/**
 * Le bilan média du même appel, pris à la même session au même moment.
 * Rien à consigner quand rien n'a été mesuré — la trace était éteinte, ou
 * l'appel n'a jamais eu de média : la loupe n'apparaît alors pas.
 */
function statsOf(ctx: PhoneCtx): { stats?: MediaStats } {
  const stats = ctx.call?.session?.callStats() ?? null;
  return stats ? { stats } : {};
}

function recordCall(ctx: PhoneCtx, ev: CallReturn): void {
  const info = ctx.pendingCall;
  if (!info || !ctx.config) return;
  const d = ev.data;
  const connectedAt = "connectedAt" in d ? d.connectedAt : null;
  const entry: CallLogEntry = {
    target: info.target.replace(/^sips?:/i, ""),
    direction: info.direction,
    outcome: LOG_OUTCOME[ev.type],
    // entrant : les médias réellement acceptés, pas ceux proposés
    media: "media" in d ? d.media : info.media,
    startedAt: info.startedAt,
    connectedAt,
    endedAt: Date.now(),
    endedBy:
      ev.type === "call:answered" ? ev.data.endedBy : ev.type === "call:dropped" ? "network" : null,
    reason: "reason" in d ? d.reason : null,
    // le carnet du dialogue, si la trace était active : le bloc a publié une
    // dernière vue avant de rendre la main, session comprise (§5.3)
    ...traceOf(ctx),
    // et ce que le média a donné pendant ce temps-là (§5.4)
    ...statsOf(ctx),
  };
  ctx.history = recent([entry, ...ctx.history]);
  void ctx.store.saveHistory(accountKey(ctx.config), ctx.history).catch(() => {});
}

/**
 * Un appel à la fois : tout INVITE arrivant hors de `ready` est refusé sur
 * place (486 en communication, 480 sinon — l'UA est en train de tomber ou
 * de se rétablir). L'événement est consommé sans changer d'état.
 */
function refuseIncoming(reason: RejectReason) {
  return (ev: Extract<PhoneEvent, { type: "sip:incoming" }>): void => {
    ev.call.reject(reason);
  };
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
    ctx.lastError = msg("error.invalidUri");
    ctx.suspectFields = "credentials";
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
    ctx.lastError = msg("error.passwordRequired");
    ctx.suspectFields = "credentials";
    return stay("mot de passe manquant");
  }
  // serveurs ICE : optionnels, mais une saisie fautive ne doit pas être
  // enregistrée en silence — l'appel échouerait plus tard, sans explication
  const ice = parseIceForm(f, ctx.config?.ice ?? null);
  if (!ice.ok) {
    ctx.lastError = ice.error;
    ctx.suspectFields = ice.field;
    return stay("serveur ICE invalide");
  }
  ctx.config = {
    proxy: f.proxy,
    domain,
    displayName: f.displayName,
    username,
    authUsername,
    ha1,
    flashAlert: f.flashAlert,
    ice: ice.ice,
  };
  return goto("saving");
}

/**
 * Retour du bloc d'appel : consigner, ranger, et choisir où revenir.
 * L'ordre des trois sorties est une priorité — la veille a été demandée
 * explicitement, une coupure de proxy doit être reconnectée, et un
 * enregistrement perdu pendant l'appel prime sur un retour en `ready`.
 */
function back(ctx: PhoneCtx, ev: CallReturn, callError: Msg | null) {
  recordCall(ctx, ev);
  const sleep = ctx.sleepRequested;
  ctx.sleepRequested = false;
  ctx.pendingCall = null;
  ctx.incoming = null;
  ctx.call = null;
  ctx.callError = callError;
  if (sleep) return goto("sleeping", "veille : appel raccroché");
  if (ev.type === "call:dropped") {
    ctx.callError = msg("error.callDropped");
    return goto("reconnecting", "proxy perdu pendant l'appel");
  }
  return ctx.lastError
    ? goto("reg_failed", "enregistrement perdu pendant l'appel")
    : goto("ready", "appel terminé");
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
    pendingCall: null,
    incoming: null,
    call: null,
    callError: null,
    history: [],
    autoReconnect: false,
    sleepRequested: false,
  }),

  states: {
    initial_state: {
      enter(ctx, fx) {
        fx.task(
          ctx.store.load().then(async (config) => ({
            config,
            history: config ? await ctx.store.loadHistory(accountKey(config)) : [],
          })),
          "loadConfig",
          { timeout: 3000 },
        );
      },
      on: {
        "task:loadConfig": (ev, ctx) => {
          ctx.config = ev.ok ? ev.value.config : null;
          ctx.history = ev.ok ? recent(ev.value.history) : [];
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
        "sip:incoming": refuseIncoming("timeout"),
        "sys:sleep": () => undefined,
        "sys:wake": () => undefined,
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
        "sip:incoming": refuseIncoming("timeout"),
        "sys:sleep": () => undefined,
        "sys:wake": () => undefined,
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
        "sip:incoming": refuseIncoming("timeout"),
        "sip:registrationFailed": () => undefined,
        "sys:sleep": () => undefined,
        "sys:wake": () => undefined,
      },
      meta: { screen: "config" },
    },

    saving: {
      enter(ctx, fx) {
        const cfg = ctx.config!;
        // sauvegarde + chargement de l'historique du compte (re)configuré
        fx.task(
          ctx.store.save(cfg).then(() => ctx.store.loadHistory(accountKey(cfg))),
          "saveConfig",
          { timeout: 3000 },
        );
      },
      on: {
        "task:saveConfig": (ev, ctx) => {
          // même si la persistance échoue, la session en mémoire reste utilisable
          if (ev.ok) ctx.history = recent(ev.value);
          else {
            ctx.lastError = msg("error.saveFailed", { detail: String(ev.error) });
            ctx.history = [];
          }
          return goto("connecting");
        },
        "sys:sleep": () => undefined,
        "sys:wake": () => undefined,
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
        // pas encore enregistré : un INVITE qui traînerait est décliné
        "sip:incoming": refuseIncoming("timeout"),
        "sip:invalidProxy": (ev, ctx) =>
          fail(ctx, msg("error.invalidProxy"), `URL: ${ev.detail}`, "proxy"),
        "sip:disconnected": (_ev, ctx) =>
          fail(ctx, msg("error.wssRefused"), "WSS_CONNECT", "proxy"),
        "sys:sleep": () => goto("sleeping", "mise en veille"),
        "sys:wake": () => undefined,
      },
      after: {
        delay: 10_000,
        then: (ctx) =>
          fail(ctx, msg("error.wssTimeout"), "WSS_TIMEOUT", "proxy"),
      },
      meta: { screen: "call" },
    },

    registering: {
      on: {
        "sip:registered": () => goto("ready", "REGISTER OK"),
        "sip:incoming": refuseIncoming("timeout"),
        "sip:registrationFailed": (ev, ctx) =>
          isCredentialsError(ev.statusCode)
            ? fail(ctx, msg("error.badCredentials"), `SIP ${ev.statusCode}`, "credentials")
            : fail(
                ctx,
                msg("error.regRefused", { cause: ev.cause }),
                ev.statusCode ? `SIP ${ev.statusCode}` : ev.cause,
                "credentials",
              ),
        "sip:disconnected": (_ev, ctx) =>
          fail(ctx, msg("error.wssLostDuringReg"), "WSS_LOST", "proxy"),
        "sys:sleep": () => goto("sleeping", "mise en veille"),
        "sys:wake": () => undefined,
      },
      after: {
        delay: 30_000,
        then: (ctx) => fail(ctx, msg("error.registrarTimeout"), "SIP_TIMEOUT", "credentials"),
      },
      meta: { screen: "call" },
    },

    ready: {
      enter(ctx) {
        ctx.autoReconnect = false;
      },
      on: {
        "ui:call": (ev, ctx) => {
          const target = ev.target.trim();
          if (!target) return stay("cible vide");
          ctx.callError = null;
          ctx.pendingCall = {
            target,
            media: ev.media,
            direction: "outgoing",
            startedAt: Date.now(),
          };
          return goto("in_call", `appel vers ${target}`);
        },
        // INVITE entrant : même écran d'appel, le bloc démarre en sonnerie
        "sip:incoming": (ev, ctx) => {
          ctx.callError = null;
          ctx.incoming = ev.call;
          ctx.pendingCall = {
            target: ev.call.from,
            media: ev.call.offered,
            direction: "incoming",
            startedAt: Date.now(),
          };
          return goto("in_call", `appel entrant de ${ev.call.from}`);
        },
        // rafraîchissements périodiques du REGISTER
        "sip:registered": () => stay("re-REGISTER OK"),
        "sip:connected": () => undefined,
        // suites d'un appel déjà refermé : le refus émis par le bloc (603,
        // 480, ou 488 sur une offre inétablissable) éteint la session après
        // qu'il a rendu la main. Plus rien à décider — mais l'événement doit
        // être consommé, sinon il s'annonce comme un trou dans la table
        "sip:failed": () => undefined,
        "sip:ended": () => undefined,
        // sans code de réponse, l'échec vient du transport (REGISTER resté
        // sans réponse, socket morte) : on reconnecte au lieu d'accuser le compte
        "sip:registrationFailed": (ev, ctx) => {
          ctx.lastError = msg("error.regLost", { cause: ev.cause });
          ctx.lastErrorCode = ev.statusCode ? `SIP ${ev.statusCode}` : ev.cause;
          ctx.suspectFields = ev.statusCode ? "credentials" : "proxy";
          return ev.statusCode ? goto("reg_failed") : goto("reconnecting", "REGISTER sans réponse");
        },
        "sip:disconnected": (_ev, ctx) => {
          ctx.lastError = msg("error.proxyLost");
          ctx.lastErrorCode = "WSS_LOST";
          ctx.suspectFields = "proxy";
          return goto("reconnecting", "connexion perdue");
        },
        "ui:backToSettings": (_ev, ctx) => {
          stopSip(ctx);
          clearError(ctx);
          return goto("reconfiguring", "retour paramètres");
        },
        "ui:logout": () => goto("unregistering"),
        "ui:clearHistory": clearHistory,
        "sys:sleep": () => goto("sleeping", "mise en veille"),
        // réveil détecté : la WSS peut être morte sans que le navigateur le
        // sache. Un REGISTER sur le transport existant tranche — même Call-ID,
        // pas de nouveau contact chez le registrar. S'il reste sans réponse,
        // sip:registrationFailed emmène en reconnecting.
        "sys:wake": (_ev, ctx) => {
          if (ctx.handle?.refresh()) return stay("réveil : REGISTER rafraîchi");
          stopSip(ctx);
          return goto("connecting", "réveil : transport fermé");
        },
      },
      meta: { screen: "call" },
    },

    /**
     * L'appel, entier, tenu par un bloc : `in_call` l'entre et se suspend
     * là jusqu'à son retour. Le bloc écrit `ctx.call` — c'est ce que l'UI
     * rend — et consomme tout ce qui arrive pendant ce temps, y compris ce
     * dont la politique est ici : il laisse alors dans le contexte de quoi
     * décider (`lastError`, `sleepRequested`), et cet état ne fait plus que
     * choisir où revenir.
     */
    in_call: {
      enter(ctx, fx) {
        const req = ctx.pendingCall!;
        fx.sbb(CallBlock, {
          args: {
            target: req.target,
            media: req.media,
            direction: req.direction,
            incoming: ctx.incoming,
          },
        });
      },
      on: {
        "call:answered": (ev, ctx) => back(ctx, ev, null),
        "call:missed": (ev, ctx) => back(ctx, ev, ev.data.failed ? ev.data.reason : null),
        "call:canceled": (ev, ctx) => back(ctx, ev, null),
        "call:rejected": (ev, ctx) => back(ctx, ev, ev.data.reason),
        "call:dropped": (ev, ctx) => back(ctx, ev, null),
      },
      meta: { screen: "call" },
    },

    /**
     * Proxy perdu hors appel : nouvelle tentative toutes les 10 s en boucle
     * (les échecs de connexion reviennent ici via fail + autoReconnect).
     * L'appel est grisé (seul `ready` l'autorise), les paramètres restent
     * accessibles.
     */
    reconnecting: {
      enter(ctx) {
        stopSip(ctx);
        ctx.autoReconnect = true;
      },
      on: {
        "ui:retry": () => goto("connecting", "reconnexion manuelle"),
        // bouton grisé : on consomme pour éviter un appel rejoué à la reconnexion
        "ui:call": () => undefined,
        "ui:clearHistory": clearHistory,
        "ui:backToSettings": (_ev, ctx) => {
          ctx.autoReconnect = false;
          return goto("reconfiguring", "paramètres");
        },
        "ui:logout": (_ev, ctx) => {
          ctx.autoReconnect = false;
          return goto("home", "déconnexion");
        },
        "sip:disconnected": () => undefined,
        "sip:unregistered": () => undefined,
        "sip:incoming": refuseIncoming("timeout"),
        "sip:registrationFailed": () => undefined,
        "sip:invalidProxy": () => undefined,
        "sys:sleep": () => goto("sleeping", "mise en veille"),
        "sys:wake": () => goto("connecting", "réveil : réenregistrement"),
      },
      after: {
        delay: 10_000,
        then: () => goto("connecting", "nouvelle tentative"),
      },
      meta: { screen: "call" },
    },

    /** Veille machine : appels raccrochés, UA désenregistré ; le réveil réenregistre. */
    sleeping: {
      enter(ctx) {
        stopSip(ctx);
        ctx.autoReconnect = false;
      },
      on: {
        "sys:wake": () => goto("connecting", "réveil : réenregistrement"),
        "sys:sleep": () => undefined,
        // bouton grisé : on consomme pour éviter un appel rejoué à la reconnexion
        "ui:call": () => undefined,
        "ui:clearHistory": clearHistory,
        "sip:disconnected": () => undefined,
        "sip:unregistered": () => undefined,
        "sip:incoming": refuseIncoming("timeout"),
        "sip:registrationFailed": () => undefined,
        "ui:logout": () => goto("home"),
        "ui:backToSettings": () => goto("reconfiguring"),
      },
      meta: { screen: "call" },
    },

    reg_failed: {
      enter(ctx) {
        stopSip(ctx);
      },
      on: {
        "ui:retry": () => goto("connecting"),
        "ui:clearHistory": clearHistory,
        "ui:backToSettings": () => goto("configuring"),
        "ui:logout": () => goto("home"),
        // suites de l'arrêt de l'UA : consommées sans effet
        "sip:disconnected": () => undefined,
        "sip:unregistered": () => undefined,
        "sip:incoming": refuseIncoming("timeout"),
        "sip:registrationFailed": () => undefined,
        "sip:invalidProxy": () => undefined,
        "sys:sleep": () => undefined,
        "sys:wake": () => undefined,
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
        "sip:incoming": refuseIncoming("timeout"),
        "sip:disconnected": (_ev, ctx) => {
          ctx.handle = null;
          return goto("home", "déconnecté");
        },
        "sys:sleep": () => undefined,
        "sys:wake": () => undefined,
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
