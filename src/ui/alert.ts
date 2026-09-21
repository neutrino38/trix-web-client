/**
 * Alerte d'appel entrant — **accessibilité sourds et malentendants**.
 *
 * L'application s'adresse d'abord à des personnes sourdes : la sonnerie
 * ne peut pas être le signal principal. Tout ce qu'une page web peut
 * offrir de visible est donc mobilisé en parallèle, chaque canal couvrant
 * un cas que les autres ne couvrent pas :
 *
 * | canal                | visible quand…                                  |
 * |----------------------|-------------------------------------------------|
 * | flash plein écran    | l'application est à l'écran                      |
 * | titre d'onglet       | l'application est dans un onglet d'arrière-plan  |
 * | favicon clignotant   | idem, repérable d'un coup d'œil dans la barre    |
 * | notification système | la fenêtre est masquée ou minimisée               |
 * | vibration            | téléphone en poche ou posé (Android)             |
 * | wake lock            | l'écran allait s'éteindre — le flash serait perdu |
 *
 * Sécurité photosensible (WCAG 2.3.1) : le flash bat à moins de 1 Hz —
 * très loin de la limite de trois flashs par seconde — et n'utilise pas
 * de rouge saturé. Sous `prefers-reduced-motion`, le clignotement laisse
 * place à un cadre permanent (voir theme.css) : l'alerte reste visible
 * sans mouvement.
 *
 * Un seul point d'entrée pour l'écran d'appel : `startIncomingAlert` /
 * `stopIncomingAlert`, tous deux idempotents (l'écran est re-rendu à
 * chaque notification de la machine).
 */

import { ringOnce, startRing, stopRing } from "./ring.js";
import { setTitleOverride } from "./title.js";
import { setFaviconOverride } from "./favicon.js";
import { t } from "../i18n/index.js";
import type { MsgKey } from "../i18n/types.js";

export interface IncomingAlert {
  caller: string;
  /** Le média offert, tel que la notification système l'annonce. */
  kind: "audio" | "video" | "text";
  /**
   * Flash plein écran — réglage du compte (`AccountConfig.flashAlert`).
   * Seul ce canal est débrayable : les autres ne perturbent pas l'écran
   * et restent le filet de sécurité de l'alerte.
   */
  flash: boolean;
}

/** Ce que la notification système annonce, selon le média offert. */
const NOTIF: Record<IncomingAlert["kind"], MsgKey> = {
  audio: "alert.notifAudio",
  video: "alert.notifVideo",
  text: "alert.notifText",
};

/** Période du clignotement titre/favicon, alignée sur celle du flash CSS. */
const BLINK_MS = 1200;
/** Motif de vibration, rejoué à chaque cycle de sonnerie. */
const VIBRATE_PATTERN = [600, 400, 600];
const VIBRATE_MS = 2000;

let active = false;
let overlay: HTMLElement | null = null;
let blinkTimer: ReturnType<typeof setInterval> | null = null;
let vibrateTimer: ReturnType<typeof setInterval> | null = null;
let notification: Notification | null = null;
let wakeLock: { release(): Promise<void> } | null = null;

// ---------------------------------------------------------------------------
// Notification système : permission demandée explicitement par l'utilisateur
// ---------------------------------------------------------------------------

export type AlertPermission = "unsupported" | "default" | "granted" | "denied";

