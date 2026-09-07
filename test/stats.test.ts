/**
 * Les statistiques média : la fenêtre de 10 s, le bilan de l'appel, et ce
 * qu'ils affichent.
 *
 * Ce qui se vérifie ici est ce qu'un rapport WebRTC ne dit pas tout seul.
 * `getStats()` rend des **cumuls depuis le début de l'appel** : lus tels
 * quels, ils affichent 0,1 % de perte sur une conversation qui hache
 * depuis dix secondes. Toute la valeur du module est donc dans la
 * différence entre deux échantillons — et dans le fait que la perte ne se
 * rapporte pas au même total selon le sens : la réception compte les
 * paquets manquants **en plus** de ceux qu'elle a reçus, l'émission les
 * compte déjà dans ce qu'elle a envoyé.
 *
 * Les deux lectures sortent des mêmes relevés et ne doivent surtout pas
 * dire la même chose : les dix dernières secondes montrent la dégradation
 * en cours, le bilan de l'appel la noie dans dix minutes de calme. C'est
 * vérifié ici sur un même appel.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  createCallStats,
  createStatsWindow,
  snapshot,
  windowStats,
  type MediaStats,
  type StatsReportLike,
} from "../src/sip/stats.js";
import { statsAsText, statsCardHtml, statsPill } from "../src/ui/screens/call/stats.js";
import { historyRow } from "../src/ui/screens/call/parts.js";
import type { CallLogEntry } from "../src/storage/store.js";
import { setSipTrace } from "../src/sip/trace.js";
import { useLocale } from "../src/i18n/index.js";

/** localStorage minimal : le réglage de la trace SIP y vit. */
function stubStorage(): void {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => data.set(k, v),
      removeItem: (k: string) => data.delete(k),
    },
  });
}

interface Recv {
  bytes: number;
  packets: number;
  lost: number;
  /** Date de lecture estimée, en ms — ce dont sort l'écart audio / vidéo. */
  playout?: number;
}
interface Sent {
  bytes: number;
  packets: number;
  /** Ce que les rapports de réception du distant disent avoir perdu. */
  rrLost?: number;
}

interface Spec {
  audioIn?: Recv;
  audioOut?: Sent;
  videoIn?: Recv;
  videoOut?: Sent;
  /** Aller-retour en secondes, comme le rapporte WebRTC. */
  rtt?: number;
}

/** Un rapport WebRTC en réduction : les seuls compteurs que le module lit. */
function report(spec: Spec): StatsReportLike {
  const m = new Map<string, Record<string, unknown>>([
    ["c-opus", { type: "codec", mimeType: "audio/opus", clockRate: 48000 }],
    ["c-vp8", { type: "codec", mimeType: "video/VP8", clockRate: 90000 }],
  ]);
  if (spec.audioIn) {
    m.set("i-a", {
      type: "inbound-rtp",
      kind: "audio",
      codecId: "c-opus",
      bytesReceived: spec.audioIn.bytes,
      packetsReceived: spec.audioIn.packets,
      packetsLost: spec.audioIn.lost,
      ...(spec.audioIn.playout === undefined
        ? {}
        : { estimatedPlayoutTimestamp: spec.audioIn.playout }),
    });
  }
  if (spec.audioOut) {
    m.set("o-a", {
      type: "outbound-rtp",
      kind: "audio",
      codecId: "c-opus",
      bytesSent: spec.audioOut.bytes,
      packetsSent: spec.audioOut.packets,
    });
    m.set("r-a", {
      type: "remote-inbound-rtp",
      kind: "audio",
      packetsLost: spec.audioOut.rrLost ?? 0,
      ...(spec.rtt === undefined ? {} : { roundTripTime: spec.rtt }),
    });
  }
  if (spec.videoIn) {
    m.set("i-v", {
      type: "inbound-rtp",
      kind: "video",
      codecId: "c-vp8",
      bytesReceived: spec.videoIn.bytes,
      packetsReceived: spec.videoIn.packets,
      packetsLost: spec.videoIn.lost,
      ...(spec.videoIn.playout === undefined
        ? {}
        : { estimatedPlayoutTimestamp: spec.videoIn.playout }),
    });
  }
  if (spec.videoOut) {
    m.set("o-v", {
      type: "outbound-rtp",
      kind: "video",
      codecId: "c-vp8",
      bytesSent: spec.videoOut.bytes,
      packetsSent: spec.videoOut.packets,
    });
    m.set("r-v", {
      type: "remote-inbound-rtp",
      kind: "video",
      packetsLost: spec.videoOut.rrLost ?? 0,
    });
  }
  return m;
}

