/**
 * T.140 codec: **the protocol, and no DOM** (docs/CONCEPTION.md §4.9).
 *
 * Two jobs, both pure — so both testable like `sdp.ts` or `ice.ts`:
 *
 * - **decoding** an incoming stream into events (text, erasure, end of
 *   bubble, alert, display attributes, lost text). The stream arrives in
 *   fragments whose boundaries mean nothing (RFC 8865 §5.2), so a command
 *   sequence may be cut in two: the decoder keeps what it cannot yet read
 *   and resumes on the next fragment;
 * - **the outgoing differential**: what to erase and what to type again to
 *   go from what has already left to what the field now shows. T.140 only
 *   erases from the end, and it erases whole graphemes (§8.2).
 *
 * What this module never does is decide what the thread looks like: the
 * bubbles, the caret and the notes belong to the panel
 * (`ui/screens/call/chat.ts`), and the pipe belongs to `sip/rtt.ts`.
 *
 * Received colours are **remapped onto the theme palette, never applied as
 * they came**. T.140 §8.8 explicitly leaves the receiver in charge, and it
 * has to: a `31` painted as `#FF0000` would be a peer choosing the colours
 * of our dark theme for us.
 */

/**
 * The command codes, never written as literal control characters in this
 * file: a raw C0/C1 byte copied into a source file does not always survive
 * the trip through editors, patches and terminals.
 */
export const T140 = {
  /** Session signature and synchronisation — consumed, never displayed. */
  BOM: "\u{FEFF}",
  /** Backspace: erases one whole grapheme. */
  BS: "\u{0008}",
  /** Line separator: freezes the live bubble (the preferred code). */
  LS: "\u{2028}",
  CR: "\u{000D}",
  LF: "\u{000A}",
  /** In-session alert. */
  BEL: "\u{0007}",
  ESC: "\u{001B}",
  /** Control sequence introducer, 8-bit form. */
  CSI: "\u{009B}",
  /** Start of string — protocol extension, swallowed whole. */
  SOS: "\u{0098}",
  /** String terminator. */
  ST: "\u{009C}",
  /** Missing text marker (RFC 8865 §5.4). */
  LOST: "\u{FFFD}",
} as const;

/**
 * Display attributes, as SGR gives them and as the panel applies them.
 * Absolute state, never a delta: an `attrs` event carries everything that
 * holds from that point on, so a bubble can be rebuilt from its runs alone.
 */
export interface T140Attrs {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** CSS colour, already taken from the theme palette. */
  color?: string;
  background?: string;
}

/** What one pass of the decoder reports, in stream order. */
export type T140Event =
  | { type: "text"; text: string }
  | { type: "erase" }
  /** Line separator: the live bubble freezes. */
  | { type: "break" }
  | { type: "alert" }
  | { type: "attrs"; attrs: T140Attrs }
  | { type: "lost" };

// ---------------------------------------------------------------------------
// Graphèmes
// ---------------------------------------------------------------------------

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

/**
 * The units T.140 counts in — one emoji, one accented letter composed of
 * two code points, one Devanagari cluster: **one grapheme**, therefore one
 * backspace (§8.2). Counting in UTF-16 units instead is the classic bug of
 * the domain, and it leaves half a character behind.
 */
export function graphemes(text: string): string[] {
  if (text === "") return [];
  return segmenter ? [...segmenter.segment(text)].map((s) => s.segment) : Array.from(text);
}

export function graphemeCount(text: string): number {
  return graphemes(text).length;
}

/** The string without its last grapheme — `""` gives `""`. */
export function dropLastGrapheme(text: string): string {
  const last = graphemes(text).at(-1);
  return last === undefined ? "" : text.slice(0, -last.length);
}

// ---------------------------------------------------------------------------
// Attributs reçus : SGR remappé sur la palette du thème
// ---------------------------------------------------------------------------

/**
 * The eight ANSI colours, read as *intentions* and rendered in the theme's
 * own ink. The bright range (90–97) maps to the same entries: once remapped
 * onto a palette that has one red, "bright red" no longer means anything —
 * and inventing a second red that no theme defines would only produce a
 * colour that fails contrast on one of the two backgrounds.
 */
const FG: Record<number, string> = {
  30: "var(--ink)",
  31: "var(--red)",
  32: "var(--green)",
  33: "var(--orange)",
  34: "var(--t140-blue)",
  35: "var(--accent)",
  36: "var(--t140-cyan)",
  37: "var(--ink-soft)",
};

