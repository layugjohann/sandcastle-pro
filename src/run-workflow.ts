import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Agent, AgentResult, Finding, Review } from "./agent.js";
import { loadConfig, type Config } from "./config.js";
import { runGate, type GateResult } from "./gate.js";
import { createIssueStore, type Issue, type IssueStore } from "./issue-store.js";
import { fenced } from "./markdown.js";
import { buildImplementerPrompt, buildReviewPrompt } from "./prompt.js";

const exec = promisify(execFile);

const DEFAULT_COUNT = 1;

export interface RunOptions {
  repoDir: string;
  agent: Agent;
  /** The project config. Defaults to the one read from `repoDir`. */
  config?: Config;
  store?: IssueStore;
  /** Branch the Issue branch starts from. Defaults to the current branch. */
  targetBranch?: string;
  /** The most Issues this Run processes, one after another. Defaults to 1. */
  count?: number;
  log?: (line: string) => void;
}

export type IssueResult =
  | { outcome: "awaiting-merge"; issue: Issue; branch: string; review: Review }
  | { outcome: "spec-disagreement"; issue: Issue; branch: string; review: Review }
  | { outcome: "gate-failed"; issue: Issue; branch: string; review: Review; gate: GateResult & { passed: false } };

export interface RunResult {
  /** The Issues this Run processed, in order. Empty when none was ready. */
  issues: IssueResult[];
}

/**
 * One Run: up to `count` ready Issues, strictly one after another. Each goes
 * through the Implementer, one Review Session, then the Gate. A Gate failure
 * ends the Run, because later Issues may build on the broken one.
 */
export async function runWorkflow(options: RunOptions): Promise<RunResult> {
  const log = options.log ?? ((line: string) => console.log(line));
  const store = options.store ?? createIssueStore(options.repoDir);
  const count = options.count ?? DEFAULT_COUNT;
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`count must be a positive whole number, got ${count}.`);
  }
  const targetBranch = options.targetBranch ?? (await git(options.repoDir, "branch", "--show-current"));
  if (!targetBranch) throw new Error("No target branch: check out a branch, or pass targetBranch.");
  const config = options.config ?? (await loadConfig(options.repoDir));
  const context = { ...options, config, targetBranch, log, store };
  await markMergedIssuesDone(context);

  const issues: IssueResult[] = [];
  while (issues.length < count) {
    const issue = await store.next();
    if (!issue) {
      const progress = issues.length === 0 ? "Nothing to do." : `Processed ${issues.length} of ${count}.`;
      const blocked = (await store.blocked()).map((b) => `Issue ${b.id} is blocked by ${b.blockers.join(", ")}.`);
      log([`No Issue is ready for an agent. ${progress}`, ...blocked].join("\n"));
      break;
    }
    const result = await runIssue(issue, context);
    issues.push(result);
    if (result.outcome === "gate-failed") {
      if (issues.length < count) log(`Stopping the Run: Issue ${issue.id} failed the Gate, so no further Issues are started.`);
      break;
    }
  }
  return { issues };
}

type IssueContext = Omit<RunOptions, "config" | "count" | "log" | "store" | "targetBranch"> & {
  config: Config;
  targetBranch: string;
  log: (line: string) => void;
  store: IssueStore;
};

/** Moves each `awaiting-merge` Issue whose branch the human has merged into the target branch to `done`. */
async function markMergedIssuesDone({ repoDir, targetBranch, store, log }: IssueContext): Promise<void> {
  for (const issue of await store.awaitingMerge()) {
    if (!(await isMerged(repoDir, issue.branch, targetBranch))) continue;
    await store.transition(issue, "done");
    log(`Issue ${issue.id} is done: ${issue.branch} is merged into ${targetBranch}.`);
  }
}

