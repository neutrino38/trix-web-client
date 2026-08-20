/**
 * Trace des paquets SIP sur la console, et des états de l'appel qui vont
 * avec.
 *
 * JsSIP sait déjà se raconter : `JsSIP.debug.enable("JsSIP:*")` allume le
 * module `debug` et l'espace `JsSIP:Transport` recrache les paquets émis
 * et reçus. Ce n'est pas ce que fait ce module, et pour deux raisons.
 *
 * La première est la lisibilité : ces lignes-là arrivent noyées dans les
 * traces internes de JsSIP, avec un format que nous ne maîtrisons pas et un
 * réglage global (`localStorage.debug`) qui n'appartient pas à Trix.
 *
 * La seconde est plus structurelle. `JsSIP.UA` accepte n'importe quel objet
 * conforme à l'interface `Socket` (connect/disconnect/send + `onconnect`,
 * `ondisconnect`, `ondata`) : le transport n'est pas forcément le
 * `WebSocketInterface` de JsSIP. En traçant **au niveau du socket** plutôt
 * qu'au niveau de JsSIP, la trace continue de fonctionner le jour où le
 * texte passe par un WebSocket propriétaire — c'est le même point de
 * passage, quel que soit ce qui l'implémente.
 *
 * Le réglage est consulté à **chaque** paquet, jamais figé à l'ouverture du
 * socket : cocher la case en pleine communication trace la suite de
 * l'échange, sans redémarrer l'UA ni rouvrir le transport.
 *
 * À la trace des paquets s'ajoute celle de la FSM d'appel
 * (`traceCallStates`, plus bas) : les mêmes lignes, le même réglage, et
 * entre deux paquets ce que la machine en a fait.
 *
 * Tout ce qui est tracé est aussi proposé au carnet de l'appel en cours
 * (`sip/record.ts`), qui n'en garde que ce qui relève de son dialogue —
 * c'est ce carnet que l'historique attache à sa ligne. Rien n'y va quand
 * la case est décochée : la décision se prend ici, une fois, en tête de
 * chaque trace.
 */

import { recordFsm, recordPacket } from "./record.js";

const KEY = "trix-siptrace";

const TAG = "[trix]";

/** La trace est-elle demandée ? Éteinte par défaut : elle est verbeuse. */
export function sipTraceEnabled(): boolean {
  return localStorage.getItem(KEY) === "on";
}

/** Effet immédiat : les sockets déjà ouverts consultent ce réglage à chaque paquet. */
export function setSipTrace(on: boolean): void {
  if (on) localStorage.setItem(KEY, "on");
  else localStorage.removeItem(KEY);
}

/**
 * Où partent les lignes. Injectable pour les tests, comme le puits de
 * `ui/diagnostics.ts` — on lit alors exactement ce qu'un développeur voit.
 */
export interface TraceSink {
  /** Entête du paquet : ouvre un groupe replié, le corps suit. */
  group(label: string): void;
  line(text: string): void;
  groupEnd(): void;
}

export const consoleTraceSink: TraceSink = {
  // replié : un REGISTER fait quinze lignes, et on ne les lit pas toutes
  group: (label) => console.groupCollapsed(label),
  line: (text) => console.log(text),
  groupEnd: () => console.groupEnd(),
};

/** Sens d'un paquet, du point de vue de Trix. */
type Way = "→" | "←";

/** Le peu qu'il faut d'un socket pour le tracer : les deux bouts du fil. */
interface Wire {
  send(message: unknown): boolean;
  ondata(data: unknown): void;
}

/**
 * Enveloppe un socket JsSIP pour tracer ce qui passe dans les deux sens.
 * Rend le socket lui-même — il est modifié sur place, JsSIP n'y voit que du
 * feu et garde l'objet qu'il attend (`via_transport`, `sip_uri` et le reste
 * restent ceux du socket d'origine, y compris leurs accesseurs).
 */
export function traceSocket<S extends object>(socket: S, sink: TraceSink = consoleTraceSink): S {
  const wire = socket as S & Wire;

  const send = wire.send.bind(wire);
  wire.send = (message: unknown): boolean => {
    trace("→", message, sink);
    return send(message);
  };

  // `ondata` n'est pas une méthode que l'on remplace : c'est un rappel que
  // le Transport de JsSIP **pose** sur le socket, plus tard. D'où
  // l'accesseur : il intercepte cette pose, et rend à JsSIP notre relais.
  let deliver: (data: unknown) => void = () => {};
  const traced = (data: unknown): void => {
    trace("←", data, sink);
    deliver(data);
  };
  Object.defineProperty(wire, "ondata", {
    configurable: true,
    get: () => traced,
    set: (fn: (data: unknown) => void) => {
      deliver = fn;
    },
  });

  return socket;
}

