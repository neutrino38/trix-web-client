/**
 * Texte en temps réel **sur WebSocket** — le dialecte non standard des
 * passerelles déjà déployées (`../generique`, `WebRTComm.js`), repris ici
 * tel qu'il est parlé en production depuis des années.
 *
 * Ce n'est pas RFC 8865, et ce n'est pas non plus RFC 4103 : le flux
 * T.140 lui-même est intact — caractères, `U+0008`, `U+2028`, `BEL`,
 * `U+FFFD` —, seul le tuyau change. La passerelle annonce l'URL de son
 * socket dans la **réponse** SDP, sur une section `m=text` que nous avons
 * proposée :
 *
 * ```
 * offre    m=text 60000 TCP/WSS t140      (a=setup:active, a=connection:new)
 * réponse  m=text 60000 TCP/WSS t140      a=wss://passerelle.example.fr/rtt/42
 * ```
 *
 * Le socket ouvert, chaque message est un fragment du flux, sans
 * enveloppe : ni JSON, ni horodatage, ni numéro de séquence. C'est ce qui
 * rend la bascule avec le canal de données possible sans que rien au
 * dessus ne bouge.
 *
 * Ce module fait deux choses : les **retouches SDP** (fonctions pures,
 * testées comme `sdp.ts`) et le **fil** lui-même. Le branchement sur JsSIP
 * — qui appellera l'une puis l'autre — viendra avec le panneau de tchat.
 */

import type { RttWire, RttWireHooks } from "./rtt.js";

/**
 * Port annoncé dans l'offre. Il ne désigne rien : la passerelle répond
 * avec une URL, personne ne se connecte à ce port. Le SDP exige un nombre,
 * et l'implémentation historique écrit celui-ci — on ne dévie pas de ce
 * qu'elle a validé côté serveur.
 */
const TEXT_PORT = 60000;

/** Même raison : l'adresse de connexion de la section texte est symbolique. */
const TEXT_ADDRESS = "127.0.0.1";

/**
 * Un SDP découpé en ce qui précède le premier `m=` et ses sections média,
 * chacune gardée telle quelle : on n'interprète que ce qu'il faut, et on
 * ne réécrit jamais une ligne qu'on n'a pas comprise.
 */
interface SdpParts {
  head: string[];
  sections: string[][];
  eol: string;
}

function split(sdp: string): SdpParts {
  const parts: SdpParts = { head: [], sections: [], eol: sdp.includes("\r\n") ? "\r\n" : "\n" };
  for (const raw of sdp.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue; // la ligne vide finale se réécrit à la jointure
    if (line.startsWith("m=")) parts.sections.push([line]);
    else if (parts.sections.length === 0) parts.head.push(line);
    else parts.sections.at(-1)!.push(line);
  }
  return parts;
}

function join(parts: SdpParts): string {
  return [...parts.head, ...parts.sections.flat()].join(parts.eol) + parts.eol;
}

const isText = (section: string[]): boolean => section[0]!.startsWith("m=text");

/** La section `m=text` que nous proposons, prête à être insérée. */
function textSection(): string[] {
  return [
    `m=text ${TEXT_PORT} TCP/WSS t140`,
    `c=IN IP4 ${TEXT_ADDRESS}`,
    "a=setup:active",
    "a=connection:new",
    "a=sendrecv",
  ];
}

/**
 * Ajoute au SDP la section `m=text` qui demande le texte en temps réel,
 * ou rend le SDP inchangé s'il en porte déjà une — une renégociation
 * (ajout de vidéo, mise en attente) ne doit pas en empiler une deuxième.
 *
 * `at` place la section à un rang précis parmi les `m=` : c'est ce qu'il
 * faut pour **répondre** à une offre qui portait du texte, l'ordre des
 * sections d'une réponse devant être celui de l'offre (RFC 3264 §6). Sans
 * lui, la section va en fin de SDP — le cas de l'offre, où le rang est le
 * nôtre.
 */
export function withTextOverWs(sdp: string, at?: number | null): string {
  const parts = split(sdp);
  if (parts.sections.some(isText)) return sdp;
  const index = at ?? parts.sections.length;
  parts.sections.splice(Math.min(Math.max(index, 0), parts.sections.length), 0, textSection());
  return join(parts);
}

/**
 * Le même SDP **sans** sa section texte, et le rang qu'elle occupait.
 *
 * C'est la retouche qui rend tout le reste possible : le navigateur ne
 * connaît pas `m=text TCP/WSS`, et une description qui en porte une est
 * refusée par `setRemoteDescription` — ou, pire, décale le nombre de
 * sections entre l'offre qu'il a rédigée et la réponse qu'on lui rend. Le
 * texte est donc retiré de tout ce qui lui est présenté, et rajouté à
 * tout ce qui part sur le fil.
 */
