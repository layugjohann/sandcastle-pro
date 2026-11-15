import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { STAGE_NAMES, type PausableStage } from "./agent.js";

export const STATUSES = [
  "needs-triage",
  "needs-info",
  "ready-for-agent",
  "ready-for-human",
  "wontfix",
  "in-progress",
  "paused",
  "awaiting-merge",
  "done",
] as const;

export type Status = (typeof STATUSES)[number];

export interface Issue {
  /** The number prefix as written in the file name, e.g. "01". */
  id: string;
  /** The `# ` heading without its number prefix, e.g. "Only" for `# 01: Only`. Falls back to the file's slug. */
  title: string;
  /** The Issue's own branch, `issue/NN-slug`. */
  branch: string;
  /** The Issue file's full text when it was read. */
  text: string;
  /** The Spec's text, or undefined when the Issue has no Spec. */
  spec: string | undefined;
  /** Absolute path of the Issue file. */
  path: string;
  /** The model from the Issue's `Model:` line, overriding the configured default for this Issue only. */
  model: string | undefined;
  /** The status when the Issue was read. */
  status: Status | undefined;
  /** Where a `paused` Issue stopped, so its Run can continue that session. Undefined when not paused or unreadable. */
  paused: PausedAt | undefined;
  /** The URL on the Issue's `Pull Request:` line, once a Run has published it. */
  pullRequest: string | undefined;
  /** The blocker branch on the Issue's `Stacked on:` line, which a Run writes when it starts a Stacked Issue. */
  stackedOn: string | undefined;
  /**
   * The branch of the one unmerged, `awaiting-merge` blocker `next()` picked this Issue on top of, when stacking is
   * on and the Issue has no `Stacked on:` line yet. The Run records it with `recordStackedOn()`.
   */
  stackOn: string | undefined;
}

/** The branch an Issue's work is measured from and published against: its `Stacked on:` branch, else `target`. */
export function baseOf(issue: Pick<Issue, "stackedOn" | "stackOn">, target: string): string {
  return issue.stackedOn ?? issue.stackOn ?? target;
}

export interface IssueStoreOptions {
  /**
   * Treat a blocker as satisfied when it is the Issue's only unsatisfied blocker and is `awaiting-merge`, so the Issue
   * can start as a Stacked Issue. Off by default, when only `done` blockers are satisfied.
   */
  stack?: boolean;
}

export interface PausedAt {
  sessionId: string;
  stage: PausableStage;
}

export interface BlockedIssue {
  id: string;
  /** Its `Blocked by:` entries that are not `done`, as written in the Issue. */
  blockers: string[];
  /**
   * Set when stacking is on and the Issue has two or more unmerged blockers, so it can't stack even if every one of
   * them is `awaiting-merge`: a Stacked Issue builds on exactly one blocker's branch.
   */
  tooManyToStack?: true;
}

export interface IssueStore {
  /**
   * The next Issue a Run should work on: the lowest-numbered `paused` one, else the lowest-numbered unblocked
   * `ready-for-agent` one, else null. With stacking on, a sole `awaiting-merge` blocker does not block.
   */
  next(): Promise<Issue | null>;
  /**
   * The `ready-for-agent` Issues that `next()` skips, each with its blockers that are not `done`, and with
   * `tooManyToStack` when stacking is on and two or more of those blockers are unmerged.
   */
  blocked(): Promise<BlockedIssue[]>;
  /** Every Issue in `awaiting-merge`, whose branch the human may have merged. */
  awaitingMerge(): Promise<Issue[]>;
  /** The Issue whose own branch is `branch`, or null when there is none. */
  byBranch(branch: string): Promise<Issue | null>;
  /** Every Issue whose `Stacked on:` line names `branch`, in any status. */
  stackedOn(branch: string): Promise<Issue[]>;
  /** Sets the status. Leaving `paused` drops the pause record. */
  transition(issue: Issue, status: Status): Promise<void>;
  /** Marks the Issue `paused`, recording the session to continue and the stage it was in. */
  pause(issue: Issue, at: PausedAt): Promise<void>;
  /** Appends text under the Issue's `## Comments` heading, creating it if needed. */
  comment(issue: Issue, text: string): Promise<void>;
  /** Records the Issue's Pull Request URL as a `Pull Request:` line near the top, replacing any earlier one. */
  recordPullRequest(issue: Issue, url: string): Promise<void>;
  /** Records the branch a Stacked Issue is based on as a `Stacked on:` line near the top, replacing any earlier one. */
  recordStackedOn(issue: Issue, branch: string): Promise<void>;
}

