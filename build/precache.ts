/**
 * Writes the precache manifest into the built service worker (`dist/sw.js`).
 *
 * The worker caches every file of the build (`public/sw.js`), and it learns
 * which ones from here: their paths, and a version derived from their
 * content. The version is what makes an update reach the browsers — a build
 * that changes any file changes `sw.js` byte for byte, the browser notices
 * on its next check and installs the new worker, which caches the new files
 * and drops the old cache.
 *
 * Under `vite dev` nothing runs: the placeholder stays `null` and the worker
 * caches nothing.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Plugin } from "vite";

/** Left by `public/sw.js` for the build to fill in. */
export const PLACEHOLDER = "/*__TRIX_PRECACHE__*/ null";

/** The worker itself is fetched by the browser, never from its own cache. */
const WORKER = "sw.js";

export interface Manifest {
  version: string;
  files: string[];
}

/**
 * The manifest for a set of built files, given as path → content. Paths are
 * relative to the site's root, `/`-separated; the order they come in does
 * not change the result.
 *
 * The worker is not listed — the browser fetches it, never the cache — but
 * its source, read before injection, counts in the version: a change to how
 * it caches starts from an empty cache rather than from the previous one's.
 */
export function manifest(files: Map<string, Buffer>): Manifest {
  const listed = [...files.keys()].filter((p) => p !== WORKER).sort();
  const hash = createHash("sha256");
  for (const p of [...listed, ...(files.has(WORKER) ? [WORKER] : [])]) {
    hash.update(p).update("\0").update(files.get(p)!).update("\0");
  }
  return { version: hash.digest("hex").slice(0, 16), files: listed };
}

/** The worker's source with the manifest in place of the placeholder. */
export function inject(worker: string, m: Manifest): string {
  if (!worker.includes(PLACEHOLDER)) {
    throw new Error(`${WORKER}: precache placeholder not found`);
  }
  return worker.replace(PLACEHOLDER, JSON.stringify(m));
}

function walk(dir: string, root: string, out: Map<string, Buffer>): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, root, out);
    else out.set(relative(root, path).split(sep).join("/"), readFileSync(path));
  }
}

/** Vite plugin: once `dist/` is complete, fills in `dist/sw.js`. */
export function precache(): Plugin {
  let outDir = "dist";
  return {
    name: "trix-precache",
    apply: "build",
    configResolved(config) {
      outDir = join(config.root, config.build.outDir);
    },
    closeBundle() {
      const files = new Map<string, Buffer>();
      walk(outDir, outDir, files);
      const worker = join(outDir, WORKER);
      writeFileSync(worker, inject(readFileSync(worker, "utf8"), manifest(files)));
    },
  };
}
