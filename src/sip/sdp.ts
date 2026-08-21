/**
 * Lecture et retouche du SDP (docs/CONCEPTION.md §4.3, §4.4).
 *
 * Deux questions seulement sont posées au SDP, et une seule retouche lui
 * est faite :
 *
 * - **quels médias sont actifs ?** — sur l'offre d'un INVITE entrant, cela
 *   décide des boutons de réponse (`offeredMedia`) ; sur la réponse à
 *   notre INVITE ou à notre re-INVITE, cela dit ce que le distant a
 *   réellement accepté (`answeredMedia`). La règle est la même des deux
 *   côtés — un flux compte s'il a un port non nul et n'est pas déclaré
 *   `inactive` (RFC 4566 §5.7/§5.14, RFC 3264 §6) ;
 * - **refuser un flux vidéo** (`withoutVideo`) : répondre « audio seul » à
 *   une offre audio + vidéo, c'est *le dire dans la réponse*. Sans cela le
 *   navigateur répond `recvonly` — il ne capte pas d'image mais accepte
 *   d'en recevoir — et l'appelant continue d'émettre la sienne, ce qui
 *   n'est pas ce que l'appelé a demandé.
 *
 * S'y ajoute un **contrôle de recevabilité** de l'offre entrante
 * (`unsupportedOffer`) : ni un choix de codec ni une politique d'appel,
 * seulement les trois invariants sans lesquels aucune implémentation
 * WebRTC ne peut établir de session. Il sert à répondre 488 avant de
 * faire sonner (§4.3).
 *
 * Tout le reste (codecs, ICE, chiffrement) est l'affaire de JsSIP et du
 * navigateur.
 */

import type { CallMedia } from "./port.js";

/** Offre illisible ou vide : on suppose de l'audio, le cas de très loin le plus courant. */
const AUDIO_ONLY: CallMedia = { audio: true, video: false };

type Direction = "sendrecv" | "sendonly" | "recvonly" | "inactive";

function directionOf(line: string): Direction | null {
  const v = line.slice(2);
  return v === "sendrecv" || v === "sendonly" || v === "recvonly" || v === "inactive" ? v : null;
}

/**
 * Les médias qu'un SDP déclare actifs — commun à l'offre et à la réponse,
 * parce que la question est la même : ce flux est-il de la partie ?
 */
function activeMedia(sdp: string | null | undefined): CallMedia {
  if (!sdp) return AUDIO_ONLY;

  const active = { audio: false, video: false };
  // direction de session, appliquée aux flux qui n'en déclarent pas
  let sessionDir: Direction = "sendrecv";
  let inMedia = false;
  let kind: "audio" | "video" | null = null;
  let port = "0";
  let mediaDir: Direction | null = null;

  const flush = (): void => {
    if (kind && port !== "0" && (mediaDir ?? sessionDir) !== "inactive") active[kind] = true;
  };

  for (const raw of sdp.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("m=")) {
      flush();
      const [k, p] = line.slice(2).split(/\s+/);
      inMedia = true;
      kind = k === "audio" || k === "video" ? k : null;
      port = p ?? "0";
      mediaDir = null;
    } else if (line.startsWith("a=")) {
      const dir = directionOf(line);
      // avant le premier m=, la direction est celle de la session
      if (dir) {
        if (inMedia) mediaDir = dir;
        else sessionDir = dir;
      }
    }
  }
  flush();

  return active.audio || active.video ? active : AUDIO_ONLY;
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
 * Le même SDP, sa vidéo déclarée `inactive` — la façon RFC 3264 §6.1 de
 * répondre « pas de vidéo » sans rejeter la m-line, qui reste donc
 * disponible pour une escalade ultérieure (ajout de la vidéo en cours
 * d'appel, §4.4).
 *
 * Ne touche qu'aux sections `m=video` : les autres, audio comprise,
 * sortent inchangées, y compris leurs propres attributs de direction.
 * Une section vidéo qui n'en déclarait aucun s'en voit ajouter un — sans
 * quoi elle hériterait de la direction de session.
 */
export function withoutVideo(sdp: string): string {
  const eol = sdp.includes("\r\n") ? "\r\n" : "\n";
  const out: string[] = [];
  let inVideo = false;
  let declared = false;

  // la section vidéo se referme sur le m= suivant ou sur la fin du SDP :
  // c'est là qu'on ajoute la direction si elle n'en portait pas
  const closeVideo = (): void => {
    if (inVideo && !declared) out.push("a=inactive");
    inVideo = false;
    declared = false;
  };

  for (const raw of sdp.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("m=")) {
      closeVideo();
      inVideo = line.startsWith("m=video");
    }
    if (inVideo && directionOf(line)) {
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
  closeVideo();

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
 */
export function unsupportedOffer(sdp: string | null | undefined): string | null {
  if (!sdp || sdp.trim() === "") return null;

  let ice = false;
  let dtls = false;
  /** Profil du premier flux actif qui n'est pas chiffré — celui qu'on cite. */
  let clear: string | null = null;
  let streams = 0;
  let active = false;

  for (const raw of sdp.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("m=")) {
      const [kind, port, profile] = line.slice(2).split(/\s+/);
      if (kind !== "audio" && kind !== "video") continue;
      streams++;
      if (port === "0" || port === undefined) continue;
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
  // aucun flux audio ni vidéo : rien à répondre qui ressemble à un appel
  if (streams === 0 || !active) missing.push("m=audio/m=video");
  if (!ice) missing.push("ICE");
  if (!dtls) missing.push("DTLS");
  if (clear !== null) missing.push(`SRTP (${clear})`);

  return missing.length > 0 ? missing.join(", ") : null;
}
