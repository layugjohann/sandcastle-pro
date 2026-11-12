import { existsSync } from "node:fs";
import { join } from "node:path";
import { readOptional } from "./files.js";

/** What a Gate command verifies. Listed cheapest first, so a failing Gate fails fast. */
const KINDS = ["typecheck", "lint", "test"] as const;
type Kind = (typeof KINDS)[number];

interface Detected {
  kind: Kind;
  command: string;
}

/**
 * Likely Gate commands for the project in `repoDir`, from its package scripts, then its Python project
 * config, then its Makefile targets. A Makefile target usually wraps the other tools, so it is added only
 * for a kind of command the others don't cover. Empty when none are found.
 */
export async function detectGate(repoDir: string): Promise<string[]> {
  const found = [...(await fromPackageScripts(repoDir)), ...(await fromPythonConfig(repoDir))];
  const covered = new Set(found.map(({ kind }) => kind));
  const make = (await fromMakefile(repoDir)).filter(({ kind }) => !covered.has(kind));
  return [...found, ...make].map(({ command }) => command);
}

interface PackageJson {
  packageManager?: unknown;
  scripts?: Record<string, unknown>;
}

async function fromPackageScripts(repoDir: string): Promise<Detected[]> {
  const text = await readOptional(join(repoDir, "package.json"));
  if (text === undefined) return [];
  let pkg: PackageJson;
  try {
    pkg = JSON.parse(text) as PackageJson;
  } catch (error) {
    throw new Error(`Could not read package scripts: package.json is not valid JSON (${(error as Error).message}).`);
  }
  const scripts = pkg.scripts ?? {};
  const manager = packageManager(repoDir, pkg);
  return KINDS.filter((kind) => isRealScript(scripts[kind])).map((kind) => ({ kind, command: `${manager} run ${kind}` }));
}

/** The `test` script `npm init` writes always fails, so it can't be a Gate command. */
function isRealScript(script: unknown): boolean {
  return typeof script === "string" && script.trim() !== "" && !script.includes("no test specified");
}

const LOCKFILES: [file: string, manager: string][] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
];

/** The `packageManager` field (Corepack) wins over lockfiles; npm when neither says. */
function packageManager(repoDir: string, pkg: PackageJson): string {
  const declared = typeof pkg.packageManager === "string" ? pkg.packageManager.split("@")[0] : "";
  if (declared) return declared;
  return LOCKFILES.find(([file]) => exists(repoDir, file))?.[1] ?? "npm";
}

/** Python tools, cheapest first, each with the config files that hold only its settings. */
const PYTHON_TOOLS: { tool: string; kind: Kind; command: string; ownConfig: string[] }[] = [
  { tool: "mypy", kind: "typecheck", command: "mypy .", ownConfig: ["mypy.ini", ".mypy.ini"] },
  { tool: "pyright", kind: "typecheck", command: "pyright", ownConfig: ["pyrightconfig.json"] },
  { tool: "ruff", kind: "lint", command: "ruff check .", ownConfig: ["ruff.toml", ".ruff.toml"] },
  { tool: "pytest", kind: "test", command: "pytest", ownConfig: ["pytest.ini"] },
];

/**
 * A tool counts when it has its own config file, or when pyproject.toml or setup.cfg has a section for
 * it (`[tool.<name>]`, `[<name>]`, `[tool:<name>]`) or lists it as a dependency. A mere mention, or
 * another package whose name starts with it (`mypy-extensions`, `pytest-cov`), doesn't count.
 */
async function fromPythonConfig(repoDir: string): Promise<Detected[]> {
  const pyproject = (await readOptional(join(repoDir, "pyproject.toml"))) ?? "";
  const setupCfg = (await readOptional(join(repoDir, "setup.cfg"))) ?? "";
  const configText = `${pyproject}\n${setupCfg}`;
  const runner = pythonRunner(repoDir, pyproject);
  return PYTHON_TOOLS.filter(({ tool, ownConfig }) => {
    const section = new RegExp(`^\\[(?:tool[.:])?${tool}[\\].-]`, "m");
    const quotedDependency = new RegExp(`["']${tool}(?![\\w-])`);
    const poetryDependency = new RegExp(`^\\s*${tool}\\s*=`, "m");
    return (
      ownConfig.some((file) => exists(repoDir, file)) ||
      section.test(configText) ||
      quotedDependency.test(pyproject) ||
      poetryDependency.test(pyproject)
    );
  }).map(({ kind, command }) => ({ kind, command: runner + command }));
}

/** The prefix that runs a tool inside the project's environment, when a tool manages it. */
function pythonRunner(repoDir: string, pyproject: string): string {
  if (exists(repoDir, "uv.lock")) return "uv run ";
  if (exists(repoDir, "poetry.lock") || /^\[tool\.poetry\]/m.test(pyproject)) return "poetry run ";
  return "";
}

/** The names GNU make looks for, in its order. */
const MAKEFILES = ["GNUmakefile", "makefile", "Makefile"];

async function fromMakefile(repoDir: string): Promise<Detected[]> {
  const file = MAKEFILES.find((name) => exists(repoDir, name));
  if (file === undefined) return [];
  const text = (await readOptional(join(repoDir, file))) ?? "";
  // A rule line is `targets: prerequisites`; `:=` and `::=` are variable assignments.
  const targets = new Set(
    [...text.matchAll(/^([\w.\/ -]+?)\s*(?:::(?!=)|:(?![:=]))/gm)].flatMap(([, names = ""]) => names.trim().split(/\s+/)),
  );
  return KINDS.filter((kind) => targets.has(kind)).map((kind) => ({ kind, command: `make ${kind}` }));
}

function exists(repoDir: string, file: string): boolean {
  return existsSync(join(repoDir, file));
}
