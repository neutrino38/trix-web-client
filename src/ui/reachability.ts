/**
 * La joignabilité — **un téléphone qui ment est pire qu'un téléphone
 * éteint** (ADR 0006).
 *
 * L'onglet reste dans la barre avec son titre et son icône, et plus
 * personne ne peut vous appeler : le navigateur en a décidé seul, et c'est
 * son comportement par défaut. Ce module est le seul endroit qui sache
 * **si l'on est joignable**, et le seul qui le dise — dans la page, dans
 * l'onglet, et hors de la page.
 *
 * Les canaux sont ceux de l'appel entrant (`ui/alert.ts`), pour les mêmes
 * raisons d'accessibilité : rien ne repose sur le son, rien ne repose sur
 * la couleur seule (RGAA 3.1).
 *
 * | canal                | ce qu'il couvre                                  |
 * |----------------------|--------------------------------------------------|
 * | phrase dans la page  | l'application est à l'écran                       |
 * | titre et favicon     | l'onglet est en arrière-plan, sans clignotement   |
 * | notification système | la fenêtre est masquée ou minimisée               |
 *
 * Sans clignotement, volontairement (D2) : une alerte permanente qui bat
 * serait une alarme, or il n'y a rien à décrocher. Et la notification
 * n'est posée qu'après **10 s** d'injoignabilité continue — sans ce
 * seuil, une reconnexion de trois secondes réveillerait tout le monde.
 *
 * Un seul point d'entrée, idempotent : `watchReachability`, appelé depuis
 * `main.ts` comme l'est `watchSystemLifecycle`.
 */

import type { PhoneInstance } from "../machines/phone.js";
import type { PageSleepReason } from "./lifecycle.js";
import {
  alertPosted,
  lastReachableAt,
  markReachable,
  pinHintShown,
  resumeAccount,
  setAlertPosted,
  setPinHintShown,
} from "../storage/session.js";
import { alertPermission } from "./alert.js";
import { clearNotice, showNotice } from "./notify.js";
import { setFaviconState } from "./favicon.js";
import { setTitleOverride } from "./title.js";
import { t } from "../i18n/index.js";
import type { MsgKey } from "../i18n/types.js";

/**
 * Les trois niveaux de D1 — et non un booléen.
 *
 * À l'étape 1, **rien ne produit jamais `deferred`** : aucun code ne
 * l'écrit, aucun écran ne l'affiche, et le niveau se lit comme un booléen.
 * Il figure quand même ici, parce que le jour où le push arrivera (ADR
 * 0007), « la page dort » cessera de vouloir dire « vous êtes
 * injoignable » : le prévoir coûte une branche morte, ne pas le prévoir
 * coûterait la reprise de toute la logique d'alerte et de ses six
 * traductions.
 */
export type Reachability = "direct" | "deferred" | "none";

/**
 * Pourquoi l'on n'est pas joignable — ce qui fait la phrase. Les deux
 * premiers motifs viennent de `ui/lifecycle.ts`, les autres se constatent
 * ici : le réseau sur `navigator.onLine`, le déchargement sur
 * `document.wasDiscarded` au chargement suivant, et `lost` quand rien
 * n'explique l'absence — l'enregistrement est simplement tombé, ce qui est
 * le cas le plus courant et mérite mieux qu'un motif emprunté à un autre.
 *
 * Le `leave` de `PageSleepReason` n'y figure pas, et c'est pour cela que
 * cette liste est écrite et non dérivée : une page qui s'en va n'a plus
 * personne à qui expliquer quoi que ce soit.
 */
export type UnreachableReason = "freeze" | "system" | "offline" | "discard" | "lost";

/** Sous ce seuil, ce n'est pas une absence : c'est une reconnexion (D2). */
const NOTIFY_AFTER_MS = 10_000;
/**
 * Un seul tag pour les deux notifications, l'absence et le retour : c'est
 * ce qui permet à la seconde d'effacer la première (D8).
 */
const TAG = "trix-reachability";
/**
 * Période de l'horodatage « dernier instant joignable ». Il n'est écrit
 * que sur un onglet **visible et joignable** : un onglet caché ne bat pas
 * (D6), et son dernier battement est celui de sa mise en arrière-plan.
 */
const STAMP_MS = 15_000;
/** Pastille d'injoignabilité — la même teinte que l'état « erreur » du thème. */
const DOT_COLOR = "#E94E3C";

