/**
 * Le tchat de l'appel — le panneau (docs/CONCEPTION.md §4.9).
 *
 * La conversation elle-même — bulles, lien, brouillon, règle des deux
 * secondes, transcription — appartient au noyau (`core/conversation.ts`,
 * ADR 0011, D5). Ce module en est la projection et la saisie : le fil
 * dessiné, le champ, le bouton « descendre », le pli mobile.
 *
 * **Le modèle est la source, le DOM une projection.** Rien n'est relu dans
 * la page. Un caractère reçu devient un **nœud texte**, jamais du
 * balisage : le correspondant écrit dans notre fil, pas dans notre DOM.
 *
 * **Rien n'est rendu par un temporisateur.** Le fil est repeint à
 * l'arrivée du fragment, sans quoi un onglet caché — dont Chrome aligne
 * les timers sur la seconde — dépasserait les 500 ms de T.140 §6.1.1. Le
 * seul temporisateur du module est le décompte de la règle des deux
 * secondes, qui ne repeint que sa ligne.
 *
 * L'état d'affichage (pli mobile, suivi du bas, bulles non vues) vit ici,
 * hors du DOM : l'écran d'appel est reconstruit à chaque notification de
 * la machine.
 */

import type { CallView } from "../../../machines/events.js";
import type { RttState } from "../../../sip/rtt.js";
import {
  bubbleText,
  type ChatBubble,
  type ChatItem,
  type ChatNote,
  type ChatRun,
  type ChatSide,
} from "../../../sip/transcript.js";
import {
  createConversation,
  type Conversation,
  type ConversationEvent,
} from "../../../core/conversation.js";
import { el, esc } from "../../el.js";
import { announce } from "../../announce.js";
import { pulseAlert } from "../../alert.js";
import { formatNumber, formatTime, t, tn } from "../../../i18n/index.js";

/** Id du panneau, cité par l'`aria-controls` du bouton de la barre mobile. */
export const CHAT_PANE_ID = "call-chat";

/** Distance au bas du fil en deçà de laquelle on le considère « suivi ». */
const PINNED_PX = 24;

/**
 * Le modèle vit sans page : il se teste comme `sdp.ts`, en dehors de tout
 * DOM. Les projections s'abstiennent quand il n'y en a pas.
 */
const hasDom = (): boolean => typeof document !== "undefined";

// ---------------------------------------------------------------------------
// La conversation
// ---------------------------------------------------------------------------

/**
 * Le modèle des bulles vit dans `sip/transcript.ts`, la conversation qui le
 * remplit dans le noyau (`core/conversation.ts`, ADR 0011, D5) : elle suit
 * le canal de l'appel que ce panneau soit monté ou non, et c'est elle que
 * l'historique lit. Ce module n'en garde que la projection et la saisie.
 * Les types restent réexportés ici — le panneau est l'endroit d'où on les
 * regarde.
 */
export type { ChatBubble, ChatItem, ChatNote, ChatRun, ChatSide };
export { bubbleText };

/** La conversation montrée : celle de `main.ts`, une vide tant qu'il n'en a pas posé. */
let conv: Conversation = createConversation();
let unfollow = conv.subscribe(onConversation);

/** Nom du correspondant, tel que les bulles le portent — relu à chaque rendu. */
let chatPeer = "";
/** Le décompte de la règle des deux secondes, à l'écran. */
let tickTimer: ReturnType<typeof setInterval> | null = null;
/** Pli du tchat mobile — affichage pur. */
let mobileOpen = true;
/** Flash plein écran sur `BEL` : le réglage du compte, relu à chaque rendu. */
let flashOnAlert = true;
/** Le fil suit-il le bas ? Faux dès que l'utilisateur a remonté (§4.9). */
let pinned = true;
/** Bulles figées arrivées pendant qu'il lisait plus haut. */
let unseen = 0;

/** Pose la conversation que le panneau montre. Appelé une fois, depuis `main.ts`. */
export function showConversation(c: Conversation): void {
  unfollow();
  conv = c;
  unfollow = c.subscribe(onConversation);
}

/** Ce que la conversation demande à l'écran, au-delà de repeindre. */
function onConversation(e: ConversationEvent): void {
  switch (e.type) {
    case "reset":
      mobileOpen = true;
      pinned = true;
      unseen = 0;
      break;
    case "frozen":
      // ce qui se lit à l'écran ne s'entend pas : la bulle figée est le seul
      // moment où l'annoncer ait un sens, la bulle vivante changeant à chaque
      // caractère (voir `chatPane`, sur `aria-live`)
      if (hasDom()) announce(t("chat.announce", { who: chatPeer, text: bubbleText(e.bubble) }));
      if (!pinned) unseen += 1;
      break;
    case "alert":
      // l'alerte en séance réemploie les canaux de l'appel entrant : elle
      // s'adresse à quelqu'un qui ne regarde peut-être pas l'écran
      if (hasDom()) pulseAlert(flashOnAlert);
      break;
    case "link":
      // un correspondant sans texte temps réel ne doit pas manger la moitié
      // de l'écran mobile ni tenir la sidebar pour un fil qui n'a jamais vécu
      // (les deux gabarits interrogent `chatRefused`)
      if (conv.refused()) mobileOpen = false;
      break;
    case "changed":
      tick();
      paint();
      break;
  }
}

