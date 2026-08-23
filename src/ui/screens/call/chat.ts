/**
 * Le tchat de l'appel — le panneau (docs/CONCEPTION.md §4.9).
 *
 * Ce module tient **le modèle** de la conversation et sa projection à
 * l'écran. Le protocole est ailleurs (`sip/t140.ts`, qui décode et calcule
 * le différentiel d'émission), le tuyau aussi (`sip/rtt.ts`, qui ne sait
 * de T.140 que le retour arrière) : ici, on ne fait qu'un fil de bulles et
 * un champ de saisie.
 *
 * Trois règles gouvernent tout ce qui suit.
 *
 * **Une seule bulle vivante par côté.** Elle interprète le flux caractère
 * par caractère, comme un terminal ; le séparateur la fige et en ouvre une
 * neuve. C'est ce que l'appendice I de T.140 décrit déjà en 1998.
 *
 * **Le modèle est la source, le DOM une projection.** Rien n'est relu dans
 * la page — ni pour copier, ni pour exporter plus tard en sous-titres. Et
 * un caractère reçu devient un **nœud texte**, jamais du balisage : le
 * correspondant écrit dans notre fil, pas dans notre DOM.
 *
 * **Rien n'est rendu par un temporisateur.** L'affichage du texte reçu est
 * piloté par l'arrivée du fragment, sans quoi un onglet caché — dont Chrome
 * aligne les timers sur la seconde — dépasserait les 500 ms de T.140 §6.1.1.
 * Les deux seuls temporisateurs de ce module servent l'émission (la règle
 * des deux secondes) et son décompte à l'écran.
 *
 * L'état vit ici, hors du DOM, comme celui du pavé DTMF : l'écran d'appel
 * est reconstruit à chaque notification de la machine, et une conversation
 * qui disparaîtrait à chaque re-rendu ne servirait à rien. Il naît avec
 * l'appel (`chatReset`) et meurt avec lui (`closeChat`).
 */

import type { CallView } from "../../../machines/events.js";
import type { RttChannel, RttState } from "../../../sip/rtt.js";
import {
  T140,
  dropLastGrapheme,
  sanitizeOutgoing,
  t140Decoder,
  t140Edit,
  type T140Attrs,
  type T140Decoder,
  type T140Event,
} from "../../../sip/t140.js";
import {
  bubbleText,
  sealTranscript,
  type ChatBubble,
  type ChatItem,
  type ChatNote,
  type ChatRun,
  type ChatSide,
} from "../../../sip/transcript.js";
import { el, esc } from "../../el.js";
import { announce } from "../../announce.js";
import { pulseAlert } from "../../alert.js";
import { formatNumber, formatTime, t, tn } from "../../../i18n/index.js";
import type { MsgKey } from "../../../i18n/types.js";

/** Id du panneau, cité par l'`aria-controls` du bouton de la barre mobile. */
export const CHAT_PANE_ID = "call-chat";

/**
 * Le silence à observer avant de réconcilier une édition faite **au milieu**
 * du texte déjà parti : remonter d'un coup jusqu'au point de divergence,
 * une seule fois, plutôt que de trembler à chaque touche (§4.9).
 */
export const CHAT_HOLD_MS = 2000;

/** Distance au bas du fil en deçà de laquelle on le considère « suivi ». */
const PINNED_PX = 24;

/**
 * Le modèle vit sans page : il se teste comme `sdp.ts`, en dehors de tout
 * DOM. Les projections s'abstiennent quand il n'y en a pas.
 */
const hasDom = (): boolean => typeof document !== "undefined";

// ---------------------------------------------------------------------------
// Le modèle
// ---------------------------------------------------------------------------

/**
 * Le modèle des bulles vit dans `sip/transcript.ts` : c'est lui que la
 * ligne d'historique emporte, et le coffre n'a pas à importer un écran
 * (§4.9). Réexporté ici — le panneau reste l'endroit d'où on le regarde.
 */
export type { ChatBubble, ChatItem, ChatNote, ChatRun, ChatSide };
export { bubbleText };

