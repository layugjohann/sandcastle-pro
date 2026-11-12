import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The git-ignored env file Sandcastle reads, relative to the repo root. */
export const ENV_FILE = ".sandcastle/.env";

export const OAUTH_TOKEN = "CLAUDE_CODE_OAUTH_TOKEN";
export const API_KEY = "ANTHROPIC_API_KEY";

export interface Auth {
  method: "oauth-token" | "api-key";
  /** The env vars to give Claude Code in the sandbox. */
  env: Record<string, string>;
}

/**
 * The credential a Run uses: `CLAUDE_CODE_OAUTH_TOKEN` by default, so the Run bills the Pro subscription,
 * with `ANTHROPIC_API_KEY` as the alternative. Each is read from the env file, then from `processEnv`.
 * Throws an error saying how to set one up when neither is set.
 */
export function resolveAuth(repoDir: string, processEnv: NodeJS.ProcessEnv = process.env): Auth {
  const file = readEnvFile(join(repoDir, ENV_FILE));
  const lookup = (key: string) => file[key] || processEnv[key] || undefined;

  const token = lookup(OAUTH_TOKEN);
  // Claude Code prefers an API key over the token, so the key is blanked to keep the Run on the subscription.
  if (token) return { method: "oauth-token", env: { [OAUTH_TOKEN]: token, [API_KEY]: "" } };
  const key = lookup(API_KEY);
  if (key) return { method: "api-key", env: { [API_KEY]: key } };
  throw new Error(
    `No Claude credentials. Run \`claude setup-token\` and put the token in ${ENV_FILE} as ${OAUTH_TOKEN}=..., ` +
      `or set ${API_KEY} there to bill the API instead.`,
  );
}

/** `KEY=value` lines; blank lines and `#` comments are skipped, and surrounding quotes removed. */
function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const entries: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    const eq = trimmed.indexOf("=");
    if (trimmed === "" || trimmed.startsWith("#") || eq === -1) continue;
    entries[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return entries;
}