/**
 * Backgrounds are the same hues, heavily diluted: a peer painting a full
 * `41` behind its text must not make it unreadable on either theme. The
 * text colour is ours, the wash is theirs.
 */
function wash(color: string): string {
  return `color-mix(in srgb, ${color} 22%, transparent)`;
}

/** Applique un paramètre SGR à l'état courant ; rend l'état suivant. */
function applySgr(attrs: T140Attrs, ps: number): T140Attrs {
  const next = { ...attrs };
  if (ps === 0) return {};
  if (ps === 1) next.bold = true;
  else if (ps === 3) next.italic = true;
  else if (ps === 4) next.underline = true;
  else if (ps === 22) delete next.bold;
  else if (ps === 23) delete next.italic;
  else if (ps === 24) delete next.underline;
  else if (ps === 39) delete next.color;
  else if (ps === 49) delete next.background;
  else if (FG[ps]) next.color = FG[ps];
  else if (ps >= 90 && ps <= 97 && FG[ps - 60]) next.color = FG[ps - 60];
  else if (ps >= 40 && ps <= 47 && FG[ps - 10]) next.background = wash(FG[ps - 10]!);
  else if (ps >= 100 && ps <= 107 && FG[ps - 70]) next.background = wash(FG[ps - 70]!);
  // tout autre paramètre est ignoré, et le flux continue (RFC 8865 §5.2)
  return next;
}

// ---------------------------------------------------------------------------
// Décodage
// ---------------------------------------------------------------------------

/**
 * What we agree to hold on to while waiting for the end of a cut sequence.
 * Past that, we give up on it and read the rest as text: a peer that opens
 * an extension and never closes it must not be able to freeze the display
 * for good.
 */
const MAX_PENDING = 4096;

export interface T140Decoder {
  /** Décode un fragment. Les événements sortent dans l'ordre du flux. */
  feed(chunk: string): T140Event[];
  /** Les attributs courants — état absolu, tel que le dernier SGR l'a laissé. */
  attrs(): T140Attrs;
  /** Ce qui attend la suite d'une séquence coupée (diagnostic et tests). */
  pending(): string;
}

/** Un caractère de commande C0/C1 qui n'a aucun sens en T.140 : filtré. */
function isNoise(ch: string): boolean {
  const c = ch.codePointAt(0)!;
  return c < 0x20 || c === 0x7f || (c >= 0x80 && c <= 0x9f);
}

/** Fin d'une séquence de contrôle : premier octet dans 0x40–0x7E. */
function finalByte(buf: string, from: number): number {
  for (let i = from; i < buf.length; i++) {
    const c = buf.charCodeAt(i);
    if (c >= 0x40 && c <= 0x7e) return i;
  }
  return -1;
}

/**
 * A decoder per correspondent — T.140 carries no source indication, so one
 * stream is one voice, and its attribute state belongs to it alone.
 *
 * Everything unknown is text (§8.1), everything unreadable is dropped
 * rather than shown: a stray `U+0000` on the wire is not a character the
 * peer typed.
 */
