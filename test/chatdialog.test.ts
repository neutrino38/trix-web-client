/**
 * La relecture d'une conversation depuis l'historique.
 *
 * Ce qui se vérifie ici est ce que le typage ne dit pas : la bulle « T »
 * n'apparaît que sur les appels où quelqu'un a écrit, le fil est rendu
 * par le même code que pendant l'appel — le correspondant y est nommé par
 * la ligne d'historique —, et rien de ce qui vient du réseau n'entre tel
 * quel dans la page.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { chatAsText, chatLogDialogHtml } from "../src/ui/chatdialog.js";
import { historyRow } from "../src/ui/screens/call/parts.js";
import type { ChatItem } from "../src/sip/transcript.js";
import type { CallLogEntry } from "../src/storage/store.js";
import { useLocale } from "../src/i18n/index.js";

const AT = Date.UTC(2026, 0, 15, 12, 30, 5);

function entry(chat?: ChatItem[]): CallLogEntry {
  return {
    target: "bob@example.fr",
    direction: "outgoing",
    outcome: "answered",
    media: { audio: false, video: false },
    startedAt: AT,
    connectedAt: AT + 1000,
    endedAt: AT + 60_000,
    endedBy: "local",
    reason: null,
    ...(chat ? { chat } : {}),
  };
}

const THREAD: ChatItem[] = [
  { kind: "note", id: 1, key: "chat.note.opened", at: AT },
  {
    kind: "bubble",
    id: 2,
    side: "them",
    runs: [{ text: "bonjour", attrs: {} }],
    startedAt: AT + 100,
    endedAt: AT + 900,
  },
  {
    kind: "bubble",
    id: 3,
    side: "us",
    runs: [{ text: "je vous lis", attrs: {} }],
    startedAt: AT + 1000,
    endedAt: AT + 1800,
  },
];

beforeEach(async () => {
  await useLocale("fr");
});

describe("contenu du popup", () => {
  it("nomme le correspondant comme la ligne d'historique le nomme", () => {
    const html = chatLogDialogHtml(entry(THREAD));
    expect(html).toContain("bob@example.fr");
    expect(html).toContain("bonjour");
    expect(html).toContain("je vous lis");
  });

  it("compte les messages, pas les remarques du fil", () => {
    expect(chatLogDialogHtml(entry(THREAD))).toContain("2 messages");
  });

  it("offre la copie et l'export en sous-titres", () => {
    const html = chatLogDialogHtml(entry(THREAD));
    expect(html).toContain('data-act="copy"');
    expect(html).toContain('data-act="export"');
  });

  it("aucune bulle vivante : la conversation est finie, rien n'y clignote", () => {
    expect(chatLogDialogHtml(entry(THREAD))).not.toContain("chat-caret");
  });

  it("échappe ce que le correspondant a écrit : ce n'est pas du HTML", () => {
    const hostile: ChatItem[] = [
      {
        kind: "bubble",
        id: 9,
        side: "them",
        runs: [{ text: "<img src=x onerror=alert(1)>", attrs: {} }],
        startedAt: AT,
        endedAt: AT + 10,
      },
    ];
    const html = chatLogDialogHtml(entry(hostile));
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("copie en texte", () => {
  it("une ligne par bulle, chacune attribuée", () => {
    const text = chatAsText(THREAD, "bob@example.fr");
    expect(text).toContain("bob@example.fr : bonjour");
    expect(text).toContain("Vous : je vous lis");
    // la remarque garde sa place : elle explique les trous
    expect(text).toContain("— Texte temps réel ouvert");
  });
});

describe("bulle « T » dans l'historique", () => {
  it("n'apparaît que sur les appels où quelqu'un a écrit", () => {
    expect(historyRow(entry(THREAD), 2)).toContain('data-act="chat-log"');
    expect(historyRow(entry(THREAD), 2)).toContain('data-i="2"');
    expect(historyRow(entry(), 0)).not.toContain('data-act="chat-log"');
  });
});
