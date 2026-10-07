/**
 * Fetching a file to show it in the page (ADR 0012, D6): the container
 * sniffed, the state a card reads, the auto-fetch bound.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileAttachment } from "../src/sip/fthttp.js";
import {
  AUTO_FETCH_MAX,
  fetchFile,
  fileState,
  kindOf,
  markUnplayable,
  onFileChange,
  resetFiles,
  sniff,
  wantsAutoFetch,
} from "../src/ui/filefetch.js";

const PHOTO: FileAttachment = {
  url: "https://files.example.org/files/tmp/a.jpg",
  name: "a.jpg",
  size: 3000,
  contentType: "image/jpeg",
  until: null,
  playingLengthMs: null,
};
const VOICE: FileAttachment = { ...PHOTO, url: "https://files.example.org/files/tmp/v.mka", contentType: "audio/wav;voice-recording=yes" };
const EBML = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x01]);

const answering = (status: number, bytes: Uint8Array = EBML) =>
  vi.fn(async () => new Response(status === 200 ? (bytes as BodyInit) : null, { status })) as unknown as typeof fetch;

afterEach(() => resetFiles());

describe("sniff and kindOf", () => {
  it("tells the containers apart by their first bytes", () => {
    expect(sniff(new TextEncoder().encode("RIFF"))).toBe("wav");
    expect(sniff(EBML)).toBe("matroska");
    expect(sniff(new TextEncoder().encode("OggS"))).toBe("ogg");
    expect(sniff(new Uint8Array([0, 0, 0, 0]))).toBeNull();
  });

  it("a voice message labelled audio/wav that is Matroska plays as webm", () => {
    expect(kindOf(VOICE, EBML)).toEqual({ kind: "audio", type: "audio/webm" });
    expect(kindOf(VOICE, new TextEncoder().encode("RIFF"))).toEqual({ kind: "audio", type: "audio/wav" });
    expect(kindOf(VOICE, new Uint8Array([1, 2, 3, 4]))).toEqual({ kind: "other", type: "application/octet-stream" });
  });

  it("an image is shown, an SVG is not", () => {
    expect(kindOf(PHOTO, EBML).kind).toBe("image");
    expect(kindOf({ ...PHOTO, contentType: "image/svg+xml" }, EBML).kind).toBe("other");
  });
});

describe("wantsAutoFetch", () => {
  it("images and voice messages up to the bound, nothing else", () => {
    expect(wantsAutoFetch(PHOTO)).toBe(true);
    expect(wantsAutoFetch(VOICE)).toBe(true);
    expect(wantsAutoFetch({ ...PHOTO, size: AUTO_FETCH_MAX + 1 })).toBe(false);
    expect(wantsAutoFetch({ ...PHOTO, contentType: "application/pdf" })).toBe(false);
  });
});

describe("fetchFile", () => {
  it("loading, then ready with an object URL; the card's owner is told each time", async () => {
    const seen: string[] = [];
    onFileChange((f) => seen.push(`${f.url} ${fileState(f.url).status}`));
    const fetchImpl = answering(200);
    await fetchFile(VOICE, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(VOICE.url, { credentials: "omit", mode: "cors" });
    expect(fileState(VOICE.url)).toEqual(expect.objectContaining({ status: "ready", kind: "audio" }));
    expect(seen).toEqual([`${VOICE.url} loading`, `${VOICE.url} ready`]);
  });

  it("fetched once: a second call does nothing", async () => {
    const fetchImpl = answering(200);
    await fetchFile(PHOTO, fetchImpl);
    await fetchFile(PHOTO, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a 404 and a network failure are failures, and may be retried", async () => {
    await fetchFile(PHOTO, answering(404));
    expect(fileState(PHOTO.url)).toEqual({ status: "failed", httpStatus: 404 });
    await fetchFile(PHOTO, vi.fn(async () => Promise.reject(new TypeError("cors"))) as unknown as typeof fetch);
    expect(fileState(PHOTO.url)).toEqual({ status: "failed", httpStatus: null });
    await fetchFile(PHOTO, answering(200));
    expect(fileState(PHOTO.url).status).toBe("ready");
  });

  it("a voice message the browser refuses becomes a file to save", async () => {
    await fetchFile(VOICE, answering(200));
    markUnplayable(VOICE.url);
    expect(fileState(VOICE.url)).toEqual(expect.objectContaining({ status: "unplayable" }));
  });
});
