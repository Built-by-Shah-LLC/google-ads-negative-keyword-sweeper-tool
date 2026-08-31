import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { Soul } from "../types.js";

const VERSION_PATTERN = /^Soul version:\s*`([^`]+)`\s*$/mu;

export async function loadSoul(rootDirectory: string): Promise<Soul> {
  const absolutePath = resolve(rootDirectory, "src/config/soul.md");
  const markdown = await readFile(absolutePath, "utf8");
  return parseSoul(markdown, relative(rootDirectory, absolutePath).replaceAll("\\", "/"));
}

export function parseSoul(markdown: string, sourcePath = "soul.md"): Soul {
  const version = VERSION_PATTERN.exec(markdown)?.[1];
  if (!version) throw new Error(`${sourcePath} is missing a Soul version.`);
  if (!markdown.replace(VERSION_PATTERN, "").trim()) {
    throw new Error(`${sourcePath} has no content beyond the Soul version.`);
  }
  return { version, sourcePath, markdown };
}
