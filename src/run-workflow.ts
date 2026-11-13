import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { readOptional } from "./files.js";
import { AgentCallError, STAGE_NAMES, type AgentCall, type AgentResult, type Agent, type Finding, type Review, type Stage } from "./agent.js";
import { loadCodingStandards } from "./coding-standards.js";
import { loadConfig, type Config } from "./config.js";
import { runGate, withoutNpmExecPath, type GateResult } from "./gate.js";
import { createIssueStore, type Issue, type IssueStore, type PausedAt } from "./issue-store.js";
import { fenced } from "./markdown.js";
import { buildImplementerPrompt, buildResumePrompt, buildReviewPrompt } from "./prompt.js";
import { formatUsage, type IssueUsage } from "./usage.js";

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

/** What every outcome of an Issue carries. `usage` holds only the stages this Run called. */
interface IssueOutcomeDetails {
  issue: Issue;
  branch: string;
  usage: IssueUsage;
}

type ReviewedIssue = IssueOutcomeDetails & { review: Review };

export type IssueResult =
  | ({ outcome: "awaiting-merge" } & ReviewedIssue)
  | ({ outcome: "spec-disagreement" } & ReviewedIssue)
  | ({ outcome: "gate-failed"; gate: GateResult } & ReviewedIssue)
  | ({ outcome: "paused"; pausedAt: PausedAt } & IssueOutcomeDetails);

export interface RunResult {
  /** The Issues this Run processed, in order. Empty when none was ready. */
  issues: IssueResult[];
}

/**
 * One Run: up to `count` ready Issues, strictly one after another. Each goes
 * through the Implementer, one Review Session, then the Gate. A paused Issue is
 * resumed first, in the stage it stopped in. A Gate failure ends the Run, because
 * later Issues may build on the broken one; so does the usage limit, so the human
 * decides when to spend the next window.
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
  try {
    await runIssues(issues, count, context);
  } finally {
    // Printed even when an Issue throws, so the cost of the Issues already finished is not lost.
    if (issues.length > 0) {
      log(["Usage this Run:", ...issues.map((r) => `Issue ${r.issue.id}: ${formatUsage(r.usage)}`)].join("\n"));
    }
  }
  return { issues };
}

/** Processes ready Issues one after another, pushing each result onto `issues` as it finishes. */
async function runIssues(issues: IssueResult[], count: number, context: IssueContext): Promise<void> {
  const { store, log } = context;
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
    if (result.outcome === "paused") {
      if (issues.length < count) log(`Stopping the Run at the usage limit, so no further Issues are started.`);
      break;
    }
  }
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
  const { repoDir, log, store, config, targetBranch: target } = options;
  const { branch } = issue;
  const resume = issue.paused;
  if (resume) log(`Resuming Issue ${issue.id} in the ${STAGE_NAMES[resume.stage]} on ${branch}`);
  else if (issue.status === "paused") log(`Issue ${issue.id} is paused but its pause record is unreadable; starting it fresh on ${branch}`);
  else log(`Starting Issue ${issue.id} on ${branch}`);
  await store.transition(issue, "in-progress");
  await ensureBranch(repoDir, branch, target);

  const { effort } = config;
  const model = issue.model ?? config.model;
  const usage: IssueUsage = {};

  if (resume?.stage !== "review-session") {
    const implemented = await callAgent(issue, options, {
      stage: "implementer",
      prompt: resume
        ? buildResumePrompt("implementer")
        : buildImplementerPrompt(issue, await readOptional(join(repoDir, "GLOSSARY.md"))),
      model,
      effort,
      branch,
      maxIterations: config.maxIterations.implementer,
      resumeSession: resume?.sessionId,
    });
    usage.implementer = implemented.usage;
    if (implemented.kind === "limit-reached") return pauseAtLimit(issue, { stage: "implementer", sessionId: implemented.sessionId }, usage, options);
  }

  const reviewSessionToResume = resume?.stage === "review-session" ? resume.sessionId : undefined;
  const reviewed = await callAgent(issue, options, {
    stage: "review-session",
    prompt: reviewSessionToResume
      ? buildResumePrompt("review-session")
      : buildReviewPrompt(issue, {
          branch,
          commits: await git(repoDir, "log", "--format=%h %s", `${target}..${branch}`),
          diff: await git(repoDir, "diff", `${target}...${branch}`),
          // Loaded only here: the Implementer never pays for Coding Standards.
          standards: await loadCodingStandards(repoDir),
          gate: config.gate,
        }),
    model,
    effort,
    branch,
    maxIterations: config.maxIterations.reviewSession,
    resumeSession: reviewSessionToResume,
  });
  usage["review-session"] = reviewed.usage;
  if (reviewed.kind === "limit-reached") return pauseAtLimit(issue, { stage: "review-session", sessionId: reviewed.sessionId }, usage, options);
  // Every outcome, including a failed review, keeps its cost history with the Issue.
  await store.comment(issue, formatUsage(usage));
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
    return { outcome: "spec-disagreement", issue, branch, review, usage };
  }

  const gate = await withWorktree(repoDir, branch, (dir) => runGate(config.gate, dir));
  const gateLog = await writeGateLog(repoDir, issue, gate);
  if (!gate.passed) {
    // The branch is left as it is so the human can take over with full context.
    await store.comment(issue, `**Gate failed** (log: \`${gateLog}\`)\n\n${fenced(gate.output.trim())}`);
    await store.transition(issue, "ready-for-human");
    log(`Gate failed on ${branch}:\n${gate.output}`);
    log(summary(`Issue ${issue.id} did not pass the Gate.`, branch, `failed (log: ${gateLog})`, [report]));
    return { outcome: "gate-failed", issue, branch, gate, review, usage };
  }

  await store.comment(issue, `**Gate passed**: every command exited 0 (log: \`${gateLog}\`).`);
  await store.transition(issue, "awaiting-merge");
  log(summary(`Issue ${issue.id} is awaiting merge.`, branch, `passed (log: ${gateLog})`, [report]));
  return { outcome: "awaiting-merge", issue, branch, review, usage };
}

