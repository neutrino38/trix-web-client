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
 * S'y ajoute une mesure qui n'est ni un débit ni une perte : **l'écart
 * audio / vidéo**, celui que F.703 §5.2.2 veut sous 100 ms parce que c'est
 * la limite de la lecture labiale et de la langue des signes (H-series
 * Suppl. 1). C'est *la* métrique du public de Trix, et elle se lit à
 * l'instant, pas sur une fenêtre.
 *
 * Les mêmes échantillons servent deux lectures, et c'est tout l'intérêt de
 * les prendre une seule fois : la fenêtre de 10 s pendant l'appel, et le
 * **bilan de l'appel entier** — premier échantillon contre dernier — que
 * l'historique garde à côté du carnet de trace (§5.4).
 *
 * **L'écran partagé compte à part** (ADR 0005, SC-5). Un rapport WebRTC
 * range ses compteurs par média, et deux `m=video` s'y additionneraient :
 * le débit « vidéo » d'un appel avec partage serait celui de la caméra
 * **plus** celui de l'écran, et l'écart audio / vidéo — la métrique du
 * public de Trix — se mesurerait sur le premier flux venu. Les m-sections
 * du partage sont donc nommées par leur MID (RFC 5888), et leurs compteurs
 * vont dans une troisième colonne, hors du calcul d'écart.
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
/**
 * Ce que les compteurs distinguent : les deux médias de la conversation, et
 * **l'écran partagé à part** (ADR 0005, D3). Ce n'est pas un média de plus
 * dans l'appel — c'est une colonne de plus dans la mesure, ce qui n'est pas
 * la même chose : l'appel ne se dit pas « en vidéo » parce qu'un document
 * défile, mais son débit se voit, et c'est souvent lui qui sature le lien.
 */
export type StatStream = MediaKind | "share";
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

/**
 * Le texte temps réel sur la fenêtre — **le troisième média** (ADR 0003,
 * D1), et il se mesure autrement que les deux autres.
 *
 * Ni débit ni taux de perte : le texte ne passe pas par RTP, `getStats()`
 * n'en sait rien, et de toute façon la question n'est pas la même. T.140
 * §5.3.2.3 donne au texte son unité de mesure — caractères corrompus,
 * caractères perdus, **marqueurs de texte manquant** —, et c'est le
 * troisième que l'on peut compter sans mentir : un `U+FFFD` reçu est un
 * trou constaté, ici ou chez le distant (`sip/rtt.ts`).
 *
 * Un seul sens, celui de la réception : ce qui est parti d'ici, personne ne
 * dit s'il est arrivé — SCTP et WebSocket sont fiables, et une passerelle
 * qui perd du RTP en aval ne le rapporte à personne.
 */
export interface TextFlow {
  /** Marqueurs de texte manquant apparus sur la fenêtre. */
  missing: number;
}

/** L'état du média des deux côtés, sur la fenêtre. */
export interface MediaStats {
  /** `null` quand ce média n'est pas dans l'appel (un appel audio n'a pas de vidéo). */
  audio: Record<Direction, Flow> | null;
  video: Record<Direction, Flow> | null;
  /**
   * **L'écran partagé**, dans un sens ou dans l'autre (ADR 0005, SC-5).
   * `null` quand il n'y en a pas — c'est-à-dire presque toujours.
   *
   * Séparé de `video`, et non fondu dedans : un écran de bureau à 2 Mbit/s
   * ferait passer pour excellente une caméra qui n'envoie plus rien, et
   * c'est exactement la question qu'on pose à cet encart quand l'image
   * hache. `video` reste donc la caméra, et rien d'autre.
   */
  share: Record<Direction, Flow> | null;
  /** `null` quand l'appel ne porte pas de texte — le compte est en `none`, ou le distant n'a pas suivi. */
  text: TextFlow | null;
  /** Aller-retour rapporté par les RR, en millisecondes. */
  rttMs: number | null;
  /**
   * **Écart audio / vidéo à la lecture**, en millisecondes, signé : positif
   * quand le son est en avance sur l'image, négatif quand il est en retard.
   *
   * F.703 §5.2.2 le veut sous 120 ms, de préférence sous 100 — le seuil de
   * la lecture labiale et de la langue des signes (`SYNC_LIMIT_MS`). Trix
   * s'adresse d'abord à des personnes sourdes : un décalage que personne
   * n'entend rend l'image inutilisable, et c'est la seule mesure de cet
   * encart dont la valeur cible vient d'une norme.
   *
   * Sur la fenêtre de 10 s, c'est l'écart **du dernier relevé** : ce qui se
   * passe maintenant. Sur le bilan d'un appel entier, c'est le **pire écart
   * observé** — un instantané pris une seconde avant le raccrochage ne
   * dirait rien des trois minutes où l'image avait décroché, et c'est
   * précisément la question que l'on pose à un bilan.
   *
   * Il vient de `estimatedPlayoutTimestamp` des deux flux entrants — la
   * date à laquelle le navigateur estime jouer ce qu'il tient. Deux flux
   * synchronisés jouent le même instant de capture, donc l'écart de ces
   * deux dates *est* le décalage. `null` dès qu'il manque un des deux —
   * appel sans vidéo, flux pas encore établi, navigateur qui ne rapporte
   * pas ce compteur : mieux vaut « — » qu'un zéro rassurant.
   */
  syncMs: number | null;
  /** Étendue réelle de la fenêtre, en ms : 0 tant qu'un seul échantillon. */
  spanMs: number;
}

