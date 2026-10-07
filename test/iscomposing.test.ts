/** "Is composing" (RFC 3994) as Linphone writes and reads it (ADR 0012, D9). */

import { DOMParser } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import { buildIsComposing, readIsComposing } from "../src/sip/iscomposing.js";
import { voiceMimeType, voiceName } from "../src/ui/voicerecorder.js";

const parser = new DOMParser() as never;

describe("isComposing", () => {
  it("active with what and for how long; idle alone", () => {
    expect(readIsComposing(buildIsComposing(true), parser)).toEqual({ active: true, contentType: "text/plain", refreshS: 60 });
    expect(readIsComposing(buildIsComposing(true, "audio/wav;voice-recording=yes"), parser)!.contentType).toBe(
      "audio/wav;voice-recording=yes",
    );
    const idle = buildIsComposing(false);
    expect(idle).not.toContain("refresh");
    expect(readIsComposing(idle, parser)).toEqual({ active: false, contentType: null, refreshS: null });
  });

  it("Linphone's, with its own prefix and spacing", () => {
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n<isComposing xmlns="urn:ietf:params:xml:ns:im-iscomposing">\n' +
      "  <state> active </state>\n  <refresh>60</refresh>\n  <contenttype>text/plain</contenttype>\n</isComposing>";
    expect(readIsComposing(xml, parser)).toEqual({ active: true, contentType: "text/plain", refreshS: 60 });
  });

  it("anything else is not one", () => {
    expect(readIsComposing("<imdn/>", parser)).toBeNull();
    expect(readIsComposing("<isComposing><state>busy</state></isComposing>", parser)).toBeNull();
    expect(readIsComposing("junk", parser)).toBeNull();
  });
});

describe("voice recorder", () => {
  it("WebM/Opus first, then Ogg; the browser's default otherwise", () => {
    expect(voiceMimeType(() => true)).toBe("audio/webm;codecs=opus");
    expect(voiceMimeType((t) => t.startsWith("audio/ogg"))).toBe("audio/ogg;codecs=opus");
    expect(voiceMimeType(() => false)).toBeUndefined();
  });

  it("named as Linphone names its own", () => {
    expect(voiceName(new Date(2026, 9, 7, 18, 30, 5).getTime())).toBe("vocal_2026-10-07-18-30-05.mka");
  });
});