interface ChatState {
  peer: string;
  items: ChatItem[];
  live: { them: ChatBubble | null; us: ChatBubble | null };
  attrs: T140Attrs;
  decoder: T140Decoder;
  link: RttState;
  /** Le lien s'est ouvert au moins une fois — un `closed` n'a pas le même sens sinon. */
  everOpen: boolean;
  /** Ce qui est réellement parti sur le fil (T.140 §7 : on affiche ce qu'on émet). */
  sent: string;
  /** Ce que montre le champ de saisie. */
  draft: string;
  /** Échéance de la réconciliation différée, `0` quand il n'y en a pas. */
  holdUntil: number;
  seq: number;
}

function blank(peer = ""): ChatState {
  return {
    peer,
    items: [],
    live: { them: null, us: null },
    attrs: {},
    decoder: t140Decoder(),
    link: "connecting",
    everOpen: false,
    sent: "",
    draft: "",
    holdUntil: 0,
    seq: 0,
  };
}

let chat = blank();

/** Le canal auquel nous sommes abonnés, et de quoi s'en détacher. */
let bound: RttChannel | null = null;
let unlisten: (() => void) | null = null;
let holdTimer: ReturnType<typeof setTimeout> | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;

/** Pli du tchat mobile — affichage pur. */
let mobileOpen = true;
/** Flash plein écran sur `BEL` : le réglage du compte, relu à chaque rendu. */
let flashOnAlert = true;
/** Le fil suit-il le bas ? Faux dès que l'utilisateur a remonté (§4.9). */
let pinned = true;
/** Bulles figées arrivées pendant qu'il lisait plus haut. */
let unseen = 0;

export const chatThread = (): readonly ChatItem[] => chat.items;
/**
 * Le fil tel que l'historique le gardera : bulles vivantes closes, copie
 * bornée, et rien du tout si personne n'a écrit (`sip/transcript.ts`).
 * Lu par la machine au moment où l'appel se range — c'est `main.ts` qui
 * les raccorde, le panneau n'en sait rien de plus.
 */
export const chatTranscript = (): ChatItem[] => sealTranscript(chat.items, Date.now());
export const chatLinkState = (): RttState => chat.link;
/**
 * Le lien est mort sans avoir jamais servi — le distant n'a pas voulu du
 * texte. Il n'y a alors pas de fil à montrer : le panneau s'efface au lieu
 * d'occuper la place avec un composeur grisé.
 */
export const chatRefused = (): boolean => chat.link === "closed" && !chat.everOpen;
export const chatMobileOpen = (): boolean => mobileOpen;
/** Ce qui est parti sur le fil — la bulle locale vivante, en somme. */
export const chatSent = (): string => chat.sent;
/** Ce que le champ doit montrer : la frappe, nettoyée de ce qu'une bulle ne porte pas. */
export const chatDraft = (): string => chat.draft;

// ---------------------------------------------------------------------------
// Écritures dans le modèle
// ---------------------------------------------------------------------------

function openBubble(side: ChatSide): ChatBubble {
  const b: ChatBubble = {
    kind: "bubble",
    id: ++chat.seq,
    side,
    runs: [],
    startedAt: Date.now(),
    endedAt: null,
  };
  chat.items.push(b);
  chat.live[side] = b;
  return b;
}

function note(key: MsgKey): void {
  const last = chat.items.at(-1);
  // deux fois la même remarque à la suite ne dit rien de plus
  if (last?.kind === "note" && last.key === key) return;
  chat.items.push({ kind: "note", id: ++chat.seq, key, at: Date.now() });
}

function sameAttrs(a: T140Attrs, b: T140Attrs): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.color === b.color &&
    a.background === b.background
  );
}

function appendText(side: ChatSide, text: string, attrs: T140Attrs): void {
  if (text === "") return;
  const b = chat.live[side] ?? openBubble(side);
  const last = b.runs.at(-1);
  if (last && !last.lost && sameAttrs(last.attrs, attrs)) last.text += text;
  else b.runs.push({ text, attrs: { ...attrs } });
}

/** Le marqueur de texte perdu, jamais deux fois de suite (§4.9). */
function appendLost(side: ChatSide): void {
  const b = chat.live[side] ?? openBubble(side);
  if (b.runs.at(-1)?.lost) return;
  b.runs.push({ text: T140.LOST, attrs: {}, lost: true });
}

