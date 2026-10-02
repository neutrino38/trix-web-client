/**
 * Le panneau du tchat : ce que le gabarit montre de la conversation.
 *
 * Le modèle — bulles, séparateurs, règle des deux secondes, transcription —
 * est au noyau et se vérifie là (`test/conversation.test.ts`). Ce qui se
 * casse ici sans qu'un type ne bronche : un correspondant qui écrit du
 * balisage dans notre fil, une ligne d'état qui ment, un panneau qui prend
 * la scène d'un appel vidéo ou qui s'écrit avant le décrochage.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  bubbleText,
  chatAvailable,
  chatPane,
  chatStateLine,
  chatThread,
  chatThreadHtml,
  chatWritable,
  chatHead,
  chatOnStage,
  chatStage,
  showConversation,
  CHAT_PANE_ID,
  type ChatBubble,
  type ChatItem,
} from "../src/ui/screens/call/chat.js";
import { createConversation, type Conversation } from "../src/core/conversation.js";
import { fakeChannel, type FakeChannel } from "./fakes/rtt.js";
import { overlayBar } from "../src/ui/screens/call/overlay.js";
import type { CallView } from "../src/machines/events.js";
import type { CallMedia } from "../src/sip/port.js";
import { T140 } from "../src/sip/t140.js";
import { useLocale } from "../src/i18n/index.js";

beforeAll(async () => {
  await useLocale("fr");
});

let conv: Conversation;
let channel: FakeChannel;

beforeEach(() => {
  conv = createConversation();
  showConversation(conv);
  channel = fakeChannel();
  conv.attach(channel);
});

/** Le correspondant écrit, le lien change, on tape : ce que le panneau montre ensuite. */
const chatReceive = (chunk: string): void => channel.receive(chunk);
const chatLink = (state: Parameters<FakeChannel["link"]>[0]): void => channel.link(state);
const chatType = (value: string): void => conv.type(value);

const bubbles = (): ChatBubble[] =>
  chatThread().filter((i: ChatItem): i is ChatBubble => i.kind === "bubble");

const texts = (): string[] => bubbles().map(bubbleText);

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

describe("la ligne d'état", () => {
  it("corriger au milieu : elle dit l'attente", () => {
    chatType("12 rue des Lilas");
    chatType("12 rue des Tilleuls");
    expect(chatStateLine().cls).toBe("warn");
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
    channel = fakeChannel();
    conv.attach(channel);
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
      shareAsked: false,
      paused: false,
      sharing: "off" as const,
      peerSharing: false,
      peerPaused: false,
      dtmfSent: "",
      notice: null,
      earlyMedia: { audio: false, video: false, text: false },
      connectedAt: Date.now(),
      endedBy: null,
      textChannel: false,
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
      shareAsked: false,
      paused: false,
      sharing: "off" as const,
      peerSharing: false,
      peerPaused: false,
      dtmfSent: "",
      notice: null,
      earlyMedia: { audio: false, video: false, text: false },
      connectedAt: Date.now(),
      endedBy: null,
      textChannel: false,
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
  /** Un appel qui porte un canal de texte — le canal suffit ici. */
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
      shareAsked: false,
      paused: false,
      sharing: "off" as const,
      peerSharing: false,
      peerPaused: false,
      dtmfSent: "",
      notice: null,
      connectedAt: Date.now(),
      endedBy: null,
      textChannel: true,
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
    expect(chatOnStage({ ...view, textChannel: false })).toBe(false);
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
