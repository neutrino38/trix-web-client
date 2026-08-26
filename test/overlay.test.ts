/**
 * La barre de commandes des deux axes (ADR 0003, D6 et D8).
 *
 * Ce qui se vérifie ici est ce qu'aucun type ne dit : **où** chaque commande
 * atterrit. La règle de D8 n'est pas une préférence de mise en page, c'est
 * une contrainte d'accessibilité — `8 × 44 + 7 × 6 + 16 = 410 px` pour un
 * écran qui en fait 360 — et une régression y serait invisible à la
 * compilation comme à la relecture.
 *
 * Quatre choses, donc :
 *
 * - la pastille porte **quatre** icônes, jamais plus, sauf promotion ;
 * - les deux boutons de l'axe 1 (audio, vidéo) n'en descendent jamais ;
 * - ni Raccrocher ni Pause n'entrent dans la feuille ;
 * - un état **coupé** ne se cache jamais.
 *
 * Et le bureau, qui ne change pas : sa sidebar a la place.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { overlayBar } from "../src/ui/screens/call/overlay.js";
import { closeSheet } from "../src/ui/screens/call/sheet.js";
import { pauseBanner, peerPauseNotice } from "../src/ui/screens/call/pause.js";
import type { CallView } from "../src/machines/events.js";
import type { CallMedia } from "../src/sip/port.js";
import { useLocale } from "../src/i18n/index.js";

beforeAll(async () => {
  // sans dictionnaire chargé, `t()` rend la clé : les libellés de la feuille
  // ne diraient rien, et c'est justement ce qui les justifie (D8, règle 4)
  await useLocale("fr");
  closeSheet();
});

function view(over: Partial<CallView> = {}): CallView {
  return {
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
    ...over,
  };
}

const media = (audio: boolean, video: boolean, text: boolean): CallMedia => ({
  audio,
  video,
  text,
});

/** La barre mobile, telle que `mobile.ts` la demande. */
const bar = (over: Partial<CallView> = {}, opts: Record<string, unknown> = {}): string =>
  overlayBar({
    view: view(over),
    speakerMuted: false,
    withHangup: true,
    compact: true,
    withFullscreen: true,
    ...opts,
  });

/** Les `data-act` d'un fragment, dans l'ordre où ils y apparaissent. */
const acts = (html: string): string[] =>
  [...html.matchAll(/data-act="([^"]+)"/g)].map((m) => m[1]!);

/** Ce que porte la pastille — la barre s'arrête au premier bouton du dehors. */
function pill(html: string): string[] {
  const start = html.indexOf('class="overlay-pill"');
  const end = html.indexOf("</div>", start);
  return acts(html.slice(start, end));
}

/** Ce que porte la feuille du bas. */
function sheet(html: string): string[] {
  const start = html.indexOf('data-ref="sheet"');
  return start === -1 ? [] : acts(html.slice(start));
}

describe("la pastille mobile porte quatre icônes", () => {
  it("audio, vidéo, haut-parleur et « ⋯ » quand l'appel ne porte pas de texte", () => {
    expect(pill(bar())).toEqual(["toggle-audio", "toggle-video", "speaker", "more"]);
  });

  /**
   * D8 : « tchat (ou haut-parleur si l'appel ne porte pas de texte) ». La
   * troisième place revient au tchat dès qu'il y a un panneau à plier — et le
   * haut-parleur redescend alors dans la feuille, où il est à sa place :
   * c'est de la réception locale, hors du champ de la norme.
   */
  it("la troisième place revient au tchat dès qu'il y en a un à plier", () => {
    const html = bar({}, { chat: { open: false, controls: "chat-pane" } });
    expect(pill(html)).toEqual(["toggle-audio", "toggle-video", "chat", "more"]);
    expect(sheet(html)).toContain("speaker");
  });

  it("les deux boutons de l'axe 1 ne descendent jamais dans la feuille", () => {
    for (const html of [bar(), bar({}, { chat: { open: false, controls: "c" } })]) {
      expect(sheet(html)).not.toContain("toggle-audio");
      expect(sheet(html)).not.toContain("toggle-video");
    }
  });
});

