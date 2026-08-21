/**
 * Le carnet d'un appel : les paquets SIP de **son** dialogue, et les états
 * par lesquels il est passé, gardés pour être relus depuis l'historique
 * (docs/CONCEPTION.md §5.3).
 *
 * La console montre l'échange pendant qu'il a lieu ; encore faut-il l'avoir
 * ouverte au bon moment. Le carnet répond à l'autre besoin, celui du
 * support : « l'appel de 14 h 32 a été coupé, que s'est-il passé ? ». Il ne
 * se remplit que si la trace est active — ce module ne consulte jamais le
 * réglage lui-même, `sip/trace.ts` ne lui envoie rien quand la case est
 * décochée, et l'appel en cours se met donc à s'enregistrer dès qu'on la
 * coche. Une seule ligne échappe à la règle, `recordError` : un échec
 * WebRTC ne se rejoue pas, il entre au carnet quoi qu'il arrive.
 *
 * Le découpage se fait sur le **Call-ID**, pas sur le temps : c'est ce qui
 * distingue les paquets d'un appel de ceux du REGISTER périodique ou d'un
 * second INVITE refusé pendant la communication. Les REGISTER sont écartés
 * d'emblée : ils portent l'empreinte du compte, n'apprennent rien sur un
 * appel, et personne ne veut les relire.
 *
 * Un carnet peut s'ouvrir **après** le premier paquet de son dialogue :
 * l'INVITE entrant est justement ce qui déclenche l'appel, il est passé
 * avant que quiconque ait pu ouvrir quoi que ce soit. D'où `recent`, qui
 * garde de quoi rattraper les tout derniers dialogues vus.
 */

/** Sens d'un paquet, du point de vue de Trix. */
export type Way = "in" | "out";

/**
 * Une ligne du carnet, telle qu'elle est persistée avec l'appel.
 * `sip` porte un paquet (entête + corps dépliable), `fsm` une transition de
 * la machine d'appel, `err` un échec WebRTC (message du navigateur, pile
 * s'il y en a une), `cut` la marque d'une trace arrêtée au plafond.
 */
export interface TraceLine {
  at: number;
  kind: "sip" | "fsm" | "err" | "cut";
  way?: Way;
  /** Ce qui reste visible sans déplier : ligne de départ, ou transition. */
  head: string;
  /** Le paquet entier — absent pour une transition. */
  body?: string;
  /** Le corps a été coupé : le paquet était plus long que le plafond. */
  clipped?: boolean;
}

/**
 * Plafonds. Un appel ordinaire tient en une vingtaine de paquets ; ces
 * bornes ne servent qu'à ce qu'un dialogue pathologique (ré-INVITE en
 * boucle, SDP géant) ne fasse pas gonfler le coffre, où les traces vivent
 * chiffrées aux côtés des 50 dernières lignes d'historique.
 */
const MAX_LINES = 200;
const MAX_BYTES = 64 * 1024;
const MAX_BODY = 4 * 1024;

/** Carnets ouverts en même temps, garde-fou contre un carnet jamais repris. */
const MAX_OPEN = 3;

/** Dialogues gardés en réserve, et leur longueur, pour rattraper un INVITE entrant. */
const RECENT_DIALOGS = 4;
const RECENT_LINES = 20;

interface Book {
  /** `null` tant qu'aucun paquet ne l'a rattaché : le carnet attend son dialogue. */
  callId: string | null;
  lines: TraceLine[];
  bytes: number;
  full: boolean;
}

/** Le carnet vu par le port : on y prend les lignes, une fois, à la fin. */
export interface CallTraceHandle {
  /** Les lignes collectées ; referme le carnet — le dialogue est terminé. */
  take(): TraceLine[];
}

/** Carnets ouverts, du plus ancien au plus récent. */
const books: Book[] = [];

/** Derniers dialogues vus hors carnet, pour l'INVITE arrivé trop tôt. */
const recent = new Map<string, TraceLine[]>();

/**
 * Ouvre un carnet. `callId` est connu pour un appel entrant (l'INVITE est
 * déjà là) et vaut `null` pour un sortant : le carnet adopte alors le premier
 * dialogue d'appel qui peut être le sien (voir `adoptable`).
 */
export function openCallTrace(callId: string | null): CallTraceHandle {
  const book: Book = { callId, lines: [], bytes: 0, full: false };
  if (callId !== null) {
    // ce qui est déjà passé de ce dialogue — l'INVITE entrant, au moins
    for (const line of recent.get(callId) ?? []) add(book, line);
    recent.delete(callId);
  }
  books.push(book);
  // un carnet que personne ne reprend (session jamais rapportée) ne doit pas
  // rester à collecter indéfiniment : le plus ancien cède la place
  while (books.length > MAX_OPEN) books.shift();
  return {
    take() {
      close(book);
      return book.lines;
    },
  };
}

/** Un paquet vient de passer. `head` est sa ligne de départ, déjà extraite par la trace. */
export function recordPacket(way: Way, head: string, text: string): void {
  const callId = callIdOf(text);
  if (callId === null || isRegister(head, text)) return;
  const line: TraceLine = { at: Date.now(), kind: "sip", way, head, ...clip(text) };
  const book = bookFor(callId, way, head, text);
  if (book) add(book, line);
  else remember(callId, line);
}

/**
 * Une transition de la machine d'appel. Elle va au carnet ouvert le plus
 * récent : il n'y a jamais qu'un appel suivi par la machine à la fois, et
 * c'est le dernier ouvert (§4.3).
 */
export function recordFsm(head: string): void {
  const book = books[books.length - 1];
  if (book) add(book, { at: Date.now(), kind: "fsm", head });
}

