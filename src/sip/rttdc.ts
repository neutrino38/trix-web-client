/**
 * Texte en temps réel **sur canal de données WebRTC** — RFC 8865, la
 * cible : c'est ce que parlent les clients T.140 standards, et cela ne
 * demande aucune passerelle.
 *
 * Le canal est **fiable et ordonné** (ni `maxRetransmits` ni
 * `maxPacketLifeTime`), de sous-protocole `t140` : la redondance de
 * RFC 4103 n'a pas lieu d'être ici, SCTP garantit déjà la livraison et
 * l'ordre. La signature de session `U+FEFF` ouvre le flux, comme la norme
 * le demande — le récepteur la consomme sans jamais l'afficher (c'est
 * l'affaire du codec, pas du tuyau).
 *
 * L'offrant crée le canal, le répondant attend celui d'en face
 * (RFC 8865 §5) : d'où le rôle passé à l'ouverture. Rien d'autre ne les
 * distingue.
 */

import type { RttWire, RttWireHooks } from "./rtt.js";

/** Label et sous-protocole du canal — les deux valent `t140` (RFC 8865 §5). */
export const T140_CHANNEL = "t140";

/** Signature de session T.140, écrite en tête du flux émis. */
const SESSION_BOM = "\uFEFF";

/**
 * Débit annoncé dans le SDP (`a=fmtp:… cps=30`), rappelé ici pour que la
 * valeur ne se perde pas entre le module qui l'écrit et celui qui la
 * respecte : trente caractères par seconde, la vitesse d'une frappe
 * soutenue.
 */
export const T140_CPS = 30;

/**
 * Ouvre le fil sur la connexion pair-à-pair de l'appel. La fermeture du
 * canal est **définitive** : SCTP ne perd pas de message en route, un
 * canal qui se ferme est un canal que le distant a fermé — ou une
 * connexion qui n'existe plus. Il n'y a donc rien à reprendre, à la
 * différence du WebSocket.
 */
export function openDcWire(
  connection: RTCPeerConnection,
  role: "offer" | "answer",
  hooks: RttWireHooks,
): RttWire {
  let channel: RTCDataChannel | null = null;
  let closed = false;

  /** Branche le canal, qu'on vienne de le créer ou de le recevoir. */
  const adopt = (dc: RTCDataChannel): void => {
    channel = dc;
    dc.onopen = () => {
      // la signature ouvre le flux : elle part avant tout caractère,
      // donc avant que le canal ne se déclare ouvert à son hôte
      dc.send(SESSION_BOM);
      hooks.state("open");
    };
    dc.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data === "string") hooks.text(ev.data);
    };
    dc.onclose = () => {
      channel = null;
      if (!closed) hooks.state("closed");
    };
    // une erreur sur un canal fiable ne laisse rien à reprendre
    dc.onerror = () => {
      if (!closed) hooks.state("closed");
    };
  };

  /** Le canal du distant, reconnu à son sous-protocole (à défaut, son label). */
  const onDataChannel = (ev: RTCDataChannelEvent): void => {
    if (channel !== null) return;
    const dc = ev.channel;
    if (dc.protocol !== T140_CHANNEL && dc.label !== T140_CHANNEL) return;
    adopt(dc);
  };

  if (role === "offer") {
    try {
      adopt(
        connection.createDataChannel(T140_CHANNEL, {
          ordered: true,
          protocol: T140_CHANNEL,
        }),
      );
    } catch {
      // connexion déjà fermée : l'appel continue, sans texte
      hooks.state("closed");
    }
  } else {
    connection.addEventListener("datachannel", onDataChannel);
  }

  return {
    send(text) {
      // l'état du canal peut avoir une microtâche de retard sur le nôtre
      if (channel?.readyState === "open") channel.send(text);
    },
    close() {
      closed = true;
      connection.removeEventListener("datachannel", onDataChannel);
      channel?.close();
      channel = null;
    },
  };
}
