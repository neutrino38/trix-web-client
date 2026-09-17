/**
 * Lecture de l'offre SDP entrante — c'est elle qui décide des réponses
 * proposées à l'utilisateur (docs/CONCEPTION.md §4.3) — et refus de la
 * vidéo dans la réponse, quand on décroche en audio seul (§4.4).
 */
import { describe, expect, it } from "vitest";
import {
  midActive,
  offeredMedia,
  sharedVideoMid,
  unsupportedOffer,
  withSharedVideo,
  withoutMedia,
} from "../src/sip/sdp.js";

const head = ["v=0", "o=- 1 1 IN IP4 192.0.2.1", "s=-", "c=IN IP4 192.0.2.1", "t=0 0"];

function sdp(...media: string[]): string {
  return [...head, ...media].join("\r\n");
}

describe("offeredMedia", () => {
  it("audio seul", () => {
    expect(offeredMedia(sdp("m=audio 49170 RTP/AVP 0 8", "a=sendrecv"))).toEqual({
      audio: true,
      video: false,
      text: false,
    });
  });

  it("audio + vidéo", () => {
    expect(
      offeredMedia(sdp("m=audio 49170 RTP/AVP 0", "m=video 51372 RTP/AVP 96", "a=sendrecv")),
    ).toEqual({ audio: true, video: true, text: false });
  });

  it("vidéo seule", () => {
    expect(offeredMedia(sdp("m=video 51372 RTP/AVP 96"))).toEqual({ audio: false, video: true, text: false });
  });

  it("flux refusé (port 0) : ignoré", () => {
    expect(offeredMedia(sdp("m=audio 49170 RTP/AVP 0", "m=video 0 RTP/AVP 96"))).toEqual({
      audio: true,
      video: false,
      text: false,
    });
  });

  it("flux inactif : ignoré", () => {
    expect(
      offeredMedia(sdp("m=audio 49170 RTP/AVP 0", "m=video 51372 RTP/AVP 96", "a=inactive")),
    ).toEqual({ audio: true, video: false, text: false });
  });

  it("direction de session appliquée aux flux qui n'en déclarent pas", () => {
    expect(
      offeredMedia(
        ["v=0", "a=inactive", "m=audio 49170 RTP/AVP 0", "m=video 51372 RTP/AVP 96", "a=sendrecv"]
          .join("\r\n"),
      ),
    ).toEqual({ audio: false, video: true, text: false });
  });

  it("recvonly / sendonly restent des médias proposés", () => {
    expect(offeredMedia(sdp("m=audio 49170 RTP/AVP 0", "a=recvonly"))).toEqual({
      audio: true,
      video: false,
      text: false,
    });
  });

  const DC = "m=application 5000 UDP/DTLS/SCTP webrtc-datachannel";
  const WS = "m=text 60000 TCP/WSS t140";

  it("un canal de données seul est un appel texte, pas un appel audio", () => {
    expect(offeredMedia(sdp(DC, "a=sendrecv"), "datachannel")).toEqual({
      audio: false,
      video: false,
      text: true,
    });
    // la section m=text des passerelles dit la même chose
    expect(offeredMedia(sdp(WS), "websocket")).toEqual({
      audio: false,
      video: false,
      text: true,
    });
  });

  /**
   * Le transport fait partie de la question (§4.9) : une offre texte
   * d'une forme que ce poste ne sait pas ouvrir n'offre pas de texte —
   * répondre « oui » y serait promettre un lien qui ne s'ouvrira jamais.
   */
  it("un transport que le compte ne porte pas n'offre pas de texte", () => {
    expect(offeredMedia(sdp(WS), "datachannel").text).toBe(false);
    expect(offeredMedia(sdp(DC, "a=sendrecv"), "websocket").text).toBe(false);
    // sans transport au compte, aucune offre texte ne compte
    expect(offeredMedia(sdp(DC, "a=sendrecv"), "none").text).toBe(false);
    expect(offeredMedia(sdp(WS), "none").text).toBe(false);
  });

  /**
   * ADR 0003, D1 : le texte est un média à côté des deux autres, plus ce
   * qui reste quand ils manquent. Un appel audio + texte se lit donc comme
   * tel — c'est le profil 3c de F.703 §7.2, et l'écran d'appel entrant le
   * dit.
   */
  it("le texte s'ajoute à la parole au lieu de s'y substituer", () => {
    expect(offeredMedia(sdp("m=audio 49170 RTP/AVP 0", DC), "datachannel")).toEqual({
      audio: true,
      video: false,
      text: true,
    });
    expect(
      offeredMedia(sdp("m=audio 49170 RTP/AVP 0", "m=video 51372 RTP/AVP 96", WS), "websocket"),
    ).toEqual({ audio: true, video: true, text: true });
  });

  it("un canal de données rejeté (port 0) ne fait pas un appel texte", () => {
    expect(offeredMedia(sdp("m=application 0 UDP/DTLS/SCTP webrtc-datachannel"), "datachannel")).toEqual({
      audio: true,
      video: false,
      text: false,
    });
  });

  it("offre absente ou illisible : audio par défaut", () => {
    expect(offeredMedia(null)).toEqual({ audio: true, video: false, text: false });
    expect(offeredMedia("")).toEqual({ audio: true, video: false, text: false });
    expect(offeredMedia("n'importe quoi")).toEqual({ audio: true, video: false, text: false });
  });

  it("séparateurs LF seuls (SDP mal formés dans la nature)", () => {
    expect(offeredMedia("v=0\nm=audio 49170 RTP/AVP 0\nm=video 51372 RTP/AVP 96")).toEqual({
      audio: true,
      video: true,
      text: false,
    });
  });
});

