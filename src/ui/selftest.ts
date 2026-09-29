/**
 * **Autotest micro et caméra**, hors appel (ADR 0003 §4 — F.703 §4.4 note :
 * *« il devrait être possible de mettre un terminal hors ligne en
 * autotest »*).
 *
 * Ce que la norme cherche à éviter est précisément le scénario le plus
 * courant : découvrir un micro muet ou une caméra prise par une autre
 * application **pendant** l'appel, c'est-à-dire au moment où l'on ne peut
 * plus rien y faire — et, pour une personne sourde, au moment où le
 * correspondant ne peut même pas le lui dire.
 *
 * Trois choses, et rien de plus : l'image qu'on enverrait, le niveau du son
 * qu'on enverrait, et le nom des périphériques que le navigateur a choisis.
 * Aucune boucle de retour audio — un haut-parleur qui rejouerait le micro
 * larsennerait, et ne prouverait rien de plus.
 *
 * **Dégrader, jamais refuser** (F.703 §5.1.2.2, cité par l'ADR) : une
 * caméra absente n'empêche pas de tester le micro. La demande se replie
 * donc sur l'audio seul, et le dit.
 *
 * Le test ne parle à personne : pas de session, pas de SIP, pas de machine.
 * Il ouvre un flux local, l'affiche, et le referme en partant — les pistes
 * sont arrêtées à la fermeture, sinon la caméra resterait allumée derrière
 * une modale disparue.
 */

import { t } from "../i18n/index.js";
import type { MsgKey } from "../i18n/types.js";
import { esc } from "./el.js";
import { audioLevel, barHeight } from "./vumeter.js";

/**
 * Ce que le navigateur peut refuser, ramené à ce qu'il faut en dire. Les
 * noms sont ceux de `DOMException` (getUserMedia) ; le reste tombe dans le
 * message générique, qui porte alors le texte brut du navigateur — c'est
 * lui qui nommera la vraie cause dans un rapport de support.
 */
const REASONS: Readonly<Record<string, MsgKey>> = {
  NotAllowedError: "selftest.denied",
  SecurityError: "selftest.denied",
  NotFoundError: "selftest.missing",
  OverconstrainedError: "selftest.missing",
  NotReadableError: "selftest.busy",
  AbortError: "selftest.busy",
};

/**
 * Ce que l'on dit d'un refus. Exporté parce que c'est la seule partie du
 * module qui se relit sans navigateur — et que ces phrases-là sont ce que
 * l'utilisateur aura pour agir : autoriser, brancher, ou fermer l'autre
 * application.
 */
export function selfTestReason(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  const key = REASONS[name];
  if (key) return t(key);
  const detail = err instanceof Error ? err.message : String(err);
  return t("selftest.failed", { detail });
}

/**
 * Le flux à tester. La caméra d'abord — c'est le cas complet —, l'audio
 * seul ensuite si elle manque : un micro qui marche reste une information,
 * et la refuser parce qu'il n'y a pas d'image serait exactement le refus
 * que la norme interdit.
 */
export async function openSelfTestMedia(): Promise<{ stream: MediaStream; videoOnly: boolean }> {
  try {
    return { stream: await navigator.mediaDevices.getUserMedia({ audio: true, video: true }), videoOnly: false };
  } catch (err) {
    // une permission refusée l'est pour les deux : inutile de redemander,
    // et le second refus effacerait le premier message
    if (err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
      throw err;
    }
    return { stream: await navigator.mediaDevices.getUserMedia({ audio: true }), videoOnly: true };
  }
}

/** Le nom d'un périphérique tel que le navigateur le donne, ou « — ». */
function deviceLine(kind: MsgKey, track: MediaStreamTrack | undefined): string {
  const label = track?.label?.trim();
  return `<div class="selftest-row">
      <span class="selftest-kind">${esc(t(kind))}</span>
      <span class="selftest-device">${esc(
        track ? (label !== "" ? label! : t("selftest.unnamed")) : t("selftest.absent"),
      )}</span>
    </div>`;
}

