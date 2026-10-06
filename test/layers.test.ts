/**
 * The layer rule of ADR 0011, D1 — checked, because a rule that is not
 * checked always ends up no longer true.
 *
 * The core (`machines/`, `sip/`, `storage/`, `core/`, `deployment.ts`,
 * `accounts.ts`, `i18n/types.ts`, `share/link.ts`) is what an affiliated project builds its
 * own UI on. It must therefore:
 *
 * - import nothing but the core itself, and npm packages an affiliate gets
 *   by installing Trix — `dependencies`, never `devDependencies` (D11);
 * - leave the page alone: no DOM tree (`document`, elements, styles) and no
 *   alert channel (`Notification`, sound, service worker, vibration). The
 *   web platform APIs that are not display — WebRTC, IndexedDB, Web Storage,
 *   WebCrypto — are allowed; the rest comes by injection (D7).
 *
 * And it keeps no state at module level (D8): two instances on a page must
 * not see each other. A top-level `let` is what gives such state away; the
 * few that are there on purpose are listed in `MODULE_STATE`, with why.
 *
 * One part of the core is the exception by design: `core/browser/`, the
 * default `Platform` (D7). It listens to the page — `document` and `window`
 * events — and nothing else; an element or an alert channel there is still
 * a violation.
 *
 * The source is read as TypeScript syntax, not searched as text: the word
 * `Notification` in an IMDN header name or in a comment is not a violation.
 *
 * The UI (`ui/`, `main.ts`) is the first client of the core, and must be
 * one like any other (D2, D3): it reads the view and sends the facade's
 * commands, never a machine. It imports nothing from `machines/` — not even
 * a type, which the facade re-exports.
 *
 * Known violations are listed in `KNOWN`, each with the decision that will
 * remove it. The list must match exactly: a new violation fails, and so does
 * an entry that no longer occurs — fixing one means crossing it off here.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Is this file (repo-relative, `/`-separated) part of the core? */
function isCore(file: string): boolean {
  return (
    /^src\/(machines|sip|storage|core)\//.test(file) ||
    ["src/deployment.ts", "src/accounts.ts", "src/i18n/types.ts", "src/share/link.ts"].includes(file)
  );
}

/** Globals that are the page itself, or one of its alert channels. */
const PAGE_GLOBALS = new Set([
  "document",
  "window",
  "Notification",
  "Audio",
  "AudioContext",
  "Image",
  "customElements",
  "getComputedStyle",
  "matchMedia",
  "requestAnimationFrame",
]);
/** What the browser platform (D7) may use: the page's events, heard, never changed. */
const PLATFORM_ADAPTER = /^src\/core\/browser\//;
const LISTENING = new Set(["uses document", "uses window"]);

/** Element types: handing them over is what D4 replaces with streams. */
const ELEMENT_TYPE = /^(HTML|SVG)\w*Element$/;
/** `navigator` is allowed (media devices, storage); these members are not. */
const NAVIGATOR_MEMBERS = new Set(["serviceWorker", "vibrate"]);

const PACKAGE = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
};
const SHIPPED = new Set(Object.keys(PACKAGE.dependencies ?? {}));

/** `@scope/name/sub` → `@scope/name`, `name/sub` → `name`. */
function packageOf(spec: string): string {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

/** Is this identifier a reference to a global, rather than a name in a declaration or after a dot? */
function isReference(id: ts.Identifier): boolean {
  const p = id.parent;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
  if (ts.isQualifiedName(p) && p.right === id) return false;
  if ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p)) && p.name === id) {
    return false;
  }
  if ((ts.isMethodDeclaration(p) || ts.isMethodSignature(p)) && p.name === id) return false;
  if ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isBindingElement(p)) && p.name === id) return false;
  if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p)) return false;
  return true;
}

/**
 * What a core file does that the rule forbids, one line per kind of
 * violation, sorted: `imports src/ui/x.ts`, `uses document`…
 */