describe("withoutMedia", () => {
  const av = sdp(
    "m=audio 49170 RTP/AVP 0 8",
    "a=sendrecv",
    "m=video 51372 RTP/AVP 96",
    "a=rtpmap:96 H264/90000",
    "a=sendrecv",
  );

  it("la vidéo passe inactive, l'audio ne bouge pas", () => {
    const out = withoutMedia(av, ["video"]);
    expect(offeredMedia(out)).toEqual({ audio: true, video: false, text: false });
    expect(out).toContain("m=video 51372 RTP/AVP 96");
    expect(out).toContain("a=rtpmap:96 H264/90000");
    expect(out.match(/a=sendrecv/g)).toHaveLength(1); // celui de l'audio
    expect(out).toContain("a=inactive");
  });

  it("une section vidéo sans direction s'en voit poser une", () => {
    const out = withoutMedia(sdp("m=audio 49170 RTP/AVP 0", "m=video 51372 RTP/AVP 96"), ["video"]);
    expect(offeredMedia(out)).toEqual({ audio: true, video: false, text: false });
    expect(out.trimEnd().endsWith("a=inactive")).toBe(true);
  });

  it("sans vidéo, le SDP traverse inchangé", () => {
    const audio = sdp("m=audio 49170 RTP/AVP 0", "a=sendrecv");
    expect(withoutMedia(audio, ["video"]).trimEnd()).toBe(audio.trimEnd());
  });

  it("les fins de ligne du SDP d'origine sont conservées", () => {
    expect(withoutMedia(av, ["video"])).toContain("\r\n");
    expect(withoutMedia(av.replaceAll("\r\n", "\n"), ["video"])).not.toContain("\r");
  });
});

/**
 * Recevabilité de l'offre entrante : ce contrôle décide qu'un appel ne
 * sonnera pas du tout (docs/CONCEPTION.md §4.3). Un faux positif coûterait
 * un appel perdu — c'est le sens qui se vérifie le plus ici.
 */