describe("la feuille du bas", () => {
  it("porte ce que la pastille ne peut plus tenir", () => {
    const html = bar({}, { chat: { open: false, controls: "c" }, withStats: true });
    expect(sheet(html)).toEqual(["speaker", "selfview", "dtmf", "fullscreen", "stats-open"]);
  });

  it("le plein écran y tombe aussi quand la vue le propose", () => {
    expect(sheet(bar({ media: media(true, true, false) }))).toContain("fullscreen");
  });

  /**
   * Règle 3 de D8 : un geste d'urgence ne se cherche pas, et un geste qui
   * doit être instantané ne demande pas deux appuis.
   */
  it("n'accueille ni Raccrocher ni Pause", () => {
    const html = bar({}, { chat: { open: false, controls: "c" } });
    expect(sheet(html)).not.toContain("hangup");
    expect(sheet(html)).not.toContain("pause");
    // les deux sont bien là, mais dehors
    expect(html).toContain('data-act="hangup"');
    expect(html).toContain('data-act="pause"');
  });

  /**
   * Règle 4 de D8 : la feuille porte des libellés, pas des icônes seules.
   * C'est un gain net — la pastille est muette, et Trix s'affiche en six
   * langues. Le libellé est dans le balisage des deux côtés ; c'est le CSS
   * qui le tait dans la pastille.
   */
  it("chaque commande y porte son libellé, dans la langue courante", () => {
    const html = bar();
    expect(html).toContain('<span class="cmd-label">Couper l\'écoute</span>');
    expect(html).toContain('<span class="cmd-label">Masquer le self-view</span>');
  });

  it("le « ⋯ » l'annonce : aria-expanded et aria-controls", () => {
    const html = bar();
    expect(html).toContain('aria-controls="call-sheet"');
    expect(html).toContain('id="call-sheet"');
    expect(html).toMatch(/data-act="more"[^>]*aria-expanded="false"/s);
  });
});

/**
 * Règle 1 de D8 : **un état coupé ne se cache jamais** — et elle se tient
 * d'elle-même depuis que l'écoute n'est plus un flux coupé. Elle ne vise que
 * ce qui sort un média de l'appel, c'est-à-dire l'audio et la vidéo, et ces
 * deux-là ne descendent jamais dans la feuille. Rien de ce qui peut y tomber
 * ne coupe quoi que ce soit : la pastille garde donc ses quatre places, quoi
 * qu'on y touche.
 */
describe("la pastille ne se recompose pas sous le pouce", () => {
  it("l'écoute coupée ne remonte pas : elle reste où elle était", () => {
    const html = bar({}, { chat: { open: false, controls: "c" }, speakerMuted: true });
    expect(pill(html)).toEqual(["toggle-audio", "toggle-video", "chat", "more"]);
    expect(sheet(html)).toContain("speaker");
  });

  it("quatre places, écoute coupée ou non — et jamais de seconde ligne", () => {
    for (const muted of [true, false]) {
      const html = bar({}, { chat: { open: false, controls: "c" }, speakerMuted: muted });
      expect(pill(html)).toHaveLength(4);
      expect(html).not.toContain("crowded");
    }
  });

  /**
   * La couleur dit **de quoi** on parle, et c'est tout l'objet de la
   * distinction : violet pour une bascule locale, rouge pour un média qui a
   * quitté l'appel. Deux ronds rouges barrés côte à côte, dont un seul
   * change l'appel, sont exactement ce que l'ADR 0003 (D6) écarte.
   */
  it("l'écoute coupée est violette, le média retiré est rouge", () => {
    const muted = bar({}, { speakerMuted: true });
    expect(muted).toMatch(/class="iconbtn toggled"[^>]*data-act="speaker"/s);
    // l'audio hors de l'appel, lui, reste rouge
    const noAudio = bar({ media: media(false, true, false) });
    expect(noAudio).toMatch(/class="iconbtn off"[^>]*data-act="toggle-audio"/s);
  });
});

/**
 * Le trait de la barre du bureau (ADR 0003, D6) : ce qui change l'appel
 * d'un côté, ce qui ne change que ce poste de l'autre. Il n'existe pas en
 * compact — la pastille contre la feuille y porte déjà la même frontière,
 * et plus fortement.
 */