function violations(file: string, source: string): string[] {
  const found = new Set<string>();
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const checkSpecifier = (spec: string) => {
    if (spec.startsWith(".")) {
      const target = posix.normalize(posix.join(posix.dirname(file), spec)).replace(/\.js$/, ".ts");
      if (!isCore(target)) found.add(`imports ${target}`);
    } else if (!SHIPPED.has(packageOf(spec))) {
      found.add(`imports ${spec} (not a dependency)`);
    }
  };

  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (ts.isStringLiteral(node.moduleSpecifier)) checkSpecifier(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      checkSpecifier(node.arguments[0].text);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      checkSpecifier(node.argument.literal.text);
    } else if (ts.isIdentifier(node) && isReference(node)) {
      if (PAGE_GLOBALS.has(node.text) || ELEMENT_TYPE.test(node.text)) found.add(`uses ${node.text}`);
    } else if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "navigator" &&
      NAVIGATOR_MEMBERS.has(node.name.text)
    ) {
      found.add(`uses navigator.${node.name.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (PLATFORM_ADAPTER.test(file)) for (const v of LISTENING) found.delete(v);
  return [...found].sort();
}

/** The variables a core file declares with `let` or `var` at its top level. */
function moduleState(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return sf.statements.flatMap((st) => {
    if (!ts.isVariableStatement(st) || st.declarationList.flags & ts.NodeFlags.Const) return [];
    return st.declarationList.declarations.map((d) => d.name.getText(sf));
  });
}

/** Is this file part of Trix's own UI? */
function isUi(file: string): boolean {
  return file.startsWith("src/ui/") || file === "src/main.ts";
}

/** The modules a file imports, statically, dynamically or as types — repo-relative. */
function importsOf(file: string, source: string): string[] {
  const found = new Set<string>();
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const visit = (node: ts.Node) => {
    let spec: string | null = null;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (ts.isStringLiteral(node.moduleSpecifier)) spec = node.moduleSpecifier.text;
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      spec = node.arguments[0].text;
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      spec = node.argument.literal.text;
    }
    if (spec?.startsWith(".")) {
      found.add(posix.normalize(posix.join(posix.dirname(file), spec)).replace(/\.js$/, ".ts"));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return [...found].sort();
}

/** Every `.ts` file under `src/`, repo-relative. */
function sources(dir = join(ROOT, "src")): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return e.name.endsWith(".ts") ? [relative(ROOT, path).split("\\").join("/")] : [];
  });
}

/**
 * The violations that exist today, and the decision of ADR 0011 that
 * removes each one. Cross an entry off once it is fixed — the test insists.
 */
const KNOWN: Record<string, string[]> = {
  // D9: `MsgKey = keyof fr` — the core's message keys are the UI dictionary's.
  // Goes with `CoreMsgKey` and `core/i18n/`.
  "src/i18n/types.ts": ["imports src/i18n/locales/fr.ts"],
};

/**
 * Module state the core keeps on purpose: what belongs to the page or to
 * JsSIP — shared by every instance whatever we do — not to an instance.
 */
const MODULE_STATE: Record<string, string[]> = {
  // JsSIP's prototype is patched once per page (its registry is a `const` Map)
  "src/sip/digest.ts": ["installed"],
  // storage persistence is the origin's, asked once
  "src/storage/store.ts": ["persistenceAsked"],
};

describe("layers (ADR 0011, D1)", () => {
  it("the core imports only the core and shipped dependencies, and leaves the page alone", () => {
    const actual: Record<string, string[]> = {};
    for (const file of sources().filter(isCore)) {
      const v = violations(file, readFileSync(join(ROOT, file), "utf8"));
      if (v.length) actual[file] = v;
    }
    expect(actual).toEqual(KNOWN);
  });

  it("the core keeps no state at module level but the page's and JsSIP's (D8)", () => {
    const actual: Record<string, string[]> = {};
    for (const file of sources().filter(isCore)) {
      const names = moduleState(file, readFileSync(join(ROOT, file), "utf8"));
      if (names.length) actual[file] = names;
    }
    expect(actual).toEqual(MODULE_STATE);
  });

  it("the UI reaches the core through the facade, never a machine (D2, D3)", () => {
    const actual: Record<string, string[]> = {};
    for (const file of sources().filter(isUi)) {
      const machines = importsOf(file, readFileSync(join(ROOT, file), "utf8")).filter((f) =>
        f.startsWith("src/machines/"),
      );
      if (machines.length) actual[file] = machines;
    }
    expect(actual).toEqual({});
  });

  it("sees an import of a machine from the UI, type-only included", () => {
    expect(importsOf("src/ui/x.ts", `import type { PhoneInstance } from "../machines/phone.js";`)).toEqual([
      "src/machines/phone.ts",
    ]);
    expect(importsOf("src/ui/screens/x.ts", `let v: import("../../machines/events.js").CallView;`)).toEqual([
      "src/machines/events.ts",
    ]);
  });

  it("sees a top-level let, not a const nor a local one", () => {
    expect(moduleState("x.ts", `let a = 1; var b; const c = 2; function f() { let d = 3; }`)).toEqual(["a", "b"]);
  });

  // The rule is only worth something if the checker sees what it must see.
  describe("the checker", () => {
    const check = (source: string) => violations("src/machines/x.ts", source);

    it("sees an import of the UI, static, dynamic or type-only", () => {
      expect(check(`import { a } from "../ui/app.js";`)).toEqual(["imports src/ui/app.ts"]);
      expect(check(`const m = await import("../main.js");`)).toEqual(["imports src/main.ts"]);
      expect(check(`import type { T } from "../ui/thread.js";`)).toEqual(["imports src/ui/thread.ts"]);
      expect(check(`let t: import("../ui/thread.js").T;`)).toEqual(["imports src/ui/thread.ts"]);
    });

    it("lets the core import itself and shipped packages, not dev tools", () => {
      expect(check(`import { x } from "../sip/port.js"; import JsSIP from "jssip";`)).toEqual([]);
      expect(check(`import { x } from "./phone.js"; import { y } from "../core/view.js";`)).toEqual([]);
      expect(check(`import { describe } from "vitest";`)).toEqual(["imports vitest (not a dependency)"]);
    });

    it("sees the page and its alert channels", () => {
      expect(check(`document.title = "x";`)).toEqual(["uses document"]);
      expect(check(`new Notification("x");`)).toEqual(["uses Notification"]);
      expect(check(`function f(v: HTMLVideoElement) {}`)).toEqual(["uses HTMLVideoElement"]);
      expect(check(`navigator.serviceWorker.register("sw.js");`)).toEqual(["uses navigator.serviceWorker"]);
    });

    it("lets the browser platform listen to the page, and nothing more", () => {
      const adapter = (source: string) => violations("src/core/browser/x.ts", source);
      expect(adapter(`document.addEventListener("freeze", f); window.addEventListener("keydown", f);`)).toEqual([]);
      expect(adapter(`new Notification("x");`)).toEqual(["uses Notification"]);
      expect(adapter(`import { a } from "../../ui/app.js";`)).toEqual(["imports src/ui/app.ts"]);
    });

    it("lets through the platform APIs that are not display, and mere names", () => {
      expect(check(`navigator.mediaDevices.getUserMedia({ audio: true });`)).toEqual([]);
      expect(check(`localStorage.getItem("k"); indexedDB.open("trix");`)).toEqual([]);
      // an IMDN header, a property and a comment are not the global
      expect(check(`// new Notification\nconst h = "imdn.Disposition-Notification"; x.document = 1;`)).toEqual([]);
      expect(check(`const o = { window: 1 }; function f(document: string) {}`)).toEqual([]);
    });
  });
});
