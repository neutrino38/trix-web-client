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

import { defineMachine, goto, stay, type Fx } from "finite-state-language";
import {
  newAccountId,
  type AccountConfig,
  type CallDirection,
  type CallLogEntry,
  type SecureStore,
  type StoredAccount,
  type Vault,
} from "../storage/store.js";
import { findByAddress } from "../accounts.js";
import { resumeAccount, setResumeAccount } from "../storage/session.js";
import type { CallMedia, IncomingCall, RejectReason, SipHandle, SipPort } from "../sip/port.js";
import type { TraceLine } from "../sip/record.js";
import type { MediaStats } from "../sip/stats.js";
import type { ChatItem } from "../sip/transcript.js";
import { computeHa1, computeHa1Sha256 } from "../storage/ha1.js";
import { parseSipUri } from "../sip/uri.js";
import { CallBlock } from "./call.js";
import type { CallReturn, CallView, PhoneEvent, SuspectField } from "./events.js";
import { parseIceForm } from "../sip/ice.js";
import { parseRttTransport } from "../sip/rtt.js";
import { deployment, pinAccount } from "../deployment.js";
import { msg, type Msg } from "../i18n/types.js";

export interface PhoneCtx {
  /** Injectés via start({ args }) — jamais recréés par la machine. */
  store: SecureStore;
  sip: SipPort;
  /**
   * La conversation de l'appel qui se termine, à consigner dans sa ligne
   * d'historique (§4.9). Injecté comme les deux précédents : le fil est
   * décodé et tenu par le panneau de tchat, et la machine n'a pas à
   * connaître un écran pour le ranger. Rend un fil vide par défaut — un
   * hôte qui n'affiche pas de tchat n'en consigne pas.
   */
  transcript: () => ChatItem[];
  /**
   * Les comptes du coffre, dans l'ordre où ils y sont (ADR 0002). La
   * machine en manipule une liste sans savoir combien il en tient : la
   * limite est une affaire d'interface (`src/accounts.ts`).
   */
  accounts: StoredAccount[];
  /** Le compte que l'application enregistre — `null` tant qu'aucun n'est choisi. */
  activeId: string | null;
  /**
   * Le compte que le formulaire modifie, `null` pour une création. Ce n'est
   * **pas** forcément l'actif : on modifie le compte au repos pendant que
   * l'autre est enregistré. Toute la validation s'y adosse — conservation du
   * HA1 quand le mot de passe est laissé vide, comparaison du domaine,
   * reprise du mot de passe TURN. La comparer à l'actif attribuerait
   * silencieusement le HA1 d'un compte à l'autre.
   */
  editing: string | null;
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
  /** Compte dont la suppression est en cours d'écriture (état `deleting`). */
  pendingDelete: string | null;
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

/**
 * Le compte enregistré, ou `null`. C'est ce que lisent les écrans et ce que
 * le port SIP reçoit ; l'identité de l'appelant, l'historique affiché et le
 * domaine des cibles composées en découlent tous.
 */
export function activeAccount(ctx: PhoneCtx): StoredAccount | null {
  return ctx.accounts.find((a) => a.id === ctx.activeId) ?? null;
}

/** Le compte que le formulaire modifie — `null` en création. */
export function editedAccount(ctx: PhoneCtx): StoredAccount | null {
  return ctx.accounts.find((a) => a.id === ctx.editing) ?? null;
}

/** Le coffre tel qu'il doit être persisté, dérivé du contexte. */
function vaultOf(ctx: PhoneCtx): Vault {
  return { accounts: ctx.accounts, activeId: ctx.activeId };
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

/**
 * Oublier que ce compte doit être enregistré (ADR 0006, D4). Le marqueur
 * est posé par `ready` et retiré ici, et ici seulement : fermer l'onglet,
 * le recharger ou le voir déchargé par le navigateur ne sont pas des
 * décisions de l'utilisateur, « Déconnexion » en est une.
 *
 * La suppression du compte passe par le même chemin sans le nommer : un
 * marqueur qui désigne un compte absent du coffre ne reprend rien.
 */
function forgetResume(ctx: PhoneCtx): void {
  if (resumeAccount() === ctx.activeId) setResumeAccount(null);
}

function clearError(ctx: PhoneCtx): void {
  ctx.lastError = null;
  ctx.lastErrorCode = null;
  ctx.suspectFields = null;
}

/** Vidage de l'historique du compte courant (mémoire + persistance). */
function clearHistory(_ev: PhoneEvent, ctx: PhoneCtx) {
  ctx.history = [];
  if (ctx.activeId) void ctx.store.saveHistory(ctx.activeId, []).catch(() => {});
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

/**
 * La conversation du même appel. Elle ne vient pas de la session, elle :
 * le fil se décode et s'affiche dans le panneau (§4.9), et la machine ne
 * sait rien du texte échangé — elle en reçoit un **lecteur**, branché à
 * la composition comme le coffre et le port (`main.ts`). Rien à consigner
 * quand personne n'a écrit : la bulle « T » n'apparaît alors pas.
 *
 * Le moment est le bon : le bloc a rendu la main, l'écran n'a pas encore
 * été re-rendu, donc le panneau tient encore le fil de l'appel qui vient
 * de finir.
 */
function chatOf(ctx: PhoneCtx): { chat?: ChatItem[] } {
  const items = ctx.transcript();
  return items.length > 0 ? { chat: items } : {};
}

function recordCall(ctx: PhoneCtx, ev: CallReturn): void {
  const info = ctx.pendingCall;
  if (!info || !ctx.activeId) return;
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
    // la conversation, s'il y en a eu une (§4.9) — sans condition, elle
    ...chatOf(ctx),
  };
  ctx.history = recent([entry, ...ctx.history]);
  void ctx.store.saveHistory(ctx.activeId, ctx.history).catch(() => {});
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

/**
 * Le défi que Trix n'a pas su relever passe devant tous les autres motifs
 * d'enregistrement refusé. C'est le seul où le 401 ne dit rien des
 * identifiants — le mot de passe est peut-être le bon, mais le compte n'a
 * pas d'empreinte SHA-256 à opposer au serveur (RFC 8760), parce qu'il a
 * été enregistré avant qu'on en calcule une. Le dire ainsi, c'est indiquer
 * du même coup le remède : ressaisir le mot de passe, qui la calculera.
 */
function unansweredChallenge(
  ev: Extract<PhoneEvent, { type: "sip:registrationFailed" }>,
): { error: Msg; code: string } | null {
  return ev.missingSha256 ? { error: msg("error.missingSha256"), code: "SHA256_MISSING" } : null;
}

/**
 * Validation + HA1 du formulaire, partagé par configuring et reconfiguring.
 *
 * Tout ce qui se compare à « le compte enregistré » se compare ici au
 * compte **édité** (`ctx.editing`), qui n'est pas forcément l'actif : c'est
 * la seule façon que modifier le compte au repos ne lui attribue pas le HA1
 * de l'autre (ADR 0002, décision 5).
 */
function saveConfig(ev: Extract<PhoneEvent, { type: "ui:saveConfig" }>, ctx: PhoneCtx) {
  const f = ev.form;
  const edited = editedAccount(ctx);
  // ce que l'exploitant impose (`config.json`) : le formulaire n'en montre
  // pas les champs, et cette fonction n'en lit pas la saisie — un formulaire
  // trafiqué ne peut donc pas placer le compte ailleurs que sur ce
  // déploiement
  const dep = deployment();
  const parsed = parseSipUri(f.uri);
  if (!parsed) {
    ctx.lastError = msg("error.invalidUri");
    ctx.suspectFields = "credentials";
    return stay("URI invalide");
  }
  const { username, domain } = parsed;
  // le domaine imposé n'est pas une valeur par défaut : une adresse d'un
  // autre domaine ne s'enregistrerait sur rien ici, autant le dire au lieu
  // de la corriger en douce
  if (dep.domain !== null && domain !== dep.domain) {
    ctx.lastError = msg("error.wrongDomain", { domain: dep.domain });
    ctx.suspectFields = "credentials";
    return stay("domaine imposé");
  }
  // une adresse SIP ne peut pas être enregistrée deux fois : le second
  // compte ne s'enregistrerait pas, et les deux partageraient un historique
  // qui n'aurait de sens pour aucun des deux (ADR 0002, décision 6)
  const address = `${username}@${domain}`;
  if (findByAddress(ctx.accounts, address, ctx.editing)) {
    ctx.lastError = msg("error.duplicateAccount", { address });
    ctx.suspectFields = "credentials";
    return stay("adresse déjà enregistrée");
  }
  const authUsername = f.authUsername?.trim() || null;
  // le HA1 dépend de l'identité d'authentification effective et du realm (= domaine)
  const authId = authUsername ?? username;
  const prevAuthId = edited ? (edited.authUsername ?? edited.username) : null;
  // les deux empreintes se calculent ensemble, du même mot de passe : c'est
  // le serveur qui choisira laquelle il défie (RFC 8760). Sans mot de passe
  // saisi, on garde celles du compte édité — dont l'empreinte SHA-256
  // peut être vide, s'il date d'avant elle
  const kept =
    edited && prevAuthId === authId && edited.domain === domain
      ? { ha1: edited.ha1, ha1Sha256: edited.ha1Sha256 }
      : null;
  const fingerprints =
    f.password !== null && f.password !== ""
      ? {
          ha1: computeHa1(authId, domain, f.password),
          ha1Sha256: computeHa1Sha256(authId, domain, f.password),
        }
      : kept;
  if (!fingerprints) {
    ctx.lastError = msg("error.passwordRequired");
    ctx.suspectFields = "credentials";
    return stay("mot de passe manquant");
  }
  // serveurs ICE : optionnels, mais une saisie fautive ne doit pas être
  // enregistrée en silence — l'appel échouerait plus tard, sans explication.
  // Imposés par le déploiement, il n'y a rien à valider : ils ne viennent
  // pas du formulaire.
  let ice = dep.ice;
  if (!ice) {
    const parsedIce = parseIceForm(f, edited?.ice ?? null);
    if (!parsedIce.ok) {
      ctx.lastError = parsedIce.error;
      ctx.suspectFields = parsedIce.field;
      return stay("serveur ICE invalide");
    }
    ice = parsedIce.ice;
  }
  const account: StoredAccount = {
    // un compte modifié garde son identifiant, donc son historique — c'est
    // tout l'intérêt de ne pas le nommer par son adresse
    id: edited?.id ?? newAccountId(),
    proxy: dep.proxy ?? f.proxy,
    domain,
    displayName: f.displayName,
    username,
    authUsername,
    ...fingerprints,
    flashAlert: f.flashAlert,
    ice,
    // rien à valider : le choix vient d'un bouton radio, et une valeur
    // inconnue (compte migré, formulaire trafiqué) retombe sur le défaut
    rtt: dep.rtt ?? parseRttTransport(f.rtt),
  };
  ctx.accounts = edited
    ? ctx.accounts.map((a) => (a.id === account.id ? account : a))
    : [...ctx.accounts, account];
  // « Enregistrer et se connecter » : le compte que l'on vient de remplir
  // est celui sur lequel on repart, qu'il fût l'actif ou non
  ctx.activeId = account.id;
  ctx.editing = account.id;
  return goto("saving");
}

/**
 * Écrit le coffre et relit l'historique du compte actif — le même travail
 * pour `saving` (le formulaire vient d'être validé) et pour `switching`
 * (c'est `activeId` qui vient de changer). Les deux repartent ensuite en
 * `connecting` : ce qui suit une écriture réussie ou ratée est ce qui les
 * distingue, pas l'écriture elle-même.
 */
function persistVault(ctx: PhoneCtx, fx: Fx<PhoneEvent, PhoneCtx>): void {
  const id = ctx.activeId!;
  fx.task(ctx.store.save(vaultOf(ctx)).then(() => ctx.store.loadHistory(id)), "saveVault", {
    timeout: 3000,
  });
}

/**
 * Suppression du compte que le formulaire modifie (ADR 0002, décision 7).
 * L'opération efface l'enregistrement **et son historique** ; c'est l'état
 * `deleting` qui écrit, celui-ci ne fait que retirer le compte de la
 * session et désigner ce qui prend sa place.
 *
 * Rien n'est proposé pour un formulaire de création : il n'y a pas de
 * compte à supprimer, et l'écran ne montre pas le bouton.
 */
function deleteAccount(_ev: PhoneEvent, ctx: PhoneCtx) {
  const id = ctx.editing;
  if (!id || !ctx.accounts.some((a) => a.id === id)) return stay("aucun compte à supprimer");
  ctx.accounts = ctx.accounts.filter((a) => a.id !== id);
  ctx.pendingDelete = id;
  // supprimer l'actif ne promeut pas l'autre : on retourne à l'accueil, où
  // le compte restant se choisit d'un clic — se réenregistrer ailleurs sans
  // qu'on l'ait demandé serait une décision prise à la place de quelqu'un
  if (ctx.activeId === id) {
    ctx.activeId = null;
    ctx.history = [];
  }
  clearError(ctx);
  return goto("deleting");
}

/**
 * Bascule vers l'autre compte, depuis l'en-tête de l'écran d'appel. Elle
 * emprunte un chemin qui existe déjà — arrêter l'UA, repartir en
 * `connecting` avec une autre configuration — via `switching`, qui écrit le
 * coffre et charge l'historique du compte qui prend la main. Il n'y a pas
 * de second UA à faire cohabiter, et il ne faut surtout pas en inventer un
 * (ADR 0002).
 *
 * L'interdiction pendant un appel n'est pas ici : `in_call` a rendu la main
 * au bloc, qui consomme l'événement sans effet — la garantie ne repose pas
 * sur l'état d'un bouton.
 */
function switchAccount(ev: Extract<PhoneEvent, { type: "ui:switchAccount" }>, ctx: PhoneCtx) {
  if (ev.id === ctx.activeId) return stay("déjà ce compte");
  if (!ctx.accounts.some((a) => a.id === ev.id)) return stay("compte inconnu");
  ctx.activeId = ev.id;
  return goto("switching", "changement de compte");
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
    transcript: () => [],
    accounts: [],
    activeId: null,
    editing: null,
    handle: null,
    lastError: null,
    lastErrorCode: null,
    suspectFields: null,
    pendingCall: null,
    incoming: null,
    call: null,
    callError: null,
    history: [],
    pendingDelete: null,
    autoReconnect: false,
    sleepRequested: false,
  }),

  states: {
    initial_state: {
      enter(ctx, fx) {
        fx.task(
          ctx.store.load().then(async (vault) => {
            // Le marqueur de reprise (ADR 0006, D4) vit hors du coffre et
            // dit une autre chose que `activeId` : non pas quel compte est
            // choisi, mais que ce compte *doit* être enregistré. Il est lu
            // ici, avant l'historique, parce que c'est lui qui décide duquel
            // on a besoin — les deux coïncident sauf si l'écriture du coffre
            // avait échoué.
            const resume = resumeAccount();
            const activeId = vault.accounts.some((a) => a.id === resume)
              ? resume
              : vault.activeId;
            return {
              vault,
              activeId,
              resume: activeId !== null && activeId === resume,
              history: activeId ? await ctx.store.loadHistory(activeId) : [],
            };
          }),
          "loadVault",
          { timeout: 3000 },
        );
      },
      on: {
        "task:loadVault": (ev, ctx) => {
          // les comptes relus passent par le déploiement avant d'être
          // adoptés : proxy, serveurs ICE et transport texte imposés
          // écrasent ce qui avait été enregistré, et un compte d'un autre
          // domaine que le domaine imposé est écarté — son HA1 a été calculé
          // sur ce domaine-là (§6), rien ne peut le rattraper ici. Si c'est
          // l'actif qui disparaît ainsi, l'accueil repart sur ce qui reste.
          const vault = ev.ok ? ev.value.vault : null;
          ctx.accounts = (vault?.accounts ?? []).flatMap((a) => {
            const pinned = pinAccount(a);
            return pinned ? [{ ...pinned, id: a.id }] : [];
          });
          const wanted = ev.ok ? ev.value.activeId : null;
          ctx.activeId = ctx.accounts.some((a) => a.id === wanted) ? wanted : null;
          ctx.history = ctx.activeId && ev.ok ? recent(ev.value.history) : [];
          // D4 : quel que soit le motif du chargement — onglet déchargé par
          // l'Économiseur de mémoire, F5, redémarrage du navigateur —, un
          // compte marqué « à reprendre » se réenregistre sans rien
          // demander. Le distinguer par `document.wasDiscarded` aurait donné
          // deux comportements à deux rechargements que l'utilisateur ne
          // distingue pas ; ce drapeau ne sert donc qu'à **expliquer**
          // l'absence (`ui/reachability.ts`).
          if (ctx.activeId && ev.ok && ev.value.resume) {
            return goto("connecting", "reprise de l'enregistrement");
          }
          return goto("home", ctx.accounts.length > 0 ? "compte trouvé" : "aucun compte");
        },
        // le temps de lire le coffre, il n'y a pas d'UA : rien à
        // désenregistrer, rien à rafraîchir. Un gel qui tomberait ici ne
        // doit pas pour autant empêcher la reprise qui suit
        "sys:sleep": () => undefined,
        "sys:wake": () => undefined,
      },
      meta: { screen: "boot" },
    },

    home: {
      on: {
        "ui:configure": (ev, ctx) => {
          clearError(ctx);
          // `id: null` ouvre un formulaire vide — ajouter un compte, et non
          // écraser celui qui est là
          ctx.editing = ev.id;
          return goto("configuring");
        },
        "ui:useAccount": (ev, ctx) => {
          if (!ctx.accounts.some((a) => a.id === ev.id)) return stay("compte inconnu");
          ctx.activeId = ev.id;
          return goto("switching", "compte choisi");
        },
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
        "ui:deleteAccount": deleteAccount,
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
        "ui:deleteAccount": deleteAccount,
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
      enter: persistVault,
      on: {
        "task:saveVault": (ev, ctx) => {
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

    /**
     * Changement de compte actif — depuis l'accueil ou depuis l'en-tête de
     * l'écran d'appel. Le même travail que `saving` : persister le coffre
     * (c'est `activeId` qui vient de changer) et charger l'historique du
     * compte qui prend la main, avant de repartir en `connecting`.
     *
     * Un état à lui, et non `saving`, parce que l'écran n'est pas le même :
     * on ne revient pas au formulaire de paramètres pour avoir cliqué sur
     * un nom de compte.
     */
    switching: {
      enter(ctx, fx) {
        stopSip(ctx);
        ctx.autoReconnect = false;
        // rien de l'ancien compte ne doit survivre à la bascule : ni son
        // journal d'appels à l'écran, ni l'erreur de son enregistrement
        ctx.history = [];
        clearError(ctx);
        persistVault(ctx, fx);
      },
      on: {
        "task:saveVault": (ev, ctx) => {
          if (ev.ok) ctx.history = recent(ev.value);
          return goto("connecting", "compte changé");
        },
        "sip:disconnected": () => undefined,
        "sip:unregistered": () => undefined,
        "sip:registrationFailed": () => undefined,
        "sip:incoming": refuseIncoming("timeout"),
        "sys:sleep": () => undefined,
        "sys:wake": () => undefined,
      },
      meta: { screen: "call" },
    },

    /**
     * Suppression du compte que le formulaire modifiait : le coffre amputé
     * est écrit, puis son historique effacé. Dans cet ordre — un historique
     * orphelin est un désagrément, un compte sans son historique est une
     * fuite : quelques dizaines d'appels chiffrés sous une clé que plus
     * personne ne lit.
     */
    deleting: {
      enter(ctx, fx) {
        stopSip(ctx);
        ctx.autoReconnect = false;
        const id = ctx.pendingDelete!;
        fx.task(
          ctx.store.save(vaultOf(ctx)).then(() => ctx.store.deleteHistory(id)),
          "deleteAccount",
          { timeout: 3000 },
        );
      },
      on: {
        // l'échec d'écriture ne change rien à la décision : le compte a
        // disparu de la session, et l'accueil ne le propose plus
        "task:deleteAccount": (_ev, ctx) => {
          ctx.pendingDelete = null;
          ctx.editing = null;
          return goto("home", "compte supprimé");
        },
        "sys:sleep": () => undefined,
        "sys:wake": () => undefined,
      },
      meta: { screen: "config" },
    },

    connecting: {
      enter(ctx, fx) {
        clearError(ctx);
        ctx.handle = ctx.sip.start(activeAccount(ctx)!, (ev) => fx.send(ev));
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
        "sip:registrationFailed": (ev, ctx) => {
          const unanswered = unansweredChallenge(ev);
          if (unanswered) return fail(ctx, unanswered.error, unanswered.code, "credentials");
          return isCredentialsError(ev.statusCode)
            ? fail(ctx, msg("error.badCredentials"), `SIP ${ev.statusCode}`, "credentials")
            : fail(
                ctx,
                msg("error.regRefused", { cause: ev.cause }),
                ev.statusCode ? `SIP ${ev.statusCode}` : ev.cause,
                "credentials",
              );
        },
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
        // D4 : l'enregistrement a réussi — ce compte *doit* être enregistré,
        // et le chargement suivant le reprendra sans rien demander, que la
        // page ait été rechargée, déchargée par l'Économiseur de mémoire ou
        // rouverte après un redémarrage du navigateur. Hors du coffre, parce
        // qu'il faut pouvoir le lire même quand celui-ci refuse de s'ouvrir.
        setResumeAccount(ctx.activeId);
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
          // le rafraîchissement d'un REGISTER peut se heurter à un serveur
          // qui a changé d'algorithme depuis l'enregistrement initial :
          // le défi resté sans réponse prime alors sur « enregistrement perdu »
          const unanswered = unansweredChallenge(ev);
          ctx.lastError = unanswered?.error ?? msg("error.regLost", { cause: ev.cause });
          ctx.lastErrorCode =
            unanswered?.code ?? (ev.statusCode ? `SIP ${ev.statusCode}` : ev.cause);
          ctx.suspectFields = unanswered || ev.statusCode ? "credentials" : "proxy";
          return unanswered || ev.statusCode
            ? goto("reg_failed")
            : goto("reconnecting", "REGISTER sans réponse");
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
          // les paramètres s'ouvrent sur le compte enregistré : c'est celui
          // dont on vient, et le seul que l'en-tête désigne
          ctx.editing = ctx.activeId;
          return goto("reconfiguring", "retour paramètres");
        },
        "ui:switchAccount": switchAccount,
        "ui:logout": (_ev, ctx) => {
          // « Déconnexion » est le seul geste qui efface le marqueur de
          // reprise : c'est la différence entre une page qu'on ferme et un
          // téléphone qu'on éteint (D4)
          forgetResume(ctx);
          return goto("unregistering");
        },
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
          ctx.editing = ctx.activeId;
          return goto("reconfiguring", "paramètres");
        },
        "ui:switchAccount": switchAccount,
        "ui:logout": (_ev, ctx) => {
          ctx.autoReconnect = false;
          forgetResume(ctx);
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
        "ui:logout": (_ev, ctx) => {
          forgetResume(ctx);
          return goto("home");
        },
        "ui:switchAccount": switchAccount,
        "ui:backToSettings": (_ev, ctx) => {
          ctx.editing = ctx.activeId;
          return goto("reconfiguring");
        },
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
        "ui:switchAccount": switchAccount,
        // le compte dont l'enregistrement vient d'échouer : c'est celui-là
        // qu'il faut corriger, et l'erreur reste affichée sur son formulaire
        "ui:backToSettings": (_ev, ctx) => {
          ctx.editing = ctx.activeId;
          return goto("configuring");
        },
        "ui:logout": (_ev, ctx) => {
          forgetResume(ctx);
          return goto("home");
        },
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
