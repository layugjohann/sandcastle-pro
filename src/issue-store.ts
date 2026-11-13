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
}

export interface PausedAt {
  sessionId: string;
  stage: PausableStage;
}

export interface BlockedIssue {
  id: string;
  /** Its `Blocked by:` entries that are not `done`, as written in the Issue. */
  blockers: string[];
}

export interface IssueStore {
  /** The next Issue a Run should work on: the lowest-numbered `paused` one, else the lowest-numbered unblocked `ready-for-agent` one, else null. */
  next(): Promise<Issue | null>;
  /** The `ready-for-agent` Issues that `next()` skips because a blocker is not `done`. */
  blocked(): Promise<BlockedIssue[]>;
  /** Every Issue in `awaiting-merge`, whose branch the human may have merged. */
  awaitingMerge(): Promise<Issue[]>;
  /** Sets the status. Leaving `paused` drops the pause record. */
  transition(issue: Issue, status: Status): Promise<void>;
  /** Marks the Issue `paused`, recording the session to continue and the stage it was in. */
  pause(issue: Issue, at: PausedAt): Promise<void>;
  /** Appends text under the Issue's `## Comments` heading, creating it if needed. */
  comment(issue: Issue, text: string): Promise<void>;
  /** Records the Issue's Pull Request URL as a `Pull Request:` line near the top, replacing any earlier one. */
  recordPullRequest(issue: Issue, url: string): Promise<void>;
}

const ISSUE_FILE = /^(\d+)-(.+)\.md$/;
const STATUS_LINE = /^Status:[ \t]*(\S*).*$/m;
const PAUSED_SESSION_LINE = /^Paused session:[ \t]*(.*)$/m;
const PAUSED_STAGE_LINE = /^Paused stage:[ \t]*(.*)$/m;
const PAUSE_RECORD = /^Paused (session|stage):.*\n?/gm;
const PULL_REQUEST_LINE = /^Pull Request:[ \t]*(.*)$/m;

/** The URL on the `Pull Request:` line above `## Comments`, or undefined when there is none. */
function parsePullRequest(text: string): string | undefined {
  const value = PULL_REQUEST_LINE.exec(headerOf(text))?.[1]?.replace(/[`<>]/g, "").trim();
  return value || undefined;
}

/** The `# ` heading without a leading `NN:` number, or undefined when the file has no heading. */
function parseTitle(text: string): string | undefined {
  const heading = /^# (.+)$/m.exec(text)?.[1]?.trim();
  return heading?.replace(/^\d+\s*[:.-]\s*/, "").trim() || undefined;
}

function parseStatus(text: string): Status | undefined {
  const value = STATUS_LINE.exec(text)?.[1];
  return STATUSES.find((s) => s === value);
}

/**
 * The blockers on the `Blocked by:` line, as written: an Issue number, or text naming no number.
 * A missing line or `None` means unblocked; a blocker the Run can't read stays unfinished.
 */
function parseBlockedBy(text: string): string[] {
  const value = /^Blocked by:[ \t]*(.*)$/m.exec(text)?.[1]?.trim() ?? "";
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
  const value = /^Model:[ \t]*(.*)$/m.exec(headerOf(text))?.[1]?.replace(/`/g, "").trim();
  return value || undefined;
}

const PAUSABLE_STAGES: readonly PausableStage[] = ["implementer", "review-session"];

/** The pause record of a `paused` Issue, or undefined when either line is missing or unreadable. */
function parsePausedAt(text: string): PausedAt | undefined {
  const header = headerOf(text);
  const sessionId = PAUSED_SESSION_LINE.exec(header)?.[1]?.replace(/`/g, "").trim();
  const stageName = PAUSED_STAGE_LINE.exec(header)?.[1]?.trim();
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

/** `file`'s blockers that are not `done`. Blockers resolve within the same issues directory. */
function unfinishedBlockers(file: IssueFile, all: readonly IssueFile[]): string[] {
  const isDone = (blocker: string) =>
    all.some((f) => f.number === Number(blocker) && dirname(f.path) === dirname(file.path) && f.status === "done");
  return file.blockedBy.filter((blocker) => !isDone(blocker));
}

/** An Issue Store over `.scratch/<feature>/issues/NN-slug.md` files. */
export function createIssueStore(repoDir: string): IssueStore {
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
    const declared = /^Spec:[ \t]*`?([^`\s]+)`?/m.exec(text)?.[1];
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

  async function toIssue(file: IssueFile): Promise<Issue> {
    const slug = basename(file.path, ".md");
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
    };
  }

  return {
    async next() {
      const files = await readIssues();
      const paused = files.find((f) => f.status === "paused");
      if (paused) return toIssue(paused);
      const ready = files.find((f) => f.status === "ready-for-agent" && unfinishedBlockers(f, files).length === 0);
      return ready ? toIssue(ready) : null;
    },

    async blocked() {
      const files = await readIssues();
      return files
        .filter((f) => f.status === "ready-for-agent")
        .map((f) => ({ id: f.id, blockers: unfinishedBlockers(f, files) }))
        .filter((b) => b.blockers.length > 0);
    },

    async awaitingMerge() {
      const files = (await readIssues()).filter((f) => f.status === "awaiting-merge");
      return Promise.all(files.map(toIssue));
    },

    async transition(issue, status) {
      await writeFile(issue.path, withStatus(await readFile(issue.path, "utf8"), status));
    },

    async pause(issue, { sessionId, stage }) {
      const text = withStatus(await readFile(issue.path, "utf8"), "paused");
      const record = `Paused session: ${sessionId}\nPaused stage: ${STAGE_NAMES[stage]}`;
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
      const line = `Pull Request: ${url}`;
      const updated = PULL_REQUEST_LINE.test(header)
        ? header.replace(PULL_REQUEST_LINE, line)
        : STATUS_LINE.test(header)
          ? header.replace(STATUS_LINE, (status) => `${status}\n${line}`)
          : insertAfterTitle(header, line);
      await writeFile(issue.path, updated + text.slice(header.length));
    },
  };
}

/** `text` with its status set and any pause record dropped; `pause()` writes a fresh one. */
function withStatus(text: string, status: Status): string {
  const header = headerOf(text);
  const rest = text.slice(header.length);
  const cleared = header.replace(PAUSE_RECORD, "") + rest;
  return STATUS_LINE.test(cleared)
    ? cleared.replace(STATUS_LINE, `Status: ${status}`)
    : insertAfterTitle(cleared, `Status: ${status}`);
}

function insertAfterTitle(text: string, line: string): string {
  const lines = text.split("\n");
  const titleIndex = lines.findIndex((l) => l.startsWith("# "));
  lines.splice(titleIndex + 1, 0, "", line);
  return lines.join("\n");
}
