/**
 * Les statistiques média, découvertes depuis la pastille « En communication »
 * (docs/CONCEPTION.md §5.4).
 *
 * La question à laquelle cet encart répond est toujours la même — « ça
 * hache, d'où ça vient ? » — et elle se pose **pendant** l'appel : codec
 * effectivement négocié de chaque côté, débit qui passe, part de paquets
 * perdus à la réception comme à l'émission. Les chiffres sont ceux d'une
 * fenêtre glissante de 10 s (`sip/stats.ts`), jamais la moyenne de l'appel :
 * une minute parfaite ne doit pas masquer les dix secondes qui coupent.
 *
 * Découverte, et non info-bulle : le survol la montre, mais le clavier
 * (focus) et le clic la montrent aussi, et le clic la fixe. Une donnée qui
 * ne s'obtient qu'à la souris n'existe pas pour une partie des utilisateurs
 * (RGAA 13.10) — et il n'y a pas de survol sur mobile.
 *
 * L'encart suit la **trace SIP** (§5.2) : c'est le même outillage de
 * diagnostic, et la même case le commande. Décochée, la pastille redevient
 * une pastille — rien à survoler, et surtout aucune mesure prélevée à la
 * seconde sur la connexion pair-à-pair d'un appel ordinaire.
 *
 * La mesure elle-même n'est pas ici : c'est le port qui échantillonne, une
 * fois par seconde, pour toute la durée de la session (`sip/port.ts`). Ce
 * module ne fait que lire et dessiner — l'écran est reconstruit à chaque
 * notification de la machine (couper le micro suffit), et une fenêtre de
 * 10 s qui repartirait de zéro à chaque re-rendu n'afficherait jamais rien.
 *
 * Les mêmes relevés donnent le **bilan de l'appel**, que l'historique garde
 * à côté du carnet de trace : la loupe d'une ligne d'historique rouvre le
 * même tableau, mesuré sur l'appel entier au lieu des dix dernières
 * secondes. Un appel terminé ne bouge plus — il s'affiche en `<dialog>`,
 * comme le carnet, et non en encart qui suit la souris.
 */

import type { CallSession } from "../../../sip/port.js";
import { STATS_WINDOW_MS, type Flow, type MediaKind, type MediaStats } from "../../../sip/stats.js";
import type { CallLogEntry } from "../../../storage/store.js";
import { formatNumber, formatTime, t } from "../../../i18n/index.js";
import { sipTraceEnabled } from "../../../sip/trace.js";
import { esc } from "../../el.js";

/** Cadence de rafraîchissement de l'encart : celle de la mesure (§5.4). */
const REFRESH_MS = 1000;

/**
 * Icône « loupe » : ce qui signale, dans l'historique, qu'un appel a gardé
 * son bilan média. Voisine du parchemin, et lisible comme lui à 16 px.
 */
export const LENS_ICON = `<svg class="icon lens" viewBox="0 0 24 24"><path d="M10.5 3a7.5 7.5 0 1 0 4.55 13.46l4.24 4.25 1.42-1.42-4.25-4.24A7.5 7.5 0 0 0 10.5 3zm0 2a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z"/></svg>`;

/** Valeur pas encore mesurée, ou sans objet. */
const DASH = "—";

/** Au-delà, la perte s'entend : la valeur est mise en avant. */
const LOSS_HOT = 0.05;

// ---------------------------------------------------------------------------
// Gabarit
// ---------------------------------------------------------------------------

/**
 * La pastille d'état de l'appel. En communication, **trace SIP cochée**,
 * elle devient un bouton qui découvre l'encart. Partout ailleurs — trace
 * décochée, numérotation, sonnerie, où il n'y a de toute façon pas encore
 * de flux à mesurer — elle reste la pastille qu'elle était.
 *
 * La condition est écrite ici seulement : le câblage ne trouve alors ni
 * bouton ni encart, et ne prélève aucune mesure (voir `startMediaStats`).
 *
 * `inner` est le contenu déjà échappé par le gabarit appelant, `cls` la
 * classe que ce gabarit donne à sa pastille : les deux vues n'habillent pas
 * leur barre haute pareil, seul le comportement est commun.
 */