export function stripTextSection(sdp: string): { sdp: string; at: number | null } {
  const parts = split(sdp);
  const at = parts.sections.findIndex(isText);
  if (at === -1) return { sdp, at: null };
  parts.sections.splice(at, 1);
  return { sdp: join(parts), at };
}

/**
 * L'URL du socket texte annoncée par un SDP distant, ou `null` si le
 * distant n'en offre pas — section absente, refusée (port 0), ou sans
 * attribut d'URL : l'appel a lieu, simplement sans texte.
 *
 * L'attribut s'écrit `a=ws:` ou `a=wss:` selon les passerelles, et ce qui
 * suit va de l'autorité seule à `//hôte/chemin`. Le schéma retenu est
 * **toujours `wss:`**, comme dans l'implémentation d'origine : le client
 * est servi en HTTPS, et un socket en clair y serait de toute façon
 * refusé par le navigateur.
 */
export function wsUrlFromSdp(sdp: string): string | null {
  const section = split(sdp).sections.find(isText);
  if (!section) return null;
  if (section[0]!.split(/\s+/)[1] === "0") return null;

  for (const line of section) {
    const match = /^a=wss?:(.*)$/i.exec(line);
    if (!match) continue;
    const value = match[1]?.trim() ?? "";
    if (value === "") continue;
    // ce qui reste peut porter son propre schéma (`a=ws:wss://…`) : seuls
    // l'autorité et le chemin nous intéressent
    return `wss://${value.replace(/^wss?:/i, "").replace(/^\/\//, "")}`;
  }
  return null;
}

/**
 * Nombre de reprises après une rupture, et délai entre deux essais.
 * Repris de l'implémentation historique : une coupure Wi-Fi de quelques
 * secondes ne doit pas coûter le lien texte d'un appel qui, lui, continue.
 */
const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 1000;

/** Marqueur de texte perdu, inséré à la reprise (T.140 §8.6). */
const LOSS_MARKER = "\uFFFD";

/**
 * Signature de session T.140, écrite en tête du flux sortant — comme le
 * canal de données le fait sur le sien (`sip/rttdc.ts`).
 *
 * Elle part **dès l'ouverture du socket**, avant tout caractère et avant
 * même le décrochage : c'est un octet qui ne dit rien et qui ouvre le
 * chemin du retour. La passerelle apprend par lui où renvoyer le texte du
 * distant — le *latching* dont dépend, en média précoce, l'arrivée d'une
 * annonce en texte temps réel (RFC 3960). Attendre le premier caractère
 * tapé reviendrait à faire dépendre la réception de l'émission, et pour un
 * appel où l'on n'écrit pas, à ne jamais rien recevoir.
 */
const SESSION_BOM = "\uFEFF";

/**
 * Ouvre le fil. La reconnexion est **silencieuse pour le canal** : il ne
 * voit que `lost` puis `open` — sauf que la reprise insère un `U+FFFD`
 * dans le flux reçu, parce que du texte distant a très probablement été
 * perdu pendant la coupure et que la norme veut que cela se voie
 * (RFC 8865 §6, T.140 §8.6).
 */
export function openWsWire(url: string, hooks: RttWireHooks): RttWire {
  let socket: WebSocket | null = null;
  let retries = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let closing = false;
  /** Une coupure a eu lieu : la prochaine ouverture n'est pas la première. */
  let interrupted = false;

  const connect = (): void => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      // URL rejetée par le navigateur : rien à reprendre, elle sera la
      // même au prochain essai
      hooks.state("closed");
      return;
    }
    socket = ws;

    ws.onopen = () => {
      retries = 0;
      // la signature ouvre le flux, et le chemin retour avec lui — y
      // compris sur un socket rouvert après coupure, dont la passerelle a
      // pu perdre l'association
      try {
        ws.send(SESSION_BOM);
      } catch {
        // socket refermé dans l'intervalle : `onclose` suit, la reprise
        // s'en chargera
      }
      if (interrupted) {
        interrupted = false;
        hooks.text(LOSS_MARKER);
      }
      hooks.state("open");
    };

    ws.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data === "string") hooks.text(ev.data);
    };

    // `onerror` ne dit rien qu'`onclose` ne redira : la reprise se décide
    // à la fermeture, qui suit toujours
    ws.onclose = () => {
      socket = null;
      if (closing) return;
      interrupted = true;
      if (retries >= MAX_RETRIES) {
        hooks.state("closed");
        return;
      }
      hooks.state("lost");
      retries++;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
      }, RETRY_DELAY_MS);
    };
  };

  connect();

  return {
    send(text) {
      // l'état du canal peut avoir une microtâche de retard sur le socket
      if (socket?.readyState === WebSocket.OPEN) socket.send(text);
    },
    close() {
      closing = true;
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      socket?.close();
      socket = null;
    },
  };
}