/**
 * Un retour arrière, dans les deux cas que la norme prévoit : effacer un
 * graphème de la bulle vivante, ou — bulle vivante vide — **effacer le
 * séparateur**, ce qui refusionne la bulle figée précédente (§8.2, les
 * séquences de commande s'effacent en une seule opération).
 */
function eraseOne(side: ChatSide): void {
  const live = chat.live[side];
  if (live && bubbleText(live) !== "") {
    const last = live.runs.at(-1)!;
    last.text = dropLastGrapheme(last.text);
    if (last.text === "") live.runs.pop();
    return;
  }
  if (live) drop(live);
  // la dernière bulle figée de ce côté redevient vivante
  const prev = [...chat.items].reverse().find((i) => i.kind === "bubble" && i.side === side) as
    | ChatBubble
    | undefined;
  if (!prev) {
    chat.live[side] = null;
    return;
  }
  prev.endedAt = null;
  chat.live[side] = prev;
}

function drop(b: ChatBubble): void {
  const at = chat.items.indexOf(b);
  if (at !== -1) chat.items.splice(at, 1);
  if (chat.live[b.side] === b) chat.live[b.side] = null;
}

/**
 * Le séparateur fige la bulle vivante. Reçu sur une bulle vide, il ne crée
 * rien : le fil ne se remplit pas de bulles blanches parce que le
 * correspondant a appuyé deux fois sur Entrée.
 */
function freeze(side: ChatSide): void {
  const live = chat.live[side];
  if (!live) return;
  chat.live[side] = null;
  if (bubbleText(live) === "") {
    drop(live);
    return;
  }
  live.endedAt = Date.now();
  if (side === "them" && hasDom()) {
    // ce qui se lit à l'écran ne s'entend pas : la bulle figée est le seul
    // moment où l'annoncer ait un sens, la bulle vivante changeant à chaque
    // caractère (voir `chatPane`, sur `aria-live`)
    announce(t("chat.announce", { who: chat.peer, text: bubbleText(live) }));
  }
  if (side === "them" && !pinned) unseen += 1;
}

// ---------------------------------------------------------------------------
// Réception
// ---------------------------------------------------------------------------

/** Ce qui doit être repeint après une écriture — installé par `wireChat`. */
let changed: (() => void) | null = null;

function touch(): void {
  changed?.();
}

function apply(events: readonly T140Event[]): void {
  for (const ev of events) {
    switch (ev.type) {
      case "text":
        appendText("them", ev.text, chat.attrs);
        break;
      case "erase":
        eraseOne("them");
        break;
      case "break":
        freeze("them");
        break;
      case "attrs":
        chat.attrs = ev.attrs;
        break;
      case "lost":
        note("chat.note.lost");
        appendLost("them");
        break;
      case "alert":
        // l'alerte en séance réemploie les canaux de l'appel entrant : elle
        // s'adresse à quelqu'un qui ne regarde peut-être pas l'écran
        note("chat.note.alert");
        if (hasDom()) pulseAlert(flashOnAlert);
        break;
    }
  }
}

/** Un fragment reçu du canal, tel qu'il est arrivé — commandes comprises. */
export function chatReceive(chunk: string): void {
  apply(chat.decoder.feed(chunk));
  touch();
}

/** L'état du lien, tel que le canal le rapporte. */
export function chatLink(state: RttState): void {
  if (state === chat.link) return;
  const was = chat.link;
  chat.link = state;
  if (state === "open") {
    if (!chat.everOpen) note("chat.note.opened");
    chat.everOpen = true;
  } else if (state === "lost") {
    note("chat.note.broken");
  } else if (state === "closed" && was !== "closed") {
    note(chat.everOpen ? "chat.note.closed" : "chat.note.refused");
    // un correspondant sans texte temps réel ne doit pas manger la moitié
    // de l'écran mobile ni tenir la sidebar pour un fil qui n'a jamais vécu
    // (les deux gabarits interrogent `chatRefused`)
    if (!chat.everOpen) mobileOpen = false;
  }
  touch();
}

// ---------------------------------------------------------------------------
// Émission
// ---------------------------------------------------------------------------

function clearHold(): void {
  if (holdTimer !== null) clearTimeout(holdTimer);
  if (tickTimer !== null) clearInterval(tickTimer);
  holdTimer = null;
  tickTimer = null;
  chat.holdUntil = 0;
}

