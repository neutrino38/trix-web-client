import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { inject, manifest, PLACEHOLDER } from "../build/precache.js";

const files = (entries: [string, string][]) =>
  new Map(entries.map(([p, c]) => [p, Buffer.from(c)] as [string, Buffer]));

describe("precache manifest", () => {
  it("lists every built file but the worker, sorted", () => {
    const m = manifest(files([["sw.js", "w"], ["index.html", "i"], ["assets/main-1.js", "m"]]));
    expect(m.files).toEqual(["assets/main-1.js", "index.html"]);
  });

  it("keeps its version while the files do not change, whatever their order", () => {
    const a = manifest(files([["index.html", "i"], ["assets/a.js", "a"]]));
    const b = manifest(files([["assets/a.js", "a"], ["index.html", "i"]]));
    expect(a.version).toBe(b.version);
  });

  it("changes its version when a file changes, so that browsers update", () => {
    const a = manifest(files([["index.html", "i"]]));
    const b = manifest(files([["index.html", "j"]]));
    expect(a.version).not.toBe(b.version);
  });

  it("changes its version when only the worker changes, so that it starts from an empty cache", () => {
    const a = manifest(files([["index.html", "i"], ["sw.js", "before"]]));
    const b = manifest(files([["index.html", "i"], ["sw.js", "after"]]));
    expect(a.version).not.toBe(b.version);
    expect(a.files).toEqual(["index.html"]);
  });
});

describe("inject", () => {
  it("fills the placeholder public/sw.js leaves", () => {
    const worker = readFileSync("public/sw.js", "utf8");
    expect(worker).toContain(PLACEHOLDER);
    const out = inject(worker, { version: "v1", files: ["index.html"] });
    expect(out).toContain('const PRECACHE = {"version":"v1","files":["index.html"]};');
  });

  it("refuses a worker without the placeholder rather than ship it uncached", () => {
    expect(() => inject("self.x = 1;", { version: "v", files: [] })).toThrow(/placeholder/);
  });
});