/**
 * Arme ou désarme le décompte. Il ne repeint que sa propre ligne : c'est le
 * seul endroit du module où un temporisateur touche à l'écran, et il ne
 * touche pas au fil.
 */
function tick(): void {
  const holding = conv.holdUntil() > 0;
  if (holding && tickTimer === null && hasDom()) tickTimer = setInterval(paintState, 100);
  else if (!holding && tickTimer !== null) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

export const chatThread = (): readonly ChatItem[] => conv.items();
export const chatLinkState = (): RttState => conv.link();
/**
 * Le lien est mort sans avoir jamais servi — le distant n'a pas voulu du
 * texte. Il n'y a alors pas de fil à montrer : le panneau s'efface au lieu
 * d'occuper la place avec un composeur grisé.
 */
export const chatRefused = (): boolean => conv.refused();
export const chatMobileOpen = (): boolean => mobileOpen;
/** Ce qui est parti sur le fil — la bulle locale vivante, en somme. */
export const chatSent = (): string => conv.sent();
/** Ce que le champ doit montrer : la frappe, nettoyée de ce qu'une bulle ne porte pas. */
export const chatDraft = (): string => conv.draft();

// ---------------------------------------------------------------------------
// Gabarit
// ---------------------------------------------------------------------------

/**
 * **Y a-t-il un tchat à montrer ?** Trois conditions, et la première est
 * celle qui tranche : **le texte doit être négocié**.
 *
 * `media.text` dit que les deux bouts en ont convenu dans la signalisation
 * (ADR 0003, D1) — l'URL annoncée par la passerelle en WebSocket,
 * l'association SCTP sur canal de données. Tant que la négociation n'a pas
 * conclu, il vaut ce que l'appel a demandé : le fil s'affiche donc dès la
 * sonnerie, et ce qui y est tapé attend dans le tampon du canal (§4.9).
 * Il tombe à faux à la première négociation aboutie où le distant n'a pas
 * suivi — et alors le panneau s'en va **entier**, champ de saisie compris :
 * un composeur ouvert sur un lien qui n'existe pas promet un message qui
 * ne partira jamais.
 *
 * Le canal doit exister (`textChannel`) — compte sans transport texte,
 * sonnerie entrante qui n'a pas encore de session — et le lien ne doit
 * pas être mort sans avoir jamais servi (`chatRefused`), ce que la
 * négociation ne dit pas toujours : une passerelle peut annoncer son URL et ne jamais ouvrir le
 * socket.
 */
export function chatAvailable(view: CallView | null): boolean {
  return view !== null && view.media.text && view.textChannel && !chatRefused();
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
  // **Un écran partagé est une image** (ADR 0005, D11) : un appel audio +
  // texte où le correspondant partage son écran a de nouveau quelque chose
  // à montrer, et le fil retourne au panneau. Sans cette ligne, l'écran
  // reçu n'aurait nulle part où s'afficher.
  if (!view || view.state === "ringing_in" || view.media.video || view.peerSharing) return false;
  if (!view.textChannel) return false;
  // Un appel **texte seul** garde sa scène même quand le texte n'est pas
  // négocié : il n'y a rien d'autre à mettre à l'écran, et la remarque du
  // fil dit pourquoi cet appel ne mènera nulle part — le champ de saisie,
  // lui, reste fermé (`chatWritable`). Un appel audio, lui, a toujours sa
  // scène d'appel audio à retrouver.
  return chatAvailable(view) || !view.media.audio;
}

/**
 * **Le champ de saisie s'ouvre-t-il ?** Deux verrous, et ils ne disent pas
 * la même chose : le texte doit avoir été négocié (sans quoi rien ne
 * partirait), et l'appel doit être décroché — avant, le fil se lit mais ne
 * s'écrit pas (§4.9, média précoce).
 *
 * La seule scène qui s'affiche sans texte négocié est celle de l'appel
 * texte seul, et c'est justement celle-là que ce verrou tient fermée.
 */
export function chatWritable(view: CallView | null): boolean {
  return view?.state === "connected" && chatAvailable(view);
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
  items: readonly ChatItem[] = conv.items(),
  peer: string = chatPeer,
): string {
  return items.map((i) => itemHtml(i, peer)).join("");
}

/** L'état du lien, dit à qui écrit : une pastille et une phrase. */
export function chatStateLine(): { cls: "ok" | "warn" | "err" | "idle"; label: string } {
  if (conv.holdUntil() > Date.now()) {
    const left = (conv.holdUntil() - Date.now()) / 1000;
    return { cls: "warn", label: t("chat.state.pending", { s: formatNumber(left, 1) }) };
  }
  switch (conv.link()) {
    case "open":
      return { cls: "ok", label: t("chat.state.open") };
    case "connecting":
      return { cls: "warn", label: t("chat.state.connecting") };
    case "lost":
      return { cls: "err", label: t("chat.state.lost") };
    case "closed":
      return !conv.refused()
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
export function chatPane(peer: string, writable = true): string {
  const state = chatStateLine();
  const closed = conv.link() === "closed";
  /**
   * **Lire oui, écrire non** : avant le décrochage, le fil montre ce que le
   * réseau envoie déjà (une annonce en texte temps réel arrive en média
   * précoce, RFC 3960) mais la saisie reste fermée. Rien de ce qu'on
   * taperait n'a de destinataire tant que personne n'a répondu, et le
   * tampon du canal le ferait partir d'un bloc au décrochage — sur la
   * conversation de quelqu'un d'autre si l'appel a été dévié.
   *
   * La signature de session, elle, part quand même (`sip/rttws.ts`) : c'est
   * elle qui ouvre le chemin retour, et elle ne dit rien.
   */
  const locked = closed || !writable;
  return `<div class="chatpane" id="${CHAT_PANE_ID}" role="region"
       data-ref="chatpane" aria-label="${esc(t("chat.aria", { peer }))}">
      <div class="chat-thread" data-ref="chat-thread" role="log" aria-live="off"
           tabindex="0">${chatThreadHtml()}</div>
      <button class="chat-jump" data-act="chat-jump" data-ref="chat-jump" ${
        unseen > 0 ? "" : "hidden"
      }>${esc(tn("chat.jump", unseen))}</button>
      <div class="chat-composer">
        <textarea class="composer" data-ref="chat-input" rows="2" dir="auto"
                  ${locked ? "disabled" : ""}
                  aria-label="${esc(t("chat.composerAria"))}"
                  placeholder="${esc(
                    t(
                      closed
                        ? "chat.placeholderClosed"
                        : writable
                          ? "chat.placeholder"
                          : "chat.placeholderEarly",
                    ),
                  )}"
                  >${esc(conv.draft())}</textarea>
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
  /** L'appel est établi : avant, le fil se lit mais ne s'écrit pas. */
  writable?: boolean;
  /** Le pavé DTMF, qui se pose sur le fil comme il se posait sur l'image. */
  dtmf?: string;
  /**
   * Ce qui se pose **par-dessus** la scène : le bandeau de pause et l'avis
   * de celle du correspondant (`pause.ts`). Le fil, lui, continue de vivre
   * dessous — c'est même tout ce qui reste quand on est en pause, et c'est
   * délibéré (ADR 0003, D7).
   */
  banner?: string;
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
 * le son de l'appel (`showStreams`), et le haut-parleur le coupe. Un appel
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
      ${chatPane(ctx.peer, ctx.writable ?? true)}
      ${ctx.dtmf ?? ""}
      ${ctx.banner ?? ""}
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
  const items = conv.items();
  for (const [i, item] of items.entries()) {
    const cur = list.children[i] as HTMLElement | undefined;
    const sig = signature(item);
    if (cur?.dataset.sig === sig) continue;
    const node = el(itemHtml(item, chatPeer));
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
  if (input) input.disabled = conv.link() === "closed";
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
  flashOnAlert = ctx.flash;
  chatPeer = ctx.peer;
  // appel sans texte (ou pas d'appel du tout) : rien à brancher. Le canal,
  // lui, est suivi par la conversation du noyau (`followCalls`), pas ici.
  if (!ctx.view?.textChannel) return;

  const input = screen.querySelector<HTMLTextAreaElement>('[data-ref="chat-input"]');
  const list = screen.querySelector<HTMLElement>('[data-ref="chat-thread"]');

  input?.addEventListener("input", () => {
    conv.type(input.value);
    // un collage arrive avec ses retours à la ligne : le champ montre ce que
    // la bulle portera, faute de quoi il promettrait dix lignes pour une
    const draft = conv.draft();
    if (input.value !== draft) {
      input.value = draft;
      input.setSelectionRange(draft.length, draft.length);
    }
    grow(input);
  });
  input?.addEventListener("keydown", (e) => {
    // `isComposing` : en japonais et en chinois, Entrée valide un candidat de
    // la méthode de saisie — la figer là serait couper la phrase en son
    // milieu, à chaque mot
    if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    conv.enter();
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