const NOTIF_BODY: Record<UnreachableReason, MsgKey> = {
  freeze: "reach.notifFreeze",
  system: "reach.notifSystem",
  offline: "reach.notifOffline",
  discard: "reach.notifDiscard",
  lost: "reach.notifLost",
};

let watched: PhoneInstance | null = null;
let level: Reachability = "none";
/** Début de l'épisode d'injoignabilité en cours, `0` quand il n'y en a pas. */
let episodeSince = 0;
/** Le dernier motif rapporté, en attente d'un épisode à expliquer. */
let noted: UnreachableReason | null = null;
/** Le motif de l'épisode en cours, arrêté à son début. */
let episodeReason: UnreachableReason = "system";
/**
 * La page s'en va (`pagehide`) : on se désenregistre comme pour un gel,
 * mais on n'alerte personne. Fermer un onglet ou naviguer ailleurs est une
 * décision de l'utilisateur, il n'a pas à en être prévenu — et une alerte
 * `requireInteraction` posée par une page qui n'existera plus dans un
 * instant ne pourrait plus être effacée par personne (D8).
 */
let leaving = false;
let notifyTimer: ReturnType<typeof setTimeout> | null = null;
let stampTimer: ReturnType<typeof setInterval> | null = null;
let notification: Notification | null = null;

/**
 * L'épisode d'injoignabilité que la page a trouvé **en se chargeant** : le
 * navigateur avait déchargé l'onglet, et personne n'a pu le dire sur le
 * moment. Calculé une seule fois, à l'import — `document.wasDiscarded`
 * décrit ce chargement-ci, et l'horodatage sera réécrit dès que l'on
 * redeviendra joignable.
 *
 * Il ne décide de rien : la reprise de l'enregistrement, elle, a lieu quel
 * que soit le motif du chargement (D4). Il ne sert qu'à **expliquer**.
 */
const discarded: { from: number; to: number } | null = (() => {
  // hors navigateur (tests unitaires des écrans), il n'y a pas de document
  // à interroger, et rien d'un chargement précédent à expliquer
  if (typeof document === "undefined") return null;
  // `wasDiscarded` n'est pas typé partout : on décrit le peu qu'on en lit
  const doc = document as Document & { wasDiscarded?: boolean };
  if (doc.wasDiscarded !== true) return null;
  const from = lastReachableAt();
  return from === null ? null : { from, to: Date.now() };
})();

/** Le message d'après-déchargement, tant qu'il n'a pas été masqué. */
let discardNotice = discarded !== null;

// un chargement qui suit un déchargement explique déjà le premier épisode
// de cette page : inutile d'attendre un signal qui ne viendra pas
if (discarded) noted = "discard";

/**
 * Le rappel « épinglez l'onglet » (D6) : une fois, au premier
 * endormissement constaté, et jamais plus. Trix ne cherche pas à échapper
 * au gel — pas de piste audio muette, pas de `MediaStream` fantôme : ces
 * ruses consomment la batterie de quelqu'un pour contourner une décision
 * qu'il a prise. Il dit en revanche ce qui dépend de lui.
 */
let pinHint = discarded !== null && !pinHintShown();
if (pinHint) setPinHintShown();

/**
 * Le niveau dérivé de l'état de la machine, et de lui seul (D1). `ready`
 * et `in_call` sont les deux états où le contact est vivant chez le
 * registrar ; tous les autres passent par `stopSip()`.
 */
export function reachabilityOf(state: string): Reachability {
  return state === "ready" || state === "in_call" ? "direct" : "none";
}

/**
 * Cette absence-là mérite-t-elle qu'on en fasse une affaire ? Seulement si
 * l'utilisateur voulait être joignable — c'est exactement ce que dit le
 * marqueur de reprise (D4). Sans lui, personne n'a demandé à être
 * enregistré : l'accueil, un formulaire ouvert ou une première connexion
 * en cours ne sont pas des pannes, et n'ont rien à annoncer.
 */
function wanted(): boolean {
  return resumeAccount() !== null;
}

/**
 * La phrase que la page affiche, ou `null` quand il n'y a rien à dire.
 *
 * `direct` ne se redit pas : la pastille de l'en-tête porte déjà
 * « Enregistré », et une phrase de plus pour confirmer que tout va bien
 * n'informerait personne. `deferred` n'en a pas non plus, mais pour une
 * autre raison — à l'étape 1, rien ne le produit (D1).
 *
 * Et rien ne se dit tant que personne n'a demandé à être joignable : un
 * formulaire ouvert, une première connexion en cours ou l'accueil ne sont
 * pas des pannes.
 */
