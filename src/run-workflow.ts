import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { promisify } from "node:util";
import { readOptional } from "./files.js";
import { AgentCallError, STAGE_NAMES, type AgentCall, type AgentResult, type Agent, type Finding, type PausableStage, type Review } from "./agent.js";
import { loadCodingStandards } from "./coding-standards.js";
import { loadConfig, type Config } from "./config.js";
import { runGate, withoutNpmExecPath, type GateResult } from "./gate.js";
import { baseOf, createIssueStore, mergeIssueFile, type BlockedIssue, type Issue, type IssueStore, type PausedAt } from "./issue-store.js";
import { fenced } from "./markdown.js";
import { buildBodyWriterPrompt, buildImplementerPrompt, buildResumePrompt, buildReviewPrompt } from "./prompt.js";
import { createGitHubPublisher, type Publisher } from "./publisher.js";
import { buildPullRequestBody, buildWrittenPullRequestBody, stackedOnText, truncateStart, type PullRequestBodyInput, type StackedOnBlocker } from "./pull-request-body.js";
import { formatUsage, type IssueUsage } from "./usage.js";

const exec = promisify(execFile);

const DEFAULT_COUNT = 1;

export interface RunOptions {
  repoDir: string;
  agent: Agent;
  /** The project config. Defaults to the one read from `repoDir`. */
  config?: Config;
  store?: IssueStore;
  /** Publishes Pull Requests and reads their state, when `config.pullRequest` is on. Defaults to `git` and `gh`. */
  publisher?: Publisher;
  /**
   * Branch the Issue branch starts from, unless it is a Stacked Issue, and the branch the Run pulls and detects merges
   * into. Defaults to the current branch.
   */
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

/** What happened when the Run tried to publish the Issue as a Pull Request. */
export type PublishResult = { published: true; url: string; error?: string } | { published: false; error: string };

/**
 * Whether the body writer wrote the Pull Request's body. When it did not, the deterministic body was used,
 * and `limitReached` says whether the usage limit was why, which ends the Run after this Issue.
 */
export type BodyWriterResult = { written: true } | { written: false; reason: string; limitReached: boolean };

export type IssueResult =
  | ({
      outcome: "awaiting-merge";
      /** Absent when `pullRequest` is off. */
      pullRequest?: PublishResult;
      /** Absent when `pullRequest` is off. */
      bodyWriter?: BodyWriterResult;
    } & ReviewedIssue)
  | ({ outcome: "spec-disagreement" } & ReviewedIssue)
  | ({ outcome: "gate-failed"; gate: GateResult } & ReviewedIssue)
  | ({ outcome: "critical-unfixed"; unfixedCritical: Finding[] } & ReviewedIssue)
  | ({ outcome: "paused"; pausedAt: PausedAt } & IssueOutcomeDetails)
  /** A Stacked Issue whose `Stacked on:` branch is gone locally, so it went to `ready-for-human` without being worked on. */
  | ({ outcome: "base-missing"; base: string } & IssueOutcomeDetails)
  /**
   * With `"stack": "run"`, a `ready-for-agent` Issue whose `Stacked on:` branch is no longer the top of the Stack, so it
   * went to `ready-for-human` without being worked on. `top` is the top's branch, or the target branch when the Stack is empty.
   */
  | ({ outcome: "base-moved"; base: string; top: string } & IssueOutcomeDetails);

export interface RunResult {
  /** The Issues this Run processed, in order. Empty when none was ready. */
  issues: IssueResult[];
}

/**
 * One Run: up to `count` ready Issues, strictly one after another. Each goes
 * through the Implementer, one Review Session, then the Gate. A paused Issue is
 * resumed first, in the stage it stopped in. A Gate failure, or a Critical Finding the
 * Review Session left unfixed, ends the Run, because later Issues may build on the
 * broken one; so does the usage limit, so the human decides when to spend the next window.
 */
export async function runWorkflow(options: RunOptions): Promise<RunResult> {
  const log = options.log ?? ((line: string) => console.log(line));
  const count = options.count ?? DEFAULT_COUNT;
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`count must be a positive whole number, got ${count}.`);
  }
  const targetBranch = options.targetBranch ?? (await git(options.repoDir, "branch", "--show-current"));
  if (!targetBranch) throw new Error("No target branch: check out a branch, or pass targetBranch.");
  const config = options.config ?? (await loadConfig(options.repoDir));
  const store = options.store ?? createIssueStore(options.repoDir, { stack: config.stack });
  const publisher = options.publisher ?? createGitHubPublisher(options.repoDir);
  const context = { ...options, config, targetBranch, log, store, publisher };
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
      log([`No Issue is ready for an agent. ${progress}`, ...blockedLines(await store.blocked())].join("\n"));
      break;
    }
    const result = await runIssue(issue, context);
    issues.push(result);
    if (result.outcome === "gate-failed") {
      if (issues.length < count) log(`Stopping the Run: Issue ${issue.id} failed the Gate, so no further Issues are started.`);
      break;
    }
    if (result.outcome === "critical-unfixed") {
      if (issues.length < count) log(`Stopping the Run: Issue ${issue.id} has unfixed Critical Findings, so no further Issues are started.`);
      break;
    }
    const atLimit = result.outcome === "paused" || (result.outcome === "awaiting-merge" && result.bodyWriter?.written === false && result.bodyWriter.limitReached);
    if (atLimit) {
      if (issues.length < count) log(`Stopping the Run at the usage limit, so no further Issues are started.`);
      break;
    }
  }
}