const ISSUE_FILE = /^(\d+)-(.+)\.md$/;

/**
 * The Issue header line for `label`, written plain (`Status: x`) or bold (`**Status:** x`, `**Status**: x`).
 * Group 1 is the label as written, up to and including its colon and any closing `**`; group 2 is `value`'s match.
 */
function headerLine(label: string, value = "(.*)$", flags = "m"): RegExp {
  return new RegExp(`^((?:\\*\\*)?${label}(?:\\*\\*)?:(?:\\*\\*)?)[ \\t]*${value}`, flags);
}

const STATUS_LINE = headerLine("Status", "(\\S*).*$");
const BLOCKED_BY_LINE = headerLine("Blocked by");
const MODEL_LINE = headerLine("Model");
const SPEC_LINE = headerLine("Spec", "`?([^`\\s]+)`?");
const PAUSED_SESSION_LINE = headerLine("Paused session");
const PAUSED_STAGE_LINE = headerLine("Paused stage");
const PAUSE_RECORD = headerLine("Paused (?:session|stage)", ".*\\n?", "gm");
const PULL_REQUEST_LINE = headerLine("Pull Request");
const STACKED_ON_LINE = headerLine("Stacked on");

/** The branch on the `Stacked on:` line above `## Comments`, or undefined when there is none. */
function parseStackedOn(text: string): string | undefined {
  const value = STACKED_ON_LINE.exec(headerOf(text))?.[2]?.replace(/[`*]/g, "").trim();
  return value || undefined;
}

/** Whether a line the Run adds to `header` is bold: when the header's `Status:` or `Blocked by:` line is. */
function isBoldHeader(header: string): boolean {
  return /^\*\*(?:Status|Blocked by)(?::\*\*|\*\*:)/m.test(header);
}

/** The `Stacked on:` line for `branch`, in the style of the header around it. */
function stackedOnLine(header: string, branch: string): string {
  return labelled("Stacked on", branch, isBoldHeader(header));
}

/** `header` with `line` placed under its `Blocked by:` line, else its `Status:` line, else its title. */
function insertStackedOn(header: string, line: string): string {
  if (BLOCKED_BY_LINE.test(header)) return header.replace(BLOCKED_BY_LINE, (blockedBy) => `${blockedBy}\n${line}`);
  if (STATUS_LINE.test(header)) return header.replace(STATUS_LINE, (status) => `${status}\n${line}`);
  return insertAfterTitle(header, line);
}

/** The URL on the `Pull Request:` line above `## Comments`, or undefined when there is none. */
function parsePullRequest(text: string): string | undefined {
  const value = PULL_REQUEST_LINE.exec(headerOf(text))?.[2]?.replace(/[`<>]/g, "").trim();
  return value || undefined;
}

/** The `# ` heading without a leading `NN:` number, or undefined when the file has no heading. */
function parseTitle(text: string): string | undefined {
  const heading = /^# (.+)$/m.exec(text)?.[1]?.trim();
  return heading?.replace(/^\d+\s*[:.-]\s*/, "").trim() || undefined;
}

function parseStatus(text: string): Status | undefined {
  const value = STATUS_LINE.exec(text)?.[2];
  return STATUSES.find((s) => s === value);
}

/**
 * The blockers on the `Blocked by:` line, as written: an Issue number, or text naming no number.
 * A missing line or `None` means unblocked; a blocker the Run can't read stays unfinished.
 */
function parseBlockedBy(text: string): string[] {
  const value = BLOCKED_BY_LINE.exec(text)?.[2]?.trim() ?? "";
  if (value === "" || /^none\b/i.test(value)) return [];
  return value
    .split(/,|\band\b/)
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part) => /\d+/.exec(part)?.[0] ?? part);
}

/**
 * The value of the `Model:` line, without backticks, or undefined when the line is missing or empty.
 * Only text above `## Comments` counts, so Gate output or Findings appended there can't change the model.
 */
function parseModel(text: string): string | undefined {
  const value = MODEL_LINE.exec(headerOf(text))?.[2]?.replace(/`/g, "").trim();
  return value || undefined;
}

const PAUSABLE_STAGES: readonly PausableStage[] = ["implementer", "review-session"];

/** The pause record of a `paused` Issue, or undefined when either line is missing or unreadable. */
function parsePausedAt(text: string): PausedAt | undefined {
  const header = headerOf(text);
  const sessionId = PAUSED_SESSION_LINE.exec(header)?.[2]?.replace(/`/g, "").trim();
  const stageName = PAUSED_STAGE_LINE.exec(header)?.[2]?.trim();
  const stage = PAUSABLE_STAGES.find((s) => STAGE_NAMES[s] === stageName);
  return sessionId && stage ? { sessionId, stage } : undefined;
}

/** The text above `## Comments`, where the Issue's own lines live. */
function headerOf(text: string): string {
  return text.split(/^## Comments[ \t]*$/m)[0]!;
}

interface IssueFile {
  id: string;
  number: number;
  path: string;
  text: string;
  status: Status | undefined;
  blockedBy: string[];
}

/** The Issue file `blocker` names, resolved within `file`'s issues directory. */
function findBlocker(file: IssueFile, blocker: string, all: readonly IssueFile[]): IssueFile | undefined {
  return all.find((f) => f.number === Number(blocker) && dirname(f.path) === dirname(file.path));
}

/** `file`'s blockers that are not `done`. Blockers resolve within the same issues directory. */
function unfinishedBlockers(file: IssueFile, all: readonly IssueFile[]): string[] {
  return file.blockedBy.filter((blocker) => findBlocker(file, blocker, all)?.status !== "done");
}

/**
 * Whether `file` can start now. Without stacking, every blocker must be `done`. With it, the one unfinished blocker
 * may be `awaiting-merge`, and its branch is returned as `stackOn`.
 */
function readiness(file: IssueFile, all: readonly IssueFile[], stack: boolean): { ready: boolean; stackOn?: string } {
  const unfinished = unfinishedBlockers(file, all);
  if (unfinished.length === 0) return { ready: true };
  if (!stack || unfinished.length > 1) return { ready: false };
  const blocker = findBlocker(file, unfinished[0]!, all);
  if (blocker?.status !== "awaiting-merge") return { ready: false };
  return { ready: true, stackOn: branchOf(blocker.path) };
}

function branchOf(path: string): string {
  return `issue/${basename(path, ".md")}`;
}

/** An Issue Store over `.scratch/<feature>/issues/NN-slug.md` files. */
export function createIssueStore(repoDir: string, options: IssueStoreOptions = {}): IssueStore {
  const stack = options.stack ?? false;
  const scratch = join(repoDir, ".scratch");

  async function listIssueFiles(): Promise<{ id: string; number: number; path: string }[]> {
    if (!existsSync(scratch)) return [];
    const found: { id: string; number: number; path: string }[] = [];
    for (const feature of await readdir(scratch, { withFileTypes: true })) {
      if (!feature.isDirectory()) continue;
      const issuesDir = join(scratch, feature.name, "issues");
      if (!existsSync(issuesDir)) continue;
      for (const name of await readdir(issuesDir)) {
        const match = ISSUE_FILE.exec(name);
        if (!match) continue;
        found.push({ id: match[1]!, number: Number(match[1]), path: join(issuesDir, name) });
      }
    }
    return found.sort((a, b) => a.number - b.number || a.path.localeCompare(b.path));
  }

  async function readSpec(issuePath: string, text: string): Promise<string | undefined> {
    const declared = SPEC_LINE.exec(text)?.[2];
    const candidates = declared
      ? [join(repoDir, declared)]
      : [join(dirname(dirname(issuePath)), "spec.md")];
    for (const path of candidates) {
      if (existsSync(path)) return readFile(path, "utf8");
    }
    return undefined;
  }

  async function readIssues(): Promise<IssueFile[]> {
    const files = [];
    for (const file of await listIssueFiles()) {
      const text = await readFile(file.path, "utf8");
      files.push({ ...file, text, status: parseStatus(text), blockedBy: parseBlockedBy(text) });
    }
    return files;
  }

  async function toIssue(file: IssueFile, stackOn?: string): Promise<Issue> {
    const slug = basename(file.path, ".md");
    const stackedOn = parseStackedOn(file.text);
    return {
      id: file.id,
      title: parseTitle(file.text) ?? slug.replace(/^\d+-/, "").replaceAll("-", " "),
      branch: `issue/${slug}`,
      text: file.text,
      spec: await readSpec(file.path, file.text),
      path: file.path,
      model: parseModel(file.text),
      status: file.status,
      paused: file.status === "paused" ? parsePausedAt(file.text) : undefined,
      pullRequest: parsePullRequest(file.text),
      stackedOn,
      stackOn: stackedOn === undefined ? stackOn : undefined,
    };
  }

  return {
    async next() {
      const files = await readIssues();
      const paused = files.find((f) => f.status === "paused");
      if (paused) return toIssue(paused);
      for (const file of files) {
        if (file.status !== "ready-for-agent") continue;
        const { ready, stackOn } = readiness(file, files, stack);
        if (ready) return toIssue(file, stackOn);
      }
      return null;
    },

    async blocked() {
      const files = await readIssues();
      return files
        .filter((f) => f.status === "ready-for-agent" && !readiness(f, files, stack).ready)
        .map((f): BlockedIssue => {
          const blockers = unfinishedBlockers(f, files);
          return stack && blockers.length > 1 ? { id: f.id, blockers, tooManyToStack: true } : { id: f.id, blockers };
        })
        .filter((b) => b.blockers.length > 0);
    },

    async awaitingMerge() {
      const files = (await readIssues()).filter((f) => f.status === "awaiting-merge");
      return Promise.all(files.map((f) => toIssue(f)));
    },

    async byBranch(branch) {
      const file = (await readIssues()).find((f) => branchOf(f.path) === branch);
      return file === undefined ? null : toIssue(file);
    },

    async stackedOn(branch) {
      const files = (await readIssues()).filter((f) => parseStackedOn(f.text) === branch);
      return Promise.all(files.map((f) => toIssue(f)));
    },

    async transition(issue, status) {
      await writeFile(issue.path, withStatus(await readFile(issue.path, "utf8"), status));
    },

    async pause(issue, { sessionId, stage }) {
      const before = await readFile(issue.path, "utf8");
      // A rewritten pause record keeps its own style; a new one follows the header around it.
      const header = headerOf(before);
      const bold = PAUSED_SESSION_LINE.exec(header)?.[1]?.startsWith("**") ?? isBoldHeader(header);
      const text = withStatus(before, "paused");
      const record = [
        labelled("Paused session", sessionId, bold),
        labelled("Paused stage", STAGE_NAMES[stage], bold),
      ].join("\n");
      await writeFile(issue.path, text.replace(STATUS_LINE, (line) => `${line}\n${record}`));
    },

    async comment(issue, comment) {
      let text = (await readFile(issue.path, "utf8")).replace(/\s*$/, "\n");
      if (!/^## Comments[ \t]*$/m.test(text)) text += "\n## Comments\n";
      await writeFile(issue.path, `${text}\n${comment.trim()}\n`);
    },

    async recordPullRequest(issue, url) {
      const text = await readFile(issue.path, "utf8");
      const header = headerOf(text);
      const line = labelled("Pull Request", url, isBoldHeader(header));
      const updated = PULL_REQUEST_LINE.test(header)
        ? header.replace(PULL_REQUEST_LINE, (_line, label: string) => `${label} ${url}`)
        : STATUS_LINE.test(header)
          ? header.replace(STATUS_LINE, (status) => `${status}\n${line}`)
          : insertAfterTitle(header, line);
      await writeFile(issue.path, updated + text.slice(header.length));
    },

    async recordStackedOn(issue, branch) {
      const text = await readFile(issue.path, "utf8");
      const line = stackedOnLine(headerOf(text), branch);
      await writeFile(issue.path, withHeaderLine(text, STACKED_ON_LINE, line, (h) => insertStackedOn(h, line)));
    },
  };
}

/** `text` with its status set and any pause record dropped; `pause()` writes a fresh one. */
function withStatus(text: string, status: Status): string {
  const header = headerOf(text);
  const rest = text.slice(header.length);
  const cleared = header.replace(PAUSE_RECORD, "") + rest;
  return STATUS_LINE.test(cleared)
    ? cleared.replace(STATUS_LINE, (_line, label: string) => `${label} ${status}`)
    : insertAfterTitle(cleared, `Status: ${status}`);
}

/** `label: value`, or `**label:** value` when `bold`. */
function labelled(label: string, value: string, bold: boolean): string {
  return bold ? `**${label}:** ${value}` : `${label}: ${value}`;
}

function insertAfterTitle(text: string, line: string): string {
  const lines = text.split("\n");
  const titleIndex = lines.findIndex((l) => l.startsWith("# "));
  lines.splice(titleIndex + 1, 0, "", line);
  return lines.join("\n");
}

/**
 * Merges the working copy's Issue file into the Issue branch's copy, never overwriting the branch's copy: the result
 * is `branchCopy` (with the Implementer's ticked boxes and any comments of its own), with the working copy's
 * `Status:`, `Pull Request:` and `Stacked on:` lines, followed by the comments the working copy added since `base`. `base` is the
 * file both last agreed on: the target branch's committed version, or the file last merged onto the branch.
 * Throws when the working copy's comments do not extend `base`'s, since the added comments can't be told apart.
 */
export function mergeIssueFile(branchCopy: string, working: string, base: string): string {
  const workingComments = commentsOf(working).trimEnd();
  const baseComments = commentsOf(base).trimEnd();
  if (!workingComments.startsWith(baseComments)) {
    throw new Error("the working copy's Issue file has comments that do not extend the committed ones, so its Run comments can't be told apart");
  }
  const added = workingComments.slice(baseComments.length).trim();

  const header = headerOf(working);
  let merged = branchCopy;
  const status = STATUS_LINE.exec(header)?.[0];
  if (status !== undefined) merged = withHeaderLine(merged, STATUS_LINE, status, (h) => insertAfterTitle(h, status));
  const pullRequest = PULL_REQUEST_LINE.exec(header)?.[0];
  if (pullRequest !== undefined) {
    merged = withHeaderLine(merged, PULL_REQUEST_LINE, pullRequest, (h) =>
      STATUS_LINE.test(h) ? h.replace(STATUS_LINE, (line) => `${line}\n${pullRequest}`) : insertAfterTitle(h, pullRequest),
    );
  }
  const stackedOn = STACKED_ON_LINE.exec(header)?.[0];
  if (stackedOn !== undefined) merged = withHeaderLine(merged, STACKED_ON_LINE, stackedOn, (h) => insertStackedOn(h, stackedOn));
  if (added === "") return merged;
  merged = merged.replace(/\s*$/, "\n");
  if (!/^## Comments[ \t]*$/m.test(merged)) merged += "\n## Comments\n";
  return `${merged}\n${added}\n`;
}

/** The text below `## Comments`, or empty when there is no such heading. */
function commentsOf(text: string): string {
  const match = /^## Comments[ \t]*$/m.exec(text);
  return match ? text.slice(match.index + match[0].length) : "";
}

/** `text` with the header line matching `pattern` replaced by `line`, or added by `insert` when it has none. */
function withHeaderLine(text: string, pattern: RegExp, line: string, insert: (header: string) => string): string {
  const header = headerOf(text);
  const updated = pattern.test(header) ? header.replace(pattern, () => line) : insert(header);
  return updated + text.slice(header.length);
}
