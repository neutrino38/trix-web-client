/**
 * Lecture et retouche du SDP (docs/CONCEPTION.md §4.3, §4.4).
 *
 * Trois questions sont posées au SDP, et une seule retouche lui est faite :
 *
 * - **quels médias sont actifs ?** — sur l'offre d'un INVITE entrant, cela
 *   décide des boutons de réponse (`offeredMedia`) ; sur la réponse à
 *   notre INVITE ou à notre re-INVITE, cela dit ce que le distant a
 *   réellement accepté (`answeredMedia`). La règle est la même des deux
 *   côtés — un flux compte s'il a un port non nul et n'est pas déclaré
 *   `inactive` (RFC 4566 §5.7/§5.14, RFC 3264 §6) ;
 * - **refuser un flux** (`withoutMedia`) : répondre « audio seul » à une
 *   offre audio + vidéo, c'est *le dire dans la réponse*. Sans cela le
 *   navigateur répond `recvonly` — il ne capte pas d'image mais accepte
 *   d'en recevoir — et l'appelant continue d'émettre la sienne, ce qui
 *   n'est pas ce que l'appelé a demandé. La règle vaut pour les deux
 *   médias depuis l'ADR 0003 : répondre « texte seul » à une offre
 *   audio + texte pose exactement la même question, et laisserait sans
 *   cela l'appelant parler dans le vide.
 *
 * S'y ajoute, depuis le partage d'écran (ADR 0005), **laquelle des deux
 * images est un écran ?** — `sharedVideoMid`. Deux `m=video` ne le disent
 * pas d'elles-mêmes : c'est `a=content:slides` (RFC 4796) qui le dit, et
 * l'ordre des m-sections qui sert de repli. La réponse est un MID
 * (RFC 5888), parce que c'est la seule identité d'une m-section qui
 * survive à une renégociation.
 *
 * S'y ajoute un **contrôle de recevabilité** de l'offre entrante
 * (`unsupportedOffer`) : ni un choix de codec ni une politique d'appel,
 * seulement les invariants sans lesquels aucune implémentation WebRTC ne
 * peut établir de session — plus la question de savoir si une offre sans
 * audio ni vidéo porte du texte que ce poste sait lire. Il sert à répondre
 * 488 avant de faire sonner (§4.3).
 *
 * Tout le reste (codecs, ICE, chiffrement) est l'affaire de JsSIP et du
 * navigateur.
 */

import type { CallMedia, MediaKind } from "./port.js";
import type { RttTransport } from "./rtt.js";

/** Offre illisible ou vide : on suppose de l'audio, le cas de très loin le plus courant. */
const AUDIO_ONLY: CallMedia = { audio: true, video: false, text: false };

type Direction = "sendrecv" | "sendonly" | "recvonly" | "inactive";

function directionOf(line: string): Direction | null {
  const v = line.slice(2);
  return v === "sendrecv" || v === "sendonly" || v === "recvonly" || v === "inactive" ? v : null;
}

/**
 * Le transport texte qu'une ligne `m=` propose, ou `null` si elle n'en
 * propose aucun. Une forme par transport (§4.9) : le canal de données
 * WebRTC (`m=application … webrtc-datachannel`, RFC 8865) et la section
 * `m=text` des passerelles déployées.
 */
function textTransportOf(line: string): RttTransport | null {
  const [kind, , proto = "", ...fmt] = line.slice(2).split(/\s+/);
  if (kind === "text") return "websocket";
  if (kind !== "application") return null;
  return /SCTP/i.test(proto) || fmt.includes("webrtc-datachannel") ? "datachannel" : null;
}

/**
 * Les médias qu'un SDP déclare actifs — commun à l'offre et à la réponse,
 * parce que la question est la même : ce flux est-il de la partie ?
 *
 * `carries` est le transport texte de ce poste (§4.9) : une section texte
 * ne compte que si c'est **celle-là** qu'il sait ouvrir. Un `m=text` reçu
 * par un compte en canal de données n'offre pas de texte ici, et un compte
 * en `none` n'en voit jamais — d'où la valeur par défaut, qui laisse la
 * lecture d'un SDP quelconque répondre sur les deux seuls médias que tout
 * le monde partage.
 */