/** Ce que rend la fenêtre entre deux rapports séparés de `spanMs`. */
function between(from: Spec, to: Spec, spanMs: number): MediaStats {
  return windowStats(snapshot(report(from), 0), snapshot(report(to), spanMs));
}

beforeEach(async () => {
  stubStorage();
  await useLocale("fr");
});

describe("fenêtre de mesure", () => {
  it("rend le débit de la fenêtre, pas la moyenne de l'appel", () => {
    // l'appel a déjà transporté 1 Mo ; seuls comptent les 40 ko des 10 s
    const stats = between(
      { audioIn: { bytes: 1_000_000, packets: 50_000, lost: 0 } },
      { audioIn: { bytes: 1_040_000, packets: 50_500, lost: 0 } },
      10_000,
    );
    // 40 000 octets × 8 ÷ 10 s = 32 kbit/s
    expect(stats.audio?.recv.kbps).toBe(32);
  });

  it("rapporte la perte reçue au total attendu — reçus plus manquants", () => {
    const stats = between(
      { audioIn: { bytes: 0, packets: 0, lost: 0 } },
      { audioIn: { bytes: 40_000, packets: 990, lost: 10 } },
      10_000,
    );
    expect(stats.audio?.recv.loss).toBeCloseTo(0.01, 6);
  });

  it("rapporte la perte émise aux paquets envoyés, qui comptent déjà les perdus", () => {
    const stats = between(
      { audioOut: { bytes: 0, packets: 0, rrLost: 0 } },
      { audioOut: { bytes: 40_000, packets: 1000, rrLost: 20 } },
      10_000,
    );
    // 20 perdus sur 1000 envoyés — et non 20 / 1020
    expect(stats.audio?.sent.loss).toBeCloseTo(0.02, 6);
  });

  it("ne rend jamais une perte négative : un paquet dupliqué fait reculer le compteur", () => {
    const stats = between(
      { audioIn: { bytes: 0, packets: 0, lost: 5 } },
      { audioIn: { bytes: 40_000, packets: 1000, lost: 2 } },
      10_000,
    );
    expect(stats.audio?.recv.loss).toBe(0);
  });

  it("donne les codecs des deux sens, avec la fréquence de l'audio", () => {
    const stats = between(
      {
        audioIn: { bytes: 0, packets: 0, lost: 0 },
        audioOut: { bytes: 0, packets: 0 },
        videoIn: { bytes: 0, packets: 0, lost: 0 },
        videoOut: { bytes: 0, packets: 0 },
      },
      {
        audioIn: { bytes: 40_000, packets: 500, lost: 0 },
        audioOut: { bytes: 40_000, packets: 500 },
        videoIn: { bytes: 700_000, packets: 900, lost: 0 },
        videoOut: { bytes: 600_000, packets: 800 },
      },
      10_000,
    );
    expect(stats.audio?.recv.codec).toBe("opus");
    expect(stats.audio?.sent.clockRate).toBe(48000);
    expect(stats.video?.recv.codec).toBe("VP8");
    // 700 000 octets × 8 ÷ 10 s = 560 kbit/s
    expect(stats.video?.recv.kbps).toBe(560);
    expect(stats.video?.sent.kbps).toBe(480);
  });

  it("ne parle pas de vidéo dans un appel audio", () => {
    const stats = between(
      { audioIn: { bytes: 0, packets: 0, lost: 0 } },
      { audioIn: { bytes: 40_000, packets: 500, lost: 0 } },
      10_000,
    );
    expect(stats.video).toBeNull();
    expect(stats.audio).not.toBeNull();
  });

  it("rend l'aller-retour des RR en millisecondes", () => {
    const stats = between(
      { audioOut: { bytes: 0, packets: 0 }, rtt: 0.042 },
      { audioOut: { bytes: 40_000, packets: 500 }, rtt: 0.042 },
      10_000,
    );
    expect(stats.rttMs).toBeCloseTo(42, 6);
  });

  it("additionne les flux d'un même média — plusieurs SSRC, un seul débit", () => {
    const two = new Map([
      ["c-vp8", { type: "codec", mimeType: "video/VP8", clockRate: 90000 }],
      [
        "o-v1",
        { type: "outbound-rtp", kind: "video", codecId: "c-vp8", bytesSent: 0, packetsSent: 0 },
      ],
      [
        "o-v2",
        { type: "outbound-rtp", kind: "video", codecId: "c-vp8", bytesSent: 0, packetsSent: 0 },
      ],
    ]);
    const later = new Map(two);
    later.set("o-v1", {
      type: "outbound-rtp",
      kind: "video",
      codecId: "c-vp8",
      bytesSent: 100_000,
      packetsSent: 100,
    });
    later.set("o-v2", {
      type: "outbound-rtp",
      kind: "video",
      codecId: "c-vp8",
      bytesSent: 150_000,
      packetsSent: 150,
    });
    const stats = windowStats(snapshot(two, 0), snapshot(later, 10_000));
    // (100 000 + 150 000) × 8 ÷ 10 s
    expect(stats.video?.sent.kbps).toBe(200);
  });
});

