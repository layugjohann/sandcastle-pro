import { existsSync } from "node:fs";
import { join } from "node:path";
import { readOptional } from "./files.js";

/** The checks looked for, cheapest first, so a failing Gate fails fast. */
const CHECKS = ["typecheck", "lint", "test"] as const;

/**
 * Likely Gate commands for the project in `repoDir`, from its package scripts, its Python project config
 * and its Makefile targets, in that order. Empty when none are found.
 */
export async function detectGate(repoDir: string): Promise<string[]> {
  return [...(await fromPackageScripts(repoDir)), ...(await fromPythonConfig(repoDir)), ...(await fromMakefile(repoDir))];
}

interface PackageJson {
  packageManager?: unknown;
  scripts?: Record<string, unknown>;
}

async function fromPackageScripts(repoDir: string): Promise<string[]> {
  const text = await readOptional(join(repoDir, "package.json"));
  if (text === undefined) return [];
  const pkg = JSON.parse(text) as PackageJson;
  const scripts = pkg.scripts ?? {};
  const manager = packageManager(repoDir, pkg);
  return CHECKS.filter((check) => isRealScript(scripts[check])).map((check) => `${manager} run ${check}`);
}

/** The `test` script `npm init` writes always fails, so it is not a check. */
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
  return LOCKFILES.find(([file]) => existsSync(join(repoDir, file)))?.[1] ?? "npm";
}

/** Python tools, cheapest first, each with the config files that hold only its settings. */
const PYTHON_TOOLS: { tool: string; command: string; ownConfig: string[] }[] = [
  { tool: "mypy", command: "mypy .", ownConfig: ["mypy.ini", ".mypy.ini"] },
  { tool: "pyright", command: "pyright", ownConfig: ["pyrightconfig.json"] },
  { tool: "ruff", command: "ruff check .", ownConfig: ["ruff.toml", ".ruff.toml"] },
  { tool: "pytest", command: "pytest", ownConfig: ["pytest.ini"] },
];

/**
 * A tool counts when it has its own config file, or when the shared Python config names it: a
 * `[tool.<name>]` or `[<name>]` section, or a dependency.
 */
async function fromPythonConfig(repoDir: string): Promise<string[]> {
  const pyproject = (await readOptional(join(repoDir, "pyproject.toml"))) ?? "";
  const shared = pyproject + ((await readOptional(join(repoDir, "setup.cfg"))) ?? "");
  const runner = existsSync(join(repoDir, "uv.lock"))
    ? "uv run "
    : existsSync(join(repoDir, "poetry.lock")) || /^\[tool\.poetry\]/m.test(pyproject)
      ? "poetry run "
      : "";
  return PYTHON_TOOLS.filter(
    ({ tool, ownConfig }) => new RegExp(`\\b${tool}\\b`).test(shared) || ownConfig.some((file) => existsSync(join(repoDir, file))),
  ).map(({ command }) => runner + command);
}

/** The names GNU make looks for, in its order. */
const MAKEFILES = ["GNUmakefile", "makefile", "Makefile"];

async function fromMakefile(repoDir: string): Promise<string[]> {
  const file = MAKEFILES.find((name) => existsSync(join(repoDir, name)));
  if (file === undefined) return [];
  const text = (await readOptional(join(repoDir, file))) ?? "";
  // A rule line is `targets: prerequisites`; `:=` and `::=` are variable assignments.
  const targets = new Set(
    [...text.matchAll(/^([\w.\/ -]+?)\s*(?:::(?!=)|:(?![:=]))/gm)].flatMap(([, names = ""]) => names.trim().split(/\s+/)),
  );
  return CHECKS.filter((check) => targets.has(check)).map((check) => `make ${check}`);
}
