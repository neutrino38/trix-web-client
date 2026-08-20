/**
 * Statistiques média d'un appel : ce que la pile WebRTC sait du flux qui
 * passe réellement, ramené aux quelques chiffres qu'on regarde quand la
 * conversation se dégrade (docs/CONCEPTION.md §5.4).
 *
 * `RTCPeerConnection.getStats()` rend des **compteurs cumulés** depuis le
 * début de l'appel : octets reçus, paquets perdus… Lus tels quels, ils ne
 * disent rien de l'instant — un appel parfait pendant dix minutes puis coupé
 * affiche toujours 0,1 % de perte. Ce module en prend des échantillons
 * réguliers, garde ceux d'une **fenêtre glissante de 10 s** et n'expose que
 * la différence entre les deux bornes : un débit et un taux de perte de
 * maintenant, pas de la moyenne de l'appel.
 *
 * Deux compteurs de perte, et ils ne se calculent pas pareil :
 *
 * - **en réception**, `inbound-rtp` compte les paquets reçus et ceux
 *   manquants dans la numérotation ; le total attendu est leur somme ;
 * - **en émission**, personne ici ne peut savoir ce qui s'est perdu en
 *   route. Le chiffre vient du distant, par les rapports de réception RTCP
 *   (RR) que le navigateur agrège dans `remote-inbound-rtp` — rapporté aux
 *   paquets envoyés, qui comptent déjà les perdus.
 *
 * Les mêmes échantillons servent deux lectures, et c'est tout l'intérêt de
 * les prendre une seule fois : la fenêtre de 10 s pendant l'appel, et le
 * **bilan de l'appel entier** — premier échantillon contre dernier — que
 * l'historique garde à côté du carnet de trace (§5.4).
 *
 * Le module ne connaît ni JsSIP ni le DOM : on lui passe un rapport, il rend
 * des nombres. C'est ce qui permet de le vérifier sans navigateur.
 */

/** Un compteur du rapport, réduit à ce que l'on sait en lire. */
interface RawStat {
  type?: unknown;
  [field: string]: unknown;
}

/**
 * Ce que ce module attend d'un rapport WebRTC : une Map d'identifiants vers
 * des compteurs. `RTCStatsReport` en est une — et un test en écrit une à la
 * main, sans navigateur.
 */
export type StatsReportLike = ReadonlyMap<string, RawStat>;

export type MediaKind = "audio" | "video";
export type Direction = "recv" | "sent";

/** Un sens d'un média : ce qu'il transporte, à quel débit, et ce qu'il en perd. */
export interface Flow {
  /** Nom du codec négocié (`opus`, `VP8`, `H264`), tel que le rapporte le SDP. */
  codec: string | null;
  /** Fréquence d'échantillonnage en hertz — parlante pour l'audio (8000, 48000). */
  clockRate: number | null;
  /** Débit sur la fenêtre, en kbit/s. `null` tant que la fenêtre n'a pas d'étendue. */
  kbps: number | null;
  /** Taux de perte sur la fenêtre, entre 0 et 1. `null` si aucun paquet n'est passé. */
  loss: number | null;
}

/** L'état du média des deux côtés, sur la fenêtre. */
export interface MediaStats {
  /** `null` quand ce média n'est pas dans l'appel (un appel audio n'a pas de vidéo). */
  audio: Record<Direction, Flow> | null;
  video: Record<Direction, Flow> | null;
  /** Aller-retour rapporté par les RR, en millisecondes. */
  rttMs: number | null;
  /** Étendue réelle de la fenêtre, en ms : 0 tant qu'un seul échantillon. */
  spanMs: number;
}

/** La fenêtre demandée par les specs : 10 s de conversation, pas la moyenne de l'appel. */
export const STATS_WINDOW_MS = 10_000;

/**
 * Cadence d'échantillonnage : celle de webrtc-internals. C'est le port qui
 * la tient (`sip/port.ts`), une fois pour toutes — l'UI ne fait plus que
 * lire, et le bilan de fin d'appel n'a pas d'autre source à interroger.
 */
export const STATS_SAMPLE_MS = 1000;

