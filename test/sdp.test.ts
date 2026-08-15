/**
 * Lecture de l'offre SDP entrante : c'est elle qui décide des réponses
 * proposées à l'utilisateur (docs/CONCEPTION.md §4.3).
 */
import { describe, expect, it } from "vitest";
import { offeredMedia } from "../src/sip/sdp.js";

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
