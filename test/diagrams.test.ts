/**
 * Garde anti-divergence (docs/CONCEPTION.md §4.4) : docs/DIAGRAMS.md doit
 * être exactement le graphe extrait des sources des machines.
 * `npm run diagrams` (UPDATE_DIAGRAMS=1) régénère le fichier ; sans le
 * flag, ce test échoue si le code et la documentation ont divergé.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { StateEvents } from "./machine-graph.js";
import { mermaidFromSource } from "./machine-graph.js";

const path = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));
const target = path("../docs/DIAGRAMS.md");

function table(caption: string, rows: StateEvents[]): string {
  if (rows.length === 0) return "";
  const lines = rows.map(
    (r) => `| \`${r.state}\` | ${r.events.map((e) => `\`${e}\``).join(", ")} |`,
  );
  return `${caption}

| État | Événements |
| --- | --- |
${lines.join("\n")}
`;
}

function section(title: string, file: string): string {
  const { diagram, consumed, forwarded } = mermaidFromSource(path(file));
  const tables = [
    table("Événements relayés à la machine enfant :", forwarded),
    table("Événements consommés sans effet sur cette machine :", consumed),
  ].filter((t) => t !== "");
  return `## ${title}

\`\`\`mermaid
${diagram}
\`\`\`

${tables.join("\n")}`;
}

function render(): string {
  return `# Diagrammes des machines — générés, ne pas éditer

Régénérer avec \`npm run diagrams\`. Source : les \`goto()\` des machines,
extraits de \`src/machines/\` par analyse statique.

Chaque flèche porte les événements qui la déclenchent, et entre parenthèses
le libellé de la transition. \`[*]\` est la fin de la machine. Les gardes
sont ignorées : une branche impossible à l'exécution est quand même
dessinée.

${section("PhoneMachine", "../src/machines/phone.ts")}
${section("CallMachine", "../src/machines/call.ts")}`;
}

describe("observabilité — diagrammes", () => {
  it("docs/DIAGRAMS.md est à jour avec les sources des machines", () => {
    const expected = render();
    if (process.env.UPDATE_DIAGRAMS) {
      writeFileSync(target, expected);
      return;
    }
    let actual = "";
    try {
      actual = readFileSync(target, "utf8");
    } catch {
      // fichier absent : le diff ci-dessous le signalera
    }
    expect(actual).toBe(expected);
  });
});
