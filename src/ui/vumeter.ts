/**
 * Niveau sonore d'un flux, en RMS — la mesure derrière les vu-mètres de
 * l'écran d'appel comme derrière celui de l'autotest (`ui/selftest.ts`).
 *
 * Un seul `AudioContext` pour toute l'application, et un analyseur par flux
 * gardé en `WeakMap` : brancher deux fois le même flux créerait deux nœuds
 * qui mesureraient la même chose, et les contextes audio sont une ressource
 * comptée par le navigateur.
 *
 * UI pure : rien ici ne connaît la machine, l'appel, ni même le DOM. On
 * donne un flux, on obtient un nombre entre 0 et 1.
 */

let audioCtx: AudioContext | null = null;
const analysers = new WeakMap<MediaStream, AnalyserNode>();

function analyserFor(stream: MediaStream): AnalyserNode | null {
  if (stream.getAudioTracks().length === 0) return null;
  const existing = analysers.get(stream);
  if (existing) return existing;
  audioCtx ??= new AudioContext();
  const an = audioCtx.createAnalyser();
  an.fftSize = 256;
  audioCtx.createMediaStreamSource(stream).connect(an);
  analysers.set(stream, an);
  return an;
}

/** Tampon de travail : une seule allocation pour toutes les mesures. */
const buf = new Uint8Array(256);

function level(an: AnalyserNode): number {
  an.getByteTimeDomainData(buf);
  let sum = 0;
  for (const v of buf) {
    const d = (v - 128) / 128;
    sum += d * d;
  }
  return Math.sqrt(sum / buf.length); // RMS 0..1
}

/**
 * Le niveau du flux à l'instant, entre 0 et 1. `0` quand le flux ne porte
 * pas d'audio, ou n'existe pas — un vu-mètre au repos, jamais une erreur.
 */
export function audioLevel(stream: MediaStream | null): number {
  const an = stream ? analyserFor(stream) : null;
  return an ? level(an) : 0;
}

/**
 * Hauteur de barre pour un niveau donné, en pourcentage. Le facteur 260
 * vient de l'écran d'appel : une voix ordinaire tient un RMS de 0,1 à 0,2,
 * et une barre qui ne monterait qu'au cinquième de sa hauteur pour une
 * conversation normale ne dirait rien à personne.
 */
export function barHeight(rms: number): number {
  return Math.min(100, Math.round(rms * 260));
}