export function statsPill(inner: string, opts: { cls: string; connected: boolean }): string {
  if (!opts.connected || !sipTraceEnabled()) return `<span class="${opts.cls}">${inner}</span>`;
  return `<span class="livewrap" data-ref="livewrap">
    <button type="button" class="${opts.cls} livepill" data-ref="statsbtn"
            aria-expanded="false" aria-controls="media-stats"
            title="${esc(t("stats.hint"))}">${inner}</button>
    <div class="mediastats" id="media-stats" data-ref="mediastats" role="group"
         aria-label="${esc(t("stats.title"))}" hidden></div>
  </span>`;
}

/**
 * Les trois valeurs d'un sens, en texte. Elles servent au tableau **et** au
 * presse-papiers : un chiffre arrondi ici et là autrement se lirait comme
 * deux mesures différentes dans le même rapport de support.
 */
function clockLabel(flow: Flow, kind: MediaKind): string | null {
  // la fréquence d'échantillonnage ne dit quelque chose que de l'audio :
  // c'est elle qui sépare un appel « téléphone » (8 kHz) d'une vraie bande
  // large (48 kHz), là où elle vaut 90 kHz pour toute vidéo
  return kind === "audio" && flow.clockRate
    ? t("stats.khz", { n: formatNumber(flow.clockRate / 1000, 1) })
    : null;
}

function codecText(flow: Flow, kind: MediaKind): string {
  if (flow.codec === null) return DASH;
  const clock = clockLabel(flow, kind);
  return clock ? `${flow.codec} ${clock}` : flow.codec;
}

function rateText(flow: Flow): string {
  if (flow.kbps === null) return DASH;
  // sous 100 kbit/s (la voix), la décimale porte de l'information ; au-delà
  // (la vidéo), elle n'est que du bruit qui bouge à chaque seconde
  return t("stats.kbps", { n: formatNumber(flow.kbps, flow.kbps < 100 ? 1 : 0) });
}

function lossText(flow: Flow): string {
  return flow.loss === null
    ? DASH
    : t("stats.percent", { n: formatNumber(flow.loss * 100, 1) });
}

function codecCell(flow: Flow, kind: MediaKind): string {
  if (flow.codec === null) return DASH;
  const clock = clockLabel(flow, kind);
  return `${esc(flow.codec)}${clock ? ` <span class="unit">${esc(clock)}</span>` : ""}`;
}

function lossCell(flow: Flow): string {
  const value = esc(lossText(flow));
  // la classe ne fait que renforcer : le chiffre reste la donnée, lisible
  // sans la couleur (RGAA 3.1)
  return flow.loss !== null && flow.loss >= LOSS_HOT
    ? `<strong class="hot">${value}</strong>`
    : value;
}

function kindRows(kind: MediaKind, flows: Record<"recv" | "sent", Flow> | null): string {
  if (!flows) return "";
  const line = (label: string, cells: (flow: Flow) => string): string =>
    `<tr><th scope="row">${esc(label)}</th>
       <td>${cells(flows.recv)}</td><td>${cells(flows.sent)}</td></tr>`;
  return `<tr class="kind"><th scope="colgroup" colspan="3">${esc(
    t(kind === "audio" ? "stats.audio" : "stats.video"),
  )}</th></tr>
    ${line(t("stats.codec"), (f) => codecCell(f, kind))}
    ${line(t("stats.bitrate"), (f) => esc(rateText(f)))}
    ${line(t("stats.loss"), lossCell)}`;
}

/**
 * Sur quoi portent les chiffres : les dix dernières secondes pendant
 * l'appel, la durée mesurée de l'appel entier depuis l'historique. Le
 * distinguer n'est pas cosmétique — 2 % de perte sur dix secondes et 2 %
 * sur un quart d'heure ne racontent pas la même conversation.
 */
export type StatsScope = "live" | "call";

function scopeLabel(scope: StatsScope, spanMs: number): string {
  if (scope === "live") return t("stats.window", { s: formatNumber(STATS_WINDOW_MS / 1000) });
  const s = Math.round(spanMs / 1000);
  const d =
    s >= 60
      ? t("duration.minSec", { m: Math.floor(s / 60), s: String(s % 60).padStart(2, "0") })
      : t("duration.sec", { s });
  return t("stats.spanCall", { d });
}