/**
 * Calls the Agent. When the call throws, the Issue is not left `in-progress`: its work in progress is
 * committed, then it is paused if the session can be resumed, or else goes back to `ready-for-agent`
 * with an empty branch deleted. The error is then rethrown, ending the Run.
 */
async function callAgent(issue: Issue, options: IssueContext, call: AgentCall): Promise<AgentResult> {
  try {
    return await options.agent.run(call);
  } catch (error) {
    try {
      await recoverFromFailure(issue, call.stage, error, options);
    } catch (recoveryError) {
      options.log(`Could not restore Issue ${issue.id} after the failure: ${String(recoveryError)}`);
    }
    throw error;
  }
}

async function recoverFromFailure(issue: Issue, stage: Stage, error: unknown, options: IssueContext): Promise<void> {
  const { repoDir, store, log, targetBranch } = options;
  const { branch } = issue;
  const stageName = STAGE_NAMES[stage];
  const sessionId = error instanceof AgentCallError ? error.sessionId : undefined;
  if (sessionId) {
    await pauseIssue(issue, { stage, sessionId }, "after a failure", undefined, options);
    log(`Issue ${issue.id} is paused: the ${stageName} failed and the next Run resumes its session.`);
    return;
  }
  await commitWorkInProgress(repoDir, branch, `WIP: ${stageName} failed (sandcastle-pro)`);
  await store.transition(issue, "ready-for-agent");
  const deleted = await deleteBranchIfEmpty(repoDir, branch, targetBranch);
  log(`Issue ${issue.id} is back to ready-for-agent: the ${stageName} failed.${deleted ? ` Deleted the empty ${branch}.` : ""}`);
}