/**
 * Arme l'attente et son décompte. Le décompte ne repeint que sa propre
 * ligne : c'est le seul endroit du module où un temporisateur touche à
 * l'écran, et il ne touche pas au fil.
 */
function startHold(): void {
  chat.holdUntil = Date.now() + CHAT_HOLD_MS;
  holdTimer = setTimeout(() => {
    holdTimer = null;
    const late = t140Edit(chat.sent, chat.draft);
    clearHold();
    emit(late.back, late.add);
  }, CHAT_HOLD_MS);
  if (hasDom()) tickTimer = setInterval(paintState, 100);
}

/**
 * Ce qui part réellement sur le fil, et se montre du même coup dans la
 * bulle locale : T.140 §7 impose l'affichage local des caractères émis, et
 * c'est ce qui rend visible l'écart pendant les deux secondes d'attente.
 */
function emit(back: number, add: string): void {
  if (back === 0 && add === "") return;
  if (back > 0) {
    bound?.backspace(back);
    for (let i = 0; i < back; i++) eraseOne("us");
  }
  if (add !== "") {
    bound?.send(add);
    appendText("us", add, {});
  }
  chat.sent = chat.draft;
  touch();
}

/**
 * Le champ a changé. Trois cas, et un seul attend (§4.9) :
 *
 * - on écrit à la fin → le suffixe part tout de suite ;
 * - on efface par la fin → les retours arrière partent tout de suite ;
 * - on corrige au milieu → deux secondes de silence, puis on remonte d'un
 *   coup jusqu'au point de divergence et on retape la suite.
 */
export function chatType(value: string): void {
  clearHold();
  chat.draft = sanitizeOutgoing(value);
  const edit = t140Edit(chat.sent, chat.draft);
  if (edit.kind === "same") {
    touch();
    return;
  }
  if (edit.kind !== "rewrite") {
    emit(edit.back, edit.add);
    return;
  }
  startHold();
  touch();
}

/**
 * Entrée : ce qui reste à réconcilier part sans attendre, puis le
 * séparateur fige la bulle des deux côtés du fil. Le tampon de 300 ms du
 * canal est vidé dans la foulée — une fin de ligne n'attend pas.
 */
export function chatEnter(): void {
  clearHold();
  const edit = t140Edit(chat.sent, chat.draft);
  emit(edit.back, edit.add);
  if (chat.sent !== "") {
    bound?.send(T140.LS);
    bound?.flush();
    freeze("us");
  }
  chat.sent = "";
  chat.draft = "";
  touch();
}

// ---------------------------------------------------------------------------
// Cycle de vie
// ---------------------------------------------------------------------------

/** Un appel commence : le fil repart vide, au nom du correspondant. */
export function chatReset(peer: string): void {
  clearHold();
  chat = blank(peer);
  mobileOpen = true;
  pinned = true;
  unseen = 0;
}

/** L'appel est fini : le fil quitte l'écran avec lui. */
export function closeChat(): void {
  clearHold();
  unlisten?.();
  unlisten = null;
  bound = null;
  changed = null;
  chat = blank();
}

// ---------------------------------------------------------------------------
// Gabarit
// ---------------------------------------------------------------------------

/** Le tchat n'existe que si le canal existe : sans lui, pas d'onglet. */
export function chatChannel(view: CallView | null): RttChannel | null {
  return view?.session?.rtt() ?? null;
}

/**
 * **Le tchat prend-il la place de la vidéo ?** Oui dès que l'appel n'a pas
 * d'image : en audio + texte comme en texte seul, la scène n'aurait qu'un
 * rectangle noir à montrer, et le fil est ce que l'on regarde. Il passe
 * donc au centre, à la taille de la fenêtre, et la barre de commandes
 * média le coiffe au lieu de flotter sur une image absente.
 *
 * Un appel vidéo lui reprend la scène : le tchat retourne au panneau
 * latéral (bureau) ou sous l'image (mobile). La bascule vaut **en cours
 * d'appel** — ajouter la caméra rend la scène à l'image, la retirer la
 * rend au fil — et ne coûte rien : le modèle vit hors du DOM.
 *
 * Pendant la sonnerie entrante, non : la scène est `inert` derrière la
 * popup, et l'on n'écrit pas à quelqu'un dont on n'a pas encore pris
 * l'appel.
 */
