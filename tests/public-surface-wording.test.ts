import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Files that reach readers (the npm tarball, the README files and the changelog) must not
// point at the private development notes this package was built from: links into the
// private repository, internal task and milestone labels, or section numbers of
// unpublished documents. dist is generated from src, so src is what is checked.

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

const INTERNAL_REFERENCE =
  /docs\/superpowers|\bm[0-9]+[ab]?-t[0-9]+|Cycle 1|post-cycle|仮仕様|AC-m[0-9]|HR-m[0-9]|SR-m[0-9]|maplat-v4-crs-libs|provisional specification|§[0-9]/;

function walk(path: string): string[] {
  if (statSync(path).isDirectory()) {
    return readdirSync(path).flatMap((name) => walk(join(path, name)));
  }
  return [path];
}

function publicFiles(): string[] {
  const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
    files?: string[];
  };
  const listed = (packageJson.files ?? []).filter((entry) => entry !== "dist" && !entry.startsWith("dist/"));
  const extra = readdirSync(packageRoot).filter((name) => /^README.*\.md$/.test(name) || name === "CHANGELOG.md");
  const files = new Set<string>();
  for (const entry of [...listed, ...extra]) {
    for (const file of walk(join(packageRoot, entry))) files.add(file);
  }
  return [...files].sort();
}

describe("public files carry no internal references", () => {
  const files = publicFiles();

  it("scans at least one file", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("has no internal reference in the published sources, README files and changelog", () => {
    const hits: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (INTERNAL_REFERENCE.test(line)) hits.push(`${relative(packageRoot, file)}:${index + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