/** Why each skipped Issue can't start, with the tops of the Stack named once when the Run can't pick one. */
function blockedLines(blocked: readonly BlockedIssue[]): string[] {
  const lines: string[] = [];
  const tops = blocked.find((b) => b.tops !== undefined)?.tops;
  if (tops !== undefined) {
    const named = tops.map((t) => `Issue ${t.id} (\`${t.branch}\`${t.pullRequest === undefined ? "" : `, ${t.pullRequest}`})`);
    lines.push(
      tops.length > 0
        ? `The Stack has ${tops.length} tops, so the Run can't tell which to build on: ${named.join(", ")}. Merge or close Pull Requests until one Stack remains.`
        : "The Stack has no top: every awaiting-merge Issue has an in-progress or paused Issue stacked on it. Finish or reset that Issue so the Run can find the top.",
    );
  }
  for (const b of blocked) {
    if (b.blockers.length === 0) continue;
    let line = `Issue ${b.id} is blocked by ${b.blockers.join(", ")}.`;
    if (b.tooManyToStack) line += ` It has ${b.blockers.length} unmerged blockers, and a Stacked Issue can have only one.`;
    if (b.outsideStack !== undefined) {
      const which = b.outsideStack.length === 1 ? `Blocker ${b.outsideStack[0]} is` : `Blockers ${b.outsideStack.join(", ")} are`;
      line += ` ${which} awaiting-merge but not in the Stack below the top, so Issue ${b.id}'s base would not have that work.`;
    }
    lines.push(line);
  }
  return lines;
}

type IssueContext = Omit<RunOptions, "config" | "count" | "log" | "store" | "targetBranch" | "publisher"> & {
  config: Config;
  targetBranch: string;
  log: (line: string) => void;
  store: IssueStore;
  publisher: Publisher;
};

/**
 * Moves each `awaiting-merge` Issue the human has merged to `done`. An Issue with a Pull Request is merged when
 * GitHub says it was merged into the target branch, which also sees squash merges; one without is merged when its
 * branch is in the target branch. A Pull Request merged into another branch, such as a Stacked Issue's blocker
 * branch, leaves its Issue `awaiting-merge`. A Pull Request closed without merging makes its Issue `wontfix` and sends
 * every Issue above it in the Stack to `ready-for-human`, except those whose own Pull Request reached the target branch.
 *
 * Every state is read before anything is moved, so the outcome does not depend on the order Issues are visited in.
 */
