import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Agent, Effort } from "./agent.js";
import { runGate, type GateResult } from "./gate.js";
import { createIssueStore, type Issue, type IssueStore } from "./issue-store.js";
import { buildImplementerPrompt } from "./prompt.js";

const exec = promisify(execFile);

export const DEFAULTS = {
  model: "claude-opus-5-5",
  effort: "medium" as Effort,
  implementerMaxIterations: 3,
};

export interface RunOptions {
  repoDir: string;
  agent: Agent;
  /** Gate commands, run in order in the Issue's branch. */
  gate: readonly string[];
  store?: IssueStore;
  /** Branch the Issue branch starts from. Defaults to the current branch. */
  targetBranch?: string;
  model?: string;
  effort?: Effort;
  log?: (line: string) => void;
}

export type RunResult =
  | { outcome: "no-ready-issue" }
  | { outcome: "awaiting-merge"; issue: Issue; branch: string }
  | { outcome: "gate-failed"; issue: Issue; branch: string; gate: GateResult & { passed: false } };

/** One Run: the next ready Issue goes through the Implementer and the Gate. */
export async function runWorkflow(options: RunOptions): Promise<RunResult> {
  const { repoDir, agent } = options;
  const log = options.log ?? ((line: string) => console.log(line));
  const store = options.store ?? createIssueStore(repoDir);

  const issue = await store.next();
  if (!issue) {
    log("No Issue is ready for an agent. Nothing to do.");
    return { outcome: "no-ready-issue" };
  }

  const target = options.targetBranch ?? (await git(repoDir, "branch", "--show-current"));
  const { branch } = issue;
  log(`Starting Issue ${issue.id} on ${branch}`);
  await store.transition(issue, "in-progress");
  await ensureBranch(repoDir, branch, target);

  const result = await agent.run({
    prompt: buildImplementerPrompt(issue, await readOptional(join(repoDir, "GLOSSARY.md"))),
    model: options.model ?? DEFAULTS.model,
    effort: options.effort ?? DEFAULTS.effort,
    branch,
    maxIterations: DEFAULTS.implementerMaxIterations,
  });
  if (result.kind !== "completed") {
    // Pausing at the usage limit is not built yet; the Issue stays in-progress.
    throw new Error(`Implementer stopped at the usage limit (session ${result.sessionId}); pausing is not supported yet.`);
  }

  const gate = await withWorktree(repoDir, branch, (dir) => runGate(options.gate, dir));
  if (!gate.passed) {
    log(`Gate failed on ${branch}:\n${gate.output}`);
    return { outcome: "gate-failed", issue, branch, gate };
  }

  await store.transition(issue, "awaiting-merge");
  log(`Issue ${issue.id} is awaiting merge. Branch: ${branch}. Gate: passed.`);
  return { outcome: "awaiting-merge", issue, branch };
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await exec("git", args, { cwd })).stdout.trim();
}

async function ensureBranch(repoDir: string, branch: string, from: string): Promise<void> {
  const exists = await git(repoDir, "branch", "--list", branch);
  if (!exists) await git(repoDir, "branch", branch, from);
}

async function withWorktree<T>(repoDir: string, branch: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const parent = await mkdtemp(join(tmpdir(), "sandcastle-pro-gate-"));
  const dir = join(parent, "worktree");
  await git(repoDir, "worktree", "add", "-q", dir, branch);
  try {
    return await fn(dir);
  } finally {
    await git(repoDir, "worktree", "remove", "--force", dir);
    await rm(parent, { recursive: true, force: true });
  }
}

async function readOptional(path: string): Promise<string | undefined> {
  return existsSync(path) ? readFile(path, "utf8") : undefined;
}