function trace(way: Way, data: unknown, sink: TraceSink): void {
  if (!sipTraceEnabled()) return;
  const text = asText(data);
  if (text === null) {
    sink.line(`${TAG} SIP ${way} paquet binaire illisible`);
    return;
  }
  // les keep-alive (CRLF simple ou double) n'ont pas de corps à déplier :
  // une ligne compacte suffit à voir que le lien respire
  if (text.trim() === "") {
    sink.line(`${TAG} SIP ${way} keep-alive`);
    return;
  }
  const head = firstLine(text);
  recordPacket(way === "→" ? "out" : "in", head, text);
  sink.group(`${TAG} SIP ${way} ${head}`);
  sink.line(text);
  sink.groupEnd();
}

/**
 * La ligne de départ d'une requête ou d'une réponse — `INVITE sip:… SIP/2.0`,
 * `SIP/2.0 401 Unauthorized` : ce qui doit rester visible groupe replié.
 */
function firstLine(text: string): string {
  const end = text.indexOf("\r\n");
  return (end === -1 ? text : text.slice(0, end)).trim();
}

/**
 * Le texte du paquet. Le socket peut livrer une chaîne ou un binaire —
 * `WebSocketInterface` met `binaryType = "arraybuffer"`, et certains proxys
 * envoient effectivement du binaire là où d'autres envoient du texte.
 */
function asText(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(data as ArrayBufferView | ArrayBuffer);
    } catch {
      return null; // ce n'est pas de l'UTF-8 : rien d'utile à montrer
    }
  }
  return null;
}

/**
 * Le peu qu'il faut d'une machine pour la suivre : où elle est, et de quoi
 * être prévenu quand elle bouge. Forme structurelle, comme `Wire` plus
 * haut — ce module ne connaît ni `finite-state-language` ni les machines de
 * Trix, et les tests lui donnent un objet de trois lignes.
 */
interface Position {
  readonly state: string;
  /** Renseigné tant qu'un service building block tourne : où l'on est dedans. */
  readonly sbb?: { readonly block: string; readonly state: string } | undefined;
}

interface Traceable extends Position {
  subscribe(fn: (n: Position & { event?: { type: string }; desc?: string }) => void): () => void;
}

/**
 * Trace les états et les transitions de la FSM d'appel, dans le même flux
 * que les paquets et sous le même réglage.
 *
 * L'intérêt n'est pas de voir la machine bouger — le `logger` de la machine
 * le dit déjà en `console.debug` — mais de le voir **entre les paquets** :
 * un 180 sans passage en `ringing` et une trace de paquets seule ne montre
 * rien d'anormal. C'est la juxtaposition qui rend la ligne utile, d'où le
 * même puits et le même réglage, consulté à chaque transition comme il
 * l'est à chaque paquet.
 *
 * ```
 * [trix] SIP ← SIP/2.0 180 Ringing
 * [trix] FSM sip:progress: (CallBlock/dialing) → (CallBlock/ringing) "180/183"
 * ```
 *
 * Ce qui est tracé, c'est le **bloc** en cours — son entrée, ses
 * transitions internes, son retour à l'hôte : l'appel, aujourd'hui le seul
 * bloc de Trix. Les transitions du téléphone lui-même n'y sont pas ; elles
 * relèvent du diagnostic général (`ui/diagnostics.ts`), pas d'un échange
 * SIP. Rend une fonction qui débranche la trace.
 */
export function traceCallStates(m: Traceable, sink: TraceSink = consoleTraceSink): () => void {
  let from = where(m);
  let inside = inBlock(m);
  return m.subscribe((n) => {
    const to = where(n);
    const enters = inBlock(n);
    // l'entrée dans le bloc et son retour sont des transitions dont un seul
    // bout est dedans : les garder, ce sont les bornes de l'appel
    if ((inside || enters) && sipTraceEnabled()) {
      const ev = n.event ? `${n.event.type}: ` : "";
      const desc = n.desc ? ` "${n.desc}"` : "";
      const head = `${ev}(${from}) → (${to})${desc}`;
      recordFsm(head);
      sink.line(`${TAG} FSM ${head}`);
    }
    from = to;
    inside = enters;
  });
}

/** L'état courant, qualifié du bloc quand on est dedans — comme le journal de la machine. */
function where(p: Position): string {
  return p.sbb ? `${p.sbb.block}/${p.sbb.state}` : p.state;
}

function inBlock(p: Position): boolean {
  return p.sbb !== undefined;
}