describe("unsupportedOffer", () => {
  /** L'offre d'un UA SIP classique : RTP en clair, ni ICE ni DTLS. */
  const SIP_NATIF = sdp(
    "m=audio 49276 RTP/AVP 98 0 8 101",
    "a=rtpmap:98 opus/48000/2",
    "a=sendrecv",
    "m=video 63650 RTP/AVP 107",
    "a=rtpmap:107 VP8/90000",
    "a=sendrecv",
  );

  /** Ce qu'un navigateur envoie : ICE, DTLS, SRTP, tout au niveau du flux. */
  const WEBRTC = sdp(
    "m=audio 9 UDP/TLS/RTP/SAVPF 111",
    "a=ice-ufrag:4ZcD",
    "a=ice-pwd:2/1muCWoOi3uLifh0NuRHlZ6",
    "a=fingerprint:sha-256 AB:CD:EF",
    "a=rtcp-mux",
    "a=sendrecv",
  );

  it("laisse passer une offre WebRTC", () => {
    expect(unsupportedOffer(WEBRTC)).toBeNull();
  });

  it("nomme les trois manques d'une offre SIP native", () => {
    expect(unsupportedOffer(SIP_NATIF)).toBe("ICE, DTLS, SRTP (RTP/AVP)");
  });

  it("ne juge pas une offre absente : elle viendra dans l'ACK", () => {
    expect(unsupportedOffer(null)).toBeNull();
    expect(unsupportedOffer("")).toBeNull();
  });

  it("accepte ICE et DTLS déclarés au niveau session", () => {
    const offer = [
      ...head,
      "a=ice-ufrag:4ZcD",
      "a=ice-pwd:2/1muCWoOi3uLifh0NuRHlZ6",
      "a=fingerprint:sha-256 AB:CD:EF",
      "m=audio 9 RTP/SAVPF 111",
      "a=sendrecv",
    ].join("\r\n");
    expect(unsupportedOffer(offer)).toBeNull();
  });

  it("ignore un flux rejeté (port 0) et les sections non média", () => {
    const offer = sdp(
      "m=audio 9 UDP/TLS/RTP/SAVPF 111",
      "a=ice-ufrag:4ZcD",
      "a=ice-pwd:x",
      "a=fingerprint:sha-256 AB",
      "m=video 0 RTP/AVP 107",
      "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
    );
    expect(unsupportedOffer(offer)).toBeNull();
  });

  /**
   * L'appel texte seul (§4.9) : le SDP n'a qu'une section `m=application`,
   * et c'est un appel — à condition que ce poste sache ouvrir ce lien-là.
   */
  describe("appel texte seul", () => {
    const TEXTE_DC = [
      ...head,
      "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
      "a=ice-ufrag:F7g3",
      "a=ice-pwd:x9cl",
      "a=fingerprint:sha-256 AA:BB",
      "a=sctp-port:5000",
    ].join("\r\n");

    it("un canal de données est un appel pour qui transporte le texte ainsi", () => {
      expect(unsupportedOffer(TEXTE_DC, "datachannel")).toBeNull();
    });

    it("mais pas pour un poste qui ne transporte pas le texte", () => {
      expect(unsupportedOffer(TEXTE_DC)).toContain("m=audio/m=video");
      expect(unsupportedOffer(TEXTE_DC, "none")).toContain("m=audio/m=video");
    });

    it("ni pour un poste qui n'en transporte pas cette forme-là", () => {
      expect(unsupportedOffer(TEXTE_DC, "websocket")).toContain("m=audio/m=video");
    });

    it("une offre texte seul reste jugée sur ICE et DTLS", () => {
      const nu = sdp("m=application 9 UDP/DTLS/SCTP webrtc-datachannel");
      expect(unsupportedOffer(nu, "datachannel")).toBe("ICE, DTLS");
    });

    it("la section m=text d'une passerelle vaut pour le transport WebSocket", () => {
      const offer = [
        ...head,
        "m=text 60000 TCP/WSS t140",
        "a=ice-ufrag:F7g3",
        "a=fingerprint:sha-256 AA:BB",
      ].join("\r\n");
      expect(unsupportedOffer(offer, "websocket")).toBeNull();
      expect(unsupportedOffer(offer, "datachannel")).toContain("m=audio/m=video");
    });
  });
});

/**
 * **Laquelle des deux images est un écran ?** (ADR 0005, D4)
 *
 * Deux `m=video` dans un SDP ne le disent pas d'elles-mêmes. RFC 4796
 * définit l'attribut qui le dit, et l'ordre sert de repli — mais un repli
 * seulement : un appel audio auquel on ajoute un partage sans jamais avoir
 * eu de caméra a son écran en **première** `m=video`, et là seul
 * `a=content` tranche.
 */
