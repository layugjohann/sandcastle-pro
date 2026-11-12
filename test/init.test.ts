import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTempRepo, useTempHome, writeFile } from "./helpers.js";
import { initProject, loadCodingStandards, loadConfig, STATUSES } from "../src/index.js";

describe("init", () => {
  useTempHome();
  let dir: string;
  let output: string[];
  const log = (line: string) => output.push(line);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sandcastle-pro-init-"));
    output = [];
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("writes a project config a Run can load, with the Gate commands from the flags", async () => {
    await initProject({ repoDir: dir, gate: ["npm test", "npm run typecheck"], log });

    const config = await loadConfig(dir);
    expect(config.gate).toEqual(["npm test", "npm run typecheck"]);
    expect(config.sandbox).toBe("native");
  });

  it.each([
    ["darwin", undefined, "native", /Seatbelt/],
    ["linux", undefined, "native", /bubblewrap/],
    ["darwin", "docker", "docker", /Docker/],
    ["linux", "docker", "docker", /Docker/],
    ["win32", undefined, "docker", /Docker/],
  ] as const)("on %s with sandbox %s, uses %s and says which sandbox Runs will use", async (platform, sandbox, expected, named) => {
    await initProject({ repoDir: dir, gate: ["true"], sandbox, platform, log });

    expect((await loadConfig(dir)).sandbox).toBe(expected);
    expect(output.join("\n")).toMatch(named);
  });

  it("refuses the native sandbox on an OS that has none, and writes nothing", async () => {
    await expect(initProject({ repoDir: dir, gate: ["true"], sandbox: "native", platform: "win32", log })).rejects.toThrow(
      /No native sandbox for win32.*--sandbox docker/,
    );
    expect(readdirSync(dir)).toEqual([]);
  });

  it.each([[[]], [["npm test", " "]]])("refuses the Gate commands %j and writes nothing, since a Run needs at least one real command", async (gate) => {
    await expect(initProject({ repoDir: dir, gate, log })).rejects.toThrow(/at least one Gate command.*--gate/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("writes a Project Coding Standards skeleton that explains `## Must` but adds no rules until the user writes some", async () => {
    await initProject({ repoDir: dir, gate: ["true"], log });

    const skeleton = readFileSync(join(dir, ".sandcastle/CODING_STANDARDS.md"), "utf8");
    expect(skeleton).toMatch(/^## Must$/m);
    expect(skeleton).toMatch(/Critical Finding/);
    const project = (await loadCodingStandards(dir)).find((layer) => layer.name === "Project");
    expect(project?.mustRules).toEqual([]);
    expect(project?.rules).not.toMatch(/[-*] /);
  });

  it("writes an env example with the OAuth token and the API key commented out", async () => {
    await initProject({ repoDir: dir, gate: ["true"], log });

    const example = readFileSync(join(dir, ".sandcastle/.env.example"), "utf8");
    expect(example).toMatch(/^CLAUDE_CODE_OAUTH_TOKEN=$/m);
    expect(example).toMatch(/^# ANTHROPIC_API_KEY=$/m);
  });

  it("leaves existing files untouched and reports them as skipped, so re-running is safe", async () => {
    const files = [
      "sandcastle-pro.config.json",
      ".sandcastle/CODING_STANDARDS.md",
      ".sandcastle/.env.example",
      "docs/agents/sandcastle-pro-issues.md",
      ".gitignore",
    ];
    const mine = (path: string) => (path === ".gitignore" ? "mine\n.sandcastle/.env\n.sandcastle/logs/\n.sandcastle/worktrees/\n" : `mine: ${path}\n`);
    for (const path of files) writeFile(dir, path, mine(path));

    await initProject({ repoDir: dir, gate: ["npm test"], sandbox: "docker", log });

    for (const path of files) {
      expect(readFileSync(join(dir, path), "utf8")).toBe(mine(path));
      expect(output.join("\n")).toMatch(new RegExp(`^skipped +${path.replaceAll(".", "\\.")} `, "m"));
    }
    expect(output.join("\n")).not.toMatch(/^created/m);
    // The flags didn't reach the kept config, so the output must not claim they will be used.
    expect(output.join("\n")).not.toMatch(/Docker|npm test/);
    expect(output.join("\n")).toMatch(/--gate and --sandbox were not applied/);
  });

  it("documents the Issue format, with every status a Run reads or sets, in the project's docs", async () => {
    await initProject({ repoDir: dir, gate: ["true"], log });

    const doc = readFileSync(join(dir, "docs/agents/sandcastle-pro-issues.md"), "utf8");
    expect(doc).toContain(".scratch/<feature>/issues/");
    for (const line of ["Status:", "Blocked by:", "Model:", "Spec:", "## Comments"]) expect(doc).toContain(line);
    for (const status of STATUSES) expect(doc).toContain(`\`${status}\``);
  });

  it("tells the user to run `claude setup-token` and where to put the token", async () => {
    await initProject({ repoDir: dir, gate: ["true"], log });

    expect(output.join("\n")).toMatch(/claude setup-token[\s\S]*\.sandcastle\/\.env[\s\S]*CLAUDE_CODE_OAUTH_TOKEN/);
  });

  it("git-ignores the env file, logs and worktrees, keeping the existing ignore rules", async () => {
    const repo = createTempRepo();
    try {
      repo.write(".gitignore", "node_modules/\n.sandcastle/.env\n");

      await initProject({ repoDir: repo.dir, gate: ["true"], log });

      const ignored = (path: string) => spawnSync("git", ["check-ignore", "-q", path], { cwd: repo.dir }).status === 0;
      expect([".sandcastle/.env", ".sandcastle/logs/run.log", ".sandcastle/worktrees/issue-01/a.ts", "node_modules/x"].filter(ignored)).toHaveLength(4);
      expect([".sandcastle/.env.example", ".sandcastle/CODING_STANDARDS.md", "sandcastle-pro.config.json"].filter(ignored)).toEqual([]);
      const gitignore = repo.read(".gitignore");
      expect(gitignore.startsWith("node_modules/\n.sandcastle/.env\n")).toBe(true);
      expect(gitignore.match(/^\.sandcastle\/\.env$/gm)).toHaveLength(1);
    } finally {
      repo.cleanup();
    }
  });
});
