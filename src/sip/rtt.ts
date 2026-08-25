/**
 * Texte en temps réel (TTR) : **le tuyau, et rien d'autre**
 * (docs/CONCEPTION.md §4.9).
 *
 * Ce module ne connaît de T.140 qu'une chose, le retour arrière — et
 * seulement parce qu'il détient le tampon d'émission, donc qu'il est le
 * seul à savoir si le caractère effacé est encore rattrapable ou déjà
 * parti. Le reste — séparateurs de ligne, signature de session, mise en
 * valeur — ne lui dit rien : il transporte un flux de caractères, dans
 * les deux sens, et laisse le codec (`sip/t140.ts`) et le panneau
 * (`ui/screens/call/chat.ts`) l'interpréter.
 * La frontière est la même qu'entre `sip/port.ts` et les machines : au
 * dessus, personne ne sait par où le texte passe.
 *
 * Deux tuyaux, un seul contrat :
 *
 * - **`websocket`** — le texte sur WebSocket des passerelles déjà
 *   déployées (`sip/rttws.ts`) : non standard, mais c'est ce que parlent
 *   les services en place, et c'est par là qu'on peut les appeler dès
 *   aujourd'hui ;
 * - **`datachannel`** — RFC 8865, le canal de données WebRTC
 *   (`sip/rttdc.ts`) : la cible, celle qui parle aux clients standards.
 *
 * Et un troisième choix qui n'est pas un tuyau : **`none`**, où l'appel se
 * passe exactement comme avant — aucun canal ouvert, aucune ligne ajoutée
 * au SDP.
 *
 * Le choix appartient au **compte** (`storage/store.ts`), comme le proxy
 * ou les serveurs ICE : c'est l'opérateur qui décide de ce que sa
 * plateforme sait recevoir. L'interface, elle, ne voit que `RttChannel` —
 * changer de transport ne lui demande rien.
 *
 * Ce qui est commun aux deux fils vit ici : le tampon d'émission, le
 * découpage des salves, la file d'attente qui survit à une rupture. Un
 * fil (`RttWire`) n'a que trois obligations : écrire, se fermer, et dire
 * son état.
 */

import { openWsWire } from "./rttws.js";
import { openDcWire } from "./rttdc.js";

/**
 * Transport du texte en temps réel, réglage du compte. `none` n'est pas
 * une absence de réglage : c'est un choix, celui de **ne rien ajouter au
 * SDP** — ni section `m=text`, ni canal de données.
 */
export type RttTransport = "none" | "websocket" | "datachannel";

/** Les transports offerts, dans l'ordre où l'écran les propose. */
export const RTT_TRANSPORTS: readonly RttTransport[] = ["none", "websocket", "datachannel"];

/**
 * Transport retenu quand rien n'a été choisi — comptes enregistrés avant
 * l'introduction du réglage compris, et valeur inconnue relue d'un
 * stockage.
 *
 * C'est **`none`**, et c'est délibéré : proposer le texte modifie l'offre
 * SDP de *tous* les appels du compte. Un serveur qui ne l'attend pas
 * devrait répondre par un port nul (RFC 3264 §6), mais une pile stricte
 * peut refuser l'INVITE entier — et un appel perdu pour une fonction que
 * personne n'a demandée serait un mauvais échange. Le texte s'active donc
 * en connaissance de cause, comme les serveurs ICE.
 */
export const DEFAULT_RTT_TRANSPORT: RttTransport = "none";

/** Valeur venue du stockage ou d'un formulaire, ramenée à un transport connu. */
export function parseRttTransport(value: unknown): RttTransport {
  return value === "websocket" || value === "datachannel" || value === "none"
    ? value
    : DEFAULT_RTT_TRANSPORT;
}

/**
 * État du lien texte, tel que l'écran a besoin de le dire :
 *
 * - `connecting` — négocié, pas encore ouvert : ce qui est tapé attend ;
 * - `open` — le texte part ;
 * - `lost` — rompu, une reprise est en cours ; ce qui est tapé attend
 *   encore, et le distant a probablement perdu du texte ;
 * - `closed` — définitif : plus rien ne partira par ce canal.
 */
