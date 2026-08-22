/**
 * Le clavier DTMF de l'appel en cours (docs/CONCEPTION.md §4.8).
 *
 * Une tonalité DTMF est ce que le téléphone a de plus discret : elle part
 * dans le flux audio (RFC 4733), aucun paquet SIP ne la porte, et
 * l'émetteur ne l'entend pas — le navigateur ne rejoue pas ce qu'il
 * insère dans le RTP sortant. Trois conséquences, et ce module n'existe
 * que pour elles :
 *
 * - **l'écho à l'écran** : les touches composées restent lisibles, c'est
 *   la seule confirmation qui existe. Elle vient de la machine, qui
 *   n'inscrit que ce qui est réellement parti — pas du clic ;
 * - **le retour sonore local**, synthétisé ici (WebAudio) : la bitonalité
 *   d'un vrai clavier téléphonique, pour qui l'entend ;
 * - **le clavier physique** : composer un code à douze chiffres à la
 *   souris est une épreuve, et au clavier c'est le geste naturel.
 *
 * Le pavé est un affichage local : il s'ouvre et se ferme sans que la
 * machine en sache rien (comme le repli du panneau, `call/panel.ts`), et
 * son état survit aux re-rendus parce qu'il vit ici, hors du DOM.
 */

import type { CallView } from "../../../machines/events.js";
import { t } from "../../../i18n/index.js";
import { esc } from "../../el.js";

/** Id de la région, cité par l'`aria-controls` du bouton de la barre. */
export const DTMF_PAD_ID = "call-dtmf";

/**
 * Les douze touches, dans l'ordre du clavier téléphonique (ITU-T E.161).
 * Les lettres ne se traduisent pas : elles sont gravées ainsi sur tous les
 * téléphones du monde, y compris là où l'alphabet est autre.
 */
const KEYS: readonly { tone: string; letters: string }[] = [
  { tone: "1", letters: "" },
  { tone: "2", letters: "ABC" },
  { tone: "3", letters: "DEF" },
  { tone: "4", letters: "GHI" },
  { tone: "5", letters: "JKL" },
  { tone: "6", letters: "MNO" },
  { tone: "7", letters: "PQRS" },
  { tone: "8", letters: "TUV" },
  { tone: "9", letters: "WXYZ" },
  { tone: "*", letters: "" },
  { tone: "0", letters: "+" },
  { tone: "#", letters: "" },
];

/** Ce que le pavé accepte du clavier physique — exactement ses touches. */
const TONES = new Set(KEYS.map((k) => k.tone));

export function isDtmfTone(key: string): boolean {
  return TONES.has(key);
}

/**
 * Le nom parlé d'une touche : les lecteurs d'écran lisent « astérisque »
 * ou « croisillon » là où l'utilisateur entend « étoile » et « dièse » —
 * ce sont les mots du téléphone, et les serveurs vocaux les emploient.
 */
function keyName(tone: string): string {
  return tone === "*" ? t("dtmf.star") : tone === "#" ? t("dtmf.hash") : tone;
}

// ---------------------------------------------------------------------------
// Gabarit
// ---------------------------------------------------------------------------

/**
 * Le pavé, posé sur la scène vidéo au-dessus de la barre de commandes.
 * Rendu (et non omis) même replié : le montrer n'est alors qu'un attribut
 * à retirer, sans re-rendu ni perte du focus.
 *
 * L'écho n'est **pas** une région `aria-live`, et ce n'est pas un oubli :
 * l'écran est reconstruit à chaque tonalité, région comprise, et une région
 * insérée en même temps que son contenu n'annonce rien. Ce qui confirme la
 * touche à un lecteur d'écran, c'est le focus qui revient s'y poser
 * (`wireDtmf`) : « Touche 5 ». L'écho, lui, s'adresse aux yeux — et c'est
 * bien pour eux qu'il existe.
 */