export function t140Decoder(): T140Decoder {
  let attrs: T140Attrs = {};
  let pending = "";

  return {
    attrs: () => attrs,
    pending: () => pending,

    feed(chunk) {
      const buf = pending + chunk;
      pending = "";
      const out: T140Event[] = [];
      let text = "";
      const flush = (): void => {
        if (text !== "") {
          out.push({ type: "text", text });
          text = "";
        }
      };

      let i = 0;
      while (i < buf.length) {
        const ch = buf[i]!;

        // signature de session : consommée, jamais affichée
        if (ch === T140.BOM) {
          i += 1;
          continue;
        }
        if (ch === T140.BS) {
          flush();
          out.push({ type: "erase" });
          i += 1;
          continue;
        }
        if (ch === T140.LS || ch === T140.LF) {
          flush();
          out.push({ type: "break" });
          i += 1;
          continue;
        }
        // `CR` seul en fin de fragment : le `LF` qui en ferait une paire est
        // peut-être dans le fragment suivant — deux bulles au lieu d'une
        // seraient un séparateur inventé
        if (ch === T140.CR) {
          if (i === buf.length - 1) {
            pending = T140.CR;
            break;
          }
          flush();
          out.push({ type: "break" });
          i += buf[i + 1] === T140.LF ? 2 : 1;
          continue;
        }
        if (ch === T140.BEL) {
          flush();
          out.push({ type: "alert" });
          i += 1;
          continue;
        }
        if (ch === T140.LOST) {
          flush();
          out.push({ type: "lost" });
          i += 1;
          continue;
        }

        // séquences de contrôle, formes 8 bits et 7 bits acceptées : nous
        // sommes tolérants en réception, et n'émettons aucune des deux
        const csi = ch === T140.CSI || (ch === T140.ESC && buf[i + 1] === "[");
        const sos = ch === T140.SOS || (ch === T140.ESC && buf[i + 1] === "X");
        if (csi) {
          const start = i + (ch === T140.CSI ? 1 : 2);
          const end = finalByte(buf, start);
          if (end === -1) {
            pending = buf.slice(i);
            break;
          }
          flush();
          if (buf[end] === "m") {
            // `CSI m` sans paramètre vaut `CSI 0 m` (remise à zéro)
            const body = buf.slice(start, end);
            for (const p of (body === "" ? "0" : body).split(";")) {
              attrs = applySgr(attrs, Number(p) || 0);
            }
            out.push({ type: "attrs", attrs: { ...attrs } });
          }
          // toute autre finale : séquence avalée, rien ne s'affiche
          i = end + 1;
          continue;
        }
        if (sos) {
          const start = i + (ch === T140.SOS ? 1 : 2);
          let end = buf.indexOf(T140.ST, start);
          let width = 1;
          const esc7 = buf.indexOf(`${T140.ESC}\\`, start);
          if (end === -1 || (esc7 !== -1 && esc7 < end)) {
            if (esc7 !== -1) {
              end = esc7;
              width = 2;
            }
          }
          if (end === -1) {
            pending = buf.slice(i);
            break;
          }
          flush();
          i = end + width;
          continue;
        }
        // `ESC` seul en fin de fragment : sa deuxième moitié suit peut-être
        if (ch === T140.ESC) {
          if (i === buf.length - 1) {
            pending = T140.ESC;
            break;
          }
          // interruption (`ESC 0x61`) et compagnie : Trix n'a pas de bascule
          // de mode, la séquence est ignorée en entier
          i += 2;
          continue;
        }

        if (isNoise(ch)) {
          i += 1;
          continue;
        }

        // tout ce qui n'est pas une commande **est** du texte (§8.1)
        text += ch;
        i += 1;
      }

      flush();
      if (pending.length > MAX_PENDING) pending = "";
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
// Émission : le différentiel
// ---------------------------------------------------------------------------

/**
 * How the field moved, seen from the wire:
 *
 * - `same` — nothing to send;
 * - `append` — written at the end: the suffix leaves at once;
 * - `erase` — erased from the end: the backspaces leave at once;
 * - `rewrite` — edited in the middle: the protocol can only get there by
 *   walking back to the divergence, which is why the panel waits two
 *   seconds of silence first (§4.9).
 */
export type T140EditKind = "same" | "append" | "erase" | "rewrite";

export interface T140Edit {
  kind: T140EditKind;
  /** Graphèmes à effacer par la fin. */
  back: number;
  /** Texte à retaper ensuite. */
  add: string;
}

/**
 * What it costs to go from what has **left** to what the field **shows**,
 * counted in graphemes: the longest common prefix stays, the rest is erased
 * and typed again.
 */
export function t140Edit(sent: string, shown: string): T140Edit {
  if (shown === sent) return { kind: "same", back: 0, add: "" };
  // Écriture à la fin, mesurée en **unités** et non en graphèmes : taper un
  // accent combinant après sa lettre allonge le dernier graphème sans rien
  // effacer, et le suffixe seul suffit à reproduire la chaîne chez le
  // correspondant. Le mesurer en graphèmes y verrait une correction au
  // milieu, et ferait attendre deux secondes une frappe ordinaire.
  if (shown.startsWith(sent)) {
    return { kind: "append", back: 0, add: shown.slice(sent.length) };
  }
  const a = graphemes(sent);
  const b = graphemes(shown);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  const back = a.length - i;
  const add = b.slice(i).join("");
  return { kind: add === "" ? "erase" : "rewrite", back, add };
}

/**
 * Text on its way to the field, cleaned of what a bubble cannot hold.
 *
 * A bubble has no line break: the protocol's only separator is the one that
 * closes it, so a ten-line paste would freeze ten bubbles. Newlines become a
 * single space — and the command codes a paste might carry are dropped
 * rather than sent: we never emit any.
 */
export function sanitizeOutgoing(text: string): string {
  const flat = text.replace(/\r\n|[\r\n\u2028\u2029]/g, " ");
  return [...flat]
    .filter((ch) => !isNoise(ch) && ch !== T140.BOM && ch !== T140.LOST)
    .join("");
}
