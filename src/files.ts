import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

/** The file's text, or undefined when it doesn't exist. */
export async function readOptional(path: string): Promise<string | undefined> {
  return existsSync(path) ? readFile(path, "utf8") : undefined;
}