describe("sharedVideoMid", () => {
  const CAMERA = ["m=video 51372 RTP/AVP 96", "a=mid:1", "a=sendrecv"];
  const ECRAN = ["m=video 51374 RTP/AVP 96", "a=mid:2", "a=content:slides", "a=sendonly"];
  const AUDIO = ["m=audio 49170 RTP/AVP 0", "a=mid:0", "a=sendrecv"];

  it("aucune vidéo : rien à désigner", () => {
    expect(sharedVideoMid(sdp(...AUDIO))).toBeNull();
  });

  it("une caméra seule n'est pas un partage", () => {
    expect(sharedVideoMid(sdp(...AUDIO, ...CAMERA))).toBeNull();
  });

  it("l'attribut RFC 4796 désigne l'écran", () => {
    expect(sharedVideoMid(sdp(...AUDIO, ...CAMERA, ...ECRAN))).toBe("2");
  });

  it("et il le désigne même quand l'écran vient en premier", () => {
    expect(sharedVideoMid(sdp(...AUDIO, ...ECRAN, ...CAMERA))).toBe("2");
  });

  it("un partage sans caméra : l'ordre ne dirait rien, l'attribut si", () => {
    expect(sharedVideoMid(sdp(...AUDIO, ...ECRAN))).toBe("2");
  });

  it("sans l'attribut, la seconde m=video active fait office", () => {
    const muet = ["m=video 51374 RTP/AVP 96", "a=mid:2", "a=sendonly"];
    expect(sharedVideoMid(sdp(...AUDIO, ...CAMERA, ...muet))).toBe("2");
  });

  it("une seconde m=video refusée (port 0) n'est pas un partage", () => {
    const mort = ["m=video 0 RTP/AVP 96", "a=mid:2"];
    expect(sharedVideoMid(sdp(...AUDIO, ...CAMERA, ...mort))).toBeNull();
  });

  it("ni une seconde m=video inactive — la m-section recyclable de D6", () => {
    const dormante = ["m=video 51374 RTP/AVP 96", "a=mid:2", "a=inactive"];
    expect(sharedVideoMid(sdp(...AUDIO, ...CAMERA, ...dormante))).toBeNull();
  });

  it("`a=content` est une liste de valeurs (RFC 4796 §5)", () => {
    const mixte = ["m=video 51374 RTP/AVP 96", "a=mid:2", "a=content:slides,speaker"];
    expect(sharedVideoMid(sdp(...AUDIO, mixte[0]!, mixte[1]!, mixte[2]!))).toBe("2");
  });

  it("une autre valeur que `slides` ne fait pas un partage", () => {
    const parole = ["m=video 51374 RTP/AVP 96", "a=mid:2", "a=content:speaker"];
    // le repli de l'ordre s'applique quand même : c'est bien la seconde
    expect(sharedVideoMid(sdp(...AUDIO, ...CAMERA, ...parole))).toBe("2");
    // mais seule, elle n'est pas désignée
    expect(sharedVideoMid(sdp(...AUDIO, ...parole))).toBeNull();
  });

  it("sans a=mid, la section n'a pas d'identité : rien n'est rendu", () => {
    const anonyme = ["m=video 51374 RTP/AVP 96", "a=content:slides"];
    expect(sharedVideoMid(sdp(...AUDIO, ...CAMERA, ...anonyme))).toBeNull();
  });

  it("pas de SDP du tout", () => {
    expect(sharedVideoMid(null)).toBeNull();
    expect(sharedVideoMid("")).toBeNull();
  });
});

/**
 * **Le partage n'est pas un média de l'appel** (ADR 0005, D3). Compté
 * comme tel, il ferait dire « il a ajouté la vidéo » à une offre qui n'a
 * pas touché à la caméra — et, pire, ferait croire à une caméra distante
 * là où il n'y a qu'un écran.
 */
describe("offeredMedia, la m-section du partage exclue", () => {
  const OFFRE = sdp(
    "m=audio 49170 RTP/AVP 0",
    "a=mid:0",
    "a=sendrecv",
    "m=video 51374 RTP/AVP 96",
    "a=mid:1",
    "a=content:slides",
    "a=sendonly",
  );

  it("un écran seul n'offre pas de vidéo", () => {
    expect(offeredMedia(OFFRE, "none", sharedVideoMid(OFFRE))).toEqual({
      audio: true,
      video: false,
      text: false,
    });
  });

  it("sans exclusion, il s'y ferait passer pour la caméra", () => {
    expect(offeredMedia(OFFRE)).toEqual({ audio: true, video: true, text: false });
  });

  it("la caméra reste comptée quand les deux sont là", () => {
    const deux = sdp(
      "m=audio 49170 RTP/AVP 0",
      "a=mid:0",
      "m=video 51372 RTP/AVP 96",
      "a=mid:1",
      "a=sendrecv",
      "m=video 51374 RTP/AVP 96",
      "a=mid:2",
      "a=content:slides",
      "a=sendonly",
    );
    expect(offeredMedia(deux, "none", sharedVideoMid(deux))).toEqual({
      audio: true,
      video: true,
      text: false,
    });
  });

  /**
   * **Chacun son écran** (ADR 0005, D9). L'offre du correspondant décrit
   * aussi celui que nous lui envoyons : les deux sont à écarter, et un seul
   * MID ne suffit plus — sans quoi l'appel se croirait en vidéo pour deux
   * documents qui défilent.
   */
  it("deux écrans dans la même offre : ni l'un ni l'autre n'est de la vidéo", () => {
    const deux = sdp(
      "m=audio 49170 RTP/AVP 0",
      "a=mid:0",
      "m=video 51374 RTP/AVP 96",
      "a=mid:1",
      "a=content:slides",
      "a=recvonly",
      "m=video 51376 RTP/AVP 96",
      "a=mid:2",
      "a=content:slides",
      "a=sendonly",
    );
    // le mien est le premier marqué : l'écarter est ce qui permet de
    // trouver le sien, et non de prendre le nôtre pour le sien
    expect(sharedVideoMid(deux, "1")).toBe("2");
    expect(offeredMedia(deux, "none", ["1", "2"])).toEqual({
      audio: true,
      video: false,
      text: false,
    });
  });

  /** Un MID seul reste accepté : c'est le cas courant, un seul écran. */
  it("un seul MID s'écrit toujours sans liste", () => {
    const un = sdp(
      "m=audio 49170 RTP/AVP 0",
      "a=mid:0",
      "m=video 51374 RTP/AVP 96",
      "a=mid:1",
      "a=content:slides",
      "a=sendonly",
    );
    expect(offeredMedia(un, "none", "1")).toEqual({ audio: true, video: false, text: false });
  });
});

