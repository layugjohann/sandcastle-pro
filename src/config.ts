import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { EFFORTS, type Effort } from "./agent.js";

/** The project config file `init` writes at the repo root. */
export const CONFIG_FILE = "sandcastle-pro.config.json";

/** "native" is Seatbelt on macOS and bubblewrap on Linux; "docker" trades setup for stronger isolation. */
export const SANDBOXES = ["native", "docker"] as const;

export type SandboxChoice = (typeof SANDBOXES)[number];

/** The Preset's project config, with every default filled in. */
export interface Config {
  /** Gate commands, run in order in the Issue's branch. */
  gate: string[];
  /** Default model; an Issue's `Model:` line overrides it for that Issue. */
  model: string;
  effort: Effort;
  maxIterations: { implementer: number; reviewSession: number };
  sandbox: SandboxChoice;
}

export const DEFAULT_CONFIG: Omit<Config, "gate"> = {
  model: "claude-opus-5-5",
  effort: "medium",
  maxIterations: { implementer: 3, reviewSession: 1 },
  sandbox: "native",
};

/** Reads and validates `sandcastle-pro.config.json` in `repoDir`. Throws an error naming the problem. */
export async function loadConfig(repoDir: string): Promise<Config> {
  const path = join(repoDir, CONFIG_FILE);
  if (!existsSync(path)) {
    throw new Error(`No ${CONFIG_FILE} in ${repoDir}. Run \`npx sandcastle-pro init\` to create one.`);
  }
  return parseConfig(await readFile(path, "utf8"));
}

/** Validates the text of a config file and fills in defaults. Throws an error naming the problem. */
function parseConfig(text: string): Config {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw configError(`is not valid JSON: ${(error as Error).message}`);
  }
  if (!isObject(raw)) throw configError("must be a JSON object.");
  rejectUnknownKeys(raw, ["gate", "model", "effort", "maxIterations", "sandbox"], "");

  const { gate, model, effort, maxIterations, sandbox } = raw;
  if (gate === undefined) throw configError(`is missing "gate": list the Gate commands, e.g. ["npm test"].`);
  if (!Array.isArray(gate) || gate.length === 0 || !gate.every((c) => typeof c === "string" && c.trim() !== "")) {
    // An empty Gate would pass every change, so at least one command is required.
    throw configError(`"gate" must be a non-empty list of command strings, got ${JSON.stringify(gate)}.`);
  }
  if (model !== undefined && (typeof model !== "string" || model.trim() === "")) {
    throw configError(`"model" must be a non-empty string, got ${JSON.stringify(model)}.`);
  }
  if (effort !== undefined && !EFFORTS.includes(effort as Effort)) {
    throw configError(`"effort" must be one of ${EFFORTS.join(", ")}, got ${JSON.stringify(effort)}.`);
  }
  if (sandbox !== undefined && !SANDBOXES.includes(sandbox as SandboxChoice)) {
    throw configError(`"sandbox" must be one of ${SANDBOXES.join(", ")}, got ${JSON.stringify(sandbox)}.`);
  }
  if (maxIterations !== undefined && !isObject(maxIterations)) {
    throw configError(`"maxIterations" must be an object, got ${JSON.stringify(maxIterations)}.`);
  }
  const limits = maxIterations ?? {};
  rejectUnknownKeys(limits, ["implementer", "reviewSession"], "maxIterations.");
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isInteger(value) || (value as number) < 1) {
      throw configError(`"maxIterations.${key}" must be a positive whole number, got ${JSON.stringify(value)}.`);
    }
  }

  return {
    gate: gate as string[],
    model: (model as string | undefined) ?? DEFAULT_CONFIG.model,
    effort: (effort as Effort | undefined) ?? DEFAULT_CONFIG.effort,
    maxIterations: { ...DEFAULT_CONFIG.maxIterations, ...(limits as Partial<Config["maxIterations"]>) },
    sandbox: (sandbox as SandboxChoice | undefined) ?? DEFAULT_CONFIG.sandbox,
  };
}

function rejectUnknownKeys(object: Record<string, unknown>, known: readonly string[], prefix: string): void {
  const unknown = Object.keys(object).find((key) => !known.includes(key));
  if (unknown !== undefined) {
    throw configError(`has an unknown key "${prefix}${unknown}". Known keys: ${known.map((k) => prefix + k).join(", ")}.`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function configError(problem: string): Error {
  return new Error(`${CONFIG_FILE} ${problem}`);
}