/**
 * Étendue minimale pour publier un débit. Deux échantillons collés donnent
 * un rapport dominé par le bruit de mesure — mieux vaut afficher « — » une
 * seconde de plus.
 */
const MIN_SPAN_MS = 500;

/** Les compteurs d'un sens d'un média, à un instant. */
interface Counters {
  /** Ce média existe dans l'appel : un compteur le rapporte, même à zéro. */
  present: boolean;
  bytes: number;
  packets: number;
  /** Cumul des paquets perdus — de la numérotation en réception, des RR en émission. */
  lost: number;
  codec: string | null;
  clockRate: number | null;
}

type FlowKey = `${MediaKind}-${Direction}`;

/** Le rapport entier, ramené aux quatre sens qui nous intéressent. */
export interface Snapshot {
  at: number;
  flows: Record<FlowKey, Counters>;
  rttMs: number | null;
}

function empty(): Counters {
  return { present: false, bytes: 0, packets: 0, lost: 0, codec: null, clockRate: null };
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Le codec d'un flux : `codecId` renvoie à un compteur `codec`, dont le
 * `mimeType` porte le nom sous la forme `audio/opus`. Absent tant que la
 * négociation n'est pas terminée — c'est un état, pas une erreur.
 */
function codecOf(
  report: StatsReportLike,
  codecId: unknown,
): { codec: string | null; clockRate: number | null } {
  const entry = typeof codecId === "string" ? report.get(codecId) : undefined;
  const mime = entry && typeof entry.mimeType === "string" ? entry.mimeType : null;
  const clock = entry && typeof entry.clockRate === "number" ? entry.clockRate : null;
  return { codec: mime ? (mime.split("/")[1] ?? mime) : null, clockRate: clock };
}

function kindOf(stat: RawStat): MediaKind | null {
  const k = stat.kind ?? stat.mediaType;
  return k === "audio" || k === "video" ? k : null;
}

/**
 * Un rapport WebRTC ramené à un échantillon. Les flux multiples d'un même
 * média (simulcast, plusieurs SSRC) s'additionnent : ce qui compte à
 * l'écran est le débit de la vidéo, pas celui de chacune de ses couches.
 */
export function snapshot(report: StatsReportLike, at: number): Snapshot {
  const flows: Record<FlowKey, Counters> = {
    "audio-recv": empty(),
    "audio-sent": empty(),
    "video-recv": empty(),
    "video-sent": empty(),
  };
  let rttMs: number | null = null;

  for (const [, stat] of report) {
    const kind = kindOf(stat);
    if (kind === null) continue;

    if (stat.type === "inbound-rtp") {
      const flow = flows[`${kind}-recv`];
      flow.present = true;
      flow.bytes += num(stat.bytesReceived);
      flow.packets += num(stat.packetsReceived);
      // `packetsLost` est signé : des paquets dupliqués le font reculer
      flow.lost += num(stat.packetsLost);
      Object.assign(flow, codecOf(report, stat.codecId));
    } else if (stat.type === "outbound-rtp") {
      const flow = flows[`${kind}-sent`];
      flow.present = true;
      flow.bytes += num(stat.bytesSent);
      flow.packets += num(stat.packetsSent);
      Object.assign(flow, codecOf(report, stat.codecId));
    } else if (stat.type === "remote-inbound-rtp") {
      // ce que le distant dit avoir reçu de nous : la seule source possible
      // pour la perte à l'émission
      flows[`${kind}-sent`].lost += num(stat.packetsLost);
      // l'aller-retour est mesuré par média ; le premier rapporté suffit à
      // qualifier le chemin, les deux passent par la même paire ICE
      if (rttMs === null && typeof stat.roundTripTime === "number") {
        rttMs = stat.roundTripTime * 1000;
      }
    }
  }
  return { at, flows, rttMs };
}

/**
 * Le taux de perte du sens considéré. Les deux directions ne rapportent pas
 * la perte au même total : en réception le compteur de paquets ignore les
 * manquants (il faut les rajouter), en émission il les compte déjà.
 */
function lossOf(dir: Direction, lost: number, packets: number): number | null {
  const expected = dir === "recv" ? packets + lost : packets;
  if (expected <= 0) return null;
  return Math.min(1, Math.max(0, lost) / expected);
}

function flowOf(dir: Direction, from: Counters, to: Counters, spanMs: number): Flow {
  const measured = spanMs >= MIN_SPAN_MS;
  return {
    codec: to.codec,
    clockRate: to.clockRate,
    // octets × 8 ÷ millisecondes = kbit/s, sans conversion intermédiaire
    kbps: measured ? Math.max(0, ((to.bytes - from.bytes) * 8) / spanMs) : null,
    loss: measured ? lossOf(dir, to.lost - from.lost, to.packets - from.packets) : null,
  };
}

/** Ce qui s'est passé entre deux échantillons. `from === to` : les codecs seuls. */
export function windowStats(from: Snapshot, to: Snapshot): MediaStats {
  const spanMs = Math.max(0, to.at - from.at);
  const both = (kind: MediaKind): Record<Direction, Flow> | null => {
    const recv = to.flows[`${kind}-recv`];
    const sent = to.flows[`${kind}-sent`];
    if (!recv.present && !sent.present) return null;
    return {
      recv: flowOf("recv", from.flows[`${kind}-recv`], recv, spanMs),
      sent: flowOf("sent", from.flows[`${kind}-sent`], sent, spanMs),
    };
  };
  return { audio: both("audio"), video: both("video"), rttMs: to.rttMs, spanMs };
}

/**
 * La fenêtre glissante : on y verse des rapports, elle rend l'état du média
 * sur les dernières `windowMs`. Les échantillons sortis de la fenêtre sont
 * oubliés — sauf les deux derniers, sans lesquels il n'y aurait plus rien à
 * comparer si les mesures s'espaçaient (onglet en arrière-plan).
 */
export interface StatsWindow {
  push(report: StatsReportLike, at?: number): void;
  /** Pour qui a déjà réduit son rapport et le garde par ailleurs (`createCallStats`). */
  pushSnapshot(sample: Snapshot): void;
  /** `null` tant qu'aucun rapport n'est arrivé. */
  read(): MediaStats | null;
  /** Nouvel appel : les compteurs du précédent n'ont rien à y faire. */
  reset(): void;
}

export function createStatsWindow(windowMs: number = STATS_WINDOW_MS): StatsWindow {
  let samples: Snapshot[] = [];
  const pushSnapshot = (sample: Snapshot): void => {
    samples.push(sample);
    const floor = sample.at - windowMs;
    while (samples.length > 2 && samples[0]!.at < floor) samples.shift();
  };
  return {
    push(report, at = Date.now()) {
      pushSnapshot(snapshot(report, at));
    },
    pushSnapshot,
    read() {
      const first = samples[0];
      const last = samples[samples.length - 1];
      return first && last ? windowStats(first, last) : null;
    },
    reset() {
      samples = [];
    },
  };
}

/**
 * Le collecteur d'un appel : on y verse les rapports, il tient les deux
 * lectures. `live()` est ce qu'on regarde pendant la conversation, `summary()`
 * ce que l'historique garde une fois raccroché.
 *
 * Le bilan compare le **premier** échantillon au **dernier**, et non zéro au
 * dernier : la mesure peut démarrer en cours d'appel — la case de trace se
 * coche quand on veut — et `spanMs` dit alors exactement ce qui a été
 * observé. Deux échantillons suffisent donc à le produire ; les rapports
 * eux-mêmes ne sont pas conservés, seuls leurs quelques compteurs le sont.
 */
export interface CallStatsCollector {
  push(report: StatsReportLike, at?: number): void;
  /** Les dix dernières secondes. */
  live(): MediaStats | null;
  /** Tout ce qui a été mesuré de l'appel. `null` s'il n'a rien été mesuré. */
  summary(): MediaStats | null;
}

export function createCallStats(windowMs: number = STATS_WINDOW_MS): CallStatsCollector {
  const win = createStatsWindow(windowMs);
  let first: Snapshot | null = null;
  let last: Snapshot | null = null;
  return {
    push(report, at = Date.now()) {
      const sample = snapshot(report, at);
      first ??= sample;
      last = sample;
      win.pushSnapshot(sample);
    },
    live: () => win.read(),
    summary: () => (first && last ? windowStats(first, last) : null),
  };
}