async function isMerged(repoDir: string, branch: string, target: string): Promise<boolean> {
  try {
    await git(repoDir, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`);
    await git(repoDir, "merge-base", "--is-ancestor", branch, target);
    return true;
  } catch (error) {
    // Exit code 1: the branch is missing, or not reachable from the target. Anything else is a real failure.
    if ((error as { code?: unknown }).code === 1) return false;
    throw error;
  }
}

async function runIssue(issue: Issue, options: IssueContext): Promise<IssueResult> {
  const { repoDir, agent, log, store, config, targetBranch: target } = options;
  const { branch } = issue;
  log(`Starting Issue ${issue.id} on ${branch}`);
  await store.transition(issue, "in-progress");
  await ensureBranch(repoDir, branch, target);

  const { effort } = config;
  const model = issue.model ?? config.model;

  const implemented = await agent.run({
    stage: "implementer",
    prompt: buildImplementerPrompt(issue, await readOptional(join(repoDir, "GLOSSARY.md"))),
    model,
    effort,
    branch,
    maxIterations: config.maxIterations.implementer,
  });
  assertCompleted(implemented, "Implementer");

  const reviewed = await agent.run({
    stage: "review-session",
    prompt: buildReviewPrompt(issue, {
      branch,
      commits: await git(repoDir, "log", "--format=%h %s", `${target}..${branch}`),
      diff: await git(repoDir, "diff", `${target}...${branch}`),
    }),
    model,
    effort,
    branch,
    maxIterations: config.maxIterations.reviewSession,
  });
  assertCompleted(reviewed, "Review Session");
  const { review } = reviewed;
  if (!review) {
    // No structured Findings is a failed review, not a clean one; the Gate must not run on it.
    throw new Error(`Review Session on ${branch} returned no structured Findings; Issue ${issue.id} stays in-progress.`);
  }
  const report = findingsForHuman(review.findings);
  if (report) await store.comment(issue, report);

  if (review.specDisagreements.length > 0) {
    // The Spec is the human's decision: log the disagreement, never act on it.
    const disagreements = bullets("Review Session: Spec disagreement (not acted on)", review.specDisagreements);
    await store.comment(issue, disagreements);
    await store.transition(issue, "needs-info");
    log(summary(`Issue ${issue.id} needs info.`, branch, "not run", [disagreements, report]));
    return { outcome: "spec-disagreement", issue, branch, review };
  }

  const gate = await withWorktree(repoDir, branch, (dir) => runGate(config.gate, dir));
  if (!gate.passed) {
    // The branch is left as it is so the human can take over with full context.
    await store.comment(issue, `**Gate failed**\n\n${fenced(gate.output.trim())}`);
    await store.transition(issue, "ready-for-human");
    log(`Gate failed on ${branch}:\n${gate.output}`);
    log(summary(`Issue ${issue.id} did not pass the Gate.`, branch, "failed", [report]));
    return { outcome: "gate-failed", issue, branch, gate, review };
  }

  await store.transition(issue, "awaiting-merge");
  log(summary(`Issue ${issue.id} is awaiting merge.`, branch, "passed", [report]));
  return { outcome: "awaiting-merge", issue, branch, review };
}

/** The Findings the human must see: Non-critical ones, and any Critical one left unfixed. */
function findingsForHuman(findings: readonly Finding[]): string | undefined {
  const sections = [];
  const unfixedCritical = findings.filter((f) => f.severity === "critical" && !f.fixed);
  const nonCritical = findings.filter((f) => f.severity === "non-critical");
  if (unfixedCritical.length > 0) {
    sections.push(bullets("Review Session: Critical Findings not fixed", unfixedCritical.map((f) => f.description)));
  }
  if (nonCritical.length > 0) {
    sections.push(bullets("Review Session: Non-critical Findings", nonCritical.map((f) => f.description)));
  }
  return sections.length > 0 ? sections.join("\n\n") : undefined;
}

function bullets(heading: string, items: readonly string[]): string {
  return `**${heading}**\n\n${items.map((item) => `- ${item}`).join("\n")}`;
}

function summary(headline: string, branch: string, gate: string, sections: readonly (string | undefined)[]): string {
  const body = sections.filter((s) => s !== undefined);
  return [`${headline} Branch: ${branch}. Gate: ${gate}.`, ...(body.length > 0 ? body : ["No Findings to report."])].join("\n\n");
}

function assertCompleted(
  result: AgentResult,
  stage: string,
): asserts result is Extract<AgentResult, { kind: "completed" }> {
  if (result.kind === "completed") return;
  // Pausing at the usage limit is not built yet; the Issue stays in-progress.
  throw new Error(`${stage} stopped at the usage limit (session ${result.sessionId}); pausing is not supported yet.`);
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
