/**
 * Le popup de relecture d'un carnet.
 *
 * Ce qui se vérifie ici est ce que le typage ne dit pas : un paquet se
 * déplie (`<details>`), une transition ne se déplie pas — elle n'a pas de
 * corps —, la coupure au plafond se voit, et rien de ce qui vient du
 * réseau n'est injecté tel quel dans la page.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { traceAsText, traceDialogHtml } from "../src/ui/tracedialog.js";
import { historyRow } from "../src/ui/screens/call/parts.js";
import type { TraceLine } from "../src/sip/record.js";
import type { CallLogEntry } from "../src/storage/store.js";
import { useLocale } from "../src/i18n/index.js";

const AT = Date.UTC(2026, 0, 15, 12, 30, 5, 42);

function entry(trace?: TraceLine[]): CallLogEntry {
  return {
    target: "bob@example.fr",
    direction: "outgoing",
    outcome: "answered",
    media: { audio: true, video: false },
    startedAt: AT,
    connectedAt: AT + 1000,
    endedAt: AT + 5000,
    endedBy: "local",
    reason: null,
    ...(trace ? { trace } : {}),
  };
}

const INVITE: TraceLine = {
  at: AT,
  kind: "sip",
  way: "out",
  head: "INVITE sip:bob@example.fr SIP/2.0",
  body: "INVITE sip:bob@example.fr SIP/2.0\r\nCall-ID: abc\r\n\r\n",
};

const FSM: TraceLine = {
  at: AT + 10,
  kind: "fsm",
  head: '(CallBlock/initial_state) → (CallBlock/dialing) "INVITE sortant"',
};

beforeEach(async () => {
  await useLocale("fr");
});

describe("contenu du popup", () => {
  it("déplie les paquets et pose les transitions à plat", () => {
    const html = traceDialogHtml(entry([INVITE, FSM]));

    expect(html).toContain("<details class=\"trace-line sip out\">");
    expect(html).toContain("INVITE sip:bob@example.fr SIP/2.0");
    // une transition n'a pas de corps : rien à déplier
    expect(html).toContain('<div class="trace-line fsm">');
    expect(html.match(/<details/g)).toHaveLength(1);
  });

  it("horodate à la milliseconde — c'est l'écart entre deux paquets qu'on lit", () => {
    const html = traceDialogHtml(entry([INVITE]));
    const stamp = new Date(AT);
    const hh = String(stamp.getHours()).padStart(2, "0");
    expect(html).toContain(`${hh}:30:05.042`);
  });

  it("compte les paquets, pas les transitions", () => {
    expect(traceDialogHtml(entry([INVITE, FSM]))).toContain("1 paquet");
    expect(traceDialogHtml(entry([INVITE, INVITE, FSM]))).toContain("2 paquets");
  });

  it("signale une trace coupée au plafond", () => {
    const html = traceDialogHtml(entry([INVITE, { at: AT, kind: "cut", head: "" }]));
    expect(html).toContain("trace-cut");
    expect(html).toContain("Trace interrompue");
  });

  it("échappe ce qui vient du réseau : un paquet n'est pas du HTML", () => {
    const nasty: TraceLine = {
      at: AT,
      kind: "sip",
      way: "in",
      head: "SIP/2.0 200 OK",
      body: '<img src=x onerror="alert(1)">',
    };
    const html = traceDialogHtml(entry([nasty]));

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("rend le carnet en texte, corps compris, pour un rapport de bogue", () => {
    const text = traceAsText([INVITE, FSM]);
    expect(text).toContain("→ INVITE sip:bob@example.fr SIP/2.0");
    expect(text).toContain("Call-ID: abc");
    expect(text).toContain("FSM (CallBlock/initial_state) → (CallBlock/dialing)");
  });
});

describe("icône parchemin dans l'historique", () => {
  it("n'apparaît que sur les appels qui ont gardé leur trace", () => {
    expect(historyRow(entry([INVITE]), 3)).toContain('data-act="trace"');
    expect(historyRow(entry([INVITE]), 3)).toContain('data-i="3"');
    expect(historyRow(entry(), 0)).not.toContain('data-act="trace"');
  });
});