describe("les deux groupes de la barre du bureau", () => {
  const wide = (over: Partial<CallView> = {}): string =>
    overlayBar({
      view: view(over),
      speakerMuted: false,
      withHangup: true,
      withFullscreen: true,
      panel: { collapsed: false, controls: "call-panel" },
    });

  it("l'axe 1 d'un côté du trait, tout le reste de l'autre", () => {
    const html = wide({ media: media(true, true, false) });
    const [before, after] = html.split('<span class="pill-sep"');
    expect(acts(before!)).toEqual(["toggle-audio", "toggle-video"]);
    expect(acts(after!)).toEqual([
      "speaker",
      "selfview",
      "dtmf",
      "fullscreen",
      "panel",
      "pause",
      "hangup",
    ]);
  });

  /**
   * Un filet vertical ne dit rien à un lecteur d'écran : la frontière est
   * portée par les intitulés des deux groupes, et le trait lui-même est
   * retiré de l'arbre d'accessibilité (RGAA 9.1).
   */
  it("la frontière est annoncée, pas seulement dessinée", () => {
    const html = wide();
    expect(html).toContain('role="group" aria-label="Médias de l\'appel"');
    expect(html).toContain('role="group" aria-label="Ce poste"');
    expect(html).toMatch(/<span class="pill-sep" aria-hidden="true">/);
  });

  it("la barre compacte n'a pas de trait : la feuille est sa frontière", () => {
    expect(bar()).not.toContain("pill-sep");
    // la feuille du bas, elle, garde le sien : c'est son propre intitulé
    expect(bar()).not.toContain("cmd-group");
  });
});

/**
 * Axe 2 — D6 et D7. Le bouton parle de moi, pas de l'appel : il est hors de
 * la pastille, et il n'existe pas là où il n'y a rien à suspendre.
 */
describe("le bouton Pause", () => {
  it("est dehors, entre la pastille et le raccrochage", () => {
    const html = bar();
    const order = acts(html).filter((a) => ["more", "pause", "hangup"].includes(a));
    expect(order).toEqual(["more", "pause", "hangup"]);
  });

  /**
   * D7 : « un appel texte seul n'a pas de bouton Pause » — il n'y a rien à
   * suspendre, et le texte ne se coupe pas. Une pause qui couperait le texte
   * reviendrait, pour un usager sourd, à raccrocher sans le dire.
   */
  it("n'existe pas sur un appel texte seul", () => {
    const html = bar({ media: media(false, false, true) });
    expect(html).not.toContain('data-act="pause"');
    // le raccrochage, lui, reste
    expect(html).toContain('data-act="hangup"');
  });

  it("n'est jamais grisé en communication, pas même en pleine renégociation", () => {
    // un geste qui doit être instantané ne peut pas dépendre de l'issue
    // d'un aller-retour SIP (D7)
    expect(bar({ mediaPending: true })).not.toMatch(/data-act="pause"[^>]*disabled/s);
    // hors communication, en revanche, il n'y a rien à suspendre
    expect(bar({ state: "dialing" })).toMatch(/data-act="pause"[^>]*disabled/s);
  });

  it("média précoce : les deux boutons média sont inertes", () => {
    // rien ne change de média avant le décrochage — il n'y a pas encore de
    // dialogue où poser un re-INVITE, et l'offre en vol est celle à
    // laquelle le distant répond (machines/call.ts, `awaitingAnswer`)
    const html = bar({ state: "early_media" });
    expect(html).toMatch(/data-act="toggle-audio"[^>]*disabled/s);
    expect(html).toMatch(/data-act="toggle-video"[^>]*disabled/s);
    expect(html).toMatch(/data-act="pause"[^>]*disabled/s);
  });

  it("dit son état : pressé, allumé, et le libellé passe à « Reprendre »", () => {
    const paused = bar({ paused: true });
    expect(paused).toMatch(/data-act="pause"[^>]*aria-pressed="true"/s);
    expect(paused).toContain("pause-btn on");
    expect(paused).toContain("Reprendre");
    expect(bar()).toMatch(/data-act="pause"[^>]*aria-pressed="false"/s);
  });

  /**
   * D7 : « les commandes média s'éteignent derrière le bandeau ». Elles ne
   * disparaissent pas — Raccrocher reste au même endroit, et la Pause garde
   * tout son éclat, puisque c'est par elle qu'on revient.
   */
  it("en pause, la pastille s'éteint et le raccrochage reste", () => {
    const paused = bar({ paused: true });
    expect(paused).toContain("overlaybar compact dimmed");
    expect(paused).toContain('data-act="hangup"');
    expect(bar()).not.toContain("dimmed");
  });
});