export function chatOnStage(view: CallView | null): boolean {
  if (!view || view.state === "ringing_in" || view.media.video) return false;
  if (chatChannel(view) === null) return false;
  // Un appel **texte seul** garde sa scène même si le distant a refusé le
  // texte : il n'y a rien d'autre à mettre à l'écran, et la remarque du
  // fil dit pourquoi cet appel ne mènera nulle part. Un appel audio, lui,
  // a toujours sa scène d'appel audio à retrouver.
  return !chatRefused() || !view.media.audio;
}

function attrStyle(run: ChatRun): string {
  const css: string[] = [];
  if (run.attrs.color) css.push(`color:${run.attrs.color}`);
  if (run.attrs.background) css.push(`background:${run.attrs.background}`);
  if (run.attrs.bold) css.push("font-weight:700");
  if (run.attrs.italic) css.push("font-style:italic");
  if (run.attrs.underline) css.push("text-decoration:underline");
  return css.join(";");
}

function runHtml(run: ChatRun): string {
  if (run.lost) {
    return `<span class="lost" title="${esc(t("chat.note.lost"))}">${esc(run.text)}</span>`;
  }
  const style = attrStyle(run);
  return style === "" ? esc(run.text) : `<span style="${esc(style)}">${esc(run.text)}</span>`;
}

/**
 * De quoi savoir, au repeint, si un nœud dit encore la vérité. Le fil est
 * repeint à chaque caractère reçu : comparer une signature évite de
 * reconstruire cent bulles figées pour une seule qui bouge.
 */
function signature(item: ChatItem): string {
  if (item.kind === "note") return `n${item.id}`;
  // condensée : la signature vit dans un attribut du document, et une bulle
  // d'un paragraphe ne doit pas y être recopiée en entier
  return `b${item.id}.${item.endedAt ?? 0}.${hash(JSON.stringify(item.runs))}`;
}

/** Somme de contrôle courte (FNV-1a 32 bits) — comparer, jamais deviner. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function bubbleHtml(b: ChatBubble, peer: string): string {
  const live = b.endedAt === null;
  const who = b.side === "them" ? peer : t("chat.you");
  // « en cours de frappe » ne se dit que du correspondant : sous notre propre
  // bulle, c'est la ligne d'état du champ qui dit ce qui part, et le redire
  // ici serait un commentaire de notre propre main
  const when = !live
    ? `<span class="when">${esc(formatTime(b.endedAt!))}</span>`
    : b.side === "them"
      ? `<span class="typing">${esc(t("chat.typing"))}</span>`
      : "";
  return `<div class="chat-line ${b.side}" data-sig="${esc(signature(b))}">
      ${b.side === "them" ? `<span class="who">${esc(who)}</span>` : ""}
      <div class="bubble ${live ? "live" : ""}" dir="auto"
           ${live ? `aria-live="off"` : ""}>${b.runs.map(runHtml).join("")}${
             live ? `<span class="chat-caret" aria-hidden="true"></span>` : ""
           }</div>
      ${when}
    </div>`;
}

function noteHtml(n: ChatNote): string {
  return `<div class="chat-note" data-sig="${esc(signature(n))}">${esc(t(n.key))} · ${esc(
    formatTime(n.at),
  )}</div>`;
}

function itemHtml(item: ChatItem, peer: string): string {
  return item.kind === "note" ? noteHtml(item) : bubbleHtml(item, peer);
}

/**
 * Le fil entier, tel qu'un premier rendu l'écrit — et tel que la relecture
 * d'un appel passé le réécrit, depuis les items gardés au coffre et le nom
 * que porte sa ligne d'historique (`ui/chatdialog.ts`).
 */
export function chatThreadHtml(
  items: readonly ChatItem[] = chat.items,
  peer: string = chat.peer,
): string {
  return items.map((i) => itemHtml(i, peer)).join("");
}

