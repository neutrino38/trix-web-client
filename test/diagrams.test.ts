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

function render(): string {
  return `# Diagrammes des machines — générés, ne pas éditer

Régénérer avec \`npm run diagrams\` (source : \`toMermaid()\` des machines).

## PhoneMachine

\`\`\`mermaid
${PhoneMachine.toMermaid().trim()}
\`\`\`

## CallMachine

\`\`\`mermaid
${CallMachine.toMermaid().trim()}
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
