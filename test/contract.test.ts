/**
 * The contract of ADR 0011 (D10) is what `src/core/index.ts` exports. An
 * affiliate must be able to **name** every type it meets there: a field of
 * the view typed with a name the facade does not export is one the
 * affiliate can only reach by importing an internal module — which D2
 * forbids, and which no version promises to keep.
 *
 * So the contract is walked with the type checker, from each export down
 * through properties, signatures, unions and type arguments, and every
 * named type declared under `src/` that it meets must be exported too.
 *
 * And the sources are compiled by the affiliate's own TypeScript, with its
 * own options (D11): the core must therefore build under the strict ones
 * an affiliate may well have on, not only under ours. A style option such
 * as `noPropertyAccessFromIndexSignature` is not supported.
 *
 * Two doors are left out of the walk, on purpose: `Trix.debug` (D9, not
 * part of the contract) and the test hooks of `TrixOptions` (`store`,
 * `session`, `sip`), which hand in the core's own internals.
 */
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FACADE = join(ROOT, "src/core/index.ts");

/** Members the walk does not enter, as `Interface.member`, and exports it does not start from. */
const OUT_OF_CONTRACT = new Set(["Trix.debug", "TrixOptions.store", "TrixOptions.session", "TrixOptions.sip"]);
const NOT_CONTRACT_EXPORTS = new Set(["TrixDebug"]);

/** `Interface.member` for a property declared in an interface, else null. */
function memberName(prop: ts.Symbol): string | null {
  const decl = prop.declarations?.[0];
  const parent = decl?.parent;
  return parent && ts.isInterfaceDeclaration(parent) ? `${parent.name.text}.${prop.name}` : null;
}

/** The options an affiliate may add to ours, and the core must build under. */
const AFFILIATE_STRICT: ts.CompilerOptions = {
  exactOptionalPropertyTypes: true,
  noUnusedLocals: true,
  noUnusedParameters: true,
  noImplicitOverride: true,
  noImplicitReturns: true,
  noFallthroughCasesInSwitch: true,
};

function program(extra: ts.CompilerOptions = {}): ts.Program {
  const config = ts.readConfigFile(join(ROOT, "tsconfig.json"), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, ROOT);
  return ts.createProgram([FACADE], { ...parsed.options, ...extra });
}

/** Is this declaration one of Trix's own, rather than the DOM's or a package's? */
function isOwn(decl: ts.Declaration): boolean {
  const file = decl.getSourceFile().fileName;
  return file.startsWith(join(ROOT, "src")) && !file.includes("node_modules");
}

/** The named types of `src/` the contract reaches: name → `src/file.ts, via path`. */
function reached(): { exported: Set<string>; met: Map<string, string> } {
  const prog = program();
  const checker = prog.getTypeChecker();
  const facade = prog.getSourceFile(FACADE)!;
  const exports = checker.getExportsOfModule(checker.getSymbolAtLocation(facade)!);
  const exported = new Set(exports.map((s) => s.name));
  const met = new Map<string, string>();
  const seen = new Set<ts.Type>();

  const note = (symbol: ts.Symbol | undefined, path: string) => {
    const decl = symbol?.declarations?.[0];
    if (!symbol || !decl || !isOwn(decl) || met.has(symbol.name)) return;
    // a type's own name, not a property's or a type parameter's
    const named =
      ts.isInterfaceDeclaration(decl) ||
      ts.isTypeAliasDeclaration(decl) ||
      ts.isClassDeclaration(decl) ||
      ts.isEnumDeclaration(decl);
    if (named) met.set(symbol.name, `${relative(ROOT, decl.getSourceFile().fileName)}, via ${path}`);
  };

  const typeArguments = (type: ts.Type): readonly ts.Type[] =>
    type.flags & ts.TypeFlags.Object && (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference
      ? checker.getTypeArguments(type as ts.TypeReference)
      : [];

  const walk = (type: ts.Type, path: string) => {
    if (seen.has(type)) return;
    seen.add(type);
    note(type.aliasSymbol, path);
    type.aliasTypeArguments?.forEach((t) => walk(t, path));
    if (type.isUnionOrIntersection()) {
      type.types.forEach((t) => walk(t, path));
      return;
    }
    const symbol = type.getSymbol();
    typeArguments(type).forEach((t) => walk(t, path));
    // a DOM or library type: only its type arguments may be ours
    if (symbol?.declarations?.[0] && !isOwn(symbol.declarations[0])) return;
    note(symbol, path);
    for (const prop of type.getProperties()) {
      const member = memberName(prop);
      if (member && OUT_OF_CONTRACT.has(member)) continue;
      const decl = prop.valueDeclaration ?? prop.declarations?.[0];
      if (decl) walk(checker.getTypeOfSymbolAtLocation(prop, decl), `${path}.${prop.name}`);
    }
    for (const sig of [...type.getCallSignatures(), ...type.getConstructSignatures()]) {
      for (const p of sig.getParameters()) {
        const decl = p.valueDeclaration ?? p.declarations?.[0];
        if (decl) walk(checker.getTypeOfSymbolAtLocation(p, decl), `${path}(${p.name})`);
      }
      walk(sig.getReturnType(), `${path}()`);
    }
    checker.getIndexInfosOfType(type).forEach((i) => walk(i.type, `${path}[]`));
  };

  for (const exp of exports) {
    if (NOT_CONTRACT_EXPORTS.has(exp.name)) continue;
    const symbol = exp.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exp) : exp;
    const decl = symbol.declarations?.[0];
    if (!decl) continue;
    const type =
      symbol.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias)
        ? checker.getDeclaredTypeOfSymbol(symbol)
        : checker.getTypeOfSymbolAtLocation(symbol, decl);
    walk(type, symbol.name);
  }
  return { exported, met };
}

describe("the core's contract (ADR 0011, D10)", () => {
  it("exports every named type its exports are made of", () => {
    const { exported, met } = reached();
    const missing = [...met].filter(([name]) => !exported.has(name)).map(([name, file]) => `${name} (${file})`);
    expect(missing.sort()).toEqual([]);
  }, 30_000);

  it("builds under the strict options an affiliate may have on (D11)", () => {
    const prog = program(AFFILIATE_STRICT);
    const errors = ts
      .getPreEmitDiagnostics(prog)
      .filter((d) => d.file?.fileName.startsWith(join(ROOT, "src")))
      .map((d) => {
        const at = d.file!.getLineAndCharacterOfPosition(d.start ?? 0);
        const text = ts.flattenDiagnosticMessageText(d.messageText, " ");
        return `${relative(ROOT, d.file!.fileName)}:${at.line + 1} ${text}`;
      });
    expect(errors).toEqual([]);
  }, 30_000);
});