/** L'état du lien, dit à qui écrit : une pastille et une phrase. */
export function chatStateLine(): { cls: "ok" | "warn" | "err" | "idle"; label: string } {
  if (chat.holdUntil > Date.now()) {
    const left = (chat.holdUntil - Date.now()) / 1000;
    return { cls: "warn", label: t("chat.state.pending", { s: formatNumber(left, 1) }) };
  }
  switch (chat.link) {
    case "open":
      return { cls: "ok", label: t("chat.state.open") };
    case "connecting":
      return { cls: "warn", label: t("chat.state.connecting") };
    case "lost":
      return { cls: "err", label: t("chat.state.lost") };
    case "closed":
      return chat.everOpen
        ? { cls: "idle", label: t("chat.state.closed") }
        : { cls: "idle", label: t("chat.state.refused") };
  }
}

/**
 * L'en-tête du panneau : son nom et la pastille du lien. Le même des deux
 * côtés — il n'y a plus d'onglets à distinguer.
 *
 * Pendant l'appel, l'historique **disparaît** de la sidebar au lieu de
 * passer derrière un onglet : à 300 px les deux ne tiennent pas côte à
 * côte, et un historique d'appels n'a rien à dire pendant qu'on parle.
 * C'est déjà ce que fait la vue mobile, qui n'a jamais eu d'onglets.
 */
export function chatHead(icon: string): string {
  return `<div class="chat-head">
      ${icon}<span>${esc(t("chat.tab"))}</span>
      <span class="dot ${headDot()}" data-ref="chat-dot"></span>
    </div>`;
}

/** La pastille de l'en-tête : verte vivante, orange en cours, rouge rompue. */
function headDot(): string {
  const cls = chatStateLine().cls;
  return cls === "ok" ? "live" : cls === "idle" ? "" : cls;
}

/**
 * Le panneau : le fil, le bouton « descendre », le champ et son état.
 *
 * Le fil est un `log` **sans `aria-live`**, et c'est délibéré : une bulle
 * vivante change à chaque caractère reçu, et une région bavarde la ferait
 * relire en entier des dizaines de fois par phrase. Ce qui est annoncé,
 * c'est la bulle **figée**, une fois, par la région d'état de l'application
 * (`ui/announce.ts`) — le seul moment où le correspondant a fini sa phrase.
 */
export function chatPane(peer: string): string {
  const state = chatStateLine();
  const closed = chat.link === "closed";
  return `<div class="chatpane" id="${CHAT_PANE_ID}" role="region"
       data-ref="chatpane" aria-label="${esc(t("chat.aria", { peer }))}">
      <div class="chat-thread" data-ref="chat-thread" role="log" aria-live="off"
           tabindex="0">${chatThreadHtml()}</div>
      <button class="chat-jump" data-act="chat-jump" data-ref="chat-jump" ${
        unseen > 0 ? "" : "hidden"
      }>${esc(tn("chat.jump", unseen))}</button>
      <div class="chat-composer">
        <textarea class="composer" data-ref="chat-input" rows="2" dir="auto"
                  ${closed ? "disabled" : ""}
                  aria-label="${esc(t("chat.composerAria"))}"
                  placeholder="${esc(t(closed ? "chat.placeholderClosed" : "chat.placeholder"))}"
                  >${esc(chat.draft)}</textarea>
        <div class="chat-foot">
          <span class="chat-state" data-ref="chat-state">
            <span class="dot ${state.cls}"></span>${esc(state.label)}
          </span>
          <span class="chat-hint">${esc(t("chat.enterHint"))}</span>
        </div>
      </div>
    </div>`;
}

/** Ce que la scène reçoit du gabarit qui l'appelle — bureau ou mobile. */
export interface ChatStageCtx {
  /** Nom du correspondant, tel que les bulles le portent. */
  peer: string;
  /** La barre de commandes média, composée par le gabarit (`overlayBar`). */
  bar: string;
  /** Vu-mètres : l'appel porte le son, et il est établi. */
  meters: boolean;
  /** Le pavé DTMF, qui se pose sur le fil comme il se posait sur l'image. */
  dtmf?: string;
}