export type RttState = "connecting" | "open" | "lost" | "closed";

/** Ce à quoi un abonné du canal est averti. */
export interface RttEvents {
  /**
   * Un fragment reçu, **tel qu'il est arrivé** : caractères et commandes
   * T.140 mêlés, sans découpage significatif — le codec recolle.
   */
  text(chunk: string): void;
  state(state: RttState): void;
}

/** Le lien texte vu d'en haut : c'est tout ce que l'interface manipule. */
export interface RttChannel {
  readonly transport: RttTransport;
  state(): RttState;
  /**
   * S'abonne au flux entrant et aux changements d'état ; rend de quoi se
   * désabonner. L'abonné reçoit **l'état courant tout de suite**, puis ce
   * qui suit ; et le premier abonné reçoit ce qui est arrivé avant lui —
   * le canal s'ouvre avec l'appel, le panneau de tchat ne s'affiche
   * qu'après, et les premiers caractères d'un correspondant pressé ne
   * doivent pas tomber dans l'intervalle.
   */
  listen(events: RttEvents): () => void;
  /**
   * Met du texte en partance. Rien ne part forcément tout de suite : les
   * frappes isolées attendent 300 ms de plus, une salve part
   * immédiatement (§4.9, « le tampon d'émission adaptatif »).
   */
  send(text: string): void;
  /**
   * Erases the last character of the outgoing stream.
   *
   * What is still buffered never leaves: it is dropped, and no backspace
   * is sent. Only what has already gone out costs a `U+0008`. Sending one
   * for a character the peer never saw would erase one of its own — the
   * likeliest bug of a real-time text implementation.
   */
  backspace(count?: number): void;
  /** Envoie sans attendre ce qui est en tampon — fin de ligne, collage, raccrochage. */
  flush(): void;
  /** Ferme le lien pour de bon ; ce qui restait en tampon part si le fil est encore ouvert. */
  close(): void;
  /**
   * **Le texte tapé part-il ?** Faux avant le décrochage, et c'est le port
   * qui en décide — lui seul voit passer le 200 OK.
   *
   * Un canal peut être grand ouvert bien avant que quiconque ait répondu :
   * en média précoce (RFC 3960), la connexion pair-à-pair s'établit sur la
   * réponse provisoire, le canal de données avec elle, et un serveur peut
   * déjà nous envoyer les sous-titres de l'annonce qu'il joue. **Ce qui
   * arrive s'affiche** ; ce qu'on écrirait, non : il n'y a personne au bout
   * pour le lire, et le mettre en tampon le ferait partir d'un bloc au
   * décrochage — sur la conversation de quelqu'un d'autre si l'appel a été
   * dévié entre-temps.
   *
   * Suspendu, le canal **jette** ce qu'on lui donne au lieu de l'accumuler,
   * et ne touche ni à ce qu'il reçoit, ni à ce que le fil entretient de son
   * côté (la signature de session répétée reste envoyée).
   */
  setSending(on: boolean): void;
  /**
   * Combien de fois du texte a **manqué** depuis le début de l'appel —
   * l'unité de mesure que T.140 §5.3.2.3 donne à la qualité du texte, et
   * la seule que ce niveau puisse observer honnêtement.
   *
   * Ce sont les marqueurs `U+FFFD` du flux entrant (RFC 8865 §5.4), et ils
   * ont deux provenances qu'il n'y a aucune raison de distinguer ici : le
   * fil en insère un à chaque reprise de canal (`rttdc.ts`, `rttws.ts`), et
   * le distant — ou la passerelle qui traduit son RTP — en envoie un pour
   * chaque trou qu'il constate de son côté. Dans les deux cas, du texte a
   * été perdu en route, et c'est ce que le compteur dit.
   *
   * Il compte **tout ce qui arrive**, y compris ce qui est arrivé avant que
   * le panneau de tchat ne soit ouvert : le canal vit avec l'appel, le
   * panneau non.
   */
  missingText(): number;
}