/**
 * Le contenu de l'encart. Séparé de son câblage : c'est la partie qui se
 * relit et se vérifie sans navigateur.
 */
export function statsCardHtml(stats: MediaStats | null, scope: StatsScope = "live"): string {
  if (stats === null) return `<p class="mediastats-msg">${esc(t("stats.pending"))}</p>`;
  if (!stats.audio && !stats.video) {
    return `<p class="mediastats-msg">${esc(t("stats.none"))}</p>`;
  }
  const rtt =
    stats.rttMs === null
      ? ""
      : `<span>${esc(t("stats.rtt"))} ${esc(
          t("stats.ms", { n: formatNumber(stats.rttMs, 0) }),
        )}</span>`;
  return `<table class="mediastats-table">
      <caption>${esc(t("stats.title"))} <span class="unit">${esc(
        scopeLabel(scope, stats.spanMs),
      )}</span></caption>
      <thead><tr><td></td>
        <th scope="col">${esc(t("stats.recv"))}</th>
        <th scope="col">${esc(t("stats.sent"))}</th></tr></thead>
      <tbody>${kindRows("audio", stats.audio)}${kindRows("video", stats.video)}</tbody>
    </table>
    <p class="mediastats-foot">${rtt}<span>${esc(t("stats.lossNote"))}</span></p>`;
}

/**
 * Le même bilan en texte, prêt à coller dans un rapport de bogue ou un
 * ticket : colonnes séparées par des tabulations, qui retombent en face
 * l'une de l'autre aussi bien dans un tableur que dans une police à
 * chasse fixe.
 */
export function statsAsText(entry: CallLogEntry): string {
  const stats = entry.stats;
  if (!stats) return "";
  const lines = [
    t("stats.callTitle", { target: entry.target }),
    `${formatTime(entry.startedAt)} — ${scopeLabel("call", stats.spanMs)}`,
    ["", t("stats.recv"), t("stats.sent")].join("\t"),
  ];
  for (const [kind, flows] of [
    ["audio", stats.audio],
    ["video", stats.video],
  ] as const) {
    if (!flows) continue;
    lines.push(t(kind === "audio" ? "stats.audio" : "stats.video"));
    const row = (label: string, value: (flow: Flow) => string): void => {
      lines.push([label, value(flows.recv), value(flows.sent)].join("\t"));
    };
    row(t("stats.codec"), (f) => codecText(f, kind));
    row(t("stats.bitrate"), rateText);
    row(t("stats.loss"), lossText);
  }
  if (stats.rttMs !== null) {
    lines.push(`${t("stats.rtt")} ${t("stats.ms", { n: formatNumber(stats.rttMs, 0) })}`);
  }
  lines.push(t("stats.lossNote"));
  return lines.join("\n");
}

/**
 * Le bilan d'un appel terminé, relu depuis l'historique. Même tableau que
 * pendant la conversation — c'est la même chose qu'on regarde, sur une
 * autre durée. Un `<dialog>` natif, comme le carnet de trace (§5.3) :
 * Échap, piège à focus, inertie du fond et retour du focus sont acquis.
 */
export function showStatsDialog(entry: CallLogEntry): void {
  if (!entry.stats) return;
  const dlg = document.createElement("dialog");
  dlg.className = "stats-dialog";
  dlg.innerHTML = `<div class="stats-head">
      <div>
        <h2>${esc(t("stats.callTitle", { target: entry.target }))}</h2>
        <p class="stats-sub">${esc(formatTime(entry.startedAt))}</p>
      </div>
      <div class="stats-actions">
        <button class="linkbtn" data-act="copy">${esc(t("stats.copy"))}</button>
        <button class="linkbtn" data-act="close">${esc(t("stats.close"))}</button>
      </div>
    </div>
    <div class="stats-body mediastats">${statsCardHtml(entry.stats, "call")}</div>`;

  const copy = dlg.querySelector<HTMLButtonElement>('[data-act="copy"]')!;
  copy.addEventListener("click", () => {
    void navigator.clipboard?.writeText(statsAsText(entry)).then(
      () => {
        copy.textContent = t("stats.copied");
      },
      () => {
        // presse-papiers refusé (contexte non sécurisé, permission) : le
        // tableau reste sélectionnable dans le dialogue, rien n'est perdu
        copy.textContent = t("stats.copyFailed");
      },
    );
  });
  dlg.querySelector('[data-act="close"]')!.addEventListener("click", () => dlg.close());
  // clic dans le fond, hors du cadre : même geste qu'Échap
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) dlg.close();
  });
  dlg.addEventListener("close", () => dlg.remove());
  document.body.appendChild(dlg);
  dlg.showModal();
}

