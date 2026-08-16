/**
 * Garde anti-divergence (docs/CONCEPTION.md §4.4) : docs/DIAGRAMS.md doit
 * être exactement le toMermaid() des machines. `npm run diagrams`
 * (UPDATE_DIAGRAMS=1) régénère le fichier ; sans le flag, ce test échoue
 * si le code et la documentation ont divergé.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PhoneMachine } from "../src/machines/phone.js";
import { CallMachine } from "../src/machines/call.js";

const target = fileURLToPath(new URL("../docs/DIAGRAMS.md", import.meta.url));

/**
 * Mermaid 11 (celui de GitHub) échoue avec « No such shape: undefined »
 * sur un `note right of X` quand X n'apparaît dans aucune transition : le
 * nœud de la note se retrouve sans forme. Or toMermaid() n'émet que des
 * déclarations d'états — les clauses `on` sont des fonctions, pas des noms
 * d'états cibles — donc toutes les notes sont dans ce cas et aucun des deux
 * diagrammes ne se rend sur GitHub. On convertit chaque note en description
 * d'état (`X : ...`), strictement équivalente et rendue partout.
 */
function notesToDescriptions(src: string): string {
  const out: string[] = [];
  let noted: string | null = null;
  for (const line of src.split("\n")) {
    const open = /^\s*note (?:right|left) of (\S+)\s*$/.exec(line);
    if (open) {
      noted = open[1];
    } else if (noted === null) {
      out.push(line);
    } else if (/^\s*end note\s*$/.test(line)) {
      noted = null;
    } else {
      out.push(`  ${noted} : ${line.trim()}`);
    }
  }
  return out.join("\n");
}

function render(): string {
  return `# Diagrammes des machines — générés, ne pas éditer

Régénérer avec \`npm run diagrams\` (source : \`toMermaid()\` des machines).

## PhoneMachine

\`\`\`mermaid
${notesToDescriptions(PhoneMachine.toMermaid().trim())}
\`\`\`

## CallMachine

\`\`\`mermaid
${notesToDescriptions(CallMachine.toMermaid().trim())}
\`\`\`
`;
}

describe("observabilité — diagrammes", () => {
  it("docs/DIAGRAMS.md est à jour avec toMermaid()", () => {
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
