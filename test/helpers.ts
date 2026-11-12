import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Agent, AgentCall, AgentResult } from "../src/index.js";

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

export interface TempRepo {
  dir: string;
  write(path: string, content: string): void;
  read(path: string): string;
  commitAll(message: string): void;
  cleanup(): void;
}

/** A real git repo on `main` in a temp directory, with one initial commit. */
export function createTempRepo(): TempRepo {
  const dir = mkdtempSync(join(tmpdir(), "sandcastle-pro-test-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
  git(dir, "config", "commit.gpgsign", "false");
  const repo: TempRepo = {
    dir,
    write(path, content) {
      const full = join(dir, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    },
    read: (path) => readFileSync(join(dir, path), "utf8"),
    commitAll(message) {
      git(dir, "add", "-A");
      git(dir, "commit", "-q", "-m", message);
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
  repo.write("README.md", "# test project\n");
  repo.commitAll("initial");
  return repo;
}

export function issueFile(opts: { title: string; status?: string; extra?: string }): string {
  const lines = [`# ${opts.title}`, ""];
  if (opts.status) lines.push(`Status: ${opts.status}`);
  lines.push("", "Spec: `.scratch/feature/spec.md`", "", opts.extra ?? "Do the thing.", "");
  return lines.join("\n");
}

export interface FakeAgent extends Agent {
  calls: AgentCall[];
}

/**
 * A scripted Agent that stands in for Sandcastle: it checks out the requested
 * branch in its own worktree, commits a file there, and reports usage.
 */
export function fakeAgent(
  repoDir: string,
  opts: {
    files?: Record<string, string>;
    onCall?: (call: AgentCall) => void;
  } = {},
): FakeAgent {
  const calls: AgentCall[] = [];
  return {
    calls,
    async run(call): Promise<AgentResult> {
      calls.push(call);
      opts.onCall?.(call);
      const worktree = mkdtempSync(join(tmpdir(), "sandcastle-pro-agent-"));
      rmSync(worktree, { recursive: true });
      git(repoDir, "worktree", "add", "-q", worktree, call.branch);
      try {
        for (const [path, content] of Object.entries(opts.files ?? { "feature.txt": "implemented\n" })) {
          const full = join(worktree, path);
          mkdirSync(dirname(full), { recursive: true });
          writeFileSync(full, content);
        }
        git(worktree, "add", "-A");
        git(worktree, "commit", "-q", "-m", "fake agent: implement issue");
      } finally {
        git(repoDir, "worktree", "remove", "--force", worktree);
      }
      return { kind: "completed", usage: { inputTokens: 100, outputTokens: 50 } };
    },
  };
}