export function dtmfPad(view: CallView): string {
  if (view.state !== "connected") return "";
  const keys = KEYS.map(
    (k) => `<button class="dtmfkey" data-act="dtmf-key" data-tone="${esc(k.tone)}"
                    aria-label="${esc(t("dtmf.keyAria", { key: keyName(k.tone) }))}">
               <span class="digit">${esc(k.tone)}</span>
               <span class="letters" aria-hidden="true">${esc(k.letters)}</span>
             </button>`,
  ).join("");
  return `<div class="dtmfpad" id="${DTMF_PAD_ID}" data-ref="dtmfpad" role="group"
               aria-label="${esc(t("dtmf.aria"))}" ${padOpen ? "" : "hidden"}>
            <p class="dtmf-echo" data-ref="dtmf-echo">
              <span class="sent-label">${esc(t("dtmf.sent"))}</span>
              ${
                view.dtmfSent
                  ? `<span class="sent" dir="ltr">${esc(view.dtmfSent)}</span>`
                  : `<span class="hint">${esc(t("dtmf.hint"))}</span>`
              }
            </p>
            <div class="dtmf-keys" dir="ltr">${keys}</div>
          </div>`;
}

// ---------------------------------------------------------------------------
// État d'ouverture — local à l'écran, comme le repli du panneau
// ---------------------------------------------------------------------------

let padOpen = false;

export function dtmfOpen(): boolean {
  return padOpen;
}

/** L'appel est fini (ou n'est plus en communication) : le pavé n'a plus d'objet. */
export function closeDtmf(): void {
  padOpen = false;
}

// ---------------------------------------------------------------------------
// Câblage
// ---------------------------------------------------------------------------

/**
 * Ce que le dernier écran rendu sait faire d'une tonalité. L'écran d'appel
 * est reconstruit à chaque notification de la machine — donc à chaque
 * touche composée — et le clavier physique, lui, ne s'adresse à aucun nœud
 * en particulier : il tape sur le pavé qui est là, maintenant.
 */
let emit: ((tone: string) => void) | null = null;

/**
 * Branche le pavé rendu dans `screen` : le bouton de la barre l'ouvre et
 * le ferme, les touches et le clavier physique composent, Échap referme.
 *
 * `send` est appelé avec la tonalité pressée ; ce qu'elle devient — partie
 * ou perdue — se lit ensuite dans la vue, pas ici.
 */
export function wireDtmf(screen: HTMLElement, send: (tone: string) => void): void {
  const pad = screen.querySelector<HTMLElement>('[data-ref="dtmfpad"]');
  emit = null;
  if (!pad) return;
  emit = send;
  watchKeyboard();

  const toggles = [...screen.querySelectorAll<HTMLElement>('[data-act="dtmf"]:not([disabled])')];
  const setOpen = (open: boolean, moveFocus: boolean): void => {
    padOpen = open;
    pad.hidden = !open;
    for (const b of toggles) {
      b.setAttribute("aria-expanded", String(open));
      b.classList.toggle("toggled", open);
      b.title = t(open ? "ctrl.dtmf.hide" : "ctrl.dtmf.show");
    }
    if (!moveFocus) return;
    if (open) pad.querySelector<HTMLElement>(".dtmfkey")?.focus();
    else toggles[0]?.focus();
  };

  for (const b of toggles) b.addEventListener("click", () => setOpen(!padOpen, true));
  for (const key of pad.querySelectorAll<HTMLElement>(".dtmfkey")) {
    key.addEventListener("click", () => press(key.dataset.tone ?? ""));
  }
  pad.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    setOpen(false, true);
  });

  // Le focus du rendu **précédent** : ce nœud-ci n'est pas encore monté,
  // l'ancien l'est toujours, et c'est le dernier instant où l'on peut savoir
  // sur quelle touche était le doigt. Sans cela, le pavé s'écroulerait sous
  // celui qui compose : chaque tonalité renvoie le focus au néant.
  const held = document.activeElement?.closest<HTMLElement>(".dtmfkey")?.dataset.tone;
  if (padOpen && held) queueMicrotask(() => keyNode(held)?.focus());
}

