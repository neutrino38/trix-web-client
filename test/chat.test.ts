/**
 * Le fil du tchat : le modèle, sans page.
 *
 * Tout ce qui est vérifié ici tient au **modèle** — c'est lui la source, le
 * DOM n'en est qu'une projection (§4.9). Ce qui se casse sans qu'un type
 * ne bronche : une bulle vivante par côté, un séparateur qui fige, un
 * retour arrière qui franchit ce séparateur, un correspondant qui écrit du
 * balisage dans notre fil, et la règle des deux secondes — écrire à la fin
 * part tout de suite, corriger au milieu attend.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  bubbleText,
  chatAvailable,
  chatEnter,
  chatLink,
  chatPane,
  chatReceive,
  chatReset,
  chatSent,
  chatStateLine,
  chatThread,
  chatThreadHtml,
  chatTranscript,
  chatWritable,
  chatHead,
  chatOnStage,
  chatStage,
  chatType,
  CHAT_PANE_ID,
  type ChatBubble,
  type ChatItem,
} from "../src/ui/screens/call/chat.js";
import { overlayBar } from "../src/ui/screens/call/overlay.js";
import type { CallView } from "../src/machines/events.js";
import type { CallMedia, CallSession } from "../src/sip/port.js";
import { T140 } from "../src/sip/t140.js";
import { useLocale } from "../src/i18n/index.js";

beforeAll(async () => {
  await useLocale("fr");
});

beforeEach(() => {
  chatReset("Bob");
});

const bubbles = (): ChatBubble[] =>
  chatThread().filter((i: ChatItem): i is ChatBubble => i.kind === "bubble");

const texts = (): string[] => bubbles().map(bubbleText);

describe("le fil reçu", () => {
  it("ouvre une bulle vivante au premier caractère", () => {
    chatReceive("bon");
    chatReceive("jour");
    expect(texts()).toEqual(["bonjour"]);
    expect(bubbles()[0]?.endedAt).toBeNull();
  });

  it("fige la bulle sur le séparateur et en ouvre une neuve", () => {
    chatReceive(`bonjour${T140.LS}salut`);
    expect(texts()).toEqual(["bonjour", "salut"]);
    expect(bubbles()[0]?.endedAt).not.toBeNull();
    expect(bubbles()[1]?.endedAt).toBeNull();
  });

  it("un séparateur reçu sur une bulle vide ne crée rien", () => {
    chatReceive(`${T140.LS}${T140.LS}a`);
    expect(texts()).toEqual(["a"]);
  });

  it("efface un graphème entier, émoji compris", () => {
    chatReceive(`bravo 👍🏽${T140.BS}`);
    expect(texts()).toEqual(["bravo "]);
  });

  it("un retour arrière sur une bulle vide refusionne la bulle figée", () => {
    chatReceive(`bonjour${T140.LS}`);
    chatReceive(T140.BS);
    expect(texts()).toEqual(["bonjour"]);
    expect(bubbles()[0]?.endedAt).toBeNull();
    chatReceive(" Bob");
    expect(texts()).toEqual(["bonjour Bob"]);
  });

  it("garde les attributs reçus en morceaux distincts", () => {
    chatReceive(`au ${T140.CSI}31m12 rue des Lilas${T140.CSI}0m, bâtiment C`);
    const runs = bubbles()[0]?.runs ?? [];
    expect(runs.map((r) => r.text)).toEqual(["au ", "12 rue des Lilas", ", bâtiment C"]);
    expect(runs[1]?.attrs.color).toBe("var(--red)");
    expect(runs[2]?.attrs.color).toBeUndefined();
  });

  it("ne pose qu'un seul marqueur pour des pertes consécutives", () => {
    chatReceive(`${T140.LOST}${T140.LOST}${T140.LOST}suite`);
    expect(texts()).toEqual([`${T140.LOST}suite`]);
  });
});

/**
 * **L'annonce précoce s'affiche.** Un serveur qui joue un fichier sous-titré
 * après un 183 envoie du T.140 avant que quiconque ait décroché : la
 * connexion pair-à-pair est déjà établie, le canal avec elle. Pour une
 * personne sourde, ce texte *est* l'annonce — le taire au motif que l'appel
 * n'est pas établi reviendrait à ne rien recevoir du tout.
 */
