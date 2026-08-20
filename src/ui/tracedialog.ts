/**
 * Relecture du carnet d'un appel : les paquets SIP de son dialogue et les
 * états traversés, tels que `sip/record.ts` les a gardés (§5.3).
 *
 * C'est la console, mais après coup : mêmes lignes, même ordre, et le corps
 * d'un paquet se déplie d'un clic comme un groupe de la console. Un
 * `<dialog>` natif, parce qu'il apporte gratuitement ce qu'une surimpression
 * maison doit réimplémenter de travers — fermeture par Échap, piège à
 * focus, inertie du fond, et le retour du focus là où il était.
 *
 * Le composant ne connaît ni la machine ni l'écran : on lui donne une ligne
 * d'historique, il l'affiche et se retire. Rien n'est re-rendu par-dessus —
 * un appel terminé ne bouge plus.
 */

import { formatTime, t, tn } from "../i18n/index.js";
import type { TraceLine } from "../sip/record.js";
import type { CallLogEntry } from "../storage/store.js";
import { esc } from "./el.js";

/**
 * Icône « parchemin » : ce qui signale, dans l'historique, qu'un appel a
 * gardé sa trace. Un rouleau — le dessin doit rester lisible à 16 px.
 */
export const SCROLL_ICON = `<svg class="icon scroll" viewBox="0 0 24 24"><path d="M6 3h11a3 3 0 0 1 3 3v1h-4v11a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zm0 2a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h6.2A3 3 0 0 1 12 18V6a3 3 0 0 1 .2-1H6zm11 0a1 1 0 0 0-1 1v1h2V6a1 1 0 0 0-1-1zM7 8h4v2H7V8zm0 4h4v2H7v-2z"/></svg>`;

/**
 * Horodatage à la seconde près, milliseconde comprise : deux paquets d'un
 * même échange tiennent dans la même minute, et c'est justement leur écart
 * que l'on regarde. Format technique, non localisé — comme le contenu qu'il
 * date.
 */
function stamp(at: number): string {
  const d = new Date(at);
  const p = (n: number, w = 2): string => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** Sens du paquet, en toutes lettres pour un lecteur d'écran (RGAA 1.1). */
function wayLabel(line: TraceLine): string {
  return line.way === "out" ? t("trace.sent") : t("trace.received");
}

function lineHtml(line: TraceLine): string {
  if (line.kind === "cut") {
    return `<p class="trace-cut">${esc(t("trace.truncated"))}</p>`;
  }
  if (line.kind === "fsm") {
    return `<div class="trace-line fsm">
      <span class="at">${esc(stamp(line.at))}</span>
      <span class="head">${esc(line.head)}</span>
    </div>`;
  }
  const clipped = line.clipped ? `\n${t("trace.clipped")}` : "";
  return `<details class="trace-line sip ${line.way === "out" ? "out" : "in"}">
    <summary>
      <span class="at">${esc(stamp(line.at))}</span>
      <span class="way" aria-label="${esc(wayLabel(line))}">${line.way === "out" ? "→" : "←"}</span>
      <span class="head">${esc(line.head)}</span>
    </summary>
    <pre>${esc((line.body ?? "") + clipped)}</pre>
  </details>`;
}

/**
 * Le contenu du dialogue, séparé de son ouverture : c'est la partie qui se
 * relit et se vérifie sans navigateur.
 */
export function traceDialogHtml(entry: CallLogEntry): string {
  const lines = entry.trace ?? [];
  return `<div class="trace-head">
      <div>
        <h2>${esc(t("trace.title", { target: entry.target }))}</h2>
        <p class="trace-sub">${esc(formatTime(entry.startedAt))} — ${esc(
          tn("trace.count", lines.filter((l) => l.kind === "sip").length),
        )}</p>
      </div>
      <div class="trace-actions">
        <button class="linkbtn" data-act="copy">${esc(t("trace.copy"))}</button>
        <button class="linkbtn" data-act="close">${esc(t("trace.close"))}</button>
      </div>
    </div>
    <div class="trace-body">${lines.map(lineHtml).join("")}</div>`;
}

/**
 * Le carnet en clair, prêt à coller dans un rapport : entêtes et corps,
 * dans l'ordre où ils sont passés.
 */
export function traceAsText(lines: TraceLine[]): string {
  return lines
    .map((l) =>
      l.kind === "cut"
        ? t("trace.truncated")
        : `${stamp(l.at)} ${l.kind === "sip" ? (l.way === "out" ? "→" : "←") : "FSM"} ${l.head}${
            l.body ? `\n${l.body}` : ""
          }`,
    )
    .join("\n");
}

/**
 * Ouvre le carnet d'une ligne d'historique. Sans trace, il n'y a rien à
 * ouvrir — l'icône n'apparaît d'ailleurs pas.
 */
export function showTraceDialog(entry: CallLogEntry): void {
  const lines = entry.trace ?? [];
  if (lines.length === 0) return;

  const dlg = document.createElement("dialog");
  dlg.className = "trace-dialog";
  dlg.innerHTML = traceDialogHtml(entry);

  const copy = dlg.querySelector<HTMLButtonElement>('[data-act="copy"]')!;
  copy.addEventListener("click", () => {
    void navigator.clipboard?.writeText(traceAsText(lines)).then(
      () => {
        copy.textContent = t("trace.copied");
      },
      () => {
        // presse-papiers refusé (contexte non sécurisé, permission) : le
        // texte reste sélectionnable dans le dialogue, rien n'est perdu
        copy.textContent = t("trace.copyFailed");
      },
    );
  });
  dlg.querySelector('[data-act="close"]')!.addEventListener("click", () => dlg.close());
  // clic dans le fond, hors du cadre : même geste que Échap
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) dlg.close();
  });
  dlg.addEventListener("close", () => dlg.remove());

  document.body.appendChild(dlg);
  dlg.showModal();
}
