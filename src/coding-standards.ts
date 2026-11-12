import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { readOptional } from "./files.js";

export type CodingStandardsLayerName = "Project" | "Personal" | "Preset";

/** One layer of Coding Standards. */
export interface CodingStandardsLayer {
  name: CodingStandardsLayerName;
  /** The layer's text without its `## Must` section. Breaking these rules is a Non-critical Finding. */
  rules: string;
  /** The rules under the layer's `## Must` heading. Breaking one is a Critical Finding. */
  mustRules: string[];
}

/** The Personal layer, relative to the user's home directory, used when `XDG_CONFIG_HOME` is not set. */
export const PERSONAL_CODING_STANDARDS = ".config/sandcastle-pro/CODING_STANDARDS.md";
/** The Project layer, relative to the repo root. */
export const PROJECT_CODING_STANDARDS = ".sandcastle/CODING_STANDARDS.md";

/** The Preset layer: universal rules shipped with the package. None are Must Rules, so style never uses up the window. */
const PRESET_CODING_STANDARDS = `# Preset Coding Standards

- Names say what a thing is or does, in the project's domain terms.
- Each function does one thing; split long functions at their natural seams.
- No dead code, commented-out code or unused imports, variables or parameters.
- No duplicated logic: reuse an existing helper before writing a new one.
- Errors are handled or propagated with a message naming the problem, never swallowed silently.
- Comments explain why, not what. Keep them true when the code changes.
- Tests check behavior through public interfaces, not implementation details.
- Follow the conventions already used in the surrounding code.
`;

/**
 * Loads the Coding Standards layers, highest precedence first: Project, Personal, Preset.
 * A missing Personal or Project file is skipped.
 */
export async function loadCodingStandards(repoDir: string): Promise<CodingStandardsLayer[]> {
  const sources: [CodingStandardsLayerName, string | undefined][] = [
    ["Project", await readOptional(join(repoDir, PROJECT_CODING_STANDARDS))],
    ["Personal", await readOptional(personalPath())],
    ["Preset", PRESET_CODING_STANDARDS],
  ];
  return sources.flatMap(([name, text]) => (text === undefined ? [] : [parseLayer(name, text)]));
}

/** The Personal layer's file: under `XDG_CONFIG_HOME` when it is set to an absolute path, else `~/.config`. */
function personalPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  // The XDG spec says a relative value is invalid and must be ignored.
  if (xdg && isAbsolute(xdg)) return join(xdg, "sandcastle-pro", "CODING_STANDARDS.md");
  return join(homedir(), PERSONAL_CODING_STANDARDS);
}

/**
 * Splits a layer into its `## Must` (or `## Must Rules`) section, as separate Must Rules, and everything else.
 * HTML comments are notes to the author, such as the examples in the skeleton `init` writes, and are dropped.
 */
function parseLayer(name: CodingStandardsLayerName, text: string): CodingStandardsLayer {
  const nonMustLines: string[] = [];
  const mustLines: string[] = [];
  let inMust = false;
  for (const { line, heading } of classifyLines(text.replace(/<!--[\s\S]*?-->/g, ""))) {
    // A Must section runs until the next heading at its own level or above.
    if (heading !== undefined && heading.level <= 2) inMust = heading.level === 2 && /^must(?: rules?)?$/i.test(heading.title);
    else if (inMust) {
      mustLines.push(line);
      continue;
    }
    if (!inMust) nonMustLines.push(line);
  }
  return { name, rules: nonMustLines.join("\n").trim(), mustRules: splitRules(mustLines) };
}

/** Tags each line with its heading, if it is one. Lines inside fenced code blocks are never headings. */
function classifyLines(text: string): { line: string; heading?: { level: number; title: string } }[] {
  let fence: string | undefined;
  return text.split(/\r?\n/).map((line) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && (fence === undefined || (marker[0] === fence[0] && marker.length >= fence.length))) {
      fence = fence === undefined ? marker : undefined;
      return { line };
    }
    const match = fence === undefined ? /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line) : null;
    return match ? { line, heading: { level: match[1]!.length, title: match[2]! } } : { line };
  });
}

/**
 * Each top-level list item or paragraph is one rule; continuation lines and nested
 * items join it. A fenced code block stays whole. Subheadings are not rules.
 */
function splitRules(lines: readonly string[]): string[] {
  const rules: string[][] = [];
  let current: string[] | undefined;
  let inFence = false;
  for (const line of lines) {
    const isFence = /^\s*(`{3,}|~{3,})/.test(line);
    if (!inFence && (line.trim() === "" || /^#{1,6}\s/.test(line))) {
      current = undefined;
      continue;
    }
    const item = inFence ? null : /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (item || !current) rules.push((current = []));
    current.push((item ? item[1]! : line).trim());
    if (isFence) inFence = !inFence;
  }
  return rules.map((rule) => rule.join(" "));
}
