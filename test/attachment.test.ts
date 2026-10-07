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
  it("a file still kept: its name escaped, its size, and the link to it", () => {
    const html = fileCard(PHOTO, NOW);
    expect(html).toContain("photo &lt;1&gt;.jpg");
    expect(html).toContain('href="https://files.example.org/files/tmp/a.jpg"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("past its until: no link, said expired", () => {
    const html = fileCard({ ...PHOTO, until: NOW - 1 }, NOW);
    expect(html).not.toContain("href=");
    expect(html).toContain("msg-file-state");
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
