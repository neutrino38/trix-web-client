/**
 * Lecture de l'offre SDP entrante — c'est elle qui décide des réponses
 * proposées à l'utilisateur (docs/CONCEPTION.md §4.3) — et refus de la
 * vidéo dans la réponse, quand on décroche en audio seul (§4.4).
 */
import { describe, expect, it } from "vitest";
import { offeredMedia, unsupportedOffer, withoutVideo } from "../src/sip/sdp.js";

const head = ["v=0", "o=- 1 1 IN IP4 192.0.2.1", "s=-", "c=IN IP4 192.0.2.1", "t=0 0"];

function sdp(...media: string[]): string {
  return [...head, ...media].join("\r\n");
}

describe("offeredMedia", () => {
  it("audio seul", () => {
    expect(offeredMedia(sdp("m=audio 49170 RTP/AVP 0 8", "a=sendrecv"))).toEqual({
      audio: true,
      video: false,
    });
  });

  it("audio + vidéo", () => {
    expect(
      offeredMedia(sdp("m=audio 49170 RTP/AVP 0", "m=video 51372 RTP/AVP 96", "a=sendrecv")),
    ).toEqual({ audio: true, video: true });
  });

  it("vidéo seule", () => {
    expect(offeredMedia(sdp("m=video 51372 RTP/AVP 96"))).toEqual({ audio: false, video: true });
  });

  it("flux refusé (port 0) : ignoré", () => {
    expect(offeredMedia(sdp("m=audio 49170 RTP/AVP 0", "m=video 0 RTP/AVP 96"))).toEqual({
      audio: true,
      video: false,
    });
  });

  it("flux inactif : ignoré", () => {
    expect(
      offeredMedia(sdp("m=audio 49170 RTP/AVP 0", "m=video 51372 RTP/AVP 96", "a=inactive")),
    ).toEqual({ audio: true, video: false });
  });

  it("direction de session appliquée aux flux qui n'en déclarent pas", () => {
    expect(
      offeredMedia(
        ["v=0", "a=inactive", "m=audio 49170 RTP/AVP 0", "m=video 51372 RTP/AVP 96", "a=sendrecv"]
          .join("\r\n"),
      ),
    ).toEqual({ audio: false, video: true });
  });

  it("recvonly / sendonly restent des médias proposés", () => {
    expect(offeredMedia(sdp("m=audio 49170 RTP/AVP 0", "a=recvonly"))).toEqual({
      audio: true,
      video: false,
    });
  });

  it("les lignes m= autres qu'audio/vidéo sont ignorées", () => {
    expect(
      offeredMedia(sdp("m=application 5000 UDP/DTLS/SCTP webrtc-datachannel", "a=sendrecv")),
    ).toEqual({ audio: true, video: false });
  });

  it("offre absente ou illisible : audio par défaut", () => {
    expect(offeredMedia(null)).toEqual({ audio: true, video: false });
    expect(offeredMedia("")).toEqual({ audio: true, video: false });
    expect(offeredMedia("n'importe quoi")).toEqual({ audio: true, video: false });
  });

  it("séparateurs LF seuls (SDP mal formés dans la nature)", () => {
    expect(offeredMedia("v=0\nm=audio 49170 RTP/AVP 0\nm=video 51372 RTP/AVP 96")).toEqual({
      audio: true,
      video: true,
    });
  });
});

describe("withoutVideo", () => {
  const av = sdp(
    "m=audio 49170 RTP/AVP 0 8",
    "a=sendrecv",
    "m=video 51372 RTP/AVP 96",
    "a=rtpmap:96 H264/90000",
    "a=sendrecv",
  );

  it("la vidéo passe inactive, l'audio ne bouge pas", () => {
    const out = withoutVideo(av);
    expect(offeredMedia(out)).toEqual({ audio: true, video: false });
    expect(out).toContain("m=video 51372 RTP/AVP 96");
    expect(out).toContain("a=rtpmap:96 H264/90000");
    expect(out.match(/a=sendrecv/g)).toHaveLength(1); // celui de l'audio
    expect(out).toContain("a=inactive");
  });

  it("une section vidéo sans direction s'en voit poser une", () => {
    const out = withoutVideo(sdp("m=audio 49170 RTP/AVP 0", "m=video 51372 RTP/AVP 96"));
    expect(offeredMedia(out)).toEqual({ audio: true, video: false });
    expect(out.trimEnd().endsWith("a=inactive")).toBe(true);
  });

  it("sans vidéo, le SDP traverse inchangé", () => {
    const audio = sdp("m=audio 49170 RTP/AVP 0", "a=sendrecv");
    expect(withoutVideo(audio).trimEnd()).toBe(audio.trimEnd());
  });

  it("les fins de ligne du SDP d'origine sont conservées", () => {
    expect(withoutVideo(av)).toContain("\r\n");
    expect(withoutVideo(av.replaceAll("\r\n", "\n"))).not.toContain("\r");
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

  it("une offre sans flux audio ni vidéo n'est pas un appel", () => {
    const offer = sdp("m=application 9 UDP/DTLS/SCTP webrtc-datachannel");
    expect(unsupportedOffer(offer)).toContain("m=audio/m=video");
  });
});
