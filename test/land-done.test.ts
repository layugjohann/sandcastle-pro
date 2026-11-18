import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTempRepo, git, type TempRepo } from "./helpers.js";

/** The `land-done` script exactly as the README documents it, so the two can't drift apart. */
function landDoneFromReadme(): string {
  const readme = readFileSync(join(import.meta.dirname, "..", "README.md"), "utf8");
  const section = readme.slice(readme.indexOf("### Optional helper: `land-done`"));
  const match = /```sh\n([\s\S]*?)```/.exec(section);
  if (!match) throw new Error("README has no ```sh block under the land-done heading");
  return match[1]!;
}

function issue(status: string): string {
  return `# Issue\n\n**Status:** ${status}\n`;
}

describe("land-done, as documented in the README", () => {
  let repo: TempRepo;
  let scratch: string;
  let script: string;

  beforeEach(() => {
    repo = createTempRepo();
    scratch = mkdtempSync(join(tmpdir(), "sandcastle-pro-land-done-"));
    script = join(scratch, "land-done");
    writeFileSync(script, landDoneFromReadme());
    chmodSync(script, 0o755);

    const origin = join(scratch, "origin.git");
    git(scratch, "init", "-q", "--bare", "-b", "main", origin);
    for (const n of ["01", "02", "03", "07", "08"]) repo.write(`.scratch/f/issues/${n}-x.md`, issue("ready-for-agent"));
    repo.commitAll("Plan");
    git(repo.dir, "remote", "add", "origin", origin);
    git(repo.dir, "push", "-q", "-u", "origin", "main");
    git(repo.dir, "remote", "set-head", "origin", "main");
  });
  afterEach(() => {
    repo.cleanup();
    rmSync(scratch, { recursive: true, force: true });
  });

  const run = () => spawnSync(script, [], { cwd: repo.dir, encoding: "utf8" });
  const changed = () => git(repo.dir, "diff", "--name-only").split("\n").filter(Boolean).sort();

  it("commits and pushes only the done Issues when a non-done one sorts last", () => {
    for (const n of ["01", "02", "03"]) repo.write(`.scratch/f/issues/${n}-x.md`, issue("done"));
    repo.write(".scratch/f/issues/07-x.md", issue("awaiting-merge"));
    repo.write(".scratch/f/issues/08-x.md", issue("in-progress"));

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(git(repo.dir, "log", "-1", "--format=%s")).toBe("Mark Issues 01, 02, 03 as done");
    expect(git(repo.dir, "rev-parse", "origin/main")).toBe(git(repo.dir, "rev-parse", "HEAD"));
    expect(git(repo.dir, "show", "--name-only", "--format=", "HEAD").split("\n").sort()).toEqual(
      ["01", "02", "03"].map((n) => `.scratch/f/issues/${n}-x.md`),
    );
    expect(changed()).toEqual([".scratch/f/issues/07-x.md", ".scratch/f/issues/08-x.md"]);
  });

  it("uses the singular message for one done Issue", () => {
    repo.write(".scratch/f/issues/02-x.md", issue("done"));

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(git(repo.dir, "log", "-1", "--format=%s")).toBe("Mark Issue 02 as done");
  });

  it("exits 0 with a message when no Issue is done", () => {
    repo.write(".scratch/f/issues/07-x.md", issue("awaiting-merge"));

    const result = run();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("no done Issues to commit");
    expect(git(repo.dir, "log", "-1", "--format=%s")).toBe("Plan");
  });

  it("exits 0 with a message when no Issue file changed", () => {
    const result = run();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("no done Issues to commit");
  });

  it("exits 1 when not on the default branch", () => {
    git(repo.dir, "switch", "-q", "-c", "issue/01-x");
    repo.write(".scratch/f/issues/01-x.md", issue("done"));

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("on 'issue/01-x', not 'main'");
    expect(git(repo.dir, "log", "-1", "--format=%s")).toBe("Plan");
  });

  it("says the commit is made and how to recover when the push is rejected", () => {
    const other = join(scratch, "other");
    git(scratch, "clone", "-q", join(scratch, "origin.git"), other);
    git(other, "-c", "user.email=t@example.com", "-c", "user.name=T", "commit", "-q", "--allow-empty", "-m", "Merge pull request");
    git(other, "push", "-q");
    repo.write(".scratch/f/issues/01-x.md", issue("done"));

    const result = run();

    expect(result.status).toBe(1);
    expect(git(repo.dir, "log", "-1", "--format=%s")).toBe("Mark Issue 01 as done");
    expect(result.stderr).toContain("git pull --rebase --autostash");
  });
});