/** Pauses the Issue at the usage limit, so the next Run continues the session. */
async function pauseAtLimit(issue: Issue, pausedAt: PausedAt, usage: IssueUsage, options: IssueContext): Promise<IssueResult> {
  const { branch } = issue;
  await pauseIssue(issue, pausedAt, "at the usage limit", formatUsage(usage), options);
  options.log(
    `Issue ${issue.id} is paused at the usage limit in the ${STAGE_NAMES[pausedAt.stage]}. Branch: ${branch}. Run again once the usage window resets to resume it.`,
  );
  return { outcome: "paused", issue, branch, pausedAt, usage };
}

/** Commits the work in progress, marks the Issue `paused` with its session and stage, and says why in a comment. */
async function pauseIssue(
  issue: Issue,
  pausedAt: PausedAt,
  reason: string,
  details: string | undefined,
  { repoDir, store }: IssueContext,
): Promise<void> {
  const stageName = STAGE_NAMES[pausedAt.stage];
  await commitWorkInProgress(repoDir, issue.branch, `WIP: paused ${reason} in the ${stageName} (sandcastle-pro)`);
  await store.pause(issue, pausedAt);
  const headline = `**Paused ${reason}** in the ${stageName} (session ${pausedAt.sessionId}).`;
  await store.comment(issue, details ? `${headline}\n\n${details}` : headline);
}

/**
 * Commits any uncommitted changes in the worktrees Sandcastle preserved for `branch`
 * under `.sandcastle/worktrees/`, then removes them so the branch can be checked out again.
 */
async function commitWorkInProgress(repoDir: string, branch: string, message: string): Promise<void> {
  const listing = await git(repoDir, "worktree", "list", "--porcelain");
  const preserved = listing
    .split(/\n\s*\n/)
    .filter((entry) => entry.split("\n").includes(`branch refs/heads/${branch}`))
    .map((entry) => /^worktree (.+)$/m.exec(entry)?.[1])
    .filter((path): path is string => path !== undefined && path.includes("/.sandcastle/worktrees/"));
  for (const dir of preserved) {
    if (await git(dir, "status", "--porcelain")) {
      await git(dir, "add", "-A");
      await git(dir, "commit", "-q", "--no-verify", "-m", message);
    }
    await git(repoDir, "worktree", "remove", "--force", dir);
  }
}

/** Deletes `branch` when it has no commits beyond `target`. Returns whether it did. */
async function deleteBranchIfEmpty(repoDir: string, branch: string, target: string): Promise<boolean> {
  if (!(await git(repoDir, "branch", "--list", branch))) return false;
  if ((await git(repoDir, "rev-list", "--count", `${target}..${branch}`)) !== "0") return false;
  await git(repoDir, "branch", "-D", branch);
  return true;
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

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await exec("git", args, { cwd })).stdout.trim();
}

async function ensureBranch(repoDir: string, branch: string, from: string): Promise<void> {
  const exists = await git(repoDir, "branch", "--list", branch);
  if (!exists) await git(repoDir, "branch", branch, from);
}

/** Where Gate logs go, relative to the repo root. Git-ignored by `init`. */
const LOGS_DIR = ".sandcastle/logs";

/**
 * Writes the Gate's full transcript, with the commit it ran on and the PATH it ran with, to its own file under
 * `.sandcastle/logs/`, so a passing Gate leaves a record too. Returns the path relative to the repo root.
 */
async function writeGateLog(repoDir: string, issue: Issue, gate: GateResult): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(LOGS_DIR, `gate-${issue.id}-${stamp}.log`);
  const header = [
    `Issue ${issue.id}, branch ${issue.branch} at ${await git(repoDir, "rev-parse", "--short", issue.branch)}`,
    `Gate ${gate.passed ? "passed" : "failed"}`,
    `PATH=${withoutNpmExecPath(process.env).PATH ?? ""}`,
  ];
  await mkdir(join(repoDir, LOGS_DIR), { recursive: true });
  await writeFile(join(repoDir, path), `${header.join("\n")}\n\n${gate.output}`);
  return path;
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