/** Ce à quoi le canal se raccorde, une fois la signalisation faite. */
export type RttLink =
  | {
      transport: "websocket";
      /** URL `wss://…`, lue dans la réponse SDP (`sip/rttws.ts`). */
      url: string;
    }
  | {
      transport: "datachannel";
      connection: RTCPeerConnection;
      /**
       * `offer` ouvre le canal, `answer` attend celui du distant — RFC 8865
       * laisse l'offrant le créer.
       */
      role: "offer" | "answer";
    };

/** Ce qu'un fil rapporte au canal qui l'enveloppe. */
export interface RttWireHooks {
  text(chunk: string): void;
  state(state: RttState): void;
}

/** Un tuyau brut : ni tampon, ni découpage, ni file d'attente. */
export interface RttWire {
  /** Écrit un message. N'est appelé que fil ouvert. */
  send(text: string): void;
  close(): void;
}

export type RttWireFactory = (hooks: RttWireHooks) => RttWire;

/**
 * Temporisation d'une frappe isolée. T.140 §6.1.1 tolère jusqu'à 0,5 s ;
 * 300 ms reste sous cette limite tout en évitant d'écrire un message par
 * touche.
 */
export const RTT_HOLD_MS = 300;

/**
 * Au-delà de cette longueur en attente, on n'attend plus : la frappe
 * rapide et le collage partent sans latence.
 */
const BURST = 4;

/**
 * Taille maximale d'un message écrit sur le fil. Très en deçà de ce que
 * SCTP ou WebSocket acceptent : un collage de plusieurs pages ne doit pas
 * dépendre de la limite du jour.
 */
const MAX_CHUNK = 1000;

/**
 * Ce qu'on garde en mémoire quand le fil n'est pas ouvert. Au-delà, on
 * cesse d'accumuler : l'état `lost` dit déjà que le texte ne passe plus,
 * et une file sans fin ne rendrait service à personne — surtout pas au
 * distant, qui recevrait d'un coup dix minutes de frappe.
 */
const PENDING_MAX = 4000;

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter() : null;

/** T.140 backspace: one character erased, wherever the erasing happens. */
const BACKSPACE = "\u0008";

/**
 * Missing text marker (T.140 §5.3.2.3, RFC 8865 §5.4). Declared here, like
 * the backspace above: this module counts these, it does not read them —
 * interpreting the stream is the codec's job (`sip/t140.ts`).
 */
const LOSS_MARKER = "\uFFFD";

/**
 * The last character of a string, in the T.140 sense — one grapheme, so
 * that an emoji or a combining mark goes in one piece, as §8.2 requires
 * of an erasure.
 */
function lastGrapheme(text: string): string | null {
  if (text === "") return null;
  const units = segmenter ? [...segmenter.segment(text)].map((s) => s.segment) : Array.from(text);
  return units.at(-1) ?? null;
}

/**
 * Découpe en messages d'au plus `max` unités, **sans couper un
 * caractère** : les frontières sont celles des graphèmes (émoji, lettres
 * accentuées composées, écritures indiennes), à défaut celles des points
 * de code. Couper au milieu d'une paire de substitution produirait deux
 * moitiés invalides — et un carré blanc à l'arrivée.
 */
export function chunkText(text: string, max = MAX_CHUNK): string[] {
  if (text.length <= max) return text === "" ? [] : [text];

  const units: Iterable<string> = segmenter
    ? [...segmenter.segment(text)].map((s) => s.segment)
    : Array.from(text);

  const out: string[] = [];
  let current = "";
  for (const unit of units) {
    if (current.length + unit.length > max && current !== "") {
      out.push(current);
      current = "";
    }
    current += unit;
  }
  if (current !== "") out.push(current);
  return out;
}

/**
 * Le canal, quel que soit le fil : tampon, découpage, file d'attente et
 * état. `connect` n'est appelé qu'une fois — la reconnexion, quand elle a
 * un sens, est l'affaire du fil (le WebSocket la fait, SCTP n'en a pas
 * besoin).
 */