export function reachSentence(state: string): MsgKey | null {
  return reachabilityOf(state) === "none" && wanted() ? "reach.none" : null;
}

/**
 * La période d'injoignabilité constatée au chargement, tant qu'elle n'a
 * pas été masquée. `null` quand ce chargement n'en suit aucune.
 */
export function discardedEpisode(): { from: number; to: number } | null {
  return discardNotice ? discarded : null;
}

export function dismissDiscardNotice(): void {
  discardNotice = false;
}

/** Le rappel sur l'épinglage est-il à montrer maintenant ? */
export function pinHintDue(): boolean {
  return pinHint;
}

export function dismissPinHint(): void {
  pinHint = false;
}

/**
 * Le motif rapporté par `ui/lifecycle.ts`, retenu pour la phrase de la
 * notification. Il ne vaut que pour l'épisode qui commence : un gel
 * d'hier n'explique pas une WSS coupée aujourd'hui.
 */
export function noteSleepReason(reason: PageSleepReason): void {
  if (reason === "leave") {
    leaving = true;
    return;
  }
  leaving = false;
  noted = reason;
}

/**
 * Le motif à retenir au début d'un épisode, du plus sûr au plus vague : un
 * navigateur qui se dit hors ligne le sait mieux que nous, puis vient ce
 * que le cycle de vie a rapporté, et à défaut rien de plus que le constat —
 * l'enregistrement est tombé, et on ne sait pas de quoi.
 */
function reasonOf(): UnreachableReason {
  if (!navigator.onLine) return "offline";
  return noted ?? "lost";
}

// ---------------------------------------------------------------------------
// Horodatage du dernier instant joignable
// ---------------------------------------------------------------------------

function stamp(): void {
  if (level === "direct") markReachable();
}

function armStamp(): void {
  if (stampTimer !== null || level !== "direct") return;
  if (document.visibilityState !== "visible") return;
  stampTimer = setInterval(stamp, STAMP_MS);
}

function disarmStamp(): void {
  if (stampTimer !== null) clearInterval(stampTimer);
  stampTimer = null;
}

// ---------------------------------------------------------------------------
// Notification système
// ---------------------------------------------------------------------------

/**
 * Pose l'alerte par la voie qui survit au gel (`ui/notify.ts`) : le
 * service worker quand il contrôle la page, `new Notification` sinon.
 *
 * L'objet rendu n'existe que sur la voie de repli. Sur l'autre, il n'y a
 * rien à tenir : c'est `clearNotice` qui referme, et c'est justement ce
 * qui permet de retirer une alerte posée par une page qui n'est plus là.
 */
function post(title: MsgKey, body: MsgKey, keep: boolean): Notification | null {
  if (alertPermission() !== "granted") {
    console.warn("[trix] injoignable, mais les notifications ne sont pas autorisées");
    return null;
  }
  return showNotice({ title: t(title), body: t(body), tag: TAG, keep });
}

/**
 * L'alerte d'absence. `requireInteraction` parce que sans lui elle
 * s'efface en quelques secondes — et le message serait perdu pour qui
 * n'était pas devant l'écran, c'est-à-dire précisément le destinataire.
 */
function notifyAway(): void {
  if (notifyTimer !== null) clearTimeout(notifyTimer);
  notifyTimer = null;
  // Ces deux sorties sont des décisions, pas des pannes — mais une alerte
  // qui ne part pas ne se constate depuis aucun écran, et la console est
  // le seul endroit où la différence se lise. Elle survit au gel.
  if (document.visibilityState === "visible") return console.debug("[trix] onglet visible : l'écran le dit déjà");
  if (alertPosted()) return console.debug("[trix] alerte d'absence déjà posée");
  notification = post("reach.notifTitle", NOTIF_BODY[episodeReason], true);
  // le marqueur est posé même si la notification a échoué : ce qu'il
  // commande, c'est de dire le retour à la normale, et la phrase de retour
  // ne coûte rien à qui n'a rien vu partir
  setAlertPosted(true);
}

/**
 * Le retour à la normale, sur le **même tag** (D8). Deux raisons.
 *
 * La technique : l'alerte d'absence est `requireInteraction`, et si la
 * page a été déchargée entre-temps, l'objet `Notification` est mort avec
 * le document — plus personne ne peut la fermer, et sans service worker
 * `getNotifications()` n'existe pas. Poster sur le même tag est alors le
 * **seul** moyen de faire disparaître une alerte devenue fausse.
 *
 * L'autre tient au public : une personne sourde qui vient de lire « vous
 * ne pouvez plus recevoir d'appels » n'a, dans le silence qui suit, aucun
 * moyen de distinguer une application rétablie d'une application morte.
 * Une alarme qui sait s'allumer doit savoir dire qu'elle s'est éteinte.
 */