/**
 * **Le tchat à la place de la vidéo** (voir `chatOnStage`) : un bandeau de
 * commandes, puis le fil et son champ sur toute la scène.
 *
 * Trois choix s'y lisent.
 *
 * **La barre de commandes coiffe le fil au lieu de flotter dessus.** En
 * surimpression, elle couvrirait le composeur ; en bas, le clavier virtuel
 * la pousserait hors de l'écran avec Raccrocher. Elle garde son fond sombre
 * de scène — ses boutons sont blancs, et c'est ce qui les rend lisibles.
 *
 * **L'élément vidéo distant reste**, quoique invisible : c'est lui qui joue
 * le son de l'appel (`attachMedia`), et le haut-parleur le coupe. Un appel
 * texte seul n'y attache rien, ce qui ne coûte rien non plus.
 *
 * **Pas de `videozone`.** Le plein écran s'attrape au double-clic sur la
 * scène vidéo ; sur un fil de texte, le double-clic sélectionne un mot — il
 * ne doit pas basculer l'écran. Le bouton, lui, n'est pas de la partie :
 * les gabarits ne le demandent pas ici, et il serait désactivé de toute
 * façon, faute d'image à agrandir.
 */
export function chatStage(ctx: ChatStageCtx): string {
  return `<div class="chat-stage">
      <div class="stage-bar">
        ${ctx.bar}
        ${
          ctx.meters
            ? `<div class="vumeters" aria-hidden="true">
                 <span class="bar" data-ref="vu-remote" style="height:4%"></span>
                 <span class="bar" data-ref="vu-local" style="height:4%"></span>
               </div>`
            : ""
        }
      </div>
      <video class="remote" data-ref="remote" autoplay playsinline></video>
      ${chatPane(ctx.peer)}
      ${ctx.dtmf ?? ""}
    </div>`;
}

// ---------------------------------------------------------------------------
// Projection : du modèle vers la page
// ---------------------------------------------------------------------------

/**
 * Le fil **à l'écran maintenant** — jamais un nœud d'un rendu périmé :
 * l'écran d'appel est reconstruit à chaque notification de la machine, et
 * un fragment peut arriver entre deux.
 */
function threadNode(): HTMLElement | null {
  return hasDom() ? document.querySelector<HTMLElement>('[data-ref="chat-thread"]') : null;
}

/**
 * Repeint ce qui a changé, et seulement cela : on compare la signature de
 * chaque élément à celle du nœud en place. Seule la bulle vivante bouge en
 * régime courant, donc un caractère reçu ne remplace qu'un nœud.
 */
function paint(): void {
  const list = threadNode();
  if (!list) return;
  const items = chat.items;
  for (const [i, item] of items.entries()) {
    const cur = list.children[i] as HTMLElement | undefined;
    const sig = signature(item);
    if (cur?.dataset.sig === sig) continue;
    const node = el(itemHtml(item, chat.peer));
    if (cur) list.replaceChild(node, cur);
    else list.append(node);
  }
  while (list.children.length > items.length) list.lastElementChild?.remove();

  // Ne jamais faire défiler d'autorité : quand l'utilisateur a remonté le
  // fil, il y reste, et un bouton dit ce qu'il manque en bas.
  if (pinned) {
    unseen = 0;
    list.scrollTop = list.scrollHeight;
  }
  const jump = document.querySelector<HTMLElement>('[data-ref="chat-jump"]');
  if (jump) {
    jump.hidden = unseen === 0;
    jump.textContent = tn("chat.jump", unseen);
  }
  paintState();
  paintHeadDot();
}

function paintState(): void {
  if (!hasDom()) return;
  const line = document.querySelector<HTMLElement>('[data-ref="chat-state"]');
  if (!line) return;
  const state = chatStateLine();
  line.replaceChildren(el(`<span class="dot ${state.cls}"></span>`), state.label);
  const input = document.querySelector<HTMLTextAreaElement>('[data-ref="chat-input"]');
  // seul `closed` coupe la saisie : ce qui est tapé pendant la sonnerie ou
  // pendant une reprise attend dans le tampon du canal et part à l'ouverture
  if (input) input.disabled = chat.link === "closed";
}

function paintHeadDot(): void {
  if (!hasDom()) return;
  const dot = document.querySelector<HTMLElement>('[data-ref="chat-dot"]');
  if (!dot) return;
  dot.className = `dot ${headDot()}`;
}

// ---------------------------------------------------------------------------
// Câblage
// ---------------------------------------------------------------------------

