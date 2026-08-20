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

import { startRing, stopRing } from "./ring.js";
import { setTitleOverride } from "./title.js";
import { t } from "../i18n/index.js";

export interface IncomingAlert {
  caller: string;
  video: boolean;
  /**
   * Flash plein écran — réglage du compte (`AccountConfig.flashAlert`).
   * Seul ce canal est débrayable : les autres ne perturbent pas l'écran
   * et restent le filet de sécurité de l'alerte.
   */
  flash: boolean;
}

/** Période du clignotement titre/favicon, alignée sur celle du flash CSS. */
const BLINK_MS = 1200;
/** Motif de vibration, rejoué à chaque cycle de sonnerie. */
const VIBRATE_PATTERN = [600, 400, 600];
const VIBRATE_MS = 2000;

let active = false;
let overlay: HTMLElement | null = null;
let blinkTimer: ReturnType<typeof setInterval> | null = null;
let vibrateTimer: ReturnType<typeof setInterval> | null = null;
let baseFavicon: string | null = null;
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

/** Pastille de favicon : deux SVG inline, aucun fichier à embarquer. */
function faviconUri(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="${color}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function faviconLink(): HTMLLinkElement {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.append(link);
  }
  return link;
}

function startBlink(caller: string): void {
  const link = faviconLink();
  baseFavicon = link.getAttribute("href");
  let on = true;
  const tick = (): void => {
    // un battement sur deux rend la main : c'est le titre d'état qui
    // réapparaît, pas une copie figée prise au début de la sonnerie
    setTitleOverride(on ? t("alert.title", { caller }) : null);
    link.href = faviconUri(on ? "#36AD45" : "#E94E3C");
    on = !on;
  };
  tick();
  blinkTimer = setInterval(tick, BLINK_MS);
}

function stopBlink(): void {
  if (blinkTimer !== null) clearInterval(blinkTimer);
  blinkTimer = null;
  setTitleOverride(null);
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (link) {
    if (baseFavicon) link.href = baseFavicon;
    else link.remove();
  }
  baseFavicon = null;
}

function notify(a: IncomingAlert): void {
  if (alertPermission() !== "granted") return;
  try {
    // `silent` : le retour sonore est déjà assuré par la sonnerie de l'app
    notification = new Notification(t("alert.notifTitle"), {
      body: t(a.video ? "alert.notifVideo" : "alert.notifAudio", { caller: a.caller }),
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