describe("texte reçu avant le décrochage", () => {
  it("le fil montre l'annonce, et la saisie reste fermée", () => {
    chatReceive("Toutes nos lignes sont occupées.");
    expect(texts()).toEqual(["Toutes nos lignes sont occupées."]);
    const pane = chatPane("Bob", false);
    expect(pane).toContain("Toutes nos lignes sont occupées.");
    expect(pane).toMatch(/<textarea[^>]*disabled/s);
  });
});

describe("ce que le correspondant écrit ne devient jamais du balisage", () => {
  it("échappe le texte reçu dans le fil", () => {
    chatReceive("<img src=x onerror=alert(1)>");
    const html = chatThreadHtml();
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img");
  });

  it("échappe aussi ce qui est tapé ici", () => {
    chatType("<b>gras</b>");
    expect(chatPane("Bob")).toContain("&lt;b&gt;gras&lt;/b&gt;");
  });
});

describe("l'émission, et la règle des deux secondes", () => {
  it("écrire à la fin part tout de suite, et se voit dans la bulle locale", () => {
    chatType("bon");
    chatType("bonjour");
    expect(chatSent()).toBe("bonjour");
    expect(texts()).toEqual(["bonjour"]);
  });

  it("effacer par la fin part tout de suite aussi", () => {
    chatType("bonjour");
    chatType("bon");
    expect(chatSent()).toBe("bon");
    expect(texts()).toEqual(["bon"]);
  });

  it("corriger au milieu attend : la bulle locale montre ce qui est parti", () => {
    chatType("12 rue des Lilas");
    chatType("12 rue des Tilleuls");
    // rien n'est encore parti : la bulle diverge du champ, et l'état le dit
    expect(chatSent()).toBe("12 rue des Lilas");
    expect(texts()).toEqual(["12 rue des Lilas"]);
    expect(chatStateLine().cls).toBe("warn");
  });

  it("Entrée fige la bulle locale et vide le champ", () => {
    chatType("j'arrive");
    chatEnter();
    expect(chatSent()).toBe("");
    expect(texts()).toEqual(["j'arrive"]);
    expect(bubbles()[0]?.endedAt).not.toBeNull();
  });

  it("Entrée sur un champ vide ne fige rien", () => {
    chatEnter();
    expect(chatThread()).toHaveLength(0);
  });

  it("un collage n'apporte pas ses retours à la ligne dans la bulle", () => {
    chatType("deux\r\nlignes");
    expect(chatSent()).toBe("deux lignes");
  });
});

describe("l'état du lien", () => {
  it("dit l'ouverture une fois, et la note dans le fil", () => {
    chatLink("open");
    chatLink("open");
    expect(chatThread().filter((i) => i.kind === "note")).toHaveLength(1);
    expect(chatStateLine().cls).toBe("ok");
  });

  it("distingue un canal refusé d'un canal fermé après usage", () => {
    chatLink("closed");
    expect(chatStateLine().label).toContain("ne prend pas");
    chatReset("Bob");
    chatLink("open");
    chatLink("closed");
    expect(chatStateLine().label).not.toContain("ne prend pas");
  });

  it("une rupture se voit dans le fil et dans l'état", () => {
    chatLink("open");
    chatLink("lost");
    expect(chatStateLine().cls).toBe("err");
    expect(chatThread().at(-1)).toMatchObject({ kind: "note", key: "chat.note.broken" });
  });
});

