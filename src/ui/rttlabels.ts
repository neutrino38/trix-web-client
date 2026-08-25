/**
 * Libellés des transports du texte en temps réel. La liste elle-même vit
 * dans `sip/rtt.ts` : en ajouter un se voit à la compilation ici, faute de
 * clé — aucun écran ne peut en oublier un en silence.
 *
 * Dans un module à part parce que deux écrans les lisent : le formulaire de
 * paramètres, qui les propose, et la page de partage, qui montre celui que
 * le lien transporte. Cette page-là n'embarque ni automate ni pile SIP, et
 * il n'était pas question qu'elle importe le formulaire pour trois chaînes.
 */

import type { RttTransport } from "../sip/rtt.js";
import type { MsgKey } from "../i18n/types.js";

export const RTT_LABELS: Record<RttTransport, { label: MsgKey; desc: MsgKey }> = {
  none: { label: "config.rttNone", desc: "config.rttNoneDesc" },
  websocket: { label: "config.rttWs", desc: "config.rttWsDesc" },
  datachannel: { label: "config.rttDc", desc: "config.rttDcDesc" },
};