describe("fenêtre glissante", () => {
  /** Un appel dont le débit reçu double à mi-parcours. */
  function pushSeconds(win: ReturnType<typeof createStatsWindow>, count: number): void {
    let bytes = 0;
    for (let s = 0; s <= count; s++) {
      win.push(report({ audioIn: { bytes, packets: s * 50, lost: 0 } }), s * 1000);
      bytes += s < 10 ? 1_000 : 4_000;
    }
  }

  it("oublie ce qui est sorti des 10 s : le débit suit la conversation", () => {
    const win = createStatsWindow();
    pushSeconds(win, 20);
    // les dix dernières secondes sont à 4 000 octets/s = 32 kbit/s ; la
    // moyenne de l'appel entier, elle, serait deux fois moindre
    expect(win.read()?.audio?.recv.kbps).toBe(32);
    expect(win.read()?.spanMs).toBe(10_000);
  });

  it("garde de quoi comparer même quand les mesures s'espacent", () => {
    const win = createStatsWindow();
    // onglet en arrière-plan : deux mesures à une minute d'écart
    win.push(report({ audioIn: { bytes: 0, packets: 0, lost: 0 } }), 0);
    win.push(report({ audioIn: { bytes: 240_000, packets: 3000, lost: 0 } }), 60_000);
    expect(win.read()?.audio?.recv.kbps).toBe(32);
  });

  it("n'annonce ni débit ni perte sur un seul échantillon, mais donne le codec", () => {
    const win = createStatsWindow();
    win.push(report({ audioIn: { bytes: 1000, packets: 50, lost: 3 } }), 0);
    const stats = win.read();
    expect(stats?.audio?.recv.kbps).toBeNull();
    expect(stats?.audio?.recv.loss).toBeNull();
    expect(stats?.audio?.recv.codec).toBe("opus");
  });

  it("repart de zéro pour l'appel suivant", () => {
    const win = createStatsWindow();
    win.push(report({ audioIn: { bytes: 500_000, packets: 9000, lost: 0 } }), 0);
    win.reset();
    expect(win.read()).toBeNull();
  });
});