/**
 * Un échec WebRTC (`sip/mediaerror.ts`), au carnet du même appel que les
 * transitions. C'est la seule ligne que le carnet accepte **sans que la
 * trace soit cochée** : l'appel a raté, il ne se reproduira pas sur
 * demande, et le message du navigateur est tout ce qui dira pourquoi. La
 * ligne suffit à faire apparaître le parchemin dans l'historique.
 */
export function recordError(head: string, body: string): void {
  const book = books[books.length - 1];
  if (book) add(book, { at: Date.now(), kind: "err", head, body });
}

/** Remet le module à zéro — l'UA s'arrête, ou un test recommence. */
export function resetCallTraces(): void {
  books.length = 0;
  recent.clear();
}

/**
 * À quel carnet ce paquet appartient-il ? Un carnet déjà rattaché à ce
 * dialogue le prend ; sinon, un carnet en attente peut l'adopter.
 */
function bookFor(callId: string, way: Way, head: string, text: string): Book | undefined {
  const known = books.find((b) => b.callId === callId);
  if (known) return known;
  if (!adoptable(way, head, text)) return undefined;
  const waiting = books.find((b) => b.callId === null);
  if (!waiting) return undefined;
  waiting.callId = callId;
  // carnet encore vierge : ce que l'on a vu passer de ce dialogue avant
  // l'adoption vient en tête, dans l'ordre. Un carnet déjà entamé, lui,
  // garderait ces lignes-là au mauvais endroit — on s'en passe.
  if (waiting.lines.length === 0) {
    for (const line of recent.get(callId) ?? []) add(waiting, line);
  }
  recent.delete(callId);
  return waiting;
}

/** Méthodes d'un dialogue d'appel : ce qu'un carnet a le droit d'adopter. */
const CALL_METHODS = new Set(["INVITE", "ACK", "BYE", "CANCEL", "UPDATE", "INFO", "PRACK", "REFER"]);

/**
 * Ce paquet peut-il désigner l'appel qu'un carnet en attente est en train de
 * placer ? Le cas ordinaire est l'INVITE qui part. Mais la case peut être
 * cochée en pleine communication : le carnet n'a alors jamais vu l'INVITE, et
 * doit pouvoir se rattacher à ce qui reste du dialogue (BYE, ré-INVITE, la
 * réponse qui suit). Deux paquets ne peuvent en aucun cas être les nôtres :
 *
 * - un **INVITE reçu** — il ouvre un appel entrant, qui a son propre carnet ;
 * - une **réponse que nous émettons** — nous ne répondons que dans un dialogue
 *   ouvert par quelqu'un d'autre.
 *
 * Sans ces deux exclusions, un appel entrant qui croiserait la numérotation
 * d'un sortant se ferait consigner dans le carnet du mauvais appel.
 */
function adoptable(way: Way, head: string, text: string): boolean {
  const request = /^([A-Z]+) /.exec(head);
  if (request) {
    const method = request[1]!;
    if (!CALL_METHODS.has(method)) return false;
    return !(way === "in" && method === "INVITE");
  }
  if (way === "out") return false;
  const cseq = /^cseq[ \t]*:[ \t]*\d+[ \t]+([A-Z]+)/im.exec(text);
  return cseq !== null && CALL_METHODS.has(cseq[1]!);
}

function add(book: Book, line: TraceLine): void {
  if (book.full) return;
  const size = line.head.length + (line.body?.length ?? 0);
  if (book.lines.length >= MAX_LINES || book.bytes + size > MAX_BYTES) {
    book.full = true;
    book.lines.push({ at: Date.now(), kind: "cut", head: "" });
    return;
  }
  book.lines.push(line);
  book.bytes += size;
}

function close(book: Book): void {
  const i = books.indexOf(book);
  if (i !== -1) books.splice(i, 1);
}

/** Garde de quoi rattraper un dialogue dont le carnet n'est pas encore ouvert. */
function remember(callId: string, line: TraceLine): void {
  const lines = recent.get(callId) ?? [];
  if (lines.length < RECENT_LINES) lines.push(line);
  // ré-insertion : la Map est ordonnée par insertion, et c'est cet ordre qui
  // désigne le dialogue le plus ancien quand il faut faire de la place
  recent.delete(callId);
  recent.set(callId, lines);
  while (recent.size > RECENT_DIALOGS) {
    const oldest = recent.keys().next();
    if (oldest.done) break;
    recent.delete(oldest.value);
  }
}

function clip(text: string): { body: string; clipped?: boolean } {
  return text.length <= MAX_BODY
    ? { body: text }
    : { body: text.slice(0, MAX_BODY), clipped: true };
}

/**
 * Le Call-ID du paquet, forme longue ou compacte (`i:`, RFC 3261 §7.3.3 —
 * rare sur WebSocket, mais un proxy a le droit). Sans lui, le paquet
 * n'appartient à aucun dialogue identifiable : il n'est pas enregistré.
 */
function callIdOf(text: string): string | null {
  const m = /^(?:call-id|i)[ \t]*:[ \t]*(.+)$/im.exec(text);
  return m ? m[1]!.trim() : null;
}

/**
 * Le REGISTER périodique et ses réponses n'ont rien à faire dans le carnet
 * d'un appel. Une requête se reconnaît à sa ligne de départ, une réponse à
 * la méthode que rappelle son CSeq.
 */
function isRegister(head: string, text: string): boolean {
  if (head.startsWith("REGISTER ")) return true;
  const cseq = /^cseq[ \t]*:[ \t]*\d+[ \t]+([A-Z]+)/im.exec(text);
  return cseq?.[1] === "REGISTER";
}