export function alertPermission(): AlertPermission {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

/** À appeler depuis un geste utilisateur : sans geste, le navigateur refuse. */
export async function requestAlertPermission(): Promise<AlertPermission> {
  if (typeof Notification === "undefined") return "unsupported";
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

// ---------------------------------------------------------------------------
// Canaux
// ---------------------------------------------------------------------------

function startBlink(caller: string): void {
  let on = true;
  const tick = (): void => {
    // un battement sur deux rend la main : c'est le titre d'état et la
    // pastille de joignabilité qui réapparaissent, pas une copie figée
    // prise au début de la sonnerie (`ui/title.ts`, `ui/favicon.ts`)
    setTitleOverride(on ? t("alert.title", { caller }) : null);
    setFaviconOverride(on ? "#36AD45" : "#E94E3C");
    on = !on;
  };
  tick();
  blinkTimer = setInterval(tick, BLINK_MS);
}

function stopBlink(): void {
  if (blinkTimer !== null) clearInterval(blinkTimer);
  blinkTimer = null;
  setTitleOverride(null);
  setFaviconOverride(null);
}

function notify(a: IncomingAlert): void {
  if (alertPermission() !== "granted") return;
  try {
    // `silent` : le retour sonore est déjà assuré par la sonnerie de l'app
    notification = new Notification(t("alert.notifTitle"), {
      body: t(NOTIF[a.kind], { caller: a.caller }),
      tag: "trix-incoming",
      requireInteraction: true,
      silent: true,
    });
    notification.onclick = () => {
      window.focus();
      notification?.close();
    };
  } catch {
    // notifications indisponibles (contexte non sécurisé…) : les autres canaux suffisent
  }
}

function startVibrate(): void {
  if (typeof navigator.vibrate !== "function") return;
  const buzz = (): void => {
    navigator.vibrate(VIBRATE_PATTERN);
  };
  buzz();
  vibrateTimer = setInterval(buzz, VIBRATE_MS);
}

function stopVibrate(): void {
  if (vibrateTimer !== null) clearInterval(vibrateTimer);
  vibrateTimer = null;
  if (typeof navigator.vibrate === "function") navigator.vibrate(0);
}

/** Wake Lock n'est pas typé partout : on décrit le peu qu'on en utilise. */
interface WakeLockSentinelLike {
  release(): Promise<void>;
}
interface WakeLockLike {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}

/** Empêche l'extinction de l'écran pendant la sonnerie : un flash éteint n'alerte personne. */
function keepScreenOn(): void {
  const wl = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
  if (!wl) return;
  void wl
    .request("screen")
    .then((lock) => {
      // l'appel a pu être décroché entre-temps : ne pas garder l'écran allumé pour rien
      if (active) wakeLock = lock;
      else void lock.release().catch(() => {});
    })
    .catch(() => {});
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export function startIncomingAlert(a: IncomingAlert): void {
  if (active) return;
  active = true;

  if (a.flash) {
    overlay = document.createElement("div");
    overlay.className = "callflash";
    overlay.setAttribute("aria-hidden", "true"); // décoratif : le texte de l'écran porte l'info
    document.body.append(overlay);
  }

  startBlink(a.caller);
  startVibrate();
  keepScreenOn();
  notify(a);
  startRing();
}

/** Durée du cadre d'une alerte ponctuelle : un battement, pas une sonnerie. */
const PULSE_MS = 1200;

let pulse: HTMLElement | null = null;
let pulseTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Alerte **en cours de session** : le `BEL` du texte temps réel (T.140 §8.3,
 * docs/CONCEPTION.md §4.9). Le correspondant appelle l'attention de
 * quelqu'un qui a peut-être quitté l'écran — d'où le réemploi des canaux de
 * l'appel entrant, en un seul battement : cadre, salve, vibration.
 *
 * Deux différences avec la sonnerie : elle ne se répète pas, et elle
 * s'efface toute seule. Pendant une sonnerie d'appel entrant, elle se tait
 * complètement : tous ces canaux sont déjà pris, et ils disent quelque
 * chose de plus urgent.
 */
export function pulseAlert(flash = true): void {
  if (active) return;

  if (flash) {
    if (pulseTimer !== null) clearTimeout(pulseTimer);
    if (!pulse) {
      pulse = document.createElement("div");
      pulse.className = "callflash";
      pulse.setAttribute("aria-hidden", "true");
      document.body.append(pulse);
    }
    pulseTimer = setTimeout(() => {
      pulse?.remove();
      pulse = null;
      pulseTimer = null;
    }, PULSE_MS);
  }

  if (typeof navigator.vibrate === "function") navigator.vibrate(200);
  ringOnce();
}

export function stopIncomingAlert(): void {
  if (!active) return;
  active = false;

  overlay?.remove();
  overlay = null;
  stopBlink();
  stopVibrate();
  notification?.close();
  notification = null;
  void wakeLock?.release().catch(() => {});
  wakeLock = null;
  stopRing();
}