async function markMergedIssuesDone(context: IssueContext): Promise<void> {
  const { repoDir, targetBranch, store, log, publisher, config } = context;
  /** Issues whose work is on the target branch: `pull` still needs its file caught up, `ready` does not. */
  const merged = { pull: [] as Issue[], ready: [] as Issue[] };
  const closed: Issue[] = [];
  for (const issue of await store.awaitingMerge()) {
    if (!issue.pullRequest) {
      if (await isMerged(repoDir, issue.branch, targetBranch)) merged.ready.push(issue);
      continue;
    }
    let status;
    try {
      status = await publisher.state(issue.pullRequest);
    } catch (error) {
      log(`Warning: could not read the state of Issue ${issue.id}'s Pull Request ${issue.pullRequest}, so it stays awaiting-merge: ${errorMessage(error)}`);
      continue;
    }
    if (status.state === "CLOSED") {
      closed.push(issue);
      continue;
    }
    if (status.state !== "MERGED") continue;
    if (status.base !== targetBranch) {
      log(
        `Warning: Issue ${issue.id}'s Pull Request ${issue.pullRequest} was merged into ${status.base}, not the target branch ${targetBranch}, so it stays awaiting-merge. Merge its blocker first, so GitHub retargets the next Pull Request to ${targetBranch}.`,
      );
      continue;
    }
    // The Issue file was committed onto the branch, so the merge brings it in: catch up first.
    (config.pullRequest ? merged.pull : merged.ready).push(issue);
  }

  // The one guard against acting on an Issue twice: an Issue whose work reached the target branch is only ever
  // marked `done`, even when it is stacked on a closed Issue, and the cascade below skips it.
  const onTarget = new Set([...merged.pull, ...merged.ready].map((i) => i.path));
  // Plan the cascade from the states as read, before anything is moved.
  const stranded = await strandedByClosedIssues(closed, context, onTarget);
  for (const issue of [...merged.ready, ...(await pullMergedIssueFiles(merged.pull, context))]) {
    await store.transition(issue, "done");
    log(
      issue.pullRequest
        ? `Issue ${issue.id} is done: its Pull Request ${issue.pullRequest} is merged.`
        : `Issue ${issue.id} is done: ${issue.branch} is merged into ${targetBranch}.`,
    );
  }
  for (const issue of closed) {
    await store.transition(issue, "wontfix");
    await store.comment(issue, `**Pull Request closed**: this Issue's Pull Request ${issue.pullRequest} was closed without being merged, so it is wontfix.`);
    log(`Issue ${issue.id} is wontfix: its Pull Request ${issue.pullRequest} was closed without being merged.`);
  }
  for (const { issue, closedIssue } of stranded) await sendToHuman(issue, closedIssue, context);
}

/** Statuses an Issue above a closed Issue keeps: finished, or already with the human. */
const KEPT_WHEN_BASE_CLOSED = new Set<Issue["status"]>(["done", "ready-for-human", "wontfix"]);

/** An Issue to send to `ready-for-human` because `closedIssue`, somewhere below it in the Stack, was closed. */
interface Stranded {
  issue: Issue;
  closedIssue: Issue;
}

/**
 * Finds every Issue above each closed Issue in the Stack, by following `Stacked on:` lines upward through every
 * level, and pairs it with the lowest closed Issue below it. Stops climbing at an Issue that is `done` or in
 * `onTarget`, since its work, and the work below it, reached the target branch. Leaves out the closed Issues
 * themselves, which go to `wontfix`, and Issues that keep their status.
 */
async function strandedByClosedIssues(closed: Issue[], { store }: IssueContext, onTarget: ReadonlySet<string>): Promise<Stranded[]> {
  const closedPaths = new Set(closed.map((i) => i.path));
  const above = new Map<string, Issue[]>();
  for (const closedIssue of closed) {
    const found: Issue[] = [];
    const seen = new Set([closedIssue.path]);
    let level = [closedIssue];
    while (level.length > 0) {
      const next: Issue[] = [];
      for (const base of level) {
        for (const issue of await store.stackedOn(base.branch)) {
          if (seen.has(issue.path)) continue;
          seen.add(issue.path);
          if (issue.status === "done" || onTarget.has(issue.path)) continue;
          found.push(issue);
          next.push(issue);
        }
      }
      level = next;
    }
    above.set(closedIssue.path, found);
  }
  // Everything above a closed Issue is also above any closed Issue below it, so the lowest has the most Issues above
  // it. It goes first, so each Issue names the lowest closure that stranded it.
  const lowestFirst = [...closed].sort((a, b) => above.get(b.path)!.length - above.get(a.path)!.length);
  const stranded = new Map<string, Stranded>();
  for (const closedIssue of lowestFirst) {
    for (const issue of above.get(closedIssue.path)!) {
      if (stranded.has(issue.path) || closedPaths.has(issue.path) || KEPT_WHEN_BASE_CLOSED.has(issue.status)) continue;
      stranded.set(issue.path, { issue, closedIssue });
    }
  }
  return [...stranded.values()];
}

/** Sends `issue` to `ready-for-human` with a comment naming `closedIssue`, because the base its work builds on will not be merged. */
async function sendToHuman(issue: Issue, closedIssue: Issue, { store, log }: IssueContext): Promise<void> {
  const direct = issue.stackedOn === closedIssue.branch;
  await store.transition(issue, "ready-for-human");
  await store.comment(
    issue,
    direct
      ? `**Blocker closed**: this Issue is stacked on \`${closedIssue.branch}\`, the branch of Issue ${closedIssue.id}, whose Pull Request ${closedIssue.pullRequest} was closed without being merged. Decide what to do with this work: rebase it onto another branch and remove the \`Stacked on:\` line, or close it.`
      : `**Blocker closed**: this Issue is stacked on \`${issue.stackedOn}\`, which is above \`${closedIssue.branch}\`, the branch of Issue ${closedIssue.id}, in the Stack. Issue ${closedIssue.id}'s Pull Request ${closedIssue.pullRequest} was closed without being merged. Decide what to do with this work: rebase it onto another branch and update or remove the \`Stacked on:\` line, or close it.`,
  );
  log(
    direct
      ? `Issue ${issue.id} is ready-for-human: it is stacked on Issue ${closedIssue.id}, whose Pull Request ${closedIssue.pullRequest} was closed without being merged.`
      : `Issue ${issue.id} is ready-for-human: it is above Issue ${closedIssue.id} in the Stack, whose Pull Request ${closedIssue.pullRequest} was closed without being merged.`,
  );
}