describe("encart des statistiques", () => {
  const FULL: Spec = {
    audioIn: { bytes: 40_000, packets: 990, lost: 10 },
    audioOut: { bytes: 40_000, packets: 1000, rrLost: 60 },
    rtt: 0.042,
  };

  it("annonce la mesure en cours tant qu'aucun rapport n'est arrivé", () => {
    expect(statsCardHtml(null)).toContain("Mesure en cours");
  });

  it("affiche codec, débit et perte des deux sens", () => {
    const html = statsCardHtml(
      between({ audioIn: { bytes: 0, packets: 0, lost: 0 }, audioOut: { bytes: 0, packets: 0 } }, FULL, 10_000),
    );
    expect(html).toContain("opus");
    expect(html).toContain("48 kHz");
    expect(html).toContain("32 kbit/s");
    expect(html).toContain("Reçu");
    expect(html).toContain("Émis");
    expect(html).toContain("moyenne sur 10 s");
    expect(html).toContain("42 ms");
    // pas de section vidéo dans un appel audio
    expect(html).not.toContain("Vidéo");
  });

  it("met en avant une perte qui s'entend, sans la confier à la seule couleur", () => {
    const html = statsCardHtml(
      between({ audioOut: { bytes: 0, packets: 0, rrLost: 0 } }, FULL, 10_000),
    );
    // 6 % à l'émission : chiffre lisible, et marqué
    expect(html).toContain("6 %");
    expect(html).toContain('<strong class="hot">');
  });

  it("écrit un tiret là où rien n'est encore mesuré", () => {
    const win = createStatsWindow();
    win.push(report({ audioIn: { bytes: 0, packets: 0, lost: 0 } }), 0);
    expect(statsCardHtml(win.read())).toContain("—");
  });

  it("échappe ce qui vient de la négociation : un nom de codec n'est pas du HTML", () => {
    const nasty = new Map([
      ["c-x", { type: "codec", mimeType: 'audio/<img src=x onerror="alert(1)">' }],
      [
        "i-a",
        {
          type: "inbound-rtp",
          kind: "audio",
          codecId: "c-x",
          bytesReceived: 0,
          packetsReceived: 0,
          packetsLost: 0,
        },
      ],
    ]);
    const html = statsCardHtml(windowStats(snapshot(nasty, 0), snapshot(nasty, 1000)));
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("pastille « En communication »", () => {
  it("ne découvre les statistiques que si la trace SIP est cochée", () => {
    setSipTrace(false);
    expect(statsPill("En communication", { cls: "pill", connected: true })).not.toContain("<button");

    setSipTrace(true);
    const html = statsPill("En communication", { cls: "pill", connected: true });
    expect(html).toContain("<button");
    expect(html).toContain('data-ref="statsbtn"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('class="mediastats"');
  });

  it("reste une pastille tant que l'appel n'est pas établi", () => {
    setSipTrace(true);
    const html = statsPill("Sonnerie", { cls: "pill", connected: false });
    expect(html).toBe('<span class="pill">Sonnerie</span>');
  });
});

describe("bilan de l'appel entier", () => {
  /** Un appel : la mesure démarre à zéro et court dix minutes. */
  function longCall() {
    const media = createCallStats();
    for (let s = 0; s <= 600; s += 1) {
      // 4 000 octets/s pendant les 10 premières minutes, sans perte, sauf
      // les dix dernières secondes, qui en perdent la moitié
      const lost = s <= 590 ? 0 : (s - 590) * 25;
      media.push(
        report({ audioIn: { bytes: s * 4_000, packets: s * 50, lost } }),
        s * 1000,
      );
    }
    return media;
  }

  it("sépare ce que voit la fenêtre et ce que garde l'historique", () => {
    const media = longCall();
    // la fenêtre montre la dégradation en cours…
    expect(media.live()?.audio?.recv.loss).toBeGreaterThan(0.3);
    // …tandis que le bilan de l'appel la noie dans dix minutes de calme
    expect(media.summary()?.audio?.recv.loss).toBeLessThan(0.01);
    expect(media.summary()?.spanMs).toBe(600_000);
    expect(media.summary()?.audio?.recv.kbps).toBe(32);
  });

  it("ne mesure que ce qu'il a vu : la case peut se cocher en cours d'appel", () => {
    const media = createCallStats();
    // l'appel dure depuis longtemps quand la mesure démarre : les compteurs
    // ne partent pas de zéro, et c'est l'écart qui compte
    media.push(report({ audioIn: { bytes: 2_000_000, packets: 25_000, lost: 0 } }), 0);
    media.push(report({ audioIn: { bytes: 2_040_000, packets: 25_500, lost: 0 } }), 10_000);
    expect(media.summary()?.audio?.recv.kbps).toBe(32);
    expect(media.summary()?.spanMs).toBe(10_000);
  });

  it("ne rend rien tant que rien n'a été mesuré — la ligne n'aura pas de loupe", () => {
    expect(createCallStats().summary()).toBeNull();
  });
});

/**
 * Le texte est le troisième média (ADR 0003, D1) et il ne se mesure pas
 * comme les deux autres : ni débit ni taux de perte, mais les **marqueurs
 * de texte manquant** de T.140 §5.3.2.3. Ce qui se vérifie ici est qu'ils
 * suivent la même règle que tout le reste du module — un cumul relevé deux
 * fois, dont seule la différence est publiée.
 */
/**
 * L'écart audio / vidéo (F.703 §5.2.2) : la seule mesure de cet encart dont
 * la valeur cible vient d'une norme, et celle qui compte le plus pour le
 * public de Trix — au delà de 100 ms, la lecture labiale décroche et la
 * langue des signes devient pénible (H-series Suppl. 1).
 */
describe("écart audio / vidéo", () => {
  const both = (audioPlayout?: number, videoPlayout?: number): StatsReportLike =>
    report({
      audioIn: { bytes: 8000, packets: 50, lost: 0, playout: audioPlayout },
      videoIn: { bytes: 90_000, packets: 300, lost: 0, playout: videoPlayout },
    });

  it("mesure la différence des dates de lecture, signe compris", () => {
    const win = createStatsWindow();
    win.push(both(1000, 1000), 0);
    // le son joue 40 ms devant l'image
    win.push(both(1040, 1000), 1000);
    expect(win.read()?.syncMs).toBe(40);
    // et l'inverse se lit à l'envers, ce qui ne se dépanne pas pareil
    win.push(both(1000, 1150), 2000);
    expect(win.read()?.syncMs).toBe(-150);
  });

  it("le bilan de l'appel garde le pire écart, pas celui de la dernière seconde", () => {
    const media = createCallStats();
    media.push(both(1000, 1000), 0);
    media.push(both(1180, 1000), 1000); // l'image a décroché : 180 ms
    media.push(both(1010, 1000), 2000); // tout est rentré dans l'ordre
    // les dix dernières secondes disent l'instant…
    expect(media.live()?.syncMs).toBe(10);
    // …le bilan, lui, dit ce que l'appel a connu de pire
    expect(media.summary()?.syncMs).toBe(180);
  });

  it("s'abstient plutôt que de rassurer à tort", () => {
    const win = createStatsWindow();
    // un appel audio seul n'a rien à synchroniser
    win.push(report({ audioIn: { bytes: 0, packets: 0, lost: 0, playout: 1000 } }), 0);
    expect(win.read()?.syncMs).toBeNull();
    // navigateur qui ne rapporte pas le compteur : « — », et non zéro
    win.reset();
    win.push(both(), 0);
    expect(win.read()?.syncMs).toBeNull();
  });

  it("le pied de l'encart le montre, et le met en avant au delà du seuil", () => {
    // l'écart suppose les deux flux : un bilan qui le porte en a forcément
    const flow = { codec: null, clockRate: null, kbps: 40, loss: 0 };
    const stats = (syncMs: number): MediaStats => ({
      audio: { recv: flow, sent: flow },
      video: { recv: flow, sent: flow },
      share: null,
      text: null,
      rttMs: null,
      syncMs,
      spanMs: 10_000,
    });
    expect(statsCardHtml(stats(40))).toContain("Écart audio / vidéo");
    expect(statsCardHtml(stats(40))).not.toContain('<strong class="hot">40');
    // 100 ms : le seuil de F.703 §5.2.2, atteint et non dépassé, compte déjà
    expect(statsCardHtml(stats(100))).toContain('<strong class="hot">100');
    expect(statsCardHtml(stats(-140))).toContain('<strong class="hot">-140');
  });
});

describe("texte manquant", () => {
  it("la fenêtre publie la différence, pas le cumul de l'appel", () => {
    const win = createStatsWindow();
    win.push(report({ audioIn: { bytes: 0, packets: 0, lost: 0 } }), 0, 3);
    win.push(report({ audioIn: { bytes: 8000, packets: 50, lost: 0 } }), 10_000, 5);
    expect(win.read()?.text).toEqual({ missing: 2 });
  });

  it("un appel sans texte n'a pas de ligne de texte", () => {
    const win = createStatsWindow();
    win.push(report({ audioIn: { bytes: 0, packets: 0, lost: 0 } }), 0);
    win.push(report({ audioIn: { bytes: 8000, packets: 50, lost: 0 } }), 1000);
    expect(win.read()?.text).toBeNull();
  });

  it("le texte arrivé en cours d'appel compte à partir de son premier relevé", () => {
    const win = createStatsWindow();
    // premier relevé sans canal texte : le compteur n'existe pas encore
    win.push(report({ audioIn: { bytes: 0, packets: 0, lost: 0 } }), 0);
    win.push(report({ audioIn: { bytes: 8000, packets: 50, lost: 0 } }), 1000, 2);
    expect(win.read()?.text).toEqual({ missing: 2 });
  });

  it("l'encart montre la ligne, et la met en avant quand il y a des trous", () => {
    const stats: MediaStats = {
      audio: null,
      video: null,
      share: null,
      text: { missing: 4 },
      rttMs: null,
      syncMs: null,
      spanMs: 10_000,
    };
    const html = statsCardHtml(stats);
    expect(html).toContain("Texte manquant");
    expect(html).toContain('<strong class="hot">4</strong>');
    // un appel texte seul a bien un bilan : ce n'est pas « aucun flux mesuré »
    expect(html).not.toContain("Aucun flux");
  });
});

describe("relecture depuis l'historique", () => {
  const STATS: MediaStats = {
    audio: {
      recv: { codec: "opus", clockRate: 48000, kbps: 32, loss: 0.004 },
      sent: { codec: "opus", clockRate: 48000, kbps: 31.8, loss: 0.06 },
    },
    video: null,
    share: null,
    text: null,
    rttMs: 42,
    syncMs: null,
    spanMs: 133_000,
  };

  function entry(stats?: MediaStats): CallLogEntry {
    return {
      target: "bob@example.fr",
      direction: "outgoing",
      outcome: "answered",
      media: { audio: true, video: false, text: false },
      startedAt: Date.UTC(2026, 0, 15, 12, 30, 5),
      connectedAt: Date.UTC(2026, 0, 15, 12, 30, 6),
      endedAt: Date.UTC(2026, 0, 15, 12, 32, 19),
      endedBy: "local",
      reason: null,
      ...(stats ? { stats } : {}),
    };
  }

  it("la loupe n'apparaît que sur les appels dont le média a été mesuré", () => {
    expect(historyRow(entry(STATS), 2)).toContain('data-act="stats"');
    expect(historyRow(entry(STATS), 2)).toContain('data-i="2"');
    expect(historyRow(entry(), 0)).not.toContain('data-act="stats"');
  });

  it("dit sur quoi portent les chiffres : la durée mesurée, non les 10 s", () => {
    const html = statsCardHtml(STATS, "call");
    expect(html).toContain("2 min 13 s");
    expect(html).not.toContain("moyenne sur 10 s");
  });

  it("se copie en texte tabulé, avec les mêmes chiffres que le tableau", () => {
    const text = statsAsText(entry(STATS));
    expect(text).toContain("Statistiques média — bob@example.fr");
    expect(text).toContain("2 min 13 s");
    expect(text).toContain("Codec\topus 48 kHz\topus 48 kHz");
    expect(text).toContain("Débit\t32 kbit/s\t31,8 kbit/s");
    expect(text).toContain("Perte\t0,4 %\t6 %");
    expect(text).toContain("Aller-retour 42 ms");
    // le tableau arrondit pareil : un rapport de support ne doit pas porter
    // deux valeurs différentes de la même mesure
    const html = statsCardHtml(STATS, "call");
    expect(html).toContain("31,8 kbit/s");
    expect(html).toContain("0,4 %");
  });

  it("ne copie rien d'un appel sans bilan", () => {
    expect(statsAsText(entry())).toBe("");
  });
});

/**
 * **L'écran partagé compte à part** (ADR 0005, SC-5).
 *
 * Un rapport WebRTC range ses compteurs par média : deux `m=video` s'y
 * additionnent, et personne ne s'en aperçoit — le débit « vidéo » devient
 * celui de la caméra **plus** celui de l'écran, et un écran de bureau à
 * 2 Mbit/s fait passer pour excellente une caméra qui n'envoie plus rien.
 *
 * Pire pour le public de Trix : l'écart audio / vidéo de F.703 §5.2.2 se
 * mesurerait sur le premier flux vidéo venu. Mesuré sur un document qui
 * défile, le chiffre ne dit plus rien de la lecture labiale.
 *
 * La séparation se fait par le `a=mid` (RFC 5888), la seule identité d'une
 * m-section qui survive à une renégociation — le port les tient, lui seul
 * sait ce qu'un flux est.
 */
describe("l'écran partagé dans la mesure", () => {
  interface Piste {
    mid?: string;
    bytes: number;
    packets: number;
    lost?: number;
    playout?: number;
  }

  /**
   * Un rapport à deux `m=video` : la caméra (MID 1) et l'écran (MID 2), en
   * réception comme en émission. L'écran est **le premier** de la liste :
   * c'est ainsi qu'on éprouve que l'ordre ne décide de rien.
   */
  function deuxVideos(o: {
    audioIn?: Piste;
    ecranIn?: Piste;
    cameraIn?: Piste;
    ecranOut?: Piste;
    cameraOut?: Piste;
    /** Perte rapportée par le distant sur le flux nommé. */
    rrLostFor?: { localId: string; lost: number };
  }): StatsReportLike {
    const m = new Map<string, Record<string, unknown>>([
      ["c-opus", { type: "codec", mimeType: "audio/opus", clockRate: 48000 }],
      ["c-vp8", { type: "codec", mimeType: "video/VP8", clockRate: 90000 }],
    ]);
    const recv = (id: string, kind: string, p: Piste, codecId: string): void => {
      m.set(id, {
        type: "inbound-rtp",
        kind,
        codecId,
        ...(p.mid === undefined ? {} : { mid: p.mid }),
        bytesReceived: p.bytes,
        packetsReceived: p.packets,
        packetsLost: p.lost ?? 0,
        ...(p.playout === undefined ? {} : { estimatedPlayoutTimestamp: p.playout }),
      });
    };
    if (o.ecranIn) recv("i-share", "video", o.ecranIn, "c-vp8");
    if (o.cameraIn) recv("i-cam", "video", o.cameraIn, "c-vp8");
    if (o.audioIn) recv("i-a", "audio", o.audioIn, "c-opus");
    for (const [id, p] of [
      ["o-share", o.ecranOut],
      ["o-cam", o.cameraOut],
    ] as const) {
      if (!p) continue;
      m.set(id, {
        type: "outbound-rtp",
        kind: "video",
        codecId: "c-vp8",
        ...(p.mid === undefined ? {} : { mid: p.mid }),
        bytesSent: p.bytes,
        packetsSent: p.packets,
      });
    }
    if (o.rrLostFor) {
      m.set("r-v", {
        type: "remote-inbound-rtp",
        kind: "video",
        localId: o.rrLostFor.localId,
        packetsLost: o.rrLostFor.lost,
      });
    }
    return m;
  }

  /** Deux relevés séparés d'une seconde, l'écran nommé par son MID. */
  const entre = (
    from: Parameters<typeof deuxVideos>[0],
    to: Parameters<typeof deuxVideos>[0],
    mids: string[] = ["2"],
  ): MediaStats =>
    windowStats(
      snapshot(deuxVideos(from), 0, null, mids),
      snapshot(deuxVideos(to), 1000, null, mids),
    );

  it("le débit vidéo est celui de la caméra, l'écran a sa propre colonne", () => {
    const stats = entre(
      {
        cameraIn: { mid: "1", bytes: 0, packets: 0 },
        ecranIn: { mid: "2", bytes: 0, packets: 0 },
      },
      {
        // 25 ko de caméra, 250 ko d'écran sur la seconde
        cameraIn: { mid: "1", bytes: 25_000, packets: 25 },
        ecranIn: { mid: "2", bytes: 250_000, packets: 250 },
      },
    );

    expect(stats.video?.recv.kbps).toBe(200);
    expect(stats.share?.recv.kbps).toBe(2000);
  });

  /**
   * La perte à l'émission ne vient pas du flux lui-même mais des rapports
   * de réception du distant — et ceux-là ne portent pas de `mid` : c'est
   * leur `localId` qui renvoie au flux émis, et lui le porte.
   */
  it("la perte rapportée par le distant suit le bon des deux flux", () => {
    const stats = entre(
      {
        cameraOut: { mid: "1", bytes: 0, packets: 0 },
        ecranOut: { mid: "2", bytes: 0, packets: 0 },
        rrLostFor: { localId: "o-share", lost: 0 },
      },
      {
        cameraOut: { mid: "1", bytes: 25_000, packets: 100 },
        ecranOut: { mid: "2", bytes: 250_000, packets: 100 },
        rrLostFor: { localId: "o-share", lost: 10 },
      },
    );

    expect(stats.share?.sent.loss).toBeCloseTo(0.1, 5);
    expect(stats.video?.sent.loss).toBe(0);
  });

  /**
   * **La métrique du public de Trix** : l'écart que F.703 §5.2.2 borne est
   * celui de la voix et du visage. Un document qui défile avec une seconde
   * de retard ne gêne personne — mesuré sur lui, le chiffre condamnerait un
   * appel parfaitement synchrone.
   */
  it("l'écart audio / vidéo ignore l'écran, même quand il vient en premier", () => {
    const avec = entre(
      {},
      {
        audioIn: { bytes: 1, packets: 1, playout: 10_000 },
        ecranIn: { mid: "2", bytes: 1, packets: 1, playout: 8_000 },
        cameraIn: { mid: "1", bytes: 1, packets: 1, playout: 9_960 },
      },
    );
    // 40 ms entre la voix et le visage, et non 2 s entre la voix et l'écran
    expect(avec.syncMs).toBe(40);
  });

  it("un écran seul, sans caméra, ne donne aucun écart à mesurer", () => {
    const stats = entre(
      {},
      {
        audioIn: { bytes: 1, packets: 1, playout: 10_000 },
        ecranIn: { mid: "2", bytes: 1, packets: 1, playout: 8_000 },
      },
    );
    expect(stats.syncMs).toBeNull();
    expect(stats.video).toBeNull();
    expect(stats.share).not.toBeNull();
  });

  /**
   * Un navigateur qui ne rapporte pas `mid` range tout dans la vidéo, comme
   * avant SC-5 : le chiffre est moins juste, l'encart reste lisible, et rien
   * n'échoue — dégrader, jamais refuser (F.703 §8.3.5).
   */
  it("sans MID rapporté, tout reste de la vidéo", () => {
    const stats = entre(
      { cameraIn: { bytes: 0, packets: 0 }, ecranIn: { bytes: 0, packets: 0 } },
      { cameraIn: { bytes: 25_000, packets: 25 }, ecranIn: { bytes: 250_000, packets: 250 } },
    );
    expect(stats.share).toBeNull();
    expect(stats.video?.recv.kbps).toBe(2200);
  });

  /** Un appel sans partage n'a pas de colonne d'écran : elle ne s'invente pas. */
  it("pas de partage, pas de colonne", () => {
    const stats = entre(
      { cameraIn: { mid: "1", bytes: 0, packets: 0 } },
      { cameraIn: { mid: "1", bytes: 25_000, packets: 25 } },
    );
    expect(stats.share).toBeNull();
  });

  it("l'encart et le presse-papiers portent la ligne de l'écran", () => {
    const stats = entre(
      {
        cameraIn: { mid: "1", bytes: 0, packets: 0 },
        ecranIn: { mid: "2", bytes: 0, packets: 0 },
      },
      {
        cameraIn: { mid: "1", bytes: 25_000, packets: 25 },
        ecranIn: { mid: "2", bytes: 250_000, packets: 250 },
      },
    );
    expect(statsCardHtml(stats)).toContain("Écran partagé");

    const entry = {
      target: "sip:bob@example.fr",
      startedAt: Date.now(),
      stats,
    } as CallLogEntry;
    expect(statsAsText(entry)).toContain("Écran partagé");
  });

  /**
   * Un bilan enregistré **avant** SC-5 n'a pas de colonne d'écran : son
   * absence n'est pas un partage à zéro, et l'historique doit continuer de
   * s'ouvrir.
   */
  it("un bilan d'avant le partage s'affiche encore", () => {
    const stats = entre(
      { cameraIn: { mid: "1", bytes: 0, packets: 0 } },
      { cameraIn: { mid: "1", bytes: 25_000, packets: 25 } },
    );
    const ancien = { ...stats } as Partial<MediaStats>;
    delete ancien.share;
    expect(() => statsCardHtml(ancien as MediaStats)).not.toThrow();
    expect(statsCardHtml(ancien as MediaStats)).not.toContain("Écran partagé");
  });
});
