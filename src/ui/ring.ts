/**
 * Sonnerie d'appel entrant — UI pure, aucune machine impliquée : la
 * CallBlock décrit l'état (`ringing_in`), l'écran d'appel démarre et
 * arrête la sonnerie en conséquence.
 *
 * Timbre synthétisé (WebAudio) plutôt qu'un fichier : rien à empaqueter,
 * rien à charger, et la cadence française (1,5 s de tonalité / 3,5 s de
 * silence) est immédiatement reconnaissable.
 */

const TONE_HZ = 440;
const TONE_MS = 1500;
const CYCLE_MS = 5000;
const PEAK = 0.07; // discret : la sonnerie prévient, elle n'agresse pas

let audio: AudioContext | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function burst(): void {
  if (!audio) return;
  const t0 = audio.currentTime;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = "sine";
  osc.frequency.value = TONE_HZ;
  // rampes d'attaque/extinction : sans elles, chaque salve claque
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(PEAK, t0 + 0.05);
  gain.gain.setValueAtTime(PEAK, t0 + TONE_MS / 1000 - 0.05);
  gain.gain.linearRampToValueAtTime(0, t0 + TONE_MS / 1000);
  osc.connect(gain).connect(audio.destination);
  osc.start(t0);
  osc.stop(t0 + TONE_MS / 1000 + 0.02);
}

/** Idempotent : appelable à chaque rendu de l'écran d'appel. */
export function startRing(): void {
  if (timer !== null) return;
  audio ??= new AudioContext();
  // sans geste utilisateur préalable, le contexte peut être suspendu :
  // la sonnerie est alors muette, ce n'est pas une raison d'échouer
  void audio.resume().catch(() => {});
  burst();
  timer = setInterval(burst, CYCLE_MS);
}

export function stopRing(): void {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
}