function activeMedia(
  sdp: string | null | undefined,
  carries: RttTransport = "none",
  /**
   * La m-section à ne pas compter, désignée par son `a=mid` — celle du
   * **partage d'écran** (ADR 0005, D3). Un écran partagé n'est pas un
   * média de l'appel : compté ici, il ferait dire « il a ajouté la vidéo »
   * à une offre qui n'a pas touché à la caméra.
   */
  ignoreMid: string | null = null,
): CallMedia {
  if (!sdp) return AUDIO_ONLY;

  const active: CallMedia = { audio: false, video: false, text: false };
  // direction de session, appliquée aux flux qui n'en déclarent pas
  let sessionDir: Direction = "sendrecv";
  let inMedia = false;
  let kind: "audio" | "video" | "text" | null = null;
  let port = "0";
  let mediaDir: Direction | null = null;
  let mid: string | null = null;

  const flush = (): void => {
    if (!kind || port === "0" || (mediaDir ?? sessionDir) === "inactive") return;
    if (ignoreMid !== null && mid === ignoreMid) return;
    active[kind] = true;
  };

  for (const raw of sdp.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("m=")) {
      flush();
      const [k, p] = line.slice(2).split(/\s+/);
      inMedia = true;
      kind = k === "audio" || k === "video" ? k : textTransportOf(line) === carries ? "text" : null;
      port = p ?? "0";
      mediaDir = null;
      mid = null;
    } else if (line.startsWith("a=")) {
      const dir = directionOf(line);
      // avant le premier m=, la direction est celle de la session
      if (dir) {
        if (inMedia) mediaDir = dir;
        else sessionDir = dir;
      } else if (line.startsWith("a=mid:")) {
        mid = line.slice("a=mid:".length).trim() || null;
      }
    }
  }
  flush();

  // rien du tout : offre illisible, pas un appel silencieux. Du texte seul,
  // en revanche, est bien un appel (§4.9) — et c'est ce que le profil 3a de
  // F.703 §7.2 appelle « text telephone service »
  return active.audio || active.video || active.text ? active : AUDIO_ONLY;
}

/**
 * Médias réellement proposés par l'offre SDP d'un INVITE entrant : c'est
 * elle qui décide des réponses offertes — l'appel ne peut pas se répondre
 * en vidéo si la vidéo n'est pas proposée.
 */
export const offeredMedia = activeMedia;

/**
 * Médias que le distant a acceptés, lus dans la réponse à notre offre.
 * Toujours un sous-ensemble de ce que nous avons proposé : c'est la
 * différence entre les deux qui se dit à l'écran (« Bob n'a pas accepté
 * la vidéo »).
 */
export const answeredMedia = activeMedia;

/**
 * Le même SDP, les médias nommés déclarés `inactive` — la façon RFC 3264
 * §6.1 de répondre « pas ce flux-là » sans rejeter la m-line, qui reste
 * donc disponible pour une escalade ultérieure (ajout du média en cours
 * d'appel, §4.4).
 *
 * Ne touche qu'aux sections nommées : les autres sortent inchangées, y
 * compris leurs propres attributs de direction — et la section texte n'est
 * jamais de la partie, puisque le texte ne se retire pas (ADR 0003, D4).
 * Une section qui ne déclarait aucune direction s'en voit ajouter une —
 * sans quoi elle hériterait de la direction de session.
 */
export function withoutMedia(sdp: string, kinds: readonly MediaKind[]): string {
  const eol = sdp.includes("\r\n") ? "\r\n" : "\n";
  const out: string[] = [];
  const muted = new Set<string>(kinds.map((k) => `m=${k}`));
  let inside = false;
  let declared = false;

  // la section se referme sur le m= suivant ou sur la fin du SDP : c'est là
  // qu'on ajoute la direction si elle n'en portait pas
  const close = (): void => {
    if (inside && !declared) out.push("a=inactive");
    inside = false;
    declared = false;
  };

  for (const raw of sdp.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("m=")) {
      close();
      inside = muted.has(line.slice(0, line.indexOf(" ")));
    }
    if (inside && directionOf(line)) {
      // une seule direction par section : les suivantes disparaissent
      if (!declared) out.push("a=inactive");
      declared = true;
      continue;
    }
    // la dernière ligne d'un SDP est vide (il se termine par un CRLF) :
    // elle ne doit pas s'intercaler avant l'attribut qu'on ajoute
    if (line === "") continue;
    out.push(line);
  }
  close();

  return out.join(eol) + eol;
}

