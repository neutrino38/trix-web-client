/**
 * Le **retour d'appel** de l'appelant (ADR 0003 §4 — F.703 §6.1.2).
 *
 * La norme demande que la progression de l'appel soit annoncée par des
 * signaux visuels *et* sonores. Le visuel existait ; le son, non — un appel
 * SIP ne transporte rien avant le 200 OK, sauf média précoce (RFC 3960).
 *
 * Ce qui se vérifie ici est la règle du silence, et elle ne se lit pas dans
 * le typage : la tonalité locale se tait quand le réseau **parle**, jamais
 * quand il se contente d'émettre. Un accueil en langue des signes ou en
 * texte temps réel — le cas normal du public de Trix — ne remplit aucun
 * silence : couper la tonalité y laisserait l'appelant devant une ligne
 * qu'il croirait morte.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { callLabel, ringbackNeeded } from "../src/ui/screens/call/parts.js";
import type { CallView } from "../src/machines/events.js";
import type { CallMedia } from "../src/sip/port.js";
import { useLocale } from "../src/i18n/index.js";

beforeAll(async () => {
  await useLocale("fr");
});

const NONE: CallMedia = { audio: false, video: false, text: false };

function view(state: CallView["state"], earlyMedia: CallMedia = NONE): CallView {
  return {
    state,
    direction: "outgoing",
    target: "sip:bob@example.fr",
    displayName: null,
    offered: { audio: true, video: false, text: false },
    media: { audio: true, video: false, text: false },
    selfViewHidden: false,
    mediaPending: false,
    mediaAsked: null,
    paused: false,
    sharing: "off" as const,
    peerPaused: false,
    dtmfSent: "",
    notice: null,
    earlyMedia,
    connectedAt: null,
    endedBy: null,
    session: null,
  };
}

describe("retour d'appel sonore", () => {
  it("sonne pendant la sonnerie, et nulle part ailleurs", () => {
    expect(ringbackNeeded(view("ringing"))).toBe(true);
    for (const state of ["dialing", "answering", "connected", "hangingup", "ringing_in"] as const) {
      expect(ringbackNeeded(view(state))).toBe(false);
    }
  });

  it("se tait dès que le réseau envoie du son", () => {
    expect(ringbackNeeded(view("early_media", { audio: true, video: false, text: false }))).toBe(
      false,
    );
    // une annonce parlée doublée d'image : le son est là, cela suffit
    expect(ringbackNeeded(view("early_media", { audio: true, video: true, text: false }))).toBe(
      false,
    );
  });

  it("continue quand l'accueil est signé ou écrit : rien ne comble le silence", () => {
    expect(ringbackNeeded(view("early_media", { audio: false, video: true, text: false }))).toBe(
      true,
    );
    expect(ringbackNeeded(view("early_media", { audio: false, video: false, text: true }))).toBe(
      true,
    );
  });

  it("le média précoce se dit à l'écran : un son que rien ne montre n'existe pas", () => {
    // même raisonnement que les DTMF (§4.8) — l'application s'adresse
    // d'abord à des personnes sourdes, qui n'entendront jamais l'annonce
    expect(callLabel("early_media")).toBe("Message du réseau");
    expect(callLabel("early_media")).not.toBe(callLabel("ringing"));
  });
});
