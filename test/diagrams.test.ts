/**
 * Garde anti-divergence (docs/CONCEPTION.md §4.5) : docs/DIAGRAMS.md doit
 * être exactement le graphe extrait des sources des machines.
 * `npm run diagrams` (UPDATE_DIAGRAMS=1) régénère le fichier ; sans le
 * flag, ce test échoue si le code et la documentation ont divergé.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { machineGraphs, renderMermaid } from "finite-state-language/diagram";
import type { MachineGraph, StateEvents } from "finite-state-language/diagram";

const path = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));
const target = path("../docs/DIAGRAMS.md");

function graphOf(file: string): MachineGraph {
  const [graph] = machineGraphs(readFileSync(path(file), "utf8"), file);
  if (graph === undefined) throw new Error(`${file} ne définit aucune machine`);
  return graph;
}

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

function section(file: string): string {
  const graph = graphOf(file);
  const kind = graph.kind === "block" ? "bloc de service (SBB)" : "machine";
  const tables = [
    table("Blocs entrés depuis cet état (`fx.sbb`) :", graph.blocks),
    table("Événements consommés sans effet sur cette machine :", graph.consumed),
  ].filter((t) => t !== "");
  return `## ${graph.name} — ${kind}

\`\`\`mermaid
${renderMermaid(graph)}
\`\`\`

${tables.join("\n")}`;
}

function render(): string {
  return `# Diagrammes des machines — générés, ne pas éditer

Régénérer avec \`npm run diagrams\`. Source : les \`goto()\` des machines,
extraits de \`src/machines/\` par \`finite-state-language/diagram\`.

Chaque flèche porte les événements qui la déclenchent, et entre parenthèses
le libellé de la transition. \`[*]\` est la fin de la machine — pour un bloc
de service, la sortie vers son hôte, étiquetée par l'événement rendu. Les
gardes sont ignorées : une branche impossible à l'exécution est quand même
dessinée.

Un état qui entre un bloc n'a pas d'arête sortante tant que le bloc n'a pas
rendu la main : il est suspendu là, et c'est le tableau qui dit dans quel
bloc.

${section("../src/machines/phone.ts")}
${section("../src/machines/call.ts")}`;
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