describe("les deux côtés du fil", () => {
  it("tient une bulle vivante de chaque côté à la fois", () => {
    chatReceive("je vous entends mal");
    chatType("oui, je vous lis");
    expect(bubbles().map((b) => [b.side, bubbleText(b)])).toEqual([
      ["them", "je vous entends mal"],
      ["us", "oui, je vous lis"],
    ]);
    // et le séparateur du correspondant ne fige que la sienne
    chatReceive(T140.LS);
    expect(bubbles()[0]?.endedAt).not.toBeNull();
    expect(bubbles()[1]?.endedAt).toBeNull();
  });
});

describe("ce que l'historique garde", () => {
  it("le fil de l'appel, bulle vivante close au raccrochage", () => {
    chatReceive("je vous entends mal");
    chatType("oui, je vous lis");
    const kept = chatTranscript();
    expect(kept.filter((i) => i.kind === "bubble").map((b) => bubbleText(b))).toEqual([
      "je vous entends mal",
      "oui, je vous lis",
    ]);
    // le panneau, lui, les tient encore pour vivantes : ce qui part au
    // coffre est une copie close, pas le modèle
    expect(kept.every((i) => i.kind === "note" || i.endedAt !== null)).toBe(true);
    expect(bubbles().every((b) => b.endedAt === null)).toBe(true);
  });

  it("rien d'un appel où personne n'a écrit", () => {
    chatLink("open");
    chatLink("closed");
    expect(chatThread().length).toBeGreaterThan(0); // des remarques, pas des messages
    expect(chatTranscript()).toEqual([]);
  });
});

describe("le gabarit", () => {
  it("le panneau est une région, jamais masquée : rien ne la rouvrirait", () => {
    const pane = chatPane("Bob");
    expect(pane).toContain(`id="${CHAT_PANE_ID}"`);
    expect(pane).toContain('role="region"');
    expect(pane.slice(0, pane.indexOf(">"))).not.toContain("hidden");
  });

  /**
   * Avant le décrochage — sonnerie, et surtout média précoce, où une
   * annonce en texte temps réel peut déjà arriver (RFC 3960) — le fil se
   * **lit** mais ne s'écrit pas : ce qu'on taperait n'aurait pas de
   * destinataire, et partirait d'un bloc au décrochage.
   */
  it("avant le décrochage : le fil se lit, la saisie est fermée", () => {
    chatLink("open");
    const early = chatPane("Bob", false);
    expect(early).toMatch(/<textarea[^>]*disabled/s);
    expect(early).toContain("Lecture seule tant que l'appel n'est pas décroché");
    // le fil lui-même reste une région ordinaire : rien n'y est masqué
    expect(early).toContain('role="log"');

    const live = chatPane("Bob");
    expect(live).not.toMatch(/<textarea[^>]*disabled/s);
  });

  it("l'en-tête porte la pastille du lien, suivie par la projection", () => {
    chatLink("open");
    expect(chatHead("<svg/>")).toContain('class="dot live" data-ref="chat-dot"');
    chatLink("lost");
    expect(chatHead("<svg/>")).toContain('class="dot err" data-ref="chat-dot"');
  });

  it("le bouton de la barre mobile n'existe que si l'appel porte du texte", () => {
    const view = {
      state: "connected",
      direction: "outgoing",
      target: "sip:bob@example.fr",
      displayName: null,
      offered: { audio: true, video: false, text: false },
      media: { audio: true, video: false, text: false },
      selfViewHidden: false,
      mediaPending: false,
      mediaAsked: null,
      paused: false,
      peerPaused: false,
      dtmfSent: "",
      notice: null,
      earlyMedia: { audio: false, video: false, text: false },
      connectedAt: Date.now(),
      endedBy: null,
      session: null,
    } satisfies CallView;
    expect(overlayBar({ view, speakerMuted: false })).not.toContain('data-act="chat"');
    const withChat = overlayBar({
      view,
      speakerMuted: false,
      chat: { open: true, controls: CHAT_PANE_ID },
    });
    expect(withChat).toContain('data-act="chat"');
    expect(withChat).toContain(`aria-controls="${CHAT_PANE_ID}"`);
  });

  /**
   * **Texte non négocié : le bouton reste, barré et inactif.** Le faire
   * disparaître laisserait croire que ce poste n'a jamais eu de tchat, alors
   * que l'appel en portait la promesse ; le laisser cliquable promettrait un
   * panneau qui n'existe plus. Et il n'est pas rouge : rien n'a été coupé
   * ici, le distant n'a simplement pas suivi.
   */
  it("texte non négocié : le bouton de la barre est barré et inactif", () => {
    const view = {
      state: "connected",
      direction: "outgoing",
      target: "sip:bob@example.fr",
      displayName: null,
      offered: { audio: true, video: false, text: true },
      media: { audio: true, video: false, text: false },
      selfViewHidden: false,
      mediaPending: false,
      mediaAsked: null,
      paused: false,
      peerPaused: false,
      dtmfSent: "",
      notice: null,
      earlyMedia: { audio: false, video: false, text: false },
      connectedAt: Date.now(),
      endedBy: null,
      session: null,
    } satisfies CallView;
    const bar = overlayBar({
      view,
      speakerMuted: false,
      chat: { open: false, controls: CHAT_PANE_ID, unavailable: true },
    });
    const btn = bar.slice(bar.indexOf('data-act="chat"'));
    expect(btn).toContain("disabled");
    // l'icône est barrée, et le bouton n'annonce plus de région à déplier
    expect(btn).toContain("M3.5 3.5l17 17");
    expect(btn).not.toContain(`aria-controls="${CHAT_PANE_ID}"`);
    // ni rouge (`off`) ni violet (`toggled`) : le tchat n'a pas été coupé
    expect(btn.slice(0, btn.indexOf(">"))).not.toMatch(/class="iconbtn (off|toggled)"/);
  });
});