/**
 * Ouvre l'autotest. Un `<dialog>` natif, comme le carnet de trace et le
 * bilan média : Échap, piège à focus, inertie du fond et retour du focus
 * sont acquis, et il n'y a rien à réimplémenter de travers.
 */
export function showSelfTestDialog(): HTMLDialogElement {
  const dlg = document.createElement("dialog");
  dlg.className = "selftest-dialog";
  dlg.innerHTML = `<div class="stats-head">
      <div>
        <h2>${esc(t("selftest.title"))}</h2>
        <p class="stats-sub">${esc(t("selftest.sub"))}</p>
      </div>
      <div class="stats-actions">
        <button class="linkbtn" data-act="close">${esc(t("selftest.close"))}</button>
      </div>
    </div>
    <div class="selftest-body">
      <div class="selftest-stage">
        <video class="selftest-video" data-ref="preview" autoplay playsinline muted></video>
        <p class="selftest-msg" data-ref="msg">${esc(t("selftest.starting"))}</p>
      </div>
      <div class="selftest-vu" role="img" aria-label="${esc(t("selftest.levelAria"))}">
        <span class="bar" data-ref="vu" style="width:0%"></span>
      </div>
      <p class="selftest-hint">${esc(t("selftest.hint"))}</p>
      <div class="selftest-devices" data-ref="devices"></div>
    </div>`;

  const preview = dlg.querySelector<HTMLVideoElement>('[data-ref="preview"]')!;
  const msg = dlg.querySelector<HTMLElement>('[data-ref="msg"]')!;
  const vu = dlg.querySelector<HTMLElement>('[data-ref="vu"]')!;
  const devices = dlg.querySelector<HTMLElement>('[data-ref="devices"]')!;

  let stream: MediaStream | null = null;
  let raf: number | null = null;

  /** Tout ce qui a été ouvert se referme ici, et une seule fois. */
  const release = (): void => {
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null;
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
    preview.srcObject = null;
  };

  const tick = (): void => {
    // la modale a pu être fermée entre deux images : la boucle meurt avec
    // le nœud, sans quoi elle mesurerait un flux déjà arrêté
    if (!dlg.isConnected) {
      raf = null;
      return;
    }
    vu.style.width = `${barHeight(audioLevel(stream))}%`;
    raf = requestAnimationFrame(tick);
  };

  void openSelfTestMedia().then(
    ({ stream: open, videoOnly }) => {
      // fermée pendant que le navigateur demandait la permission : on rend
      // les périphériques au lieu de les allumer pour personne
      if (!dlg.isConnected) {
        for (const track of open.getTracks()) track.stop();
        return;
      }
      stream = open;
      preview.srcObject = open;
      const cam = open.getVideoTracks()[0];
      const mic = open.getAudioTracks()[0];
      dlg.classList.toggle("no-video", cam === undefined);
      msg.textContent = videoOnly || cam === undefined ? t("selftest.noCamera") : "";
      msg.hidden = !videoOnly && cam !== undefined;
      devices.innerHTML = `${deviceLine("selftest.mic", mic)}${deviceLine("selftest.cam", cam)}`;
      raf = requestAnimationFrame(tick);
    },
    (err: unknown) => {
      dlg.classList.add("no-video");
      msg.textContent = selfTestReason(err);
      msg.hidden = false;
    },
  );

  dlg.querySelector('[data-act="close"]')!.addEventListener("click", () => dlg.close());
  // clic dans le fond, hors du cadre : même geste qu'Échap
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) dlg.close();
  });
  dlg.addEventListener("close", () => {
    release();
    dlg.remove();
  });
  document.body.appendChild(dlg);
  dlg.showModal();
  // rendu à qui l'ouvre : la fenêtre des réglages le referme si un appel arrive
  return dlg;
}