/** An Issue file whose local edit was discarded before the pull, kept so it can be put back. */
interface DiscardedEdit {
  path: string;
  file: string;
  content: Buffer;
  /** The file's `git ls-files -s` entry before the discard, or empty when it was not in the index. */
  indexEntry: string;
}

/**
 * Fast-forwards the target branch over the merged Pull Requests of `issues`. A merged Stacked Issue's branch also
 * holds the Issue files of the blockers it is stacked on, so the pull brings those in too. Each such file's local
 * edit, which would make `git pull` refuse, is discarded first, but only when it matches the file at the tip of the
 * merged Issue's branch, so nothing the merge does not bring back is lost. When a check or the pull fails, the files
 * are put back as they were and a warning is logged. Returns the Issues that caught up. Other files are never touched.
 */
async function pullMergedIssueFiles(issues: readonly Issue[], context: IssueContext): Promise<Issue[]> {
  const { repoDir, targetBranch, log } = context;
  if (issues.length === 0) return [];
  const warn = (issue: Issue, file: string, reason: string) =>
    log(`Warning: Issue ${issue.id}'s Pull Request ${issue.pullRequest} is merged, but ${file} was left as it is and the Issue stays awaiting-merge: ${reason}`);
  const current = await git(repoDir, "branch", "--show-current");
  const discarded: DiscardedEdit[] = [];
  const pulled: Issue[] = [];
  for (const issue of issues) {
    const file = relative(repoDir, issue.path);
    if (current !== targetBranch) {
      warn(issue, file, `the target branch ${targetBranch} is not checked out (the working copy is on ${current || "a detached HEAD"}).`);
      continue;
    }
    // Its own file always; a blocker's file only when it has a local edit the pull would refuse to overwrite. A file
    // an earlier Issue's check already discarded is skipped: the pull brings it in for both.
    const already = new Set(discarded.map((edit) => edit.path));
    const paths = already.has(issue.path) ? [] : [issue.path];
    for (const path of await blockerPaths(issue, context)) {
      if (!already.has(path) && (await git(repoDir, "status", "--porcelain", "--", relative(repoDir, path)))) paths.push(path);
    }
    let failure: { file: string; reason: string } | undefined;
    for (const path of paths) {
      const reason = await differenceFromBranch(repoDir, relative(repoDir, path), issue.branch);
      if (reason) {
        failure = { file: relative(repoDir, path), reason };
        break;
      }
    }
    const edits: DiscardedEdit[] = [];
    let discarding = file;
    try {
      for (const path of failure ? [] : paths) {
        discarding = relative(repoDir, path);
        const edit: DiscardedEdit = {
          path,
          file: discarding,
          content: await readFile(path),
          indexEntry: await git(repoDir, "ls-files", "-s", "--", relative(repoDir, path)),
        };
        edits.push(edit);
        await git(repoDir, "checkout", "HEAD", "--", edit.file);
      }
    } catch (error) {
      for (const edit of edits) await restoreEdit(repoDir, edit);
      failure = { file: discarding, reason: `could not discard its local edit: ${errorMessage(error)}` };
    }
    if (failure) {
      warn(issue, failure.file, failure.reason);
      continue;
    }
    discarded.push(...edits);
    pulled.push(issue);
  }
  if (pulled.length === 0) return [];
  try {
    await git(repoDir, "pull", "-q", "--ff-only", "origin", targetBranch);
  } catch (error) {
    for (const edit of discarded) await restoreEdit(repoDir, edit);
    for (const issue of pulled) {
      warn(issue, relative(repoDir, issue.path), `\`git pull --ff-only origin ${targetBranch}\` failed: ${gitErrorMessage(error)}`);
    }
    return [];
  }
  return pulled;
}