/** La touche du pavé actuellement à l'écran — pas celle d'un rendu périmé. */
function keyNode(tone: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.dtmfpad .dtmfkey[data-tone="${CSS.escape(tone)}"]`);
}

/**
 * Une touche pressée, d'où qu'elle vienne. L'envoi re-rend l'écran d'appel
 * une microtask plus tard (`main.ts`) : le nœud que nous tenons ici aura
 * disparu, et c'est le pavé du rendu suivant qu'il faut allumer.
 */
function press(tone: string): void {
  if (!emit || !isDtmfTone(tone)) return;
  playTone(tone);
  emit(tone);
  queueMicrotask(() => {
    // la touche s'allume brièvement : au clavier physique, c'est ce qui dit
    // laquelle a répondu — et cela se voit sans le son
    const key = keyNode(tone);
    if (!key) return;
    key.classList.add("hit");
    setTimeout(() => key.classList.remove("hit"), TONE_MS);
  });
}

/**
 * Le clavier physique, écouté une fois pour toutes sur le document plutôt
 * que sur l'écran : on compose en regardant son correspondant, pas ses
 * propres boutons, et le focus peut être n'importe où. Rien n'est
 * intercepté tant que le pavé est replié — ni pendant une saisie, où « 4 »
 * est un chiffre à écrire, pas une tonalité à envoyer.
 */
let keyboardWatched = false;

function watchKeyboard(): void {
  if (keyboardWatched) return;
  keyboardWatched = true;
  document.addEventListener("keydown", (e) => {
    if (!padOpen || !emit || e.altKey || e.ctrlKey || e.metaKey) return;
    if ((e.target as HTMLElement | null)?.closest("input, textarea, [contenteditable]")) return;
    if (!isDtmfTone(e.key)) return;
    e.preventDefault();
    press(e.key);
  });
}

// ---------------------------------------------------------------------------
// Retour sonore local (WebAudio)
// ---------------------------------------------------------------------------

/** Durée d'une tonalité locale, et de l'éclat de la touche qui va avec. */
const TONE_MS = 140;

/** Les deux fréquences de chaque touche (ITU-T Q.23) : ligne × colonne. */
const ROWS = [697, 770, 852, 941];
const COLS = [1209, 1336, 1477, 1633];
const GRID: Record<string, [number, number]> = {};
for (const [i, row] of ["123A", "456B", "789C", "*0#D"].entries()) {
  for (const [j, tone] of [...row].entries()) GRID[tone] = [ROWS[i]!, COLS[j]!];
}

let audio: AudioContext | null = null;

/**
 * La bitonalité de la touche, jouée **localement**. Ce n'est pas le DTMF
 * de l'appel — celui-là part dans le RTP sortant, que l'émetteur n'entend
 * jamais : c'est le retour d'un poste téléphonique, qui dit que la touche
 * a répondu. Un échec de synthèse ne fait rien échouer : la tonalité est
 * déjà partie, et l'écran, lui, la montre.
 */
function playTone(tone: string): void {
  const pair = GRID[tone.toUpperCase()];
  if (!pair) return;
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
    const now = audio.currentTime;
    const gain = audio.createGain();
    // attaque et extinction en douceur : un créneau franc claque
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.07, now + 0.012);
    gain.gain.setValueAtTime(0.07, now + TONE_MS / 1000 - 0.02);
    gain.gain.linearRampToValueAtTime(0, now + TONE_MS / 1000);
    gain.connect(audio.destination);
    for (const hz of pair) {
      const osc = audio.createOscillator();
      osc.frequency.value = hz;
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + TONE_MS / 1000);
    }
  } catch {
    // pas de contexte audio disponible : le pavé reste utilisable
  }
}
