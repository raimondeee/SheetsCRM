#!/usr/bin/env node
/**
 * Regenerates Word (.docx) and rich-text (.rtf) copies of the setup and
 * security guides from their Markdown sources (macOS textutil).
 *
 * Usage: npm run docs:richtext
 */
import { execFileSync, execSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  statSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = join(root, "node_modules", ".cache", "docs-richtext");

async function loadMarked() {
  try {
    const require = createRequire(import.meta.url);
    return require("marked").marked;
  } catch {
    // fall through — install a local cache copy
  }

  mkdirSync(cacheDir, { recursive: true });
  const pkgJson = join(cacheDir, "package.json");
  if (!existsSync(pkgJson)) {
    writeFileSync(pkgJson, JSON.stringify({ name: "docs-richtext-cache", private: true }, null, 2));
  }
  if (!existsSync(join(cacheDir, "node_modules", "marked"))) {
    console.log("Installing marked (one-time cache for doc export)...");
    execSync("npm install --no-save marked@^15", {
      cwd: cacheDir,
      stdio: "inherit",
    });
  }
  const require = createRequire(join(cacheDir, "package.json"));
  return require("marked").marked;
}

function mdToHtmlDoc(mdPath, title, marked) {
  const body = marked.parse(readFileSync(mdPath, "utf8"), { gfm: true });
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; font-size: 11pt; line-height: 1.45; color: #111; margin: 24px; }
  h1 { font-size: 22pt; margin-top: 0; }
  h2 { font-size: 16pt; margin-top: 28px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  h3 { font-size: 13pt; margin-top: 20px; }
  code, pre { font-family: Menlo, Consolas, monospace; font-size: 9.5pt; }
  pre { background: #f5f5f5; padding: 10px; border: 1px solid #ddd; white-space: pre-wrap; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 10pt; }
  th, td { border: 1px solid #bbb; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #f0f0f0; }
  blockquote { border-left: 3px solid #999; margin-left: 0; padding-left: 12px; }
</style>
</head>
<body>${body}</body>
</html>`;
}

function convert({ mdPath, outBase, title, marked }) {
  const tmp = mkdtempSync(join(tmpdir(), "sheetscrm-docs-"));
  const htmlPath = join(tmp, "doc.html");
  writeFileSync(htmlPath, mdToHtmlDoc(mdPath, title, marked));
  const docxPath = `${outBase}.docx`;
  const rtfPath = `${outBase}.rtf`;
  execFileSync("textutil", ["-convert", "docx", htmlPath, "-output", docxPath]);
  execFileSync("textutil", ["-convert", "rtf", htmlPath, "-output", rtfPath]);
  rmSync(tmp, { recursive: true, force: true });
  console.log(`Wrote ${docxPath} (${statSync(docxPath).size} bytes)`);
  console.log(`Wrote ${rtfPath} (${statSync(rtfPath).size} bytes)`);
}

const marked = await loadMarked();
const docs = join(root, "docs");

convert({
  mdPath: join(root, "README.md"),
  outBase: join(docs, "SheetsCRM-Local-Setup-Guide"),
  title: "SheetsCRM — Local setup guide",
  marked,
});

convert({
  mdPath: join(docs, "ENGINEERING_AND_SECURITY.md"),
  outBase: join(docs, "ENGINEERING_AND_SECURITY"),
  title: "SheetsCRM — Engineering & security reference",
  marked,
});
