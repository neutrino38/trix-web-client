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
 *
 * Comme le canal de données, le fil **dit ses pannes à voix haute** — une
 * ligne de console et une ligne au carnet de l'appel (`sip/mediaerror.ts`),
 * que la trace SIP soit cochée ou non. La rupture d'un socket ne laisse
 * aucune trace SIP : elle a lieu sur un fil parallèle, dont la
 * signalisation ne sait rien une fois l'URL lue dans la réponse.
 */

import type { RttWire, RttWireHooks } from "./rtt.js";
import { consoleErrorSink, reportTextChannelError, type ErrorSink } from "./mediaerror.js";

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

/**
 * Délai au-delà duquel un socket qui n'est toujours pas ouvert est signalé.
 *
 * Une connexion refusée se ferme d'elle-même — `onclose`, code 1006 — et
 * n'a pas besoin de ce délai. Celui-ci est pour l'autre panne, celle qui
 * n'émet rien : la passerelle qui accepte le TCP et ne répond jamais à la
 * poignée de main WebSocket, où le navigateur peut attendre des minutes
 * avant de conclure. Dix secondes suffisent à un socket qui va s'ouvrir —
 * l'URL est lue dans la réponse SDP, la connexion part aussitôt, elle
 * n'attend aucun décrochage.
 */
const OPEN_DEADLINE_MS = 10000;

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
export function openWsWire(
  url: string,
  hooks: RttWireHooks,
  sink: ErrorSink = consoleErrorSink,
): RttWire {
  let socket: WebSocket | null = null;
  let retries = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let closing = false;
  /** Une coupure a eu lieu : la prochaine ouverture n'est pas la première. */
  let interrupted = false;
  /** Le socket en cours s'est-il ouvert ? Distingue la rupture de l'échec. */
  let opened = false;
  /** Le délai d'ouverture, et le fait qu'il n'ait à parler qu'une fois. */
  let deadline: ReturnType<typeof setTimeout> | null = null;
  let hangSaid = false;

  /**
   * Dit la panne — console et carnet, sans condition. `notes` porte ce que
   * l'événement de fermeture ne dit pas et qu'on veut relire au support :
   * quel socket, et combien de reprises avaient déjà été tentées.
   */
  const fail = (problem: string, notes: Record<string, string | number> = {}): void => {
    reportTextChannelError(
      { problem, notes: { transport: "websocket", socket: url, reprises: retries, ...notes } },
      sink,
    );
  };

  const disarm = (): void => {
    if (deadline === null) return;
    clearTimeout(deadline);
    deadline = null;
  };

  const arm = (): void => {
    disarm();
    deadline = setTimeout(() => {
      deadline = null;
      if (closing || hangSaid || socket?.readyState === WebSocket.OPEN) return;
      hangSaid = true; // une fois suffit : les reprises diraient la même chose
      fail(`socket toujours pas ouvert ${OPEN_DEADLINE_MS / 1000} s après la demande`);
    }, OPEN_DEADLINE_MS);
  };

  const connect = (): void => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (error) {
      // URL rejetée par le navigateur : rien à reprendre, elle sera la
      // même au prochain essai
      reportTextChannelError(
        { problem: "ouverture du socket impossible", error, notes: { socket: url } },
        sink,
      );
      hooks.state("closed");
      return;
    }
    socket = ws;
    opened = false;
    arm();

    ws.onopen = () => {
      retries = 0;
      opened = true;
      disarm();
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
    ws.onclose = (ev: CloseEvent) => {
      socket = null;
      disarm();
      if (closing) return;
      interrupted = true;
      const why = closeFacts(ev, opened);
      // **la première panne de la série, et l'abandon.** Les huit reprises
      // du milieu rediraient mot pour mot la même chose : ce qui compte est
      // que le fil ait rompu, et comment cela a fini
      if (retries === 0) fail(why.problem, why.notes);
      if (retries >= MAX_RETRIES) {
        const gaveUp = `socket irrécupérable, abandon après ${MAX_RETRIES} reprises`;
        fail(`${gaveUp}${why.suffix}`, why.notes);
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
      disarm();
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      socket?.close();
      socket = null;
    },
  };
}

/**
 * Ce que dit un événement de fermeture. Le code est la seule chose qui
 * distingue une passerelle qui raccroche proprement (1000) d'un fil coupé
 * en route (1006) : il va donc dans l'entête, où il se lit sans rien
 * déplier. Le motif et la propreté suivent en notes, souvent vides, jamais
 * inutiles quand ils ne le sont pas.
 *
 * **Le certificat du serveur.** La RFC 6455 §7.4.1 réserve le code 1015
 * pour une poignée de main TLS échouée — certificat invalide, expiré, ou
 * autorité inconnue — mais interdit du même souffle de le remonter à
 * l'application : les navigateurs ferment sur **1006**, sans motif. Un
 * certificat expiré, un DNS mort et un port fermé y sont donc
 * indistinguables, et il n'existe aucun détour (une sonde HTTPS vers la
 * même origine serait de toute façon refusée par la CSP de production,
 * `connect-src 'self' wss:`). Ce qui est écrit est donc ce qui est su : un
 * socket qui n'a **jamais** été ouvert nomme les trois causes possibles, le
 * certificat en tête, et laisse le lecteur trancher avec ce que, lui, peut
 * aller voir. Le 1015 reste traité pour la pile qui le remonterait quand
 * même — un mandataire, un portage non navigateur.
 */
function closeFacts(
  ev: CloseEvent,
  opened: boolean,
): { problem: string; suffix: string; notes: Record<string, string | number> } {
  const code = typeof ev?.code === "number" ? ev.code : null;
  const suffix = code === null ? "" : ` (code ${code})`;
  const notes: Record<string, string | number> = {};
  if (typeof ev?.reason === "string" && ev.reason !== "") notes["motif"] = ev.reason;
  if (typeof ev?.wasClean === "boolean") notes["wasClean"] = String(ev.wasClean);

  if (code === 1015) {
    const tls = "poignée de main TLS échouée : certificat du serveur invalide ou expiré";
    return { problem: `${tls}${suffix}`, suffix, notes };
  }
  if (!opened) {
    notes["causes possibles"] =
      "certificat du serveur invalide ou expiré, hôte injoignable, " +
      "ou socket refusé — le navigateur ne les distingue pas";
    return { problem: `connexion au socket refusée${suffix}`, suffix, notes };
  }
  return { problem: `socket rompu${suffix}`, suffix, notes };
}