/**
 * L'écart audio / vidéo au-delà duquel la lecture labiale décroche : 100 ms,
 * la valeur préférée de F.703 §5.2.2 (la limite absolue y est 120 ms). C'est
 * le seuil à partir duquel l'encart met le chiffre en avant.
 */
export const SYNC_LIMIT_MS = 100;

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

type FlowKey = `${StatStream}-${Direction}`;

/** Le rapport entier, ramené aux quatre sens qui nous intéressent. */
export interface Snapshot {
  at: number;
  flows: Record<FlowKey, Counters>;
  rttMs: number | null;
  /**
   * Marqueurs de texte manquant **cumulés depuis le début de l'appel**, tels
   * que le canal texte les compte (`sip/rtt.ts`). `null` quand l'appel n'en
   * porte pas.
   *
   * Cumulé, comme les octets et les paquets du rapport WebRTC — et pour la
   * même raison : c'est la différence entre deux relevés qui dit quelque
   * chose de l'instant. Trois trous en dix minutes ne se lisent pas comme
   * trois trous en dix secondes.
   */
  textMissing: number | null;
  /**
   * Date de lecture estimée de chaque flux entrant (`estimatedPlayoutTimestamp`,
   * en ms), telle que le navigateur la rapporte. `null` quand il ne la
   * rapporte pas, ou que le flux n'existe pas.
   *
   * **L'écran partagé n'y entre pas** : l'écart que F.703 §5.2.2 borne est
   * celui de la voix et du visage, et un document qui défile avec une
   * seconde de retard ne gêne personne. Mesuré sur lui, le chiffre dirait
   * n'importe quoi de la lecture labiale.
   *
   * Instantané, et non cumulé : c'est la seule valeur du rapport dont la
   * différence entre deux relevés ne voudrait rien dire — ce qui compte est
   * l'écart entre les deux médias au même instant.
   */
  playout: Record<MediaKind, number | null>;
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
export function snapshot(
  report: StatsReportLike,
  at: number,
  textMissing: number | null = null,
  /**
   * Les `a=mid` des m-sections qui portent un **écran partagé** — le nôtre,
   * le sien, ou les deux (ADR 0005). Le port les tient : c'est lui qui sait
   * ce qu'un flux est, le rapport WebRTC ne le dit pas.
   */
  shareMids: readonly string[] = [],
): Snapshot {
  const flows: Record<FlowKey, Counters> = {
    "audio-recv": empty(),
    "audio-sent": empty(),
    "video-recv": empty(),
    "video-sent": empty(),
    "share-recv": empty(),
    "share-sent": empty(),
  };
  const shares = new Set(shareMids);
  /** Le `a=mid` d'un compteur, quand le navigateur le rapporte. */
  const midOf = (stat: RawStat): string | null =>
    typeof stat.mid === "string" ? stat.mid : null;
  /**
   * Dans quelle colonne ce compteur va : la m-section décide, et le média
   * ne décide que du reste. Un navigateur qui ne rapporte pas `mid` range
   * tout dans la vidéo, comme avant — dégrader, jamais refuser.
   */
  const streamOf = (stat: RawStat, kind: MediaKind): StatStream => {
    const mid = midOf(stat);
    return mid !== null && shares.has(mid) ? "share" : kind;
  };
  let rttMs: number | null = null;
  const playout: Record<MediaKind, number | null> = { audio: null, video: null };

  for (const [, stat] of report) {
    const kind = kindOf(stat);
    if (kind === null) continue;

    if (stat.type === "inbound-rtp") {
      const stream = streamOf(stat, kind);
      const flow = flows[`${stream}-recv`];
      flow.present = true;
      // le premier flux du média suffit : les couches d'un simulcast sont
      // jouées ensemble, et c'est l'écart *entre médias* que l'on mesure.
      // L'écran, lui, n'y entre jamais : ce n'est pas de sa synchronisation
      // que parle F.703 §5.2.2
      if (
        stream !== "share" &&
        playout[kind] === null &&
        typeof stat.estimatedPlayoutTimestamp === "number"
      ) {
        playout[kind] = stat.estimatedPlayoutTimestamp;
      }
      flow.bytes += num(stat.bytesReceived);
      flow.packets += num(stat.packetsReceived);
      // `packetsLost` est signé : des paquets dupliqués le font reculer
      flow.lost += num(stat.packetsLost);
      Object.assign(flow, codecOf(report, stat.codecId));
    } else if (stat.type === "outbound-rtp") {
      const flow = flows[`${streamOf(stat, kind)}-sent`];
      flow.present = true;
      flow.bytes += num(stat.bytesSent);
      flow.packets += num(stat.packetsSent);
      Object.assign(flow, codecOf(report, stat.codecId));
    } else if (stat.type === "remote-inbound-rtp") {
      // ce que le distant dit avoir reçu de nous : la seule source possible
      // pour la perte à l'émission. Ce compteur-là ne porte pas de `mid` —
      // c'est son `localId` qui renvoie au flux émis, et lui le porte
      const local = typeof stat.localId === "string" ? report.get(stat.localId) : undefined;
      flows[`${local ? streamOf(local, kind) : kind}-sent`].lost += num(stat.packetsLost);
      // l'aller-retour est mesuré par média ; le premier rapporté suffit à
      // qualifier le chemin, les deux passent par la même paire ICE
      if (rttMs === null && typeof stat.roundTripTime === "number") {
        rttMs = stat.roundTripTime * 1000;
      }
    }
  }
  return { at, flows, rttMs, textMissing, playout };
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

/**
 * Les trous de texte apparus entre deux échantillons. Le compteur du canal
 * ne redescend jamais, mais un appel peut avoir commencé sans texte et en
 * gagner un : la différence est alors prise à partir du premier relevé qui
 * en portait un, et jamais négative.
 */
function textOf(from: Snapshot, to: Snapshot): TextFlow | null {
  if (to.textMissing === null) return null;
  return { missing: Math.max(0, to.textMissing - (from.textMissing ?? 0)) };
}

/**
 * L'écart audio / vidéo d'un relevé : la différence des deux dates de
 * lecture estimées. Un état, pas un cumul — d'où la lecture sur un seul
 * échantillon, là où tout le reste de ce module compare deux bornes.
 */
export function syncOf(to: Snapshot): number | null {
  const { audio, video } = to.playout;
  return audio !== null && video !== null ? audio - video : null;
}

/** Ce qui s'est passé entre deux échantillons. `from === to` : les codecs seuls. */
export function windowStats(from: Snapshot, to: Snapshot): MediaStats {
  const spanMs = Math.max(0, to.at - from.at);
  const both = (stream: StatStream): Record<Direction, Flow> | null => {
    const recv = to.flows[`${stream}-recv`];
    const sent = to.flows[`${stream}-sent`];
    if (!recv.present && !sent.present) return null;
    return {
      recv: flowOf("recv", from.flows[`${stream}-recv`], recv, spanMs),
      sent: flowOf("sent", from.flows[`${stream}-sent`], sent, spanMs),
    };
  };
  return {
    audio: both("audio"),
    video: both("video"),
    share: both("share"),
    text: textOf(from, to),
    rttMs: to.rttMs,
    syncMs: syncOf(to),
    spanMs,
  };
}

/**
 * La fenêtre glissante : on y verse des rapports, elle rend l'état du média
 * sur les dernières `windowMs`. Les échantillons sortis de la fenêtre sont
 * oubliés — sauf les deux derniers, sans lesquels il n'y aurait plus rien à
 * comparer si les mesures s'espaçaient (onglet en arrière-plan).
 */
export interface StatsWindow {
  push(
    report: StatsReportLike,
    at?: number,
    textMissing?: number | null,
    shareMids?: readonly string[],
  ): void;
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
    push(report, at = Date.now(), textMissing = null, shareMids = []) {
      pushSnapshot(snapshot(report, at, textMissing, shareMids));
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
  /**
   * Un relevé. `textMissing` est le compteur cumulé du canal texte, `null`
   * quand l'appel n'en porte pas — le port le lit au même instant que le
   * rapport WebRTC, pour que les deux mesures parlent de la même seconde.
   */
  push(
    report: StatsReportLike,
    at?: number,
    textMissing?: number | null,
    shareMids?: readonly string[],
  ): void;
  /** Les dix dernières secondes. */
  live(): MediaStats | null;
  /** Tout ce qui a été mesuré de l'appel. `null` s'il n'a rien été mesuré. */
  summary(): MediaStats | null;
}

export function createCallStats(windowMs: number = STATS_WINDOW_MS): CallStatsCollector {
  const win = createStatsWindow(windowMs);
  let first: Snapshot | null = null;
  let last: Snapshot | null = null;
  /** Le pire écart audio / vidéo vu de tout l'appel — voir `MediaStats.syncMs`. */
  let worstSync: number | null = null;
  return {
    push(report, at = Date.now(), textMissing = null, shareMids = []) {
      const sample = snapshot(report, at, textMissing, shareMids);
      first ??= sample;
      last = sample;
      const sync = syncOf(sample);
      if (sync !== null && (worstSync === null || Math.abs(sync) > Math.abs(worstSync))) {
        worstSync = sync;
      }
      win.pushSnapshot(sample);
    },
    live: () => win.read(),
    summary: () =>
      first && last ? { ...windowStats(first, last), syncMs: worstSync } : null,
  };
}