export function rttChannel(transport: RttTransport, connect: RttWireFactory): RttChannel {
  let state: RttState = "connecting";
  let pending = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  const listeners = new Set<RttEvents>();
  /** Ce qui est arrivé avant le premier abonné — jamais perdu, juste en retard. */
  let backlog = "";
  /** Marqueurs de texte manquant reçus (T.140 §5.3.2.3) — voir `missingText`. */
  let missing = 0;
  /** Le texte tapé part-il ? Voir `setSending` — faux avant le décrochage. */
  let sending = true;

  const cancelTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  /** Assigné dès le retour de `connect` ; les hooks peuvent parler avant. */
  let wire: RttWire | null = null;

  const flush = (): void => {
    cancelTimer();
    if (pending === "" || state !== "open" || !wire) return;
    const out = pending;
    pending = "";
    for (const chunk of chunkText(out)) wire.send(chunk);
  };

  /** Sends the burst, or waits a little longer for the next keystroke. */
  const arm = (): void => {
    if (state !== "open") return;
    if (pending.length >= BURST) {
      flush();
      return;
    }
    if (timer === null) {
      timer = setTimeout(() => {
        timer = null;
        flush();
      }, RTT_HOLD_MS);
    }
  };

  const hooks: RttWireHooks = {
    text(chunk) {
      if (chunk === "") return;
      // compté ici et nulle part ailleurs : c'est le seul point par lequel
      // tout ce qui arrive passe, panneau ouvert ou non
      for (const unit of chunk) if (unit === LOSS_MARKER) missing += 1;
      if (listeners.size === 0) {
        backlog += chunk;
        return;
      }
      for (const l of listeners) l.text(chunk);
    },
    state(next) {
      // `close()` a le dernier mot : un fil qui s'éteint après coup ne
      // ressuscite pas le canal
      if (closed && next !== "closed") return;
      if (next === state) return;
      state = next;
      for (const l of listeners) l.state(next);
      // le fil vient de s'ouvrir (ou de se rétablir) : ce qui attendait part
      if (next === "open" && pending !== "") flush();
    },
  };

  wire = connect(hooks);

  return {
    transport,
    state: () => state,
    missingText: () => missing,

    setSending(on) {
      if (on === sending) return;
      sending = on;
      // ce qui a été tapé pendant la suspension ne part pas après coup :
      // c'est tout l'intérêt de l'avoir suspendu
      if (!on) {
        cancelTimer();
        pending = "";
      }
    },

    listen(events) {
      listeners.add(events);
      events.state(state);
      if (backlog !== "") {
        const late = backlog;
        backlog = "";
        events.text(late);
      }
      return () => listeners.delete(events);
    },

    send(text) {
      if (closed || !sending || text === "" || state === "closed") return;
      // fil rompu : on garde, mais pas indéfiniment
      if (pending.length < PENDING_MAX) pending += text;
      arm();
    },

    backspace(count = 1) {
      if (closed || !sending || state === "closed") return;
      for (let i = 0; i < count; i++) {
        const last = lastGrapheme(pending);
        // a backspace already queued cannot be taken back, only added to
        if (last !== null && last !== BACKSPACE) pending = pending.slice(0, -last.length);
        else if (pending.length < PENDING_MAX) pending += BACKSPACE;
      }
      arm();
    },

    flush,

    close() {
      if (closed) return;
      flush(); // ce qui est déjà tapé part avant la fermeture
      closed = true;
      cancelTimer();
      pending = "";
      wire?.close();
      if (state !== "closed") {
        state = "closed";
        for (const l of listeners) l.state("closed");
      }
    },
  };
}

/**
 * Ouvre le lien texte sur le transport que la signalisation a retenu.
 * C'est le seul point où les deux implémentations se rencontrent : au
 * dessus, `RttChannel` ne dit pas par où le texte passe.
 */
export function openRtt(link: RttLink): RttChannel {
  if (link.transport === "websocket") {
    return rttChannel("websocket", (hooks) => openWsWire(link.url, hooks));
  }
  return rttChannel("datachannel", (hooks) => openDcWire(link.connection, link.role, hooks));
}
