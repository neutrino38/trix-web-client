/**
 * Trace des paquets SIP sur la console.
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
 */

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
  sink.group(`${TAG} SIP ${way} ${firstLine(text)}`);
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
