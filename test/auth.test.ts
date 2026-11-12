import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveAuth } from "../src/index.js";
import { writeFile } from "./helpers.js";

const ENV_FILE = ".sandcastle/.env";

describe("Auth for a Run", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sandcastle-pro-auth-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("uses the OAuth token from the env file, so the Run bills the Pro subscription", () => {
    writeFile(dir, ENV_FILE, "# from claude setup-token\nCLAUDE_CODE_OAUTH_TOKEN=oauth-123\n");

    expect(resolveAuth(dir, {})).toEqual({ method: "oauth-token", env: { CLAUDE_CODE_OAUTH_TOKEN: "oauth-123", ANTHROPIC_API_KEY: "" } });
  });

  it("prefers the OAuth token when the API key is also set", () => {
    writeFile(dir, ENV_FILE, "ANTHROPIC_API_KEY=sk-456\nCLAUDE_CODE_OAUTH_TOKEN=\"oauth-123\"\n");

    expect(resolveAuth(dir, {}).method).toBe("oauth-token");
  });

  it("falls back to the API key when no OAuth token is set", () => {
    writeFile(dir, ENV_FILE, "CLAUDE_CODE_OAUTH_TOKEN=\nANTHROPIC_API_KEY=sk-456\n");

    expect(resolveAuth(dir, {})).toEqual({ method: "api-key", env: { ANTHROPIC_API_KEY: "sk-456" } });
  });

  it("reads the shell environment when the env file is missing", () => {
    expect(resolveAuth(dir, { CLAUDE_CODE_OAUTH_TOKEN: "oauth-from-shell" }).env.CLAUDE_CODE_OAUTH_TOKEN).toBe("oauth-from-shell");
  });

  it("says how to set up a token when neither credential is set", () => {
    writeFile(dir, ENV_FILE, "# CLAUDE_CODE_OAUTH_TOKEN=\n");

    expect(() => resolveAuth(dir, {})).toThrow(/claude setup-token.*\.sandcastle\/\.env.*ANTHROPIC_API_KEY/);
  });
});