/**
 * L'offre d'un INVITE entrant est-elle **hors de portée d'un navigateur** ?
 * Rend la liste des manques (« ICE, DTLS, SRTP (RTP/AVP) »), ou `null` si
 * rien ne s'y oppose.
 *
 * Ce n'est pas une réimplémentation de la validation du navigateur : c'est
 * le minimum vital, les trois choses qu'un UA SIP classique n'a pas et
 * qu'aucune pile WebRTC ne sait suppléer (RFC 8829 §5.9, RFC 8827) —
 *
 * - **ICE** : `a=ice-ufrag` et `a=ice-pwd`. Chrome refuse l'offre sur ce
 *   seul point (« Called with SDP without ice-ufrag and ice-pwd ») ;
 * - **DTLS** : `a=fingerprint`, sans quoi les clés SRTP ne peuvent pas
 *   s'échanger ;
 * - **SRTP** : un profil de transport `…SAVP`/`…SAVPF`. Le RTP en clair
 *   (`RTP/AVP`) n'existe pas en WebRTC.
 *
 * Les trois sont cherchés **où qu'ils soient** — au niveau session ou dans
 * n'importe quel flux actif : le but est de séparer une offre WebRTC d'une
 * offre qui ne l'est pas, pas de juger de leur placement. Un flux au port
 * nul est ignoré (il est rejeté ou `bundle-only`), et une offre sans SDP
 * du tout n'est pas jugée : l'offre viendra dans l'ACK (`late SDP`), c'est
 * l'affaire de JsSIP.
 *
 * S'y ajoute une quatrième question, qui n'est pas de WebRTC mais de nous :
 * **une offre sans audio ni vidéo est-elle un appel ?** Elle l'est si elle
 * porte du texte temps réel *et* que ce poste sait ouvrir ce lien-là —
 * c'est ce que dit `carries`, le transport texte du compte (§4.9). Un
 * appel texte seul reçu par un poste qui ne transporte pas le texte, ou
 * qui n'en transporte pas la forme proposée, serait un appel sans rien :
 * il se refuse avant de faire sonner, comme les trois autres.
 */
export function unsupportedOffer(
  sdp: string | null | undefined,
  carries: RttTransport = "none",
): string | null {
  if (!sdp || sdp.trim() === "") return null;

  let ice = false;
  let dtls = false;
  /** Profil du premier flux actif qui n'est pas chiffré — celui qu'on cite. */
  let clear: string | null = null;
  let active = false;
  /** Un flux de texte actif, du transport que ce poste sait ouvrir. */
  let text = false;

  for (const raw of sdp.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("m=")) {
      const [kind, port, profile] = line.slice(2).split(/\s+/);
      const dead = port === "0" || port === undefined;
      if (kind !== "audio" && kind !== "video") {
        if (!dead && textTransportOf(line) === carries) text = true;
        continue;
      }
      if (dead) continue;
      active = true;
      // « UDP/TLS/RTP/SAVPF », « RTP/SAVP »… : seul compte le chiffrement
      if (clear === null && !/SAVPF?$/.test(profile ?? "")) clear = profile ?? "?";
    } else if (line.startsWith("a=ice-ufrag:") || line.startsWith("a=ice-pwd:")) {
      ice = true;
    } else if (line.startsWith("a=fingerprint:")) {
      dtls = true;
    }
  }

  const missing: string[] = [];
  // ni parole, ni image, ni texte que nous sachions porter : rien à
  // répondre qui ressemble à un appel
  if (!active && !text) missing.push("m=audio/m=video");
  if (!ice) missing.push("ICE");
  if (!dtls) missing.push("DTLS");
  if (clear !== null) missing.push(`SRTP (${clear})`);

  return missing.length > 0 ? missing.join(", ") : null;
}

/**
 * Le MID (RFC 5888) de la m-section qui porte un **écran partagé**, ou
 * `null` si le SDP n'en décrit pas (ADR 0005, D4).
 *
 * Deux `m=video` dans un SDP ne disent pas d'elles-mêmes laquelle est le
 * visage et laquelle est l'écran : RFC 4796 définit l'attribut qui le dit,
 * et `slides` est la valeur que Trix pose sur son partage. Il est
 * **informatif** — un terminal qui l'ignore n'échoue pas —, d'où le repli.
 *
 * La lecture, dans l'ordre :
 *
 * 1. la première `m=video` active portant `a=content:slides` ;
 * 2. à défaut, la **seconde** `m=video` active. C'est le repli pour les
 *    terminaux qui ne posent pas l'attribut, et il suffit dans le cas
 *    courant — un appel n'a qu'une caméra, et elle vient en premier.
 *
 * L'ordre ne peut pas remplacer l'attribut dans l'autre sens : un appel
 * audio auquel on ajoute un partage sans jamais avoir eu de caméra a son
 * partage en **première** `m=video`, et seul `a=content` le dit.
 *
 * Rend `null` quand la section trouvée n'a pas de `a=mid` : sans identité,
 * elle n'est pas suivable d'une renégociation à la suivante, et le port ne
 * saurait de toute façon rien en faire.
 */
