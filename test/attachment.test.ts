/**
 * A file in the conversation (ADR 0012, D3): its card and its one-line label.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { useLocale } from "../src/i18n/index.js";
import { entryText, fileCard, fileLabel, formatLength, formatSize } from "../src/ui/attachment.js";
import type { FileAttachment } from "../src/sip/fthttp.js";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const PHOTO: FileAttachment = {
  url: "https://files.example.org/files/tmp/a.jpg",
  name: "photo <1>.jpg",
  size: 184_233,
  contentType: "image/jpeg",
  until: NOW + 3600_000,
  playingLengthMs: null,
};
const VOICE: FileAttachment = {
  ...PHOTO,
  url: "https://files.example.org/files/tmp/v.mka",
  name: "vocal_1.mka",
  contentType: "audio/wav;voice-recording=yes",
  playingLengthMs: 64_320,
};

beforeAll(() => useLocale("fr"));

describe("formats", () => {
  it("length as m:ss, size in kilo- or megabytes", () => {
    expect(formatLength(4_320)).toBe("0:04");
    expect(formatLength(64_320)).toBe("1:04");
    expect(formatSize(184_233)).toMatch(/^180 /);
    expect(formatSize(3 * 1024 * 1024)).toMatch(/^3 /);
  });
});

describe("fileCard", () => {
  it("not fetched yet: its name escaped, its size, a button to fetch it", () => {
    const html = fileCard(PHOTO, NOW, { status: "idle" });
    expect(html).toContain("photo &lt;1&gt;.jpg");
    expect(html).toContain('data-act="file-fetch"');
    expect(html).toContain('data-autofetch="1"');
  });

  it("fetched: the image shown, and a link to save it", () => {
    const html = fileCard(PHOTO, NOW, { status: "ready", objectUrl: "blob:x", kind: "image" });
    expect(html).toContain('<img class="msg-file-img" src="blob:x"');
    expect(html).toContain('download="photo &lt;1&gt;.jpg"');
    expect(html).not.toContain("data-autofetch");
  });

  it("a voice message fetched plays; refused by the browser, it is saved instead", () => {
    expect(fileCard(VOICE, NOW, { status: "ready", objectUrl: "blob:v", kind: "audio" })).toContain("<audio");
    const refused = fileCard(VOICE, NOW, { status: "unplayable", objectUrl: "blob:v" });
    expect(refused).not.toContain("<audio");
    expect(refused).toContain('href="blob:v"');
  });

  it("past its until and not fetched: expired, nothing to fetch", () => {
    const html = fileCard({ ...PHOTO, until: NOW - 1 }, NOW, { status: "idle" });
    expect(html).not.toContain("file-fetch");
    expect(html).toContain("msg-file-state");
  });

  it("gone from the server: said so, and no retry", () => {
    const html = fileCard(PHOTO, NOW, { status: "failed", httpStatus: 404 });
    expect(html).not.toContain("file-fetch");
  });

  it("a voice message says so, with its length", () => {
    const html = fileCard(VOICE, NOW);
    expect(html).toContain("1:04");
    expect(fileLabel(VOICE)).toContain("1:04");
  });
});

describe("entryText", () => {
  it("the text when there is one, else what the file is", () => {
    expect(entryText({ text: "la terrasse", file: PHOTO })).toBe("la terrasse");
    expect(entryText({ text: "", file: PHOTO })).toContain("photo <1>.jpg");
    expect(entryText({ text: "Salut" })).toBe("Salut");
  });
});
