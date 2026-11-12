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
    expect(output.join("\n")).toMatch(/Kept the Gate and sandbox in the existing sandcastle-pro.config.json/);
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

  describe("Gate detection", () => {
    it("detects the test, typecheck and lint package scripts, cheapest first, run with npm by default", async () => {
      writeFile(dir, "package.json", JSON.stringify({ scripts: { build: "tsc", test: "vitest run", lint: "eslint .", typecheck: "tsc --noEmit" } }));

      await initProject({ repoDir: dir, log });

      expect((await loadConfig(dir)).gate).toEqual(["npm run typecheck", "npm run lint", "npm run test"]);
    });

    it.each([
      ["pnpm-lock.yaml", {}, "pnpm"],
      ["yarn.lock", {}, "yarn"],
      ["bun.lock", {}, "bun"],
      ["package-lock.json", {}, "npm"],
      [undefined, { packageManager: "pnpm@9.12.0" }, "pnpm"],
      ["package-lock.json", { packageManager: "yarn@4.5.0" }, "yarn"],
    ] as const)("with lockfile %s and %j, runs the package scripts with %s", async (lockfile, fields, manager) => {
      writeFile(dir, "package.json", JSON.stringify({ ...fields, scripts: { test: "vitest run" } }));
      if (lockfile) writeFile(dir, lockfile, "");

      await initProject({ repoDir: dir, log });

      expect((await loadConfig(dir)).gate).toEqual([`${manager} run test`]);
    });

    it("ignores the placeholder test script `npm init` writes, which always fails", async () => {
      writeFile(dir, "package.json", JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1', lint: "eslint ." } }));

      await initProject({ repoDir: dir, log });

      expect((await loadConfig(dir)).gate).toEqual(["npm run lint"]);
    });

    it.each([
      [
        "pyproject.toml with mypy, ruff and pytest settings",
        { "pyproject.toml": '[project]\nname = "app"\n\n[tool.mypy]\nstrict = true\n\n[tool.ruff.lint]\nselect = ["E"]\n\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\n' },
        ["mypy .", "ruff check .", "pytest"],
      ],
      [
        "uv, with pytest as a dev dependency and pyright settings",
        { "pyproject.toml": '[project]\nname = "app"\n\n[dependency-groups]\ndev = ["pytest>=8"]\n\n[tool.pyright]\n', "uv.lock": "" },
        ["uv run pyright", "uv run pytest"],
      ],
      [
        "Poetry",
        { "pyproject.toml": '[tool.poetry]\nname = "app"\n\n[tool.poetry.group.dev.dependencies]\npytest = "^8"\n' },
        ["poetry run pytest"],
      ],
      ["setup.cfg sections", { "setup.cfg": "[metadata]\nname = app\n\n[mypy]\n\n[tool:pytest]\n" }, ["mypy .", "pytest"]],
      ["standalone config files", { "mypy.ini": "[mypy]\n", "ruff.toml": "", "pytest.ini": "[pytest]\n" }, ["mypy .", "ruff check .", "pytest"]],
    ])("detects Python Gate commands from %s", async (_, files, gate) => {
      for (const [path, content] of Object.entries(files)) writeFile(dir, path, content);

      await initProject({ repoDir: dir, log });

      expect((await loadConfig(dir)).gate).toEqual(gate);
    });

    it("ignores Python tools that are only mentioned, or are a prefix of another package's name", async () => {
      writeFile(
        dir,
        "pyproject.toml",
        '[project]\nname = "app"\n# We lint with ruff in CI only.\ndependencies = ["mypy-extensions>=1"]\n\n[dependency-groups]\ndev = ["pytest-cov", "pytest_mock"]\n',
      );
      writeFile(dir, "Makefile", "test:\n\tpython -m unittest\n");

      await initProject({ repoDir: dir, log });

      expect((await loadConfig(dir)).gate).toEqual(["make test"]);
    });

    it("fails with a message naming package.json when it is not valid JSON, and writes nothing", async () => {
      writeFile(dir, "package.json", "{ scripts: ");

      await expect(initProject({ repoDir: dir, log })).rejects.toThrow(/package\.json/);
      expect(readdirSync(dir)).toEqual(["package.json"]);
    });

    it("detects the test, typecheck and lint Makefile targets, ignoring variables and other targets", async () => {
      writeFile(dir, "Makefile", "TEST := pytest\ntypecheck ::= x\n.PHONY: test lint\n\nbuild:\n\tgo build ./...\n\ntest: build\n\tgo test ./...\n\nlint check:\n\tgolangci-lint run\n");

      await initProject({ repoDir: dir, log });

      expect((await loadConfig(dir)).gate).toEqual(["make lint", "make test"]);
    });

    it("combines package scripts and Python tools, adding Makefile targets only for what they don't cover", async () => {
      writeFile(dir, "package.json", JSON.stringify({ scripts: { test: "vitest run" } }));
      writeFile(dir, "pyproject.toml", "[tool.ruff]\n");
      // The Makefile's test and lint targets likely wrap the commands above, so only typecheck is added.
      writeFile(dir, "makefile", "typecheck:\n\tmypy .\nlint:\n\truff check .\ntest:\n\tnpm test\n");

      await initProject({ repoDir: dir, log });

      expect((await loadConfig(dir)).gate).toEqual(["npm run test", "ruff check .", "make typecheck"]);
    });

    it("fails with a clear message and writes nothing when no Gate commands are detected and no prompt is possible", async () => {
      writeFile(dir, "package.json", JSON.stringify({ scripts: { build: "tsc" } }));

      await expect(initProject({ repoDir: dir, log })).rejects.toThrow(/No Gate commands detected.*--gate "npm test"/s);
      expect(readdirSync(dir)).toEqual(["package.json"]);
    });

    it("uses the --gate commands instead of the detected ones", async () => {
      writeFile(dir, "package.json", JSON.stringify({ scripts: { test: "vitest run" } }));

      await initProject({ repoDir: dir, gate: ["make ci"], log });

      expect((await loadConfig(dir)).gate).toEqual(["make ci"]);
    });
  });

  describe("interactive Gate confirmation", () => {
    /** Answers each prompt in turn, recording the questions; fails the test if init asks more than scripted. */
    function scripted(...answers: string[]) {
      const questions: string[] = [];
      const ask = async (question: string) => {
        questions.push(question);
        const answer = answers.shift();
        if (answer === undefined) throw new Error(`Unscripted prompt: ${question}`);
        return answer;
      };
      return { ask, questions, unanswered: answers };
    }

    beforeEach(() => writeFile(dir, "package.json", JSON.stringify({ scripts: { test: "vitest run", lint: "eslint ." } })));

    it("shows the detected commands and keeps them all when the user just presses Enter", async () => {
      const user = scripted("", "", "");

      await initProject({ repoDir: dir, ask: user.ask, log });

      expect(output.join("\n")).toMatch(/Detected Gate commands/);
      expect(user.questions.slice(0, 2)).toEqual([expect.stringContaining("npm run lint"), expect.stringContaining("npm run test")]);
      expect(user.unanswered).toEqual([]);
      expect((await loadConfig(dir)).gate).toEqual(["npm run lint", "npm run test"]);
    });

    it("lets the user drop detected commands and add their own", async () => {
      const user = scripted("n", "Y", "  npm run e2e  ", "");

      await initProject({ repoDir: dir, ask: user.ask, log });

      expect((await loadConfig(dir)).gate).toEqual(["npm run test", "npm run e2e"]);
    });

    it("asks for commands when none are detected, until the user gives at least one", async () => {
      rmSync(join(dir, "package.json"));
      const user = scripted("", "cargo test", "");

      await initProject({ repoDir: dir, ask: user.ask, log });

      expect(output.join("\n")).toMatch(/No Gate commands detected[\s\S]*at least one/);
      expect((await loadConfig(dir)).gate).toEqual(["cargo test"]);
    });

    it("does not ask when --gate is passed", async () => {
      const user = scripted();

      await initProject({ repoDir: dir, gate: ["make ci"], ask: user.ask, log });

      expect((await loadConfig(dir)).gate).toEqual(["make ci"]);
    });

    it("does not ask when the config already exists, since the answers could not be applied", async () => {
      writeFile(dir, "sandcastle-pro.config.json", JSON.stringify({ gate: ["make ci"] }));
      const user = scripted();

      await initProject({ repoDir: dir, ask: user.ask, log });

      expect(user.questions).toEqual([]);
      expect((await loadConfig(dir)).gate).toEqual(["make ci"]);
    });
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
