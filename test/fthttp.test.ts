/**
 * Files in chat, as Linphone sends them (ADR 0012): the RCS XML read, and
 * where it is found in a MESSAGE body.
 */

import { DOMParser } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import { isExpired, isVoiceMessage, readAttachment, readFtHttp } from "../src/sip/fthttp.js";

const parser = new DOMParser() as never;
const FT = "application/vnd.gsma.rcs-ft-http+xml";

/** What the reference store answered on 2026-10-07 (elixip, packaging/fhft/). */
const SERVER_XML =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<file xmlns="urn:gsma:params:xml:ns:rcs:rcs:fthttp"><file-info type="file"><file-size>3000</file-size>' +
  "<file-name>photo.jpg</file-name><content-type>image/jpeg</content-type>" +
  '<data url="https://files.weshwesh.eu:443/files/tmp/6ac665a6c7175_51cfe9c75571d3803c98.jpg" until="2026-10-14T15:30:46Z"/>' +
  "</file-info></file>\n";

/** Linphone's own, rebuilt after the upload: CRLF, the am namespace, a voice message. */
const VOICE_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<file xmlns="urn:gsma:params:xml:ns:rcs:rcs:fthttp" xmlns:am="urn:gsma:params:xml:ns:rcs:rcs:rram">',
  '<file-info type="thumbnail">',
  "<file-size>120</file-size>",
  '<data url="https://files.example.com/files/tmp/thumb.jpg" until="2026-10-09T10:21:45Z"/>',
  "</file-info>",
  '<file-info type="file">',
  "<file-size>18432</file-size>",
  "<file-name>vocal_2026-10-02-10-21-45.mka</file-name>",
  "<content-type>audio/wav;voice-recording=yes</content-type>",
  "<am:playing-length>4320</am:playing-length>",
  "<file-key>ignored</file-key>",
  '<data url="https://files.example.com/files/tmp/68de1c2a_9f3a.mka" until="2026-10-09T10:21:45Z"/>',
  "</file-info>",
  "</file>",
  "",
].join("\r\n");

describe("readFtHttp", () => {
  it("reads the store's XML", () => {
    expect(readFtHttp(SERVER_XML, parser)).toEqual({
      url: "https://files.weshwesh.eu:443/files/tmp/6ac665a6c7175_51cfe9c75571d3803c98.jpg",
      name: "photo.jpg",
      size: 3000,
      contentType: "image/jpeg",
      until: Date.parse("2026-10-14T15:30:46Z"),
      playingLengthMs: null,
    });
  });

  it("a voice message: the file, not the thumbnail; its length in milliseconds", () => {
    const file = readFtHttp(VOICE_XML, parser)!;
    expect(file.url).toContain("68de1c2a_9f3a.mka");
    expect(file.playingLengthMs).toBe(4320);
    expect(isVoiceMessage(file)).toBe(true);
    expect(isVoiceMessage({ contentType: "audio/wav" })).toBe(false);
  });

  it("percent-decodes the name", () => {
    const xml = SERVER_XML.replace("photo.jpg</file-name>", "IMG%200042%20%C3%A9t%C3%A9.jpg</file-name>");
    expect(readFtHttp(xml, parser)!.name).toBe("IMG 0042 été.jpg");
  });

  it("names nothing it cannot fetch: no file-info, no url, a javascript: url, a doctype, junk", () => {
    expect(readFtHttp(SERVER_XML.replace('type="file"', 'type="thumbnail"'), parser)).toBeNull();
    expect(readFtHttp(SERVER_XML.replace('url="', 'href="'), parser)).toBeNull();
    expect(readFtHttp(SERVER_XML.replace(/url="[^"]*"/, 'url="javascript:alert(1)"'), parser)).toBeNull();
    expect(readFtHttp('<!DOCTYPE file [<!ENTITY x "y">]><file/>', parser)).toBeNull();
    expect(readFtHttp("<file><file-info>", parser)).toBeNull();
  });

  it("expiry is the store's until", () => {
    const file = readFtHttp(SERVER_XML, parser)!;
    expect(isExpired(file, Date.parse("2026-10-14T15:30:45Z"))).toBe(false);
    expect(isExpired(file, Date.parse("2026-10-14T15:30:46Z"))).toBe(true);
    expect(isExpired({ until: null }, Date.now())).toBe(false);
  });
});

describe("readAttachment", () => {
  it("the XML alone", () => {
    expect(readAttachment(FT, SERVER_XML, parser)).toEqual({ file: expect.objectContaining({ name: "photo.jpg" }), caption: null });
  });

  it("beside a caption, which keeps its own trailing space", () => {
    const body = ["--b1", `Content-Type: ${FT}`, "", SERVER_XML, "--b1", "Content-Type: text/plain;charset=UTF-8", "", "la terrasse ", "--b1--", ""].join("\r\n");
    const got = readAttachment("multipart/mixed;boundary=b1", body, parser)!;
    expect(got.file.name).toBe("photo.jpg");
    expect(got.caption).toBe("la terrasse ");
  });

  it("the older message/external-body", () => {
    const got = readAttachment('message/external-body; access-type=URL; URL="https://files.example.com/files/tmp/a%20b.png"', "", parser)!;
    expect(got.file).toEqual(expect.objectContaining({ url: "https://files.example.com/files/tmp/a%20b.png", name: "a b.png" }));
  });

  it("a multipart without a file, a text, an external body that is not a URL: nothing", () => {
    const body = ["--b1", "Content-Type: text/plain", "", "rien", "--b1--"].join("\r\n");
    expect(readAttachment("multipart/mixed;boundary=b1", body, parser)).toBeNull();
    expect(readAttachment("text/plain", "Bonjour", parser)).toBeNull();
    expect(readAttachment('message/external-body; access-type=local-file; name="x"', "", parser)).toBeNull();
  });
});