/** The files of the Issues `issue` is stacked on, following each `Stacked on:` line down the chain. */
async function blockerPaths(issue: Issue, { store }: IssueContext): Promise<string[]> {
  const paths: string[] = [];
  const seen = new Set([issue.path]);
  for (let branch = issue.stackedOn; branch; ) {
    const blocker = await store.byBranch(branch);
    if (!blocker || seen.has(blocker.path)) break;
    seen.add(blocker.path);
    paths.push(blocker.path);
    branch = blocker.stackedOn;
  }
  return paths;
}

/** Why the working copy's `file` is not the one at the tip of `branch`, or undefined when it is. */
async function differenceFromBranch(repoDir: string, file: string, branch: string): Promise<string | undefined> {
  let atTip: string;
  try {
    atTip = await git(repoDir, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}:${file}`);
  } catch {
    return `it is not on the local branch ${branch}.`;
  }
  const local = await git(repoDir, "hash-object", "--", file);
  return local === atTip ? undefined : `it differs from the file at the tip of ${branch}.`;
}

async function restoreEdit(repoDir: string, { path, content, indexEntry, file }: DiscardedEdit): Promise<void> {
  await writeFile(path, content);
  const entry = /^(\d+) ([0-9a-f]+) \d+\t/.exec(indexEntry);
  if (entry) await git(repoDir, "update-index", "--cacheinfo", `${entry[1]},${entry[2]},${file}`);
}

/** Git's stderr when it has one, else the error's message. */
function gitErrorMessage(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr;
  return typeof stderr === "string" && stderr.trim() !== "" ? stderr.trim() : errorMessage(error);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

/**
 * Sends a `ready-for-agent` Issue to `ready-for-human` when its recorded Base Issue is no longer the top of the Stack,
 * since starting it there would make a second branch on that Base Issue and split the Stack. Returns undefined when the
 * Issue may start: its Base Issue is still the top, it has no `Stacked on:` line, or it is paused.
 */
async function sendBackIfBaseMoved(issue: Issue, base: string, options: IssueContext): Promise<IssueResult | undefined> {
  const { currentTop } = issue;
  const { store, log, targetBranch } = options;
  if (currentTop === undefined || issue.stackedOn === undefined) return undefined;
  const top = currentTop?.branch ?? targetBranch;
  if (base === top) return undefined;
  const recorded = await store.byBranch(base);
  const recordedText = recorded ? `Issue ${recorded.id}'s branch \`${base}\`` : `\`${base}\``;
  const topText = currentTop
    ? `the top of the Stack is now Issue ${currentTop.id} (\`${top}\`${currentTop.pullRequest ? `, ${currentTop.pullRequest}` : ""})`
    : `nothing is awaiting merge, so the top of the Stack is now the target branch \`${top}\``;
  const rebase = currentTop
    ? `rebase \`${issue.branch}\` onto \`${top}\` and change the \`Stacked on:\` line to \`${top}\``
    : `rebase \`${issue.branch}\` onto \`${top}\` and remove the \`Stacked on:\` line`;
  await store.comment(
    issue,
    `**Base Issue is no longer the top**: this Issue is stacked on ${recordedText}, but ${topText}. Starting it on its recorded Base Issue would split the Stack in two, so the Run did not start it. Either ${rebase}, then set it back to ready-for-agent; or delete \`${issue.branch}\` and remove the \`Stacked on:\` line, then set it back to ready-for-agent so it restarts on the top of the Stack.`,
  );
  await store.transition(issue, "ready-for-human");
  log(`Issue ${issue.id} is stacked on ${base}, but the top of the Stack is now ${top}, so it goes to ready-for-human.`);
  return { outcome: "base-moved", issue, branch: issue.branch, base, top, usage: {} };
}

async function runIssue(issue: Issue, options: IssueContext): Promise<IssueResult> {
  const { repoDir, log, store, config } = options;
  const { branch } = issue;
  // The branch this Issue's work is measured from and published against: its blocker's, for a Stacked Issue.
  const base = baseOf(issue, options.targetBranch);
  const moved = await sendBackIfBaseMoved(issue, base, options);
  if (moved) return moved;
  if (base !== options.targetBranch && !(await branchExists(repoDir, base))) {
    // The recorded base is what the work is built on: never silently rebuild it on the target branch.
    await store.comment(
      issue,
      `**Stacked on a missing branch**: this Issue is stacked on \`${base}\`, which no longer exists locally, so the Run did not ${issue.status === "paused" ? "resume" : "start"} it. Restore the branch, or remove the \`Stacked on:\` line to base it on ${options.targetBranch}.`,
    );
    await store.transition(issue, "ready-for-human");
    log(`Issue ${issue.id} is stacked on ${base}, which no longer exists locally, so it goes to ready-for-human.`);
    return { outcome: "base-missing", issue, branch, base, usage: {} };
  }
  const resume = issue.paused;
  const stacked = base !== options.targetBranch ? ` stacked on ${base}` : "";
  if (resume) log(`Resuming Issue ${issue.id} in the ${STAGE_NAMES[resume.stage]} on ${branch}${stacked}`);
  else if (issue.status === "paused") log(`Issue ${issue.id} is paused but its pause record is unreadable; starting it fresh on ${branch}${stacked}`);
  else log(`Starting Issue ${issue.id} on ${branch}${stacked}`);
  if (issue.stackOn !== undefined) await store.recordStackedOn(issue, issue.stackOn);
  await store.transition(issue, "in-progress");
  await ensureBranch(repoDir, branch, base);

  const { effort } = config;
  const model = issue.model ?? config.model;
  const usage: IssueUsage = {};

  if (resume?.stage !== "review-session") {
    const implemented = await callAgent(issue, options, {
      stage: "implementer",
      prompt: resume
        ? buildResumePrompt("implementer")
        : buildImplementerPrompt(issue, await readOptional(join(repoDir, "GLOSSARY.md")), config.gate),
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
          commits: await git(repoDir, "log", "--format=%h %s", `${base}..${branch}`),
          diff: await git(repoDir, "diff", `${base}...${branch}`),
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

  const unfixedCritical = review.findings.filter(isUnfixedCritical);
  if (unfixedCritical.length > 0) {
    // Only Non-critical Findings may be left for the human, so the Issue cannot reach awaiting-merge.
    // The unfixed Critical Findings are already in the Findings comment above.
    await store.transition(issue, "ready-for-human");
    log(summary(`Issue ${issue.id} has Critical Findings the Review Session did not fix.`, branch, "not run, because Critical Findings are unfixed", [report]));
    return { outcome: "critical-unfixed", issue, branch, unfixedCritical, review, usage };
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
  if (!config.pullRequest) {
    await store.transition(issue, "awaiting-merge");
    log(summary(`Issue ${issue.id} is awaiting merge.`, branch, `passed (log: ${gateLog})`, [report]));
    return { outcome: "awaiting-merge", issue, branch, review, usage };
  }

  const written = await writeBody(issue, base, review.findings, gate.output, usage, options);
  const stackedOn = await blockerOf(base, options);
  const bodyInput: PullRequestBodyInput = { gateOutput: gate.output, findings: review.findings, usage, stackedOn };
  const body = written.body !== undefined ? buildWrittenPullRequestBody(written.body, bodyInput) : buildPullRequestBody(bodyInput, written.note);
  const pullRequest = await publishPullRequest(issue, base, body, stackedOn, options);
  // Even when publishing failed, the work passed the Gate and waits for the human: the branch is still there.
  await store.transition(issue, "awaiting-merge");
  const published = pullRequest.published
    ? [`Pull Request: ${pullRequest.url}`, ...(pullRequest.error ? [`Warning: ${pullRequest.error}`] : [])].join("\n")
    : `Could not publish the Pull Request: ${pullRequest.error}`;
  const bodyNote = written.result.written ? undefined : written.note;
  log(summary(`Issue ${issue.id} is awaiting merge.`, branch, `passed (log: ${gateLog})`, [published, bodyNote, report]));
  return { outcome: "awaiting-merge", issue, branch, review, usage, pullRequest, bodyWriter: written.result };
}

/** The blocker whose branch is `base`, for a Stacked Issue; undefined when `base` is the target branch. */
async function blockerOf(base: string, { targetBranch, store }: IssueContext): Promise<StackedOnBlocker | undefined> {
  if (base === targetBranch) return undefined;
  const blocker = await store.byBranch(base);
  return { id: blocker?.id, branch: base, pullRequest: blocker?.pullRequest, targetBranch };
}

/**
 * Calls the body writer once, adding its usage to `usage` and commenting it on the Issue. It never pauses the Issue:
 * when it hits the usage limit, throws, or returns no body, the result says why, for the deterministic body to note.
 * Whatever it did to the branch is undone, because the Gate passed on the branch as it was.
 */
async function writeBody(
  issue: Issue,
  base: string,
  findings: readonly Finding[],
  gateOutput: string,
  usage: IssueUsage,
  { repoDir, agent, config, store, log }: IssueContext,
): Promise<{ body?: string; result: BodyWriterResult; note?: string }> {
  const { branch } = issue;
  const tip = await git(repoDir, "rev-parse", branch);
  let outcome: AgentResult | { kind: "failed"; error: string };
  try {
    outcome = await agent.run({
      stage: "body-writer",
      prompt: buildBodyWriterPrompt(issue, {
        branch,
        commits: await git(repoDir, "log", "--format=%h %s", `${base}..${branch}`),
        diff: await git(repoDir, "diff", `${base}...${branch}`),
        findings,
        gateOutput: truncateStart(gateOutput.trim()),
      }),
      model: config.bodyWriter.model,
      effort: config.bodyWriter.effort,
      branch,
      maxIterations: 1,
    });
  } catch (error) {
    outcome = { kind: "failed", error: errorMessage(error) };
  }
  await restoreBranch(repoDir, branch, tip, issue, store, log);

  if (outcome.kind !== "failed") {
    usage["body-writer"] = outcome.usage;
    await store.comment(issue, formatUsage({ "body-writer": outcome.usage }));
  }
  if (outcome.kind === "completed" && outcome.body !== undefined && outcome.body.trim() !== "") {
    return { body: outcome.body, result: { written: true } };
  }
  const reason =
    outcome.kind === "limit-reached"
      ? "it hit the usage limit"
      : outcome.kind === "failed"
        ? `it failed: ${outcome.error}`
        : "it returned no body";
  const note = `The body writer did not write this body, because ${reason}. This is the plain body the host builds.`;
  await store.comment(issue, `**Body writer**: ${note}`);
  return { result: { written: false, reason, limitReached: outcome.kind === "limit-reached" }, note };
}

/**
 * Puts `branch` back at `tip`, discarding any worktree Sandcastle preserved for it, in case the body writer
 * committed or left changes despite being told not to. Logged and commented when there was something to undo.
 */
async function restoreBranch(
  repoDir: string,
  branch: string,
  tip: string,
  issue: Issue,
  store: IssueStore,
  log: (line: string) => void,
): Promise<void> {
  for (const dir of await preservedWorktrees(repoDir, branch)) await git(repoDir, "worktree", "remove", "--force", dir);
  if ((await git(repoDir, "rev-parse", branch)) === tip) return;
  await git(repoDir, "update-ref", `refs/heads/${branch}`, tip);
  const warning = `The body writer changed ${branch}; it was put back to ${tip.slice(0, 7)}, the commit that passed the Gate.`;
  log(`Warning: ${warning}`);
  await store.comment(issue, `**Warning**: ${warning}`);
}

/**
 * Merges the Issue file, with its Run comments, onto the Issue's branch, pushes the branch and opens its Pull
 * Request against `base`: the target branch, or the blocker's branch for a Stacked Issue. Once it is open, the URL is recorded, the Issue moves to `awaiting-merge`,
 * and the Issue file is merged onto the branch and pushed again, so the working copy's file matches the branch
 * tip. When publishing fails, the branch is put back as it was, so the Issue-file commit never lingers on it. The
 * host does all this, never the sandbox. A failure is commented on the Issue and returned rather than thrown, so
 * the Run carries on.
 */
async function publishPullRequest(
  issue: Issue,
  base: string,
  body: string,
  stackedOn: StackedOnBlocker | undefined,
  options: IssueContext,
): Promise<PublishResult> {
  const { store, publisher, repoDir, log } = options;
  const commitMessage = `Record Issue ${issue.id}'s Run comments`;
  const file = relative(repoDir, issue.path);
  const tip = await git(repoDir, "rev-parse", issue.branch);
  let url: string;
  let merged: string;
  try {
    merged = await commitIssueFile(repoDir, issue, (await showFile(repoDir, base, file)) ?? "", commitMessage);
    ({ url } = await publisher.publish({
      branch: issue.branch,
      base,
      title: `Issue ${issue.id}: ${issue.title}`,
      body,
    }));
  } catch (error) {
    const message = errorMessage(error);
    await git(repoDir, "update-ref", `refs/heads/${issue.branch}`, tip);
    await store.comment(issue, `**Could not publish the Pull Request**\n\n${fenced(message.trim())}`);
    return { published: false, error: message };
  }
  try {
    await writeFile(issue.path, merged);
    await store.recordPullRequest(issue, url);
    const blocker = stackedOn === undefined ? "" : `\n\n${stackedOnText(stackedOn)}`;
    await store.comment(issue, `**Pull Request opened**: ${url}${blocker}`);
    await store.transition(issue, "awaiting-merge");
    await writeFile(issue.path, await commitIssueFile(repoDir, issue, merged, commitMessage));
    await publisher.push(issue.branch);
    return { published: true, url };
  } catch (error) {
    // The Pull Request exists: say so, so the human never opens a second one.
    const message = `The Pull Request was opened at ${url}, but recording it on the Issue and its branch failed: ${errorMessage(error)}`;
    try {
      await store.comment(issue, `**Warning**: ${message}`);
    } catch (commentError) {
      // The Run summary still carries the message; say why the Issue file does not.
      log(`Warning: could not comment on Issue ${issue.id}: ${errorMessage(commentError)}`);
    }
    return { published: true, url, error: message };
  }
}

/**
 * Merges the working copy's Issue file into the copy at the tip of its branch (see `mergeIssueFile`), never
 * overwriting the branch's copy, and commits the result there when it changed. `base` is the file both last
 * agreed on. Returns the merged file, for the caller to write back to the working copy.
 */
async function commitIssueFile(repoDir: string, issue: Issue, base: string, message: string): Promise<string> {
  const file = relative(repoDir, issue.path);
  const working = await readFile(issue.path, "utf8");
  const branchCopy = await showFile(repoDir, issue.branch, file);
  const merged = branchCopy === undefined ? working : mergeIssueFile(branchCopy, working, base);
  await withWorktree(repoDir, issue.branch, async (dir) => {
    await mkdir(dirname(join(dir, file)), { recursive: true });
    await writeFile(join(dir, file), merged);
    await git(dir, "add", "--", file);
    if (await git(dir, "status", "--porcelain", "--", file)) await git(dir, "commit", "-q", "--no-verify", "-m", message);
  });
  return merged;
}

/** `file` as committed at `ref`, or undefined when it is not there. */
async function showFile(repoDir: string, ref: string, file: string): Promise<string | undefined> {
  try {
    await git(repoDir, "rev-parse", "--verify", "--quiet", `${ref}:${file}`);
  } catch {
    return undefined;
  }
  return (await exec("git", ["show", `${ref}:${file}`], { cwd: repoDir, maxBuffer: 64 * 1024 * 1024 })).stdout;
}

/**
 * Calls the Agent. When the call throws, the Issue is not left `in-progress`: its work in progress is
 * committed, then it is paused if the session can be resumed, or else goes back to `ready-for-agent`
 * with an empty branch deleted. The error is then rethrown, ending the Run.
 */
async function callAgent(issue: Issue, options: IssueContext, call: AgentCall & { stage: PausableStage }): Promise<AgentResult> {
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

async function recoverFromFailure(issue: Issue, stage: PausableStage, error: unknown, options: IssueContext): Promise<void> {
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
  const deleted = await deleteBranchIfEmpty(repoDir, branch, baseOf(issue, targetBranch));
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
  for (const dir of await preservedWorktrees(repoDir, branch)) {
    if (await git(dir, "status", "--porcelain")) {
      await git(dir, "add", "-A");
      await git(dir, "commit", "-q", "--no-verify", "-m", message);
    }
    await git(repoDir, "worktree", "remove", "--force", dir);
  }
}

/** The worktrees Sandcastle preserved for `branch` under `.sandcastle/worktrees/`. */
async function preservedWorktrees(repoDir: string, branch: string): Promise<string[]> {
  const listing = await git(repoDir, "worktree", "list", "--porcelain");
  return listing
    .split(/\n\s*\n/)
    .filter((entry) => entry.split("\n").includes(`branch refs/heads/${branch}`))
    .map((entry) => /^worktree (.+)$/m.exec(entry)?.[1])
    .filter((path): path is string => path !== undefined && path.includes("/.sandcastle/worktrees/"));
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
  const unfixedCritical = findings.filter(isUnfixedCritical);
  const nonCritical = findings.filter((f) => f.severity === "non-critical");
  if (unfixedCritical.length > 0) {
    sections.push(bullets("Review Session: Critical Findings not fixed", unfixedCritical.map((f) => f.description)));
  }
  if (nonCritical.length > 0) {
    sections.push(bullets("Review Session: Non-critical Findings", nonCritical.map((f) => f.description)));
  }
  return sections.length > 0 ? sections.join("\n\n") : undefined;
}

function isUnfixedCritical(finding: Finding): boolean {
  return finding.severity === "critical" && !finding.fixed;
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

async function branchExists(repoDir: string, branch: string): Promise<boolean> {
  return (await git(repoDir, "branch", "--list", branch)) !== "";
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
  const parent = await mkdtemp(join(tmpdir(), "sandcastle-pro-worktree-"));
  const dir = join(parent, "worktree");
  await git(repoDir, "worktree", "add", "-q", dir, branch);
  try {
    return await fn(dir);
  } finally {
    await git(repoDir, "worktree", "remove", "--force", dir);
    await rm(parent, { recursive: true, force: true });
  }
}
