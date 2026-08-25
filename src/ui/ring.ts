/**
 * Sonnerie d'appel entrant et **retour d'appel sortant** — UI pure, aucune
 * machine impliquée : la CallBlock décrit l'état (`ringing_in`, `ringing`),
 * l'écran d'appel démarre et arrête le timbre en conséquence.
 *
 * Timbre synthétisé (WebAudio) plutôt qu'un fichier : rien à empaqueter,
 * rien à charger, et la cadence française (1,5 s de tonalité / 3,5 s de
 * silence) est immédiatement reconnaissable.
 *
 * Les deux timbres partagent cette cadence, parce que c'est la même dans le
 * réseau français — celui qui appelle et celui qu'on appelle entendent le
 * même rythme, et il n'y a aucune raison d'en inventer un second. Ils ne se
 * rencontrent jamais : un appel est entrant ou sortant. Ce qui les sépare
 * est le niveau, et il dit à qui le son s'adresse — la sonnerie doit
 * traverser une pièce, le retour d'appel n'a qu'à confirmer, à l'oreille de
 * qui attend déjà, que ça sonne là-bas (F.703 §6.1.2 : la progression de
 * l'appel est annoncée par des signaux visuels **et** sonores).
 */

const TONE_HZ = 440;
const TONE_MS = 1500;
const CYCLE_MS = 5000;
const PEAK = 0.07; // discret : la sonnerie prévient, elle n'agresse pas
/** Le retour d'appel s'adresse à une oreille déjà tournée vers l'écran. */
const RINGBACK_PEAK = 0.04;

let audio: AudioContext | null = null;

function burst(peak: number): void {
  if (!audio) return;
  const t0 = audio.currentTime;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = "sine";
  osc.frequency.value = TONE_HZ;
  // rampes d'attaque/extinction : sans elles, chaque salve claque
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.05);
  gain.gain.setValueAtTime(peak, t0 + TONE_MS / 1000 - 0.05);
  gain.gain.linearRampToValueAtTime(0, t0 + TONE_MS / 1000);
  osc.connect(gain).connect(audio.destination);
  osc.start(t0);
  osc.stop(t0 + TONE_MS / 1000 + 0.02);
}

/**
 * Une cadence : première salve tout de suite, les suivantes au rythme du
 * réseau. `start` est idempotent — l'écran d'appel est re-rendu à chaque
 * notification de la machine, et le timbre ne doit pas repartir à zéro à
 * chaque battement du chrono.
 */
function cadence(peak: number): { start(): void; stop(): void } {
  let timer: ReturnType<typeof setInterval> | null = null;
  return {
    start() {
      if (timer !== null) return;
      audio ??= new AudioContext();
      // sans geste utilisateur préalable, le contexte peut être suspendu :
      // le timbre est alors muet, ce n'est pas une raison d'échouer
      void audio.resume().catch(() => {});
      burst(peak);
      timer = setInterval(() => burst(peak), CYCLE_MS);
    },
    stop() {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    },
  };
}

const ring = cadence(PEAK);
const ringback = cadence(RINGBACK_PEAK);

/**
 * Une seule salve, sans cadence : l'alerte en séance de T.140 (`BEL`, §4.9)
 * n'est pas un appel qui sonne, c'est un correspondant qui appelle
 * l'attention. Le contexte audio est le même — il n'y a aucune raison d'en
 * ouvrir un second.
 */
export function ringOnce(): void {
  audio ??= new AudioContext();
  void audio.resume().catch(() => {});
  burst(PEAK);
}

/** Idempotent : appelable à chaque rendu de l'écran d'appel. */
export function startRing(): void {
  ring.start();
}

export function stopRing(): void {
  ring.stop();
}

/**
 * Le **retour d'appel** : ce que l'appelant entend pendant que ça sonne
 * chez l'autre. Il est produit ici, localement, et non attendu du réseau —
 * un appel SIP sans média précoce ne transporte rien avant le 200 OK, et
 * l'appelant n'entendrait donc rien du tout.
 *
 * Il ne doit surtout pas se superposer au **média précoce** quand il y en a
 * un : la sonnerie de l'opérateur, une annonce (« votre correspondant est
 * absent »), un serveur vocal. C'est l'appelant qui le décide, en n'appelant
 * pas cette fonction — la réponse provisoire porte alors une description de
 * session, et `CallView.earlyMedia` le dit.
 */
export function startRingback(): void {
  ringback.start();
}

export function stopRingback(): void {
  ringback.stop();
}