/**
 * **Le tchat à la place de la vidéo** (§4.9). La règle tient à une chose : un
 * appel qui n'a pas d'image n'a rien à mettre au centre de l'écran, et le fil
 * y va. Ce qui se casse sans qu'un type ne bronche : un appel vidéo dont la
 * scène passerait au texte, une sonnerie entrante où l'on écrirait à
 * quelqu'un dont on n'a pas pris l'appel, et un appel texte seul qui perdrait
 * son écran le jour où le distant refuse le texte.
 */
describe("le tchat sur la scène", () => {
  /** Un appel dont la session porte un canal de texte — le canal suffit ici. */
  const callOf = (media: CallMedia, state = "connected"): CallView =>
    ({
      state,
      direction: "outgoing",
      target: "sip:bob@example.fr",
      displayName: null,
      offered: media,
      media,
      selfViewHidden: false,
      mediaPending: false,
      mediaAsked: null,
      paused: false,
      peerPaused: false,
      dtmfSent: "",
      notice: null,
      connectedAt: Date.now(),
      endedBy: null,
      session: { rtt: () => ({}) } as unknown as CallSession,
    }) as CallView;

  it("prend la scène quand l'appel n'a pas d'image", () => {
    expect(chatOnStage(callOf({ audio: true, video: false, text: true }))).toBe(true);
    expect(chatOnStage(callOf({ audio: false, video: false, text: true }))).toBe(true);
  });

  it("la rend à l'image dès que l'appel porte la vidéo", () => {
    expect(chatOnStage(callOf({ audio: true, video: true, text: true }))).toBe(false);
  });

  it("pas pendant la sonnerie entrante : la popup est le seul interlocuteur", () => {
    expect(chatOnStage(callOf({ audio: true, video: false, text: true }, "ringing_in"))).toBe(false);
  });

  it("pas d'appel, pas de canal, pas de scène", () => {
    expect(chatOnStage(null)).toBe(false);
    const view = callOf({ audio: true, video: false, text: true });
    expect(chatOnStage({ ...view, session: null })).toBe(false);
  });

  it("texte refusé : l'appel audio retrouve sa scène, l'appel texte garde la sienne", () => {
    chatLink("closed"); // fermé sans s'être jamais ouvert : le distant n'en a pas voulu
    expect(chatOnStage(callOf({ audio: true, video: false, text: false }))).toBe(false);
    // un appel texte seul n'a rien d'autre à montrer, et la remarque du fil
    // dit pourquoi il ne mènera nulle part
    expect(chatOnStage(callOf({ audio: false, video: false, text: false }))).toBe(true);
  });

  /**
   * **Le texte non négocié n'affiche rien**, quel que soit l'état du lien :
   * `media.text` est la seule chose qui dise que les deux bouts en ont
   * convenu (ADR 0003, D1). Un lien resté `connecting` — le distant a
   * rejeté la section `m=application`, DCEP n'ouvrira jamais rien — ne doit
   * pas donner un panneau où l'on tape dans le vide.
   */
  it("texte non négocié : ni tchat ni scène, même si le lien espère encore", () => {
    chatLink("connecting");
    const audioOnly = callOf({ audio: true, video: false, text: false });
    expect(chatAvailable(audioOnly)).toBe(false);
    expect(chatOnStage(audioOnly)).toBe(false);
    expect(chatWritable(audioOnly)).toBe(false);
    // le même appel, texte négocié : le panneau est là et s'écrit
    const withText = callOf({ audio: true, video: false, text: true });
    expect(chatAvailable(withText)).toBe(true);
    expect(chatWritable(withText)).toBe(true);
  });

  it("texte seul non négocié : la scène reste, la saisie non", () => {
    chatLink("connecting");
    const textOnly = callOf({ audio: false, video: false, text: false });
    // rien d'autre à montrer : le fil reste, avec ce qu'il a à dire
    expect(chatOnStage(textOnly)).toBe(true);
    // mais on n'y écrit pas — le champ le dit et le montre
    expect(chatWritable(textOnly)).toBe(false);
    expect(chatPane("Bob", chatWritable(textOnly))).toMatch(/<textarea[^>]*disabled/s);
  });

  it("avant le décrochage, le texte négocié ne suffit pas à ouvrir la saisie", () => {
    chatLink("open");
    expect(chatWritable(callOf({ audio: true, video: false, text: true }, "ringing"))).toBe(false);
  });

  it("la scène porte le fil, la barre reçue, et le son de l'appel", () => {
    const html = chatStage({ peer: "Bob", bar: "<div class=\"overlaybar\"></div>", meters: true });
    expect(html).toContain(`id="${CHAT_PANE_ID}"`);
    expect(html).toContain('class="overlaybar"');
    // l'élément média distant reste : c'est lui qui joue le son
    expect(html).toContain('class="remote" data-ref="remote"');
    expect(html).toContain('data-ref="vu-remote"');
    // pas de zone de plein écran : sur un fil de texte, le double-clic
    // sélectionne un mot, il ne bascule pas l'écran
    expect(html).not.toContain('data-ref="videozone"');
  });

  it("pas de vu-mètres quand l'appel ne porte pas de son", () => {
    const html = chatStage({ peer: "Bob", bar: "", meters: false });
    expect(html).not.toContain('data-ref="vu-remote"');
  });

  /**
   * La vidéo ajoutée ou retirée en cours d'appel déplace le fil — scène ou
   * panneau — et chaque place le réécrit **depuis le modèle**. C'est ce qui
   * fait qu'une renégociation ne coûte ni une bulle ni une phrase en cours
   * de frappe : les deux gabarits rendent le même fil et le même brouillon.
   */
  it("la bascule ne perd ni le fil ni la phrase en cours", () => {
    chatLink("open");
    chatReceive("bonjour, je vous entends mal");
    chatType("je vous lis très bien");
    for (const html of [chatStage({ peer: "Bob", bar: "", meters: true }), chatPane("Bob")]) {
      expect(html).toContain("bonjour, je vous entends mal");
      expect(html).toContain("je vous lis très bien");
    }
  });
});