/**
 * Ce que la Pause donne à voir (`pause.ts`). Le bandeau est ce qui supprime
 * le « tu étais en sourdine » : mieux qu'une icône rouge de 44 px, qu'on
 * cesse de voir au bout de dix secondes.
 */
describe("le bandeau de pause", () => {
  it("n'existe que quand je suis en pause", () => {
    expect(pauseBanner(view())).toBe("");
    expect(pauseBanner(view({ paused: true }))).toContain("Vous êtes en pause");
  });

  it("« Reprendre » est le seul geste offert", () => {
    const html = pauseBanner(view({ paused: true }));
    expect([...html.matchAll(/<button/g)]).toHaveLength(1);
    expect(html).toContain('data-act="pause"');
  });

  /**
   * Le rappel sur le texte n'est pas décoratif : c'est ce qui distingue la
   * Pause d'un raccrochage pour qui n'entend pas — le fil continue de passer
   * dans les deux sens, et c'est là qu'on écrit « deux minutes ».
   */
  it("dit que le texte, lui, continue de passer", () => {
    expect(pauseBanner(view({ paused: true }))).toContain("Le texte, lui, continue de passer");
  });

  it("s'annonce sans interrompre : c'est un état demandé, pas une alerte", () => {
    expect(pauseBanner(view({ paused: true }))).toContain('role="status"');
  });
});

/**
 * L'avis de la pause **du correspondant** : l'*avis explicite* que F.703
 * §6.2.4 réclame pour une vidéo suspendue, rendu par le récepteur, à la
 * place de l'image figée qu'on verrait sinon.
 */
describe("l'avis de la pause du correspondant", () => {
  it("nomme celui qui s'est retiré", () => {
    const html = peerPauseNotice(view({ peerPaused: true, displayName: "Alice" }));
    expect(html).toContain("Alice est en pause");
  });

  it("ne s'affiche pas hors communication", () => {
    expect(peerPauseNotice(view({ peerPaused: true, state: "ringing_in" }))).toBe("");
    expect(peerPauseNotice(view())).toBe("");
  });

  it("un nom venu du réseau n'est pas injecté tel quel", () => {
    const html = peerPauseNotice(view({ peerPaused: true, displayName: "<img src=x>" }));
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });

  /**
   * Il s'affiche que l'appel porte l'image ou non : sur un appel audio,
   * c'est la seule façon de comprendre pourquoi le silence dure.
   */
  it("vaut aussi sur un appel sans image", () => {
    const audio = view({ peerPaused: true, media: media(true, false, false) });
    expect(peerPauseNotice(audio)).toContain("en pause");
  });
});

/**
 * « Le bureau ne change pas : la sidebar a la place. » Le vérifier n'est pas
 * un luxe : les deux vues partagent **la même** fonction, et c'est le seul
 * endroit où l'on peut constater qu'elle rend bien deux barres différentes.
 */
describe("le bureau ne change pas", () => {
  const desktop = (): string =>
    overlayBar({
      view: view(),
      speakerMuted: false,
      withHangup: true,
      withFullscreen: true,
      panel: { collapsed: false, controls: "call-panel" },
    });

  it("garde toutes ses commandes dans la pastille, sans feuille ni « ⋯ »", () => {
    const html = desktop();
    expect(pill(html)).toEqual([
      "toggle-audio",
      "toggle-video",
      "speaker",
      "selfview",
      "dtmf",
      "fullscreen",
      "panel",
    ]);
    expect(html).not.toContain('data-act="more"');
    expect(html).not.toContain('data-ref="sheet"');
  });

  /**
   * **La Pause, elle, existe sur les deux gabarits.** Ce que D8 réserve au
   * mobile est le remaniement pastille / feuille, pas le geste : F.703
   * §6.2.4 exige que tout participant puisse suspendre ce qu'il émet, et la
   * norme ne connaît pas la largeur des écrans. Elle reste **hors de la
   * pastille** ici comme là-bas — c'est l'axe 2 (D6), et il ne se confond
   * avec les commandes média sur aucun écran.
   */
  it("garde la Pause, hors de la pastille", () => {
    const html = desktop();
    expect(html).toContain('data-act="pause"');
    expect(pill(html)).not.toContain("pause");
  });
});
