import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Agent, AgentResult, Effort, Finding, Review } from "./agent.js";
import { runGate, type GateResult } from "./gate.js";
import { createIssueStore, type Issue, type IssueStore } from "./issue-store.js";
import { buildImplementerPrompt, buildReviewPrompt } from "./prompt.js";

const exec = promisify(execFile);

export const DEFAULTS = {
  model: "claude-opus-5-5",
  effort: "medium" as Effort,
  implementerMaxIterations: 3,
  reviewMaxIterations: 1,
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
  | { outcome: "awaiting-merge"; issue: Issue; branch: string; review: Review }
  | { outcome: "spec-disagreement"; issue: Issue; branch: string; review: Review }
  | { outcome: "gate-failed"; issue: Issue; branch: string; review: Review; gate: GateResult & { passed: false } };

/** One Run: the next ready Issue goes through the Implementer, one Review Session, then the Gate. */
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

  const model = options.model ?? DEFAULTS.model;
  const effort = options.effort ?? DEFAULTS.effort;

  const implemented = await agent.run({
    stage: "implementer",
    prompt: buildImplementerPrompt(issue, await readOptional(join(repoDir, "GLOSSARY.md"))),
    model,
    effort,
    branch,
    maxIterations: DEFAULTS.implementerMaxIterations,
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
    maxIterations: DEFAULTS.reviewMaxIterations,
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

  const gate = await withWorktree(repoDir, branch, (dir) => runGate(options.gate, dir));
  if (!gate.passed) {
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