// ---------------------------------------------------------------------------
// Mesure et découverte
// ---------------------------------------------------------------------------

// État UI pur, survivant aux re-rendus de l'écran (voir l'en-tête).
let timer: ReturnType<typeof setInterval> | null = null;
/** Appel dont l'encart est ouvert : un nouvel appel repart encart fermé. */
let openedFor: number | null = null;
/** Encart fixé au clic — le seul état de découverte qui traverse un re-rendu. */
let pinned = false;

/** À appeler en tête de chaque rendu : l'ancien nœud disparaît avec sa boucle. */
export function stopMediaStats(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

/**
 * Câble la découverte et rafraîchit l'encart tant qu'il est ouvert. `key`
 * identifie l'appel (son instant de décrochage) : l'encart fixé pendant le
 * précédent ne se rouvre pas tout seul sur le suivant.
 */
export function startMediaStats(node: HTMLElement, session: CallSession, key: number): void {
  stopMediaStats();
  if (key !== openedFor) {
    openedFor = key;
    pinned = false;
  }
  const wrap = node.querySelector('[data-ref="livewrap"]');
  const btn = node.querySelector('[data-ref="statsbtn"]') as HTMLElement | null;
  const card = node.querySelector('[data-ref="mediastats"]') as HTMLElement | null;
  // pastille muette : la trace est décochée (voir `statsPill`), et personne
  // n'a demandé qu'on interroge la connexion toutes les secondes
  if (!wrap || !btn || !card) return;

  let over = false;
  const tick = (): void => {
    if (node.isConnected) draw();
    else stopMediaStats(); // l'écran a été re-rendu : cette boucle meurt
  };
  const draw = (): void => {
    if (!card.hidden) card.innerHTML = statsCardHtml(session.mediaStats());
  };
  /**
   * Ouverture, fermeture, et la boucle de rafraîchissement avec : un encart
   * fermé n'a rien à redessiner, et la mesure, elle, continue dans le port.
   */
  const sync = (): void => {
    card.hidden = !(pinned || over);
    btn.setAttribute("aria-expanded", String(!card.hidden));
    draw();
    if (card.hidden) stopMediaStats();
    else if (timer === null) timer = setInterval(tick, REFRESH_MS);
  };

  wrap.addEventListener("mouseenter", () => {
    over = true;
    sync();
  });
  wrap.addEventListener("mouseleave", () => {
    over = false;
    sync();
  });
  // le focus ouvre comme le survol : c'est le même geste au clavier
  btn.addEventListener("focus", () => {
    over = true;
    sync();
  });
  btn.addEventListener("blur", () => {
    over = false;
    sync();
  });
  // fixer : sans cela l'encart se referme dès qu'on veut lire ailleurs, et
  // c'est aussi ce qui l'ouvre au doigt, où il n'y a pas de survol
  btn.addEventListener("click", () => {
    pinned = !pinned;
    sync();
  });
  // clic ailleurs dans l'écran : l'encart fixé se retire, comme le menu de
  // mode d'appel — on n'a pas à revenir sur la pastille pour s'en défaire
  node.addEventListener("click", (e) => {
    if (!pinned || (e.target as HTMLElement).closest(".livewrap")) return;
    pinned = false;
    sync();
  });
  wrap.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key !== "Escape" || card.hidden) return;
    // Échap ne doit pas remonter fermer autre chose : il vient de refermer ceci
    e.stopPropagation();
    pinned = false;
    over = false;
    sync();
  });

  sync();
}