export function sharedVideoMid(sdp: string | null | undefined): string | null {
  if (!sdp) return null;

  /** Les `m=video` actives, dans l'ordre du SDP. */
  const videos: { mid: string | null; slides: boolean }[] = [];
  let sessionDir: Direction = "sendrecv";
  let inMedia = false;
  let video = false;
  let port = "0";
  let mediaDir: Direction | null = null;
  let mid: string | null = null;
  let slides = false;

  const flush = (): void => {
    if (!video || port === "0" || (mediaDir ?? sessionDir) === "inactive") return;
    videos.push({ mid, slides });
  };

  for (const raw of sdp.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("m=")) {
      flush();
      const [k, p] = line.slice(2).split(/\s+/);
      inMedia = true;
      video = k === "video";
      port = p ?? "0";
      mediaDir = null;
      mid = null;
      slides = false;
    } else if (line.startsWith("a=")) {
      const dir = directionOf(line);
      if (dir) {
        if (inMedia) mediaDir = dir;
        else sessionDir = dir;
      } else if (line.startsWith("a=mid:")) {
        mid = line.slice("a=mid:".length).trim() || null;
      } else if (line.startsWith("a=content:")) {
        // RFC 4796 §5 : une liste de valeurs séparées par des virgules
        slides = line
          .slice("a=content:".length)
          .split(",")
          .some((v) => v.trim() === "slides");
      }
    }
  }
  flush();

  const marked = videos.find((v) => v.slides);
  return marked ? marked.mid : (videos[1]?.mid ?? null);
}

/**
 * Le même SDP, la m-section de ce MID marquée `a=content:slides`
 * (RFC 4796) — **la seule écriture que Trix fasse dans une offre**
 * (ADR 0005, D4).
 *
 * Le navigateur n'écrit pas `a=content` : rien dans WebRTC ne distingue
 * l'écran du visage, et sans cet attribut le correspondant n'aurait que
 * l'ordre des m-sections pour deviner — ce qui ne suffit pas quand le
 * partage arrive dans un appel qui n'a jamais eu de caméra.
 *
 * La caméra, elle, ne reçoit **pas** de `a=content:main` : ce serait
 * retoucher une m-section qui fonctionne aujourd'hui contre des
 * passerelles qu'on ne maîtrise pas, pour un gain nul.
 *
 * Sans effet si le MID est introuvable, ou si la section porte déjà un
 * `a=content` — le sien vaut mieux que le nôtre.
 */
export function withSharedVideo(sdp: string, mid: string): string {
  const eol = sdp.includes("\r\n") ? "\r\n" : "\n";
  const out: string[] = [];
  /** La section courante, retenue le temps de savoir si c'est la bonne. */
  let section: string[] | null = null;
  let found = false;
  let marked = false;

  const close = (): void => {
    if (!section) return;
    // l'attribut se pose juste après le `a=mid`, là où il se lit
    if (found && !marked) {
      const at = section.findIndex((l) => l.startsWith("a=mid:"));
      section.splice(at + 1, 0, "a=content:slides");
    }
    out.push(...section);
    section = null;
    found = false;
    marked = false;
  };

  for (const raw of sdp.split(/\r?\n/)) {
    const line = raw.trim();
    // la dernière ligne d'un SDP est vide : elle ne doit pas s'intercaler
    if (line === "") continue;
    if (line.startsWith("m=")) {
      close();
      section = [];
    }
    if (!section) {
      out.push(line);
      continue;
    }
    if (line === `a=mid:${mid}`) found = true;
    if (line.startsWith("a=content:")) marked = true;
    section.push(line);
  }
  close();

  return out.join(eol) + eol;
}

/**
 * La m-section de ce MID est-elle active dans ce SDP ? C'est ainsi que se
 * lit le **refus poli** d'un partage : un 200 OK dont la m-section de
 * l'écran est déclarée `inactive` (RFC 3264 §6.1) — le distant a accepté
 * la renégociation, pas ce qu'elle proposait.
 *
 * Rend `false` pour un MID introuvable : une m-section absente de la
 * réponse n'est pas une m-section acceptée.
 */
export function midActive(sdp: string | null | undefined, mid: string): boolean {
  if (!sdp) return false;

  let sessionDir: Direction = "sendrecv";
  let inMedia = false;
  let alive = false;
  let mediaDir: Direction | null = null;
  let hit = false;
  let answer = false;

  const flush = (): void => {
    if (hit) answer = alive && (mediaDir ?? sessionDir) !== "inactive";
  };

  for (const raw of sdp.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("m=")) {
      flush();
      inMedia = true;
      hit = false;
      alive = (line.slice(2).split(/\s+/)[1] ?? "0") !== "0";
      mediaDir = null;
    } else if (line.startsWith("a=")) {
      const dir = directionOf(line);
      if (dir) {
        if (inMedia) mediaDir = dir;
        else sessionDir = dir;
      } else if (line === `a=mid:${mid}`) {
        hit = true;
      }
    }
  }
  flush();

  return answer;
}
