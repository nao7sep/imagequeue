import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { parse } from "@babel/parser";
import { describe, expect, it } from "vitest";

// Interface text comes from the catalogues. This scan fails on words written
// straight into JSX: text between tags, a string in braces, or a string given
// to an attribute a person reads or hears. Names and literal values that are
// the same in every language are listed.

const SOURCE = join(process.cwd(), "src/renderer/src");

const READ_ATTRIBUTES = new Set([
  "title",
  "aria-label",
  "aria-description",
  "placeholder",
  "alt",
  "label",
  "passiveContentLabel",
]);

const LITERAL_TEXT = new Set([
  // Brand and product names.
  "ImageQueue",
  "GitHub",
  "GPT Image",
  "Nano Banana",
  "Grok Imagine",
  "FLUX",
  "Draw Things",
  "Hugging Face",
  "Google",
  // A file name, shown as it is.
  "custom.json",
]);
// Entries the scan met, so one that no longer matches anything fails.
const usedLiterals = new Set<string>();

type Node = { type: string; loc?: { start: { line: number } }; [key: string]: unknown };

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

function hasWords(text: string): boolean {
  if (LITERAL_TEXT.has(text.trim())) {
    usedLiterals.add(text.trim());
    return false;
  }
  return /\p{L}/u.test(text);
}

function literalText(node: Node | undefined): string | null {
  if (!node) return null;
  if (node.type === "StringLiteral") return node.value as string;
  if (node.type === "TemplateLiteral") {
    return (node.quasis as Array<{ value: { cooked: string } }>).map((quasi) => quasi.value.cooked).join(" ");
  }
  return null;
}

function findings(file: string): string[] {
  const ast = parse(readFileSync(file, "utf8"), { sourceType: "module", plugins: ["jsx", "typescript"] });
  const found: string[] = [];
  const report = (node: Node, text: string) =>
    found.push(`${relative(process.cwd(), file)}:${node.loc?.start.line}: ${JSON.stringify(text.trim())}`);

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node === null || typeof node !== "object" || typeof (node as Node).type !== "string") return;
    const current = node as Node;

    // A <kbd> names keycaps, whose tokens stay English in every language
    // (keyboard-shortcut-conventions); its contents are not interface text.
    if (current.type === "JSXElement") {
      const opening = current.openingElement as { name: { type: string; name?: string } };
      if (opening.name.type === "JSXIdentifier" && opening.name.name === "kbd") return;
    }
    if (current.type === "JSXText" && hasWords(current.value as string)) {
      report(current, current.value as string);
    }
    if (current.type === "JSXExpressionContainer" && current.expression) {
      const text = literalText(current.expression as Node);
      // An attribute's braces are judged with the attribute below.
      if (text !== null && hasWords(text) && !(current as { inAttribute?: boolean }).inAttribute) {
        report(current, text);
      }
    }
    if (current.type === "JSXAttribute") {
      const name = (current.name as { name: string }).name;
      const value = current.value as Node | null;
      if (value?.type === "JSXExpressionContainer") {
        (value as { inAttribute?: boolean }).inAttribute = true;
      }
      const text = value?.type === "JSXExpressionContainer" ? literalText(value.expression as Node) : literalText(value ?? undefined);
      if (READ_ATTRIBUTES.has(name) && text !== null && hasWords(text)) {
        report(current, text);
      }
    }

    for (const [key, child] of Object.entries(current)) {
      if (key !== "loc" && key !== "start" && key !== "end") visit(child);
    }
  };

  visit(ast.program);
  return found;
}

describe("interface text", () => {
  it("comes from the catalogues, not from JSX literals", () => {
    const all = tsxFiles(SOURCE).flatMap(findings);
    expect(all).toEqual([]);
    expect([...LITERAL_TEXT].filter((text) => !usedLiterals.has(text)), "allowed literals that match nothing").toEqual([]);
  });

  // The scan can fail: a planted literal in each place it reads is found.
  it("finds a literal in text, an expression and a read attribute", () => {
    const dir = mkdtempSync(join(tmpdir(), "hardcoded-text-"));
    const file = join(dir, "Planted.tsx");
    try {
      writeFileSync(file, 'export const A = () => <div title="Planted title">Planted text{"Planted expression"}</div>\n');
      expect(findings(file).map((finding) => finding.replace(/^.*: /, ""))).toEqual(['"Planted title"', '"Planted text"', '"Planted expression"']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