/**
 * **La seule chose que Trix écrive dans une offre** (ADR 0005, D4). Le
 * navigateur n'écrit pas `a=content` : sans lui, deux `m=video` ne disent
 * pas laquelle est le visage — et c'est le visage qui porte la langue des
 * signes.
 */
describe("withSharedVideo", () => {
  const OFFRE = sdp(
    "m=audio 49170 RTP/AVP 0",
    "a=mid:0",
    "a=sendrecv",
    "m=video 51372 RTP/AVP 96",
    "a=mid:1",
    "a=sendrecv",
    "m=video 51374 RTP/AVP 96",
    "a=mid:2",
    "a=sendonly",
  );

  it("marque la m-section du MID, et elle seule", () => {
    const out = withSharedVideo(OFFRE, "2");
    expect(out).toContain("a=mid:2\r\na=content:slides");
    expect(out.match(/a=content:slides/g)).toHaveLength(1);
    // la caméra ne reçoit rien : on ne retouche pas ce qui marche
    expect(out).toContain("a=mid:1\r\na=sendrecv");
  });

  it("le SDP se relit tel qu'il était pour tout le reste", () => {
    expect(sharedVideoMid(withSharedVideo(OFFRE, "2"))).toBe("2");
    expect(offeredMedia(withSharedVideo(OFFRE, "2"), "none", "2")).toEqual({
      audio: true,
      video: true,
      text: false,
    });
  });

  it("un MID introuvable ne change rien", () => {
    expect(withSharedVideo(OFFRE, "9")).not.toContain("a=content");
  });

  it("un `a=content` déjà posé n'est pas doublé — le sien vaut mieux", () => {
    const deja = sdp("m=video 51374 RTP/AVP 96", "a=mid:2", "a=content:speaker");
    expect(withSharedVideo(deja, "2")).not.toContain("slides");
  });

  it("ne touche pas aux lignes d'avant la première m-section", () => {
    expect(withSharedVideo(OFFRE, "2")).toContain("o=- 1 1 IN IP4 192.0.2.1");
  });
});

/**
 * **Le refus poli d'un partage** : un 200 OK dont la m-section de l'écran
 * est déclarée `inactive`. Le distant a accepté la renégociation, pas ce
 * qu'elle proposait — et rien dans le code de réponse ne le dit.
 */
describe("midActive", () => {
  const REPONSE = (dir: string): string =>
    sdp("m=audio 49170 RTP/AVP 0", "a=mid:0", "a=sendrecv", "m=video 51374 RTP/AVP 96", "a=mid:2", dir);

  it("acceptée", () => {
    expect(midActive(REPONSE("a=recvonly"), "2")).toBe(true);
  });

  it("refusée poliment", () => {
    expect(midActive(REPONSE("a=inactive"), "2")).toBe(false);
  });

  it("rejetée franchement (port 0)", () => {
    const nul = sdp("m=audio 49170 RTP/AVP 0", "a=mid:0", "m=video 0 RTP/AVP 96", "a=mid:2");
    expect(midActive(nul, "2")).toBe(false);
  });

  it("la direction de session s'applique à qui n'en déclare pas", () => {
    const muet = ["v=0", "a=inactive", "m=video 51374 RTP/AVP 96", "a=mid:2"].join("\r\n");
    expect(midActive(muet, "2")).toBe(false);
  });

  it("un MID absent de la réponse n'est pas un MID accepté", () => {
    expect(midActive(REPONSE("a=recvonly"), "9")).toBe(false);
    expect(midActive(null, "2")).toBe(false);
  });

  it("ne confond pas deux MID dont l'un préfixe l'autre", () => {
    const deux = sdp(
      "m=video 51372 RTP/AVP 96",
      "a=mid:1",
      "a=inactive",
      "m=video 51374 RTP/AVP 96",
      "a=mid:12",
      "a=sendrecv",
    );
    expect(midActive(deux, "1")).toBe(false);
    expect(midActive(deux, "12")).toBe(true);
  });
});
