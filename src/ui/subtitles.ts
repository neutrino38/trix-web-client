/**
 * The subtitles export, handed to the browser. The file itself — WebVTT laid
 * on the start of the communication — is built by the core
 * (`core/subtitles.ts`); this is the only part that touches the document.
 */

import { subtitlesOf } from "../core/subtitles.js";
import { translate } from "../i18n/index.js";
import type { CallLogEntry } from "../storage/store.js";

/**
 * Hands the file to the browser. The only part of the export that touches
 * the document: a blob, an anchor that nobody sees, and the object URL
 * released once the click is through — a page that keeps them alive holds
 * the whole conversation in memory for as long as it lives.
 *
 * Returns `false` when the browser has no such door (no `URL.createObjectURL`),
 * so that the caller can say so instead of leaving a dead button.
 */
export function downloadSubtitles(entry: CallLogEntry): boolean {
  const { name, text } = subtitlesOf(entry, translate);
  let url: string;
  try {
    url = URL.createObjectURL(new Blob([text], { type: "text/vtt;charset=utf-8" }));
  } catch {
    return false;
  }
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // let the download start before the URL goes: revoking in the same tick
  // cancels it on some browsers
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}