/**
 * Branche le panneau rendu dans `screen`. Appelé à chaque rendu : le canal,
 * lui, ne change qu'une fois par appel — c'est ce qui décide de repartir
 * d'un fil vide ou de reprendre celui qui est en cours.
 */
export interface ChatCtx {
  view: CallView | null;
  /** Nom du correspondant, tel que les bulles le portent. */
  peer: string;
  /**
   * Flash plein écran sur alerte reçue — le réglage du compte, celui-là
   * même qui gouverne l'appel entrant (`AccountConfig.flashAlert`).
   */
  flash: boolean;
}

export function wireChat(screen: HTMLElement, ctx: ChatCtx): void {
  const { view, peer } = ctx;
  flashOnAlert = ctx.flash;
  const channel = chatChannel(view);
  if (!channel) {
    // appel sans texte (ou pas d'appel du tout) : rien à brancher, et le fil
    // du précédent n'a rien à faire dans celui-ci
    if (bound) closeChat();
    return;
  }

  if (channel !== bound) {
    unlisten?.();
    chatReset(peer);
    bound = channel;
    // le premier abonné reçoit ce qui est arrivé avant lui : le canal s'ouvre
    // avec l'appel, le panneau bien après
    unlisten = channel.listen({ text: chatReceive, state: chatLink });
  }
  changed = paint;

  const input = screen.querySelector<HTMLTextAreaElement>('[data-ref="chat-input"]');
  const list = screen.querySelector<HTMLElement>('[data-ref="chat-thread"]');

  input?.addEventListener("input", () => {
    chatType(input.value);
    // un collage arrive avec ses retours à la ligne : le champ montre ce que
    // la bulle portera, faute de quoi il promettrait dix lignes pour une
    if (input.value !== chat.draft) {
      input.value = chat.draft;
      input.setSelectionRange(chat.draft.length, chat.draft.length);
    }
    grow(input);
  });
  input?.addEventListener("keydown", (e) => {
    // `isComposing` : en japonais et en chinois, Entrée valide un candidat de
    // la méthode de saisie — la figer là serait couper la phrase en son
    // milieu, à chaque mot
    if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    chatEnter();
    input.value = "";
    grow(input);
  });

  list?.addEventListener("scroll", () => {
    const bottom = list.scrollHeight - list.scrollTop - list.clientHeight;
    pinned = bottom <= PINNED_PX;
    if (pinned) {
      unseen = 0;
      const jump = screen.querySelector<HTMLElement>('[data-ref="chat-jump"]');
      if (jump) jump.hidden = true;
    }
  });

  for (const b of screen.querySelectorAll<HTMLElement>('[data-act="chat-jump"]')) {
    b.addEventListener("click", () => {
      pinned = true;
      unseen = 0;
      paint();
      list?.focus();
    });
  }

  // mobile : le tchat prend la place que la vidéo lui cède, et le bouton de
  // la barre de surimpression le replie
  for (const b of screen.querySelectorAll<HTMLElement>('[data-act="chat"]')) {
    b.addEventListener("click", () => {
      mobileOpen = !mobileOpen;
      screen.classList.toggle("chat-open", mobileOpen);
      b.classList.toggle("toggled", mobileOpen);
      b.setAttribute("aria-expanded", String(mobileOpen));
      b.title = t(mobileOpen ? "ctrl.chat.hide" : "ctrl.chat.show");
      if (mobileOpen) paint();
    });
  }

  // Le champ du rendu **précédent** : ce nœud-ci n'est pas encore monté,
  // l'ancien l'est toujours, et c'est le dernier instant où l'on peut savoir
  // où était le curseur. Sans cela, une notification de la machine ferait
  // perdre le fil de sa phrase à qui écrit.
  const held = document.activeElement;
  const caret =
    held instanceof HTMLTextAreaElement && held.dataset.ref === "chat-input"
      ? held.selectionStart
      : null;
  if (caret !== null) {
    queueMicrotask(() => {
      const next = document.querySelector<HTMLTextAreaElement>('[data-ref="chat-input"]');
      if (!next) return;
      next.focus();
      next.setSelectionRange(caret, caret);
      grow(next);
    });
  }

  queueMicrotask(paint);
}

/** Le champ grandit avec le texte, sans dépasser la hauteur du composeur. */
function grow(input: HTMLTextAreaElement): void {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 132)}px`;
}

