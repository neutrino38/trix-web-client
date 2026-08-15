/**
 * Lecture de l'offre SDP d'un INVITE entrant (docs/CONCEPTION.md §4.3).
 * Une seule question est posée au SDP : quels médias l'appelant
 * propose-t-il ? C'est elle qui décide des boutons de réponse offerts
 * (A/V, audio seul) — l'appel ne peut pas se répondre en vidéo si la
 * vidéo n'est pas proposée.
 *
 * Analyse volontairement minimale (RFC 4566 §5.7/§5.14, RFC 4566 §6
 * pour les attributs de direction) : un flux compte s'il a un port non
 * nul et n'est pas déclaré `inactive`. Tout le reste (codecs, ICE,
 * chiffrement) est l'affaire de JsSIP et du navigateur.
 */

import type { CallMedia } from "./port.js";

/** Offre illisible ou vide : on suppose de l'audio, le cas de très loin le plus courant. */
const AUDIO_ONLY: CallMedia = { audio: true, video: false };

type Direction = "sendrecv" | "sendonly" | "recvonly" | "inactive";

function directionOf(line: string): Direction | null {
  const v = line.slice(2);
  return v === "sendrecv" || v === "sendonly" || v === "recvonly" || v === "inactive" ? v : null;
}

export function offeredMedia(sdp: string | null | undefined): CallMedia {
  if (!sdp) return AUDIO_ONLY;

  const offered = { audio: false, video: false };
  // direction de session, appliquée aux flux qui n'en déclarent pas
  let sessionDir: Direction = "sendrecv";
  let inMedia = false;
  let kind: "audio" | "video" | null = null;
  let port = "0";
  let mediaDir: Direction | null = null;

  const flush = (): void => {
    if (kind && port !== "0" && (mediaDir ?? sessionDir) !== "inactive") offered[kind] = true;
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

  return offered.audio || offered.video ? offered : AUDIO_ONLY;
}