function notifyBack(): void {
  // deux façons de refermer, pour deux voies : l'objet quand on l'a encore,
  // et le service worker quand l'alerte a été posée par une page qui n'est
  // plus là — c'est le cas d'un onglet gelé puis déchargé
  notification?.close();
  notification = null;
  clearNotice(TAG);
  setAlertPosted(false);
  const back = post("reach.backTitle", "reach.back", false);
  // elle a dit ce qu'elle avait à dire : on ne la laisse pas s'installer
  if (back) setTimeout(() => back.close(), NOTIFY_AFTER_MS);
}

// ---------------------------------------------------------------------------
// Épisodes
// ---------------------------------------------------------------------------

function beginEpisode(): void {
  if (episodeSince !== 0) return;
  episodeSince = Date.now();
  // le motif est arrêté ici : ce qui arrivera ensuite — un retour en ligne,
  // un dégel — ne doit pas réécrire l'explication de ce qui a commencé
  episodeReason = reasonOf();
  setTitleOverride(t("reach.title"));
  setFaviconState(DOT_COLOR);
  // D6 : au premier gel constaté, et une seule fois, Trix rappelle les deux
  // gestes qui dépendent de l'utilisateur — épingler l'onglet, ajouter le
  // site aux « sites toujours actifs »
  if (episodeReason === "freeze" && !pinHintShown()) {
    pinHint = true;
    setPinHintShown();
  }
  // La page s'en va : rien à annoncer, et personne pour le lire.
  if (leaving) return;
  // **Le gel n'attend pas le seuil.** `freeze` est le dernier instant où du
  // JS tourne : le `setTimeout` des 10 s serait suspendu avec le reste et
  // ne s'exécuterait qu'au dégel — c'est-à-dire au moment précis où
  // l'alerte n'a plus lieu d'être. Le seuil protège d'une reconnexion de
  // trois secondes ; un gel, lui, n'a rien d'une reconnexion : il est
  // annoncé, il est certain, et il dure jusqu'à ce que l'utilisateur
  // revienne. L'alerte part donc avec le dernier battement de la page.
  if (episodeReason === "freeze") {
    notifyAway();
    return;
  }
  if (notifyTimer === null) notifyTimer = setTimeout(notifyAway, NOTIFY_AFTER_MS);
}

function endEpisode(): void {
  if (notifyTimer !== null) clearTimeout(notifyTimer);
  notifyTimer = null;
  episodeSince = 0;
  noted = null;
  leaving = false;
  setTitleOverride(null);
  setFaviconState(null);
  if (alertPosted()) notifyBack();
}

function update(): void {
  const phone = watched;
  if (!phone) return;
  level = reachabilityOf(phone.state);
  if (level === "direct") {
    markReachable();
    endEpisode();
    armStamp();
    return;
  }
  disarmStamp();
  if (wanted()) beginEpisode();
}

/**
 * Branche la joignabilité sur la machine. Idempotent : un second appel ne
 * double ni les abonnements ni les timers.
 */
export function watchReachability(phone: PhoneInstance): void {
  if (watched) return;
  watched = phone;

  // Deux motifs de réévaluation hors machine : l'onglet qui se montre ou se
  // cache — la notification ne se pose que sur un onglet caché —, et les
  // deux derniers instants où du JS tourne avant une suspension.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      armStamp();
      return;
    }
    // cet instant est le dernier dont on sache qu'on y était joignable
    stamp();
    disarmStamp();
    // l'onglet vient de passer en arrière-plan alors que l'absence durait
    // déjà : c'est maintenant que la notification a un sens
    if (episodeSince !== 0 && Date.now() - episodeSince >= NOTIFY_AFTER_MS) notifyAway();
  });

  // `freeze` et `pagehide` s'exécutent **avant** que `ui/lifecycle.ts` ne
  // pousse `sys:sleep` dans la machine — les écouteurs partent dans l'ordre
  // où ils ont été posés, et `main.ts` pose ceux-ci en premier. Le niveau
  // vaut donc encore `direct` ici, et l'horodatage est juste à la seconde.
  const lastBreath = (): void => {
    stamp();
    disarmStamp();
  };
  document.addEventListener("freeze", lastBreath);
  addEventListener("pagehide", lastBreath);

  phone.subscribe(update);
  update();
}
